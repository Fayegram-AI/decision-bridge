import { requireCondition as check } from '../errors.mjs';
import { isRecord } from '../validation.mjs';
import { validateImageSource, validateJsonInputData } from '../input.mjs';

const own = (value, key) => Object.hasOwn(value, key);
export function fields(value, allowed, required, label, code = 'VALIDATION_ERROR') {
    check(isRecord(value) && Object.keys(value).every(key => allowed.includes(key)) &&
        required.every(key => own(value, key)), `Invalid ${label} fields.`, code);
}
const text = (value, label) => check(typeof value === 'string', `${label} must be text.`);

export function validateCacheBreakpoint(value) {
    if (value === undefined || value === null) return;
    fields(value, ['mode'], ['mode'], 'cache breakpoint');
    check(value.mode === 'explicit', 'Cache breakpoint mode must be explicit.');
}

export function validateCacheOptions(value) {
    if (value === undefined || value === null) return;
    fields(value, ['mode', 'ttl'], [], 'cache options');
    check(value.mode === undefined || value.mode === null || ['implicit', 'explicit'].includes(value.mode), 'Invalid cache mode.');
    check(value.ttl === undefined || value.ttl === '30m', 'Unsupported Decisions cache TTL.');
}

/** Explicit contexts prevent user JSON and shared cache fields leaking into other parts. */
export function validateDecisionContentPart(part, { textOnly = false, json = false, cache = true } = {}) {
    const cacheFields = cache ? ['prompt_cache_breakpoint'] : [];
    if (part?.type === 'input_text') {
        fields(part, ['type', 'text', ...cacheFields], ['type', 'text'], 'input text');
        text(part.text, 'Input text');
    } else if (!textOnly && json && part?.type === 'input_json') {
        fields(part, ['type', 'data'], ['type', 'data'], 'input JSON');
        validateJsonInputData(part.data);
    } else {
        check(!textOnly && part?.type === 'input_image', 'Unsupported input content.');
        fields(part, ['type', 'image_url', 'detail', ...cacheFields], ['type', 'image_url'], 'input image');
        validateImageSource(part.image_url, part.detail);
    }
    if (cache) validateCacheBreakpoint(part.prompt_cache_breakpoint);
}

function outputPart(part) {
    if (part?.type === 'output_text') {
        fields(part, ['type', 'text'], ['type', 'text'], 'output text');
        text(part.text, 'Output text');
    } else {
        fields(part, ['type', 'refusal'], ['type', 'refusal'], 'refusal');
        check(part.type === 'refusal', 'Unsupported assistant content.');
        text(part.refusal, 'Refusal');
    }
}

/** Keep strings, item order, explicit nulls and tool arguments verbatim. */
export function validateDecisionInput(input) {
    if (typeof input === 'string') return;
    check(Array.isArray(input) && input.length > 0, 'input must be text or a nonempty item array.');
    const calls = new Map();
    for (const item of input) {
        if (isRecord(item) && own(item, 'role')) {
            fields(item, ['type', 'role', 'content', 'phase'], ['role', 'content'], 'message');
            check(item.type === undefined || item.type === 'message', 'Invalid message type.');
            check(['user', 'developer', 'system', 'assistant'].includes(item.role), 'Unsupported message role.');
            check(item.phase === undefined || item.phase === null ||
                ['commentary', 'final_answer'].includes(item.phase), 'Invalid assistant phase.');
            if (typeof item.content !== 'string') {
                check(Array.isArray(item.content) && item.content.length > 0, 'Message requires ordered content.');
                for (const part of item.content) {
                    if (item.role === 'assistant') outputPart(part);
                    else validateDecisionContentPart(part, { textOnly: item.role !== 'user', json: item.role === 'user' });
                }
            }
            continue;
        }
        const call = ['function_call', 'custom_tool_call'].includes(item?.type);
        const output = ['function_call_output', 'custom_tool_call_output'].includes(item?.type);
        check(call || output, 'Unsupported conversation item.');
        const payload = output ? 'output' : item.type === 'function_call' ? 'arguments' : 'input';
        fields(item, ['type', 'call_id', payload, 'id', 'status', ...(call ? ['name', 'namespace'] : [])],
            ['type', 'call_id', payload, ...(call ? ['name'] : [])], 'tool item');
        check(typeof item.call_id === 'string' && item.call_id.length > 0, 'Tool items require a call_id.');
        for (const key of ['id', 'namespace']) if (own(item, key) && item[key] !== null) text(item[key], key);
        check(item.status === undefined || item.status === null ||
            ['in_progress', 'completed', 'incomplete'].includes(item.status), 'Invalid tool status.');
        if (call) {
            check(typeof item.name === 'string' && item.name.length > 0, 'Tool calls require a name.');
            text(item[payload], payload);
            calls.set(item.call_id, item.type);
        } else {
            check(calls.get(item.call_id) === item.type.replace('_output', ''), 'Tool output requires a matching preceding call.');
            if (typeof item.output !== 'string') {
                check(Array.isArray(item.output) && item.output.length > 0, 'Tool output requires text or ordered content.');
                item.output.forEach(part => validateDecisionContentPart(part));
            }
        }
    }
}

export function validateDecisionQuestions(questions) {
    check(Array.isArray(questions) && questions.length > 0, 'questions must be a nonempty array.');
    for (const q of questions) {
        check(isRecord(q) && ['predicate', 'choice', 'score'].includes(q.type), 'Unsupported native question type.');
        const extra = q.type === 'choice' ? ['choices'] : q.type === 'score' ? ['levels'] : [];
        fields(q, ['type', 'name', 'instructions', ...extra], ['type', 'instructions', ...extra], 'question');
        if (typeof q.instructions !== 'string') {
            check(Array.isArray(q.instructions) && q.instructions.length > 0, 'Instructions must be text or nonempty content parts.');
            q.instructions.forEach(part => validateDecisionContentPart(part, { json: true, cache: false }));
        }
        if (own(q, 'name')) text(q.name, 'Question name');
        if (q.type === 'choice') {
            check(Array.isArray(q.choices) && q.choices.length >= 2, 'choices requires at least two options.');
            const values = new Set();
            for (const option of q.choices) {
                fields(option, ['value', 'description'], ['value'], 'choice option');
                check(typeof option.value === 'string' || typeof option.value === 'boolean', 'Choice values must be strings or booleans.');
                check(!values.has(option.value), 'Choice values must be distinct.');
                values.add(option.value);
                if (own(option, 'description')) text(option.description, 'Choice description');
            }
        } else if (q.type === 'score') {
            check(Array.isArray(q.levels) && q.levels.length > 0, 'levels must be nonempty.');
            for (const level of q.levels) {
                fields(level, ['label', 'description'], ['label'], 'score level');
                text(level.label, 'Score label');
                if (own(level, 'description')) text(level.description, 'Score description');
            }
        }
    }
}
