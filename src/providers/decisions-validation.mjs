import { DecisionError, requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { isTextWithinLimit, validateImage } from '../input.mjs';
import { builtInCapabilities } from '../capabilities.mjs';
import { OPENAI_DEFAULT_MODEL } from './openai-profile.mjs';

const own = (value, key) => Object.hasOwn(value, key);
function fields(value, allowed, required, label, code = 'VALIDATION_ERROR') {
    check(isRecord(value) && Object.keys(value).every(key => allowed.includes(key)) &&
        required.every(key => own(value, key)), `Invalid ${label} fields.`, code);
}
function text(value, label, max = 1048576) {
    check(isTextWithinLimit(value, max), `Invalid ${label}.`);
}

/** Validate native fields while retaining the selected model for preparation and metadata. */
export function validateDecisionRequest(input, defaultModel = OPENAI_DEFAULT_MODEL) {
    const request = cloneJson(input, 'native decision request');
    fields(request, ['input', 'model', 'questions', 'safety_identifier'], ['input', 'questions'], 'decision request');
    const model = request.model ?? defaultModel;
    check(typeof model === 'string' && model.trim().length > 0, 'model must be nonempty.');
    check(builtInCapabilities('openai-decisions', model).supported,
        'Selected provider/model does not support this model.', 'UNSUPPORTED_CAPABILITY');
    if (own(request, 'model')) text(request.model, 'model');
    if (own(request, 'safety_identifier') && request.safety_identifier !== null) text(request.safety_identifier, 'safety_identifier', 128);
    let images = 0;
    if (typeof request.input === 'string') text(request.input, 'input', 10485760);
    else {
        check(Array.isArray(request.input) && request.input.length > 0, 'input must be text or nonempty user messages.');
        for (const message of request.input) {
            fields(message, ['role', 'content', 'type'], ['role', 'content'], 'input message');
            check(message.role === 'user' && (!own(message, 'type') || message.type === 'message'),
                'Only user input messages are supported.');
            if (typeof message.content === 'string') text(message.content, 'message content', 10485760);
            else {
                check(Array.isArray(message.content) && message.content.length > 0, 'Message content must contain ordered parts.');
                for (const part of message.content) {
                    if (part?.type === 'input_text') {
                        fields(part, ['type', 'text'], ['type', 'text'], 'text part');
                        text(part.text, 'input text', 10485760);
                    } else {
                        fields(part, ['type', 'image_url', 'detail'], ['type', 'image_url'], 'image part');
                        check(part.type === 'input_image', 'Unsupported input part.');
                        validateImage(part.image_url, part.detail);
                        images++;
                    }
                }
            }
        }
    }
    check(images <= 128, 'At most 128 images are supported.', 'UNSUPPORTED_CAPABILITY');
    check(Array.isArray(request.questions) && request.questions.length > 0, 'questions must be a nonempty array.');
    for (const q of request.questions) {
        check(isRecord(q) && ['predicate', 'choice', 'score'].includes(q.type), 'Unsupported native question type.');
        const extra = q.type === 'choice' ? ['choices'] : q.type === 'score' ? ['levels'] : [];
        fields(q, ['type', 'name', 'instructions', ...extra], ['type', 'instructions', ...extra], 'question');
        text(q.instructions, 'instructions');
        if (own(q, 'name')) text(q.name, 'question name');
        if (q.type === 'choice') {
            check(Array.isArray(q.choices) && q.choices.length >= 2 && q.choices.length <= 255,
                'choices must contain 2 to 255 options.');
            const values = new Set();
            for (const option of q.choices) {
                fields(option, ['value', 'description'], ['value'], 'choice option');
                check(typeof option.value === 'string' || typeof option.value === 'boolean', 'Choice values must be strings or booleans.');
                check(!values.has(option.value), 'Choice values must be distinct.');
                values.add(option.value);
                if (own(option, 'description')) text(option.description, 'choice description');
            }
        } else if (q.type === 'score') {
            check(Array.isArray(q.levels) && q.levels.length > 0, 'levels must be nonempty.');
            for (const level of q.levels) {
                fields(level, ['label', 'description'], ['label'], 'score level');
                text(level.label, 'score label');
                if (own(level, 'description')) text(level.description, 'score description');
            }
        }
    }
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
export function validateDecisionResponse(input, request) {
    const data = cloneJson(input, 'native decision response', 'INVALID_RESPONSE');
    fields(data, ['model', 'answers', 'usage'], ['model', 'answers', 'usage'], 'decision response', 'INVALID_RESPONSE');
    invalid(typeof data.model === 'string' && data.model.trim().length > 0, 'Missing reported model.');
    validateUsage(data.usage);
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
    if (refusedQuestions.length) throw new DecisionError('The model refused one or more decision questions.', {
        code: 'MODEL_REFUSAL', refusedQuestions, usage: data.usage,
    });
    return freezeJson(data);
}
