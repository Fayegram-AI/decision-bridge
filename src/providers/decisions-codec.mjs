import { validateResult } from '../validation.mjs';
import { requireCondition as check } from '../errors.mjs';

const own = (value, key) => Object.hasOwn(value, key);
/** Preserve strings; encode structured common instructions as deterministic JSON text. */
const encodeText = value => typeof value === 'string' ? value : JSON.stringify(value);
const description = value => value === undefined || value === null ? {} : { description: encodeText(value) };

/** Only explicit content parts are interpreted; legacy structured values remain text. */
function encodePart(part) {
    if (part.type === 'json') return { type: 'input_json', data: part.data };
    const cache = own(part, 'promptCacheBreakpoint') ? { prompt_cache_breakpoint: part.promptCacheBreakpoint } : {};
    return part.type === 'text' ? { type: 'input_text', text: part.text, ...cache }
        : { type: 'input_image', image_url: part.dataUrl ?? part.url, ...cache,
            ...(own(part, 'detail') ? { detail: part.detail } : {}) };
}

export function encodeCommonDecision(request) {
    check(!request.input?.some(part => !['text', 'image', 'json'].includes(part.type)),
        'OpenAI Decisions does not support audio or video input.', 'UNSUPPORTED_CAPABILITY');
    const input = own(request, 'state') ? encodeText(request.state) : own(request, 'conversation') ? request.conversation
        : [{ role: 'user', content: request.input.map(encodePart) }];
    const questions = Object.entries(request.questions).map(([name, q]) => {
        const base = { name, instructions: own(q, 'instructionParts') ? q.instructionParts.map(encodePart) : encodeText(q.instructions) };
        if (q.type === 'noul') {
            if (!q.criteria || Object.keys(q.criteria).length === 0) return { ...base, type: 'predicate' };
            return { ...base, type: 'choice', choices: [true, false].map(value => ({
                value, ...description(q.criteria[String(value)]),
            })) };
        }
        if (q.type === 'choice') return { ...base, type: 'choice', choices: q.options
            ? q.options.map(option => ({ value: option.value, ...description(option.description) }))
            : Object.entries(q.criteria).map(([value, entry]) => ({ value, ...description(entry) })) };
        return { ...base, type: 'score', levels: q.levels
            ? q.levels.map(level => ({ label: level.label, ...description(level.description) }))
            : q.criteria.map((entry, index) => ({ label: String(index), description: encodeText(entry) })) };
    });
    return { model: request.model, input, questions,
        ...(own(request, 'safetyIdentifier') ? { safety_identifier: request.safetyIdentifier } : {}),
        ...(own(request, 'promptCacheKey') ? { prompt_cache_key: request.promptCacheKey } : {}),
        ...(own(request, 'promptCacheOptions') ? { prompt_cache_options: request.promptCacheOptions } : {}) };
}

export function decodeCommonDecision(decision, request, meta) {
    const answerDetails = {};
    const answers = Object.fromEntries(Object.entries(request.questions).map(([id, q], index) => {
        const native = decision.answers[index];
        const probabilities = new Map(native.probabilities?.map(item => [item.value, item.probability]) ?? []);
        Object.defineProperty(answerDetails, id, { enumerable: true, configurable: true, writable: true,
            value: { type: native.type, ...(own(native, 'confidence') ? { confidence: native.confidence } : {}) } });
        if (q.type === 'noul') return [id, { type: 'noul', noul: native.type === 'predicate' ? native.probability
            : probabilities.get(true) }];
        if (q.type === 'choice') return [id, { type: 'choice', choice: native.choice, confidence: native.confidence,
            probabilities: q.options ? q.options.map(option => ({ value: option.value,
                probability: probabilities.get(option.value) }))
                : Object.fromEntries(native.probabilities.map(item => [item.value, item.probability])) }];
        return [id, { type: 'score', score: native.score, confidence: native.confidence,
            probabilities: Object.fromEntries(native.probabilities.map(item => [String(item.value), item.probability])),
            legend: Object.fromEntries((q.levels ?? q.criteria).map((level, i) => [String(i), level])) }];
    }));
    const usage = decision.usage;
    return validateResult({ model: decision.model, answers,
        usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
            cache_creation_input_tokens: usage.input_tokens_details.cache_write_tokens,
            cache_read_input_tokens: usage.input_tokens_details.cached_tokens },
        meta: { ...meta, provider: 'openai-decisions', requestedModel: request.model,
            probabilitySource: 'native', confidenceSource: 'native', modelSource: 'reported',
            openaiDecisions: { usage, answers: answerDetails } },
    }, request.questions, { native: true });
}
