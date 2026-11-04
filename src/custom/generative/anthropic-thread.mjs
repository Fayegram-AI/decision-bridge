// Explicit in-memory cumulative evaluations. Independent provider calls never share this state.
import { optionsObject } from '../../options.mjs';
import { DecisionError, requireCondition as check } from '../../errors.mjs';
import { cloneJson, freezeJson, isRecord, validateRequest } from '../../validation.mjs';
import { deadline } from '../../async.mjs';
import { serializeRequestBody } from '../../transport.mjs';

const RECOVERABLE = new Set(['thread_not_found', 'thread_already_continued', 'thread_continue_in_flight']);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Retained assistant blocks must be valid for replay without changing opaque fields. */
function validateReplayContent(content) {
    for (const block of content) {
        check(isRecord(block), 'Invalid thread response block.', 'INVALID_RESPONSE');
        const valid = block.type === 'text' ? typeof block.text === 'string'
            : block.type === 'thinking' ? typeof block.thinking === 'string' && typeof block.signature === 'string'
                : block.type === 'redacted_thinking' ? typeof block.data === 'string'
                    : block.type === 'tool_use' && typeof block.id === 'string' && block.id.length > 0 &&
                        block.name === 'submit_decisions' && isRecord(block.input);
        check(valid, 'Invalid thread replay content.', 'INVALID_RESPONSE');
    }
}

/** Only sanitized machine identifiers leave the protocol error boundary. */
export function anthropicError(data, status, meta) {
    const code = data?.error?.details?.error_code;
    const type = data?.error?.type;
    return new DecisionError(`Anthropic returned HTTP ${status}.`, { code: 'HTTP_ERROR', status, source: 'provider', ...meta,
        ...(typeof code === 'string' && /^[a-z_]{1,100}$/.test(code) ? { upstreamErrorCode: code } : {}),
        ...(typeof type === 'string' && /^[a-z_]{1,100}$/.test(type) ? { upstreamErrorType: type } : {}) });
}

export function createAnthropicThread(input, { model, maxRequestBytes, timeoutMs, build, send, parse }) {
    const configured = optionsObject(input, ['questions', 'model', 'maxTurns', 'maxHistoryBytes'], 'Anthropic thread');
    const fixed = freezeJson(validateRequest({ state: '', questions: configured.questions, model: configured.model ?? model }, model ?? ''));
    // Validate the preset's capabilities and response schema before retaining any state.
    build(fixed);
    const maxTurns = configured.maxTurns ?? 128;
    const maxHistoryBytes = configured.maxHistoryBytes ?? Math.min(8 * 1024 * 1024, maxRequestBytes);
    check(Number.isSafeInteger(maxTurns) && maxTurns > 0 && maxTurns <= 1000000, 'Invalid thread turn budget.', 'CONFIGURATION_ERROR');
    check(Number.isSafeInteger(maxHistoryBytes) && maxHistoryBytes > 0 && maxHistoryBytes <= maxRequestBytes,
        'Thread history budget must fit the provider request budget.', 'CONFIGURATION_ERROR');
    let history = [];
    let cursor;
    let turns = 0;
    let pending;
    let disposed = false;
    const usable = () => check(!disposed, 'Thread is disposed.', 'DISPOSED');
    const clear = () => { history = []; cursor = undefined; turns = 0; };
    return Object.freeze({
        async evaluate(state, options = {}) {
            usable();
            check(!pending, 'Thread evaluation is already in progress.', 'THREAD_BUSY');
            const { signal } = optionsObject(options, ['signal'], 'Thread evaluation options');
            const controller = new AbortController();
            const budget = deadline(timeoutMs, signal);
            const combined = AbortSignal.any([controller.signal, budget.signal]);
            pending = controller;
            let dispatched = false;
            let attempts = 0;
            const started = performance.now();
            try {
                budget.throwIfAborted();
                check(turns < maxTurns, 'Thread turn budget exceeded; reset or create another thread.', 'HISTORY_LIMIT');
                const request = validateRequest({ state, questions: fixed.questions, model: fixed.model });
                const base = build(request);
                base.system += '\nEvaluate the cumulative evidence in all accepted user states in this conversation against the fixed questions.';
                const toolCalls = history.at(-1)?.content?.filter(block => block.type === 'tool_use') ?? [];
                const next = { role: 'user', content: toolCalls.length ? [
                    ...toolCalls.map(tool => ({ type: 'tool_result', tool_use_id: tool.id, content: 'Decision output received.' })),
                    { type: 'text', text: base.messages[0].content },
                ] : base.messages[0].content };
                const staged = [...history, next];
                check(bytes(staged) <= maxHistoryBytes, 'Thread history byte budget exceeded.', 'HISTORY_LIMIT');
                let previous = cursor;
                for (let replay = 0; ; replay++) {
                    budget.throwIfAborted();
                    usable();
                    const body = { ...base, messages: previous ? [next] : staged,
                        thread: previous ? { type: 'continue', previous_message_id: previous } : { type: 'create' } };
                    if (previous) { delete body.system; delete body.tools; }
                    serializeRequestBody(body, maxRequestBytes);
                    dispatched = true;
                    let response;
                    try { response = await send(body, { signal: combined }); attempts += response.meta.attempts; }
                    catch (error) {
                        attempts += error.attempts ?? 0;
                        if (previous && replay === 0 && RECOVERABLE.has(error.upstreamErrorCode) &&
                            (error.status === 404 && error.upstreamErrorCode === 'thread_not_found' || error.status === 400 && error.upstreamErrorCode !== 'thread_not_found')) {
                            previous = undefined;
                            continue;
                        }
                        throw error;
                    }
                    budget.throwIfAborted();
                    usable();
                    const { data, meta } = response;
                    const result = parse(data, request, { ...meta, attempts,
                        durationMs: Math.round((performance.now() - started) * 1000) / 1000 });
                    check(typeof data.id === 'string' && data.id.length > 0, 'Thread response requires a message ID.', 'INVALID_RESPONSE');
                    validateReplayContent(data.content);
                    const accepted = [...staged, { role: 'assistant', content: cloneJson(data.content, 'thread response', 'INVALID_RESPONSE') }];
                    check(bytes(accepted) <= maxHistoryBytes, 'Thread response exceeds the retained history budget.', 'HISTORY_LIMIT');
                    const iterations = data.usage?.iterations;
                    check(iterations == null || Array.isArray(iterations) && iterations.every(i => isRecord(i) && typeof i.type === 'string'),
                        'Invalid thread usage iterations.', 'INVALID_RESPONSE');
                    const nextCursor = iterations?.some(i => i.type === 'fallback_message') ? undefined : data.id;
                    // Commit only after every response and retained-state check succeeds.
                    history = accepted;
                    turns++;
                    cursor = nextCursor;
                    return result;
                }
            } catch (error) {
                if (dispatched) cursor = undefined;
                if (disposed) throw new DecisionError('Thread is disposed.', { code: 'DISPOSED', attempts });
                if (budget.timedOut) throw new DecisionError('Thread evaluation deadline exceeded.', { code: 'TIMEOUT', attempts });
                if (dispatched && error instanceof DecisionError) error.attempts = attempts;
                throw error;
            } finally { pending = undefined; budget.close(); }
        },
        reset() { usable(); check(!pending, 'Cannot reset a busy thread.', 'THREAD_BUSY'); clear(); },
        dispose() { if (disposed) return; disposed = true; pending?.abort(); clear(); },
    });
}
