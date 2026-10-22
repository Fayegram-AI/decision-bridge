import { DecisionError, requireCondition as check, publicError } from '../errors.mjs';
import { optionsObject } from '../options.mjs';
import { deadline, validateSignal, withSignal } from '../async.mjs';
import { freezeJson } from '../validation.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { validateLiveCommand, validateLiveConfiguration, validateLiveEvent } from './validation.mjs';
import { createLiveState } from './state.mjs';

export { validateLiveCommand, validateLiveConfiguration, validateLiveEvent } from './validation.mjs';

/** Own Decisions commands and correlation, while the application owns its connection. */
export function createLiveDecisions(options) {
    const { transport, configuration, timeoutMs = 30000, maxPending = 128, maxHistory = 4096,
        maxRequestBytes = 8 * 1024 * 1024, maxResponseBytes = 8 * 1024 * 1024 } = optionsObject(options,
        ['transport', 'configuration', 'timeoutMs', 'maxPending', 'maxHistory', 'maxRequestBytes', 'maxResponseBytes'], 'Live controller options');
    check(transport && typeof transport.send === 'function' && typeof transport.subscribe === 'function',
        'Live requires a supplied connection adapter.', 'CONFIGURATION_ERROR');
    for (const value of [maxPending, maxHistory]) check(Number.isSafeInteger(value) && value > 0,
        'Live history and pending budgets must be positive integers.', 'CONFIGURATION_ERROR');
    for (const value of [maxRequestBytes, maxResponseBytes]) check(Number.isSafeInteger(value) && value > 0 && value <= 64 * 1024 * 1024,
        'Live byte budgets must be within 1 to 64 MiB.', 'CONFIGURATION_ERROR');
    check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2147483647, 'Invalid Live timeout.', 'CONFIGURATION_ERROR');
    const state = createLiveState({ configuration, maxHistory });
    const observers = new Set();
    const pending = new Map();
    const prefix = globalThis.crypto.randomUUID();
    let sequence = 0;
    let closed = false;
    let closeError;
    const lifetime = new AbortController();
    let unsubscribe;
    const failure = (code, message) => new DecisionError(message, { code, source: 'client' });

    function notify(event) {
        const immutable = freezeJson(event);
        // Subscription changes affect later deliveries, never revisit a recipient.
        for (const observer of [...observers]) {
            if (!observers.has(observer)) continue;
            const failed = () => {
                if (event.type !== 'observer_error' && !closed) notify({ type: 'observer_error',
                    error: { code: 'OBSERVER_ERROR', message: 'A Live observer failed.' } });
            };
            try { Promise.resolve(observer(immutable)).catch(failed); } catch { failed(); }
        }
    }
    function detach() {
        const cleanup = unsubscribe;
        unsubscribe = undefined;
        try { cleanup?.(); } catch { /* Application cleanup cannot retain pending work. */ }
    }
    function close(code, message, report = true) {
        if (closed) return;
        closed = true;
        closeError = failure(code, message);
        lifetime.abort();
        for (const wait of pending.values()) wait.reject(failure(code, message));
        pending.clear();
        detach();
        state.clear();
        if (report) notify({ type: 'closed', error: { code, message } });
        observers.clear();
    }
    function receive(notification) {
        if (closed) return;
        if (notification?.kind === 'close' || notification?.kind === 'error') {
            close(notification.kind === 'close' ? 'CONNECTION_CLOSED' : 'NETWORK_ERROR', 'The supplied Live connection ended.');
            return;
        }
        try {
            check(notification?.kind === 'event', 'Invalid connection notification.', 'INVALID_RESPONSE');
            const event = validateLiveEvent(notification.event);
            try { serializeRequestBody(event, maxResponseBytes); }
            catch (error) {
                if (error.code === 'REQUEST_TOO_LARGE') throw failure('RESPONSE_TOO_LARGE', 'Live event exceeds the client byte budget.');
                throw error;
            }
            const normalized = state.accept(event);
            const clientId = event.error?.client_event_id ?? event.client_event_id;
            const wait = clientId ? pending.get(clientId) : undefined;
            if (normalized?.type !== 'duplicate' && wait) {
                if (event.type === 'error') wait.reject(new DecisionError(normalized.error.message, normalized.error));
                else if (event.type === wait.expected) {
                    const mismatched = event.type === 'decision.item.deleted' && event.item_id !== wait.command.item_id ||
                        event.type === 'decision.item.created' && wait.command.item.id && event.item.id !== wait.command.item.id;
                    if (mismatched) {
                        const error = failure('INVALID_RESPONSE', 'Item acknowledgement does not match the command.');
                        wait.reject(error);
                        throw error;
                    }
                    wait.resolve(normalized);
                }
            }
            if (normalized) notify(normalized);
            if (event.type === 'session.closed') close('CONNECTION_CLOSED', 'The Live session closed.', false);
        } catch (error) { notify({ type: 'error', error: publicError(error) }); }
    }
    try { unsubscribe = transport.subscribe(receive); }
    catch { throw failure('NETWORK_ERROR', 'Cannot subscribe to the supplied Live connection.'); }
    check(typeof unsubscribe === 'function', 'Live transport subscribe must return an unsubscribe function.', 'CONFIGURATION_ERROR');
    if (closed) detach();

    async function send(type, body, expected, options = {}) {
        const { signal, timeoutMs: callTimeoutMs = timeoutMs } = optionsObject(options, ['signal', 'timeoutMs'], 'Live call options');
        check(!closed, 'Live controller is closed.', 'CONNECTION_CLOSED');
        check(pending.size < maxPending, 'Live pending operations exceed the client resource budget.', 'RESOURCE_LIMIT');
        validateSignal(signal);
        const budget = deadline(callTimeoutMs, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal);
        let command;
        try {
            budget.throwIfAborted();
            command = validateLiveCommand({ ...body, type, event_id: `${prefix}_${++sequence}` });
            budget.throwIfAborted();
        } catch (error) {
            budget.close();
            if (budget.timedOut) throw failure('TIMEOUT', 'Live command deadline exceeded.');
            throw error;
        }
        let observed = false;
        let resolve;
        let reject;
        const acknowledged = expected ? new Promise((yes, no) => { resolve = yes; reject = no; }) : undefined;
        acknowledged?.catch(() => {});
        // Submission-only calls are tracked too, so disposal interrupts a stalled send.
        const stopped = new Promise((_yes, no) => {
            pending.set(command.event_id, { resolve, reject: no, expected, command });
        });
        stopped.catch(() => {});
        if (expected) pending.get(command.event_id).reject = error => { reject(error); };
        try {
            budget.throwIfAborted();
            serializeRequestBody(command, maxRequestBytes);
            const dispatched = Promise.resolve().then(() => {
                budget.throwIfAborted();
                // Unsent updates cannot change the accepted configuration. Observe
                // just before send so synchronous acknowledgements still correlate.
                state.observeClient(command);
                observed = true;
                return transport.send(command);
            });
            // Acknowledgement can arrive synchronously from a supplied transport.
            await withSignal(Promise.race([dispatched, expected ? acknowledged.then(() => undefined) : stopped]), budget.signal);
            if (expected) return await withSignal(acknowledged, budget.signal);
            budget.throwIfAborted();
            return freezeJson({ eventId: command.event_id, type, status: 'submitted' });
        } catch (error) {
            if (observed) state.abandon(command);
            if (budget.timedOut) throw failure('TIMEOUT', 'Live command deadline exceeded.');
            if (signal?.aborted) throw failure('ABORTED', 'Live command cancelled.');
            if (closed) throw closeError;
            if (error instanceof DecisionError) throw error;
            throw failure('NETWORK_ERROR', 'Live command submission failed.');
        } finally { pending.delete(command.event_id); budget.close(); }
    }
    return Object.freeze({
        configure(config, call) { return send('session.update', { session: config }, 'session.updated', call); },
        createItem(item, call) { return send('decision.item.create', { item }, 'decision.item.created', call); },
        deleteItem(itemId, call) { return send('decision.item.delete', { item_id: itemId }, 'decision.item.deleted', call); },
        requestDecision(call) { return send('decision.create', {}, undefined, call); },
        appendCommentary(content, options = {}) {
            const { delegationId = null, ...call } = optionsObject(options, ['delegationId', 'signal', 'timeoutMs'], 'Commentary options');
            return send('session.commentary.append', { content, delegation_id: delegationId }, undefined, call);
        },
        subscribe(observer) {
            check(!closed && typeof observer === 'function', 'Live subscription requires an open controller and function.', 'CONFIGURATION_ERROR');
            observers.add(observer);
            return () => observers.delete(observer);
        },
        dispose() { close('DISPOSED', 'Live controller disposed.'); },
    });
}
