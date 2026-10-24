// Work, human interaction and total elapsed time have independent deadlines.
import { deadline, withSignal, abortError, validateSignal } from '../async.mjs';
import { DecisionError } from '../errors.mjs';

export function routingBudget(options, call, started = performance.now()) {
    validateSignal(call.signal);
    const overall = call.timeoutMs === undefined ? undefined : deadline(Math.max(1, Math.floor(call.timeoutMs - (performance.now() - started))), call.signal);
    const signal = overall?.signal ?? call.signal;
    const limit = options.workTimeoutMs ?? 60000;
    let workMs = 0;
    let clarificationMs = 0;
    const check = () => {
        if (call.signal?.aborted) throw abortError();
        if (overall?.timedOut || call.timeoutMs !== undefined && performance.now() - started >= call.timeoutMs) throw new DecisionError('Routing overall deadline exceeded.', { code: 'TIMEOUT' });
        if (signal?.aborted) throw abortError();
    };
    return {
        signal,
        check,
        remaining: () => Math.max(0, limit - workMs),
        timings: () => ({ workMs: Math.round(workMs), clarificationMs: Math.round(clarificationMs), wallMs: Math.round(performance.now() - started) }),
        close: () => overall?.close(),
        async wait(promise) {
            try { check(); return await withSignal(promise, signal); }
            catch (error) { check(); throw error; }
        },
        async run(kind, callback, cap) {
            check();
            const ms = kind === 'work' ? Math.min(limit - workMs, cap ?? Infinity)
                : cap ?? options.clarificationTimeoutMs ?? 300000;
            if (ms < 1) throw new DecisionError('Routing work deadline exceeded.', { code: 'TIMEOUT' });
            const stage = deadline(Math.max(1, Math.floor(ms)), signal);
            const start = performance.now();
            try {
                stage.throwIfAborted();
                const value = await withSignal(callback(stage.signal), stage.signal);
                stage.throwIfAborted(); check();
                return value;
            } catch (error) {
                check();
                if (stage.timedOut) throw new DecisionError(kind === 'work' ? 'Routing work deadline exceeded.' : 'Routing clarification deadline exceeded.',
                    { code: kind === 'work' ? 'TIMEOUT' : 'CLARIFICATION_TIMEOUT' });
                throw error;
            } finally {
                const elapsed = performance.now() - start;
                if (kind === 'work') workMs += elapsed; else clarificationMs += elapsed;
                stage.close();
            }
        },
    };
}

/** Ordered admission; skipped rows release their place without consuming a budget. */
export function clarificationGate() {
    const slots = new Map();
    let next = 0;
    function slot(index) {
        if (!slots.has(index)) {
            let resolve;
            const promise = new Promise(done => { resolve = done; });
            slots.set(index, { promise, resolve, done: false });
        }
        return slots.get(index);
    }
    return {
        wait(index) { if (index === next) return Promise.resolve(); return slot(index).promise; },
        done(index) {
            if (index < next) return;
            slot(index).done = true;
            while (slots.get(next)?.done) { slots.delete(next++); }
            slots.get(next)?.resolve();
        },
    };
}
