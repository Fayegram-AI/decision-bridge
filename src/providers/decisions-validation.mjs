import { DecisionError, requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { builtInCapabilities } from '../capabilities.mjs';
import { OPENAI_DEFAULT_MODEL } from './openai-profile.mjs';
import { fields, validateCacheOptions, validateDecisionInput, validateDecisionQuestions } from './decisions-input.mjs';

/** Structural preflight; service counts and context limits remain server-owned. */
export function validateDecisionRequest(input, defaultModel = OPENAI_DEFAULT_MODEL) {
    const request = cloneJson(input, 'native decision request');
    fields(request, ['input', 'model', 'questions', 'safety_identifier', 'prompt_cache_key', 'prompt_cache_options'],
        ['input', 'questions'], 'decision request');
    const model = Object.hasOwn(request, 'model') ? request.model : defaultModel;
    check(typeof model === 'string' && model.trim().length > 0, 'model must be nonempty.');
    check(builtInCapabilities('openai-decisions', model).supported,
        'Selected provider/model does not support this model.', 'UNSUPPORTED_CAPABILITY');
    for (const key of ['safety_identifier', 'prompt_cache_key']) {
        check(request[key] === undefined || request[key] === null || typeof request[key] === 'string', key + ' must be text or null.');
    }
    validateCacheOptions(request.prompt_cache_options);
    validateDecisionInput(request.input);
    validateDecisionQuestions(request.questions);
    return freezeJson({ ...request, model });
}

const invalid = (condition, message) => check(condition, message, 'INVALID_RESPONSE');
const probability = value => invalid(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1, 'Invalid decision probability.');
const tokens = value => invalid(Number.isSafeInteger(value) && value >= 0, 'Invalid decision token usage.');

function validateUsage(usage) {
    fields(usage, ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details'],
        ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details'], 'usage', 'INVALID_RESPONSE');
    for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) tokens(usage[key]);
    fields(usage.input_tokens_details, ['cached_tokens', 'cache_write_tokens'], ['cached_tokens', 'cache_write_tokens'], 'input usage', 'INVALID_RESPONSE');
    fields(usage.output_tokens_details, ['reasoning_tokens'], ['reasoning_tokens'], 'output usage', 'INVALID_RESPONSE');
    Object.values(usage.input_tokens_details).forEach(tokens);
    Object.values(usage.output_tokens_details).forEach(tokens);
}

/** Refusals are failures even when valid sibling answers exist. No partial success. */
export function validateDecisionResponse(input, request, { allowRefusals = false } = {}) {
    const data = cloneJson(input, 'native decision response', 'INVALID_RESPONSE');
    fields(data, ['model', 'answers', 'usage'], ['model', 'answers', 'usage'], 'decision response', 'INVALID_RESPONSE');
    invalid(typeof data.model === 'string' && data.model.trim().length > 0, 'Missing reported model.');
    validateUsage(data.usage);
    // Live can deliver a native result before its configuration is observed.
    // Validate its self-contained distribution without inventing request correlation.
    if (!request) {
        invalid(Array.isArray(data.answers) && data.answers.length > 0, 'Missing decision answers.');
        request = { questions: data.answers.map(answer => {
            invalid(isRecord(answer) && (answer.name === null || typeof answer.name === 'string'), 'Invalid answer name.');
            invalid(['predicate', 'choice', 'score', 'refusal'].includes(answer.type), 'Invalid answer type.');
            const question = { type: answer.type, ...(answer.name === null ? {} : { name: answer.name }) };
            if (answer.type === 'choice' || answer.type === 'score') {
                invalid(Array.isArray(answer.probabilities) && answer.probabilities.length > 0, 'Missing decision distribution.');
                if (answer.type === 'choice') question.choices = answer.probabilities.map(item => {
                    invalid(isRecord(item) && ['string', 'boolean'].includes(typeof item.value), 'Invalid choice value.');
                    return { value: item.value };
                });
                else {
                    const sorted = [...answer.probabilities].sort((a, b) => a?.value - b?.value);
                    question.levels = sorted.map((item, index) => {
                        invalid(isRecord(item) && item.value === index && typeof item.label === 'string', 'Invalid score level.');
                        return { label: item.label };
                    });
                }
            }
            return question;
        }) };
    }
    invalid(Array.isArray(data.answers) && data.answers.length === request.questions.length, 'Decision answer count mismatch.');
    const refusedQuestions = [];
    for (let index = 0; index < data.answers.length; index++) {
        const answer = data.answers[index];
        const q = request.questions[index];
        invalid(isRecord(answer) && answer.name === (q.name ?? null), 'Decision answer name/order mismatch.');
        if (answer.type === 'refusal') {
            fields(answer, ['type', 'name'], ['type', 'name'], 'refusal', 'INVALID_RESPONSE');
            refusedQuestions.push({ index, name: answer.name });
            continue;
        }
        invalid(answer.type === q.type, 'Decision answer type mismatch.');
        if (q.type === 'predicate') {
            fields(answer, ['type', 'name', 'probability'], ['type', 'name', 'probability'], 'predicate answer', 'INVALID_RESPONSE');
            probability(answer.probability);
            continue;
        }
        const selectedField = q.type === 'choice' ? 'choice' : 'score';
        const keys = ['type', 'name', 'confidence', 'probabilities', selectedField];
        fields(answer, keys, keys, 'decision answer', 'INVALID_RESPONSE');
        invalid(typeof answer.confidence === 'number' && Number.isFinite(answer.confidence), 'Invalid native confidence.');
        const supplied = q.type === 'choice' ? q.choices : q.levels;
        invalid(Array.isArray(answer.probabilities) && answer.probabilities.length === supplied.length, 'Decision distribution count mismatch.');
        const values = new Set(q.type === 'choice' ? q.choices.map(option => option.value) : q.levels.map((_, i) => i));
        const seen = new Set();
        let total = 0;
        let mean = 0;
        for (const item of answer.probabilities) {
            const keys = q.type === 'choice' ? ['value', 'probability'] : ['value', 'label', 'probability'];
            fields(item, keys, keys, 'decision probability', 'INVALID_RESPONSE');
            invalid(values.has(item.value) && !seen.has(item.value), 'Decision distribution values mismatch.');
            seen.add(item.value);
            probability(item.probability);
            total += item.probability;
            if (q.type === 'score') {
                invalid(item.label === q.levels[item.value].label, 'Decision score label mismatch.');
                mean += item.value * item.probability;
            }
        }
        invalid(Math.abs(total - 1) <= 1e-3, 'Decision probabilities must sum to 1.');
        if (q.type === 'choice') invalid(values.has(answer.choice), 'Decision choice is not a supplied value.');
        else invalid(typeof answer.score === 'number' && Number.isFinite(answer.score) && answer.score >= 0 &&
            answer.score <= supplied.length - 1 && Math.abs(answer.score - mean) <= 0.02 * supplied.length,
        'Decision score is inconsistent with its rubric.');
    }
    if (refusedQuestions.length && !allowRefusals) throw new DecisionError('The model refused one or more decision questions.', {
        code: 'MODEL_REFUSAL', refusedQuestions, usage: data.usage,
    });
    return freezeJson(data);
}
