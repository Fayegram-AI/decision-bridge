// Human selection precedes model selection. Both operate on the verified candidate set.
import { DecisionError, requireCondition as check } from '../errors.mjs';
import { optionsObject } from '../options.mjs';
import { cloneJson, freezeJson } from '../validation.mjs';
import { createBridge } from '../bridge.mjs';
import { decideChoice } from '../policy.mjs';
import { resultValidationPolicies } from '../probabilities.mjs';
import { usageSnapshot } from './diagnostics.mjs';
import { publicTarget, selectorRequest } from './context.mjs';
import { localChoice, selectorReadiness, noEligible } from './eligibility.mjs';
import { refreshEligibility } from './preflight.mjs';

function failureClass(error) {
    if (error.code === 'ROUTING_AMBIGUOUS') return 'abstain';
    if (error.code === 'INVALID_RESPONSE') return 'invalid-response';
    if (error.code === 'TIMEOUT') return 'timeout';
    if (error.code === 'ROUTING_CONTEXT_TOO_LARGE') return 'context-too-large';
    if (['RATE_LIMITED', 'CAPACITY_EXCEEDED', 'AUTHENTICATION_ERROR', 'PERMISSION_DENIED', 'ALLOCATION_EXCEEDED',
        'HTTP_ERROR', 'NETWORK_ERROR'].includes(error.code)) return 'unavailable';
}

async function refreshCandidates(ticket, state) {
    ticket.report = await ticket.budget.run('work', signal => refreshEligibility(state, ticket.request, ticket.call, signal));
    ticket.diagnostics.candidates = ticket.report.entries.map(({ id, status, code }) => ({ id, status, ...(code ? { code } : {}) }));
    if (!ticket.report.verified.length) noEligible(ticket.report);
}

async function assisted(ticket, state) {
    const { registry, policy, operation } = state;
    check(selectorReadiness(policy, registry).ready, 'Decision-assisted routing requires a ready decision selector, model and explicit thresholds.', 'CONFIGURATION_ERROR');
    const target = registry.get(policy.selector.route);
    const selectorMeta = { route: target.id, usage: null };
    ticket.diagnostics.selector = selectorMeta;
    try {
        return await ticket.budget.run('work', async signal => {
            const context = selectorRequest(ticket.request, operation,
                ticket.report.verified.map(id => registry.get(id)), policy, ticket.call);
            const provider = await target.initialize(signal);
            const request = target.preflight(context.request);
            const bridge = createBridge({ provider });
            const result = await bridge.evaluate(request, { signal });
            Object.assign(selectorMeta, { provider: result.meta.provider.slice(0, 256), model: result.model.slice(0, 256), usage: usageSnapshot(result.usage) });
            const validation = resultValidationPolicies.get(result);
            const decision = decideChoice(result.answers.route, {
                minProbability: policy.selector.minProbability, minMargin: policy.selector.minMargin,
                abstainOptions: ['abstain'], probabilityDecimalPlaces: validation.probabilityDecimalPlaces,
            });
            check(decision.status === 'selected' && context.choices.has(decision.choice), 'The selector did not choose a route within its acceptance policy.', 'ROUTING_AMBIGUOUS');
            const id = context.choices.get(decision.choice);
            check(ticket.report.verified.includes(id), 'Selector returned an ineligible route.', 'INVALID_RESPONSE');
            return { id, method: 'selector' };
        }, Math.min(policy.selector.timeoutMs ?? 5000, Math.floor(ticket.budget.remaining() / 2)));
    } catch (error) {
        selectorMeta.failureCode = error instanceof DecisionError ? error.code : 'PROVIDER_ERROR';
        if (error instanceof DecisionError && error.usage !== undefined) selectorMeta.usage = usageSnapshot(error.usage);
        const reason = failureClass(error);
        const fallback = localChoice(policy, ticket.report.verified, ticket.report.facts);
        if (reason && policy.selector.fallbackOn?.includes(reason) && fallback) return { ...fallback, method: 'selector-fallback' };
        throw error;
    }
}

function localSelection(policy, report) {
    const needsSelector = policy.policy === 'decision-assisted' && policy.selector?.when === 'multiple' && report.verified.length > 1;
    return needsSelector ? undefined : localChoice(policy, report.verified, report.facts);
}

export async function selectRoute(ticket, state) {
    const { policy, registry } = state;
    if (ticket.requestedRoute !== 'auto') { ticket.admission?.done(); return { id: ticket.requestedRoute, method: 'direct' }; }
    // Batch preparation may precede selection by other requests' entire executions.
    await refreshCandidates(ticket, state);
    const local = localSelection(policy, ticket.report);
    if (local) { ticket.admission?.done(); return local; }
    if (ticket.clarify) {
        try {
            if (ticket.admission) await ticket.budget.wait(ticket.admission.wait());
            // Waiting can change both eligibility and the deterministic policy winner.
            await refreshCandidates(ticket, state);
            const refreshed = localSelection(policy, ticket.report);
            if (refreshed) return refreshed;
            const response = await ticket.budget.run('human', signal => ticket.clarify(freezeJson({
                operation: state.operation, requestedRoute: 'auto', candidates: ticket.report.verified.map(id => publicTarget(registry.get(id))),
                selectorAvailable: selectorReadiness(policy, registry).ready,
            }), Object.freeze({ signal })), policy.clarification?.timeoutMs);
            const answer = cloneJson(response, 'clarification answer', 'VALIDATION_ERROR');
            optionsObject(answer, ['action', 'route'], 'Clarification answer');
            check(['select', 'use-selector', 'cancel'].includes(answer.action), 'Unknown clarification action.');
            check(answer.action === 'select' || answer.route === undefined, 'Only selection accepts a route.');
            if (answer.action === 'cancel') throw new DecisionError('Routing cancelled during clarification.', { code: 'ABORTED' });
            if (answer.action === 'select') {
                check(ticket.report.verified.includes(answer.route), 'Clarification must select a currently eligible concrete route.');
                return { id: answer.route, method: 'clarification' };
            }
            check(policy.policy === 'decision-assisted', 'Deterministic routing cannot invoke a selector.', 'CONFIGURATION_ERROR');
        } finally { ticket.admission?.done(); }
    } else ticket.admission?.done();
    if (policy.policy === 'decision-assisted') return assisted(ticket, state);
    throw new DecisionError('Multiple eligible routes remain; configure priority, rules or onAmbiguity.', { code: 'ROUTING_AMBIGUOUS' });
}
