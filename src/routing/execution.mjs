// Cross-route recovery is deliberately narrower than provider transport retry policy.
import { DecisionError } from '../errors.mjs';
import { createBridge } from '../bridge.mjs';
import { deadline, withSignal } from '../async.mjs';
import { freezeJson } from '../validation.mjs';
import { refreshEligibility } from './preflight.mjs';
import { cooldownKey } from './cooldown.mjs';
import { usageSnapshot } from './diagnostics.mjs';

const TRANSIENT = new Set(['RATE_LIMITED', 'CAPACITY_EXCEEDED']);

export async function executeSelected(ticket, state, selection) {
    const { registry, policy, operation, cooldowns } = state;
    const automatic = ticket.requestedRoute === 'auto';
    const attempts = ticket.diagnostics.attempts;
    let id = selection.id;
    let method = selection.method;
    const maxAttempts = automatic && policy.failover ? policy.failover.maxAttempts ?? 2 : 1;
    function fresh(signal) { return refreshEligibility(state, ticket.request, ticket.call, signal,
        { direct: automatic ? undefined : ticket.requestedRoute }); }
    async function nextRoute(report) {
        if (!automatic || !policy.failover || attempts.length >= maxAttempts) return undefined;
        const current = report ?? await ticket.budget.run('work', fresh);
        return policy.failover.routes.find(next => current.verified.includes(next) && !attempts.some(attempt => attempt.route === next));
    }
    while (true) {
        ticket.budget.check();
        // Full preflight can be expensive even when synchronous; charge it before dispatch.
        const report = await ticket.budget.run('work', fresh);
        if (!report.verified.includes(id)) {
            id = await nextRoute(report);
            if (!id) throw new DecisionError('Selected route became unavailable before dispatch.', { code: 'ROUTE_UNAVAILABLE' });
            method = 'failover';
        }
        const target = registry.get(id);
        ticket.diagnostics.selectedRoute = id;
        ticket.diagnostics.method = method;
        const attempt = { route: id, usage: null };
        let dispatched = false;
        try {
            const result = await ticket.budget.run('work', async signal => {
                const provider = await target.initialize(signal);
                if (automatic && !(await fresh(signal)).verified.includes(id)) throw new DecisionError('Selected route became unavailable before dispatch.', { code: 'ROUTE_UNAVAILABLE' });
                // Preserve an explicit caller alias while allowing provider-native normalization.
                target.preflight(ticket.request);
                const request = ticket.request.model === undefined && target.model !== undefined
                    ? { ...ticket.request, model: target.model } : ticket.request;
                dispatched = true;
                attempts.push(attempt);
                return operation === 'extraction' ? provider.extract(request, { signal })
                    : createBridge({ provider }).evaluate(request, { signal });
            });
            attempt.usage = usageSnapshot(result.usage ?? result.extraction?.usage);
            attempt.status = 'succeeded';
            return result;
        } catch (error) {
            if (!dispatched) {
                const next = error?.code === 'ROUTE_UNAVAILABLE' ? await nextRoute() : undefined;
                if (!next) throw error;
                id = next; method = 'failover'; continue;
            }
            attempt.status = 'failed';
            attempt.code = error instanceof DecisionError ? error.code : 'PROVIDER_ERROR';
            if (error instanceof DecisionError) attempt.usage = usageSnapshot(error.usage);
            if (!automatic || !TRANSIENT.has(attempt.code)) throw error;
            if (policy.cooldown) {
                const duration = Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : policy.cooldown.durationMs ?? 30000;
                const key = cooldownKey(target);
                cooldowns.set(key, Math.max(cooldowns.get(key) ?? 0, Date.now() + Math.min(duration, 2147483647)));
            }
            const next = await nextRoute();
            if (!next) throw error;
            id = next; method = 'failover';
        }
    }
}

/** Once execution succeeded, an observer cannot turn the result into a retryable error. */
export async function observe(result, ticket, state) {
    let failure = false;
    const snapshot = freezeJson({ ...result, meta: { ...result.meta, routing: {
        ...ticket.diagnostics, timings: ticket.budget.timings(),
    } } });
    if (state.options.onResult) {
        const observer = deadline(state.options.observerTimeoutMs ?? 1000, ticket.call.signal);
        try {
            observer.throwIfAborted();
            await withSignal(Promise.resolve().then(() => {
                observer.throwIfAborted();
                return state.options.onResult(snapshot, Object.freeze({ operation: state.operation, requestedRoute: ticket.requestedRoute, signal: observer.signal }));
            }), observer.signal);
            observer.throwIfAborted();
        } catch { failure = true; }
        finally { observer.close(); }
    }
    return freezeJson({ ...snapshot, meta: { ...snapshot.meta, routing: { ...snapshot.meta.routing, observerFailed: failure } } });
}
