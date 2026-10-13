import { optionsObject } from './options.mjs';
import { requireCondition as check } from './errors.mjs';
import { cloneJson, isRecord, validateResult } from './validation.mjs';

/** Optional application policy; never executes an action or alters the model's answer. */
export function decideChoice(answer, options = {}) {
    const { minProbability, minMargin = 0, abstainOptions = [], probabilityDecimalPlaces } = optionsObject(
        options, ['minProbability', 'minMargin', 'abstainOptions', 'probabilityDecimalPlaces'], 'Choice policy options');
    check(Number.isFinite(minProbability) && minProbability >= 0 && minProbability <= 1,
        'Supply minProbability explicitly in [0, 1].');
    check(Number.isFinite(minMargin) && minMargin >= 0 && minMargin <= 1, 'minMargin must be in [0, 1].');
    const abstentions = cloneJson(abstainOptions, 'abstainOptions');
    check(Array.isArray(abstentions) && abstentions.every(x => typeof x === 'string' || typeof x === 'boolean'),
        'abstainOptions must be an array of labels.');
    // Snapshot before deriving criteria or applying policy; never invoke answer accessors.
    answer = cloneJson(answer, 'choice answer', 'INVALID_RESPONSE');
    check(isRecord(answer) && answer.type === 'choice' &&
        (isRecord(answer.probabilities) || Array.isArray(answer.probabilities)), 'A choice answer is required.');
    const typed = Array.isArray(answer.probabilities);
    if (typed) check(answer.probabilities.every(isRecord), 'Typed probabilities must contain objects.', 'INVALID_RESPONSE');
    const criteria = typed ? { options: answer.probabilities.map(item => ({ value: item.value })) }
        : { criteria: Object.fromEntries(Object.keys(answer.probabilities).map(key => [key, null])) };
    // Select precision explicitly from the provider contract, never the answer or metadata.
    validateResult({ model: 'policy-validation', answers: { value: answer },
        usage: { input_tokens: 0, output_tokens: 0 } }, { value: { type: 'choice', ...criteria } }, { probabilityDecimalPlaces });
    const probabilities = new Map(typed ? answer.probabilities.map(item => [item.value, item.probability])
        : Object.entries(answer.probabilities));
    check(abstentions.every(label => probabilities.has(label)),
        'Every abstainOptions label must be an available choice.');
    const selectedProbability = probabilities.get(answer.choice);
    const runnerUp = Math.max(0, ...[...probabilities]
        .filter(([label]) => label !== answer.choice).map(([, p]) => p));
    const margin = selectedProbability - runnerUp;
    const reason = abstentions.includes(answer.choice) ? 'abstain_option'
        : selectedProbability < minProbability ? 'probability_below_threshold'
            : margin < minMargin ? 'margin_below_threshold' : null;
    return Object.freeze({
        status: reason === null ? 'selected' : 'review',
        choice: answer.choice,
        selectedProbability,
        margin,
        reason,
    });
}
