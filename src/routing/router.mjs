// Shared operation-independent state machine; existing bridges own result validation.
import { optionsObject } from '../options.mjs';
import { DecisionError, requireCondition as check } from '../errors.mjs';
import { validateRequestStructure, cloneJson, freezeJson } from '../validation.mjs';
import { validateExtractionStructure } from '../extraction/validation.mjs';
import { routerOptions, ids, integer } from './configuration.mjs';
import { createTargets } from './targets.mjs';
import { eligible, inspection, selectorReadiness, assertRequired, noEligible } from './eligibility.mjs';
import { refreshEligibility } from './preflight.mjs';
import { routingBudget } from './budget.mjs';
import { selectRoute } from './selection.mjs';
import { executeSelected, observe } from './execution.mjs';

export const routerInternals = new WeakMap();
const CALL_FIELDS = ['route', 'candidates', 'labels', 'routingDescription', 'onAmbiguity', 'clarify', 'signal', 'timeoutMs'];

export function makeRouter(input, operation) {
    const options = routerOptions(input);
    const registry = createTargets(options);
    const policy = options.auto;
    const cooldowns = new Map();
    const state = { options, registry, policy, cooldowns, operation };
    const structure = operation === 'decision' ? validateRequestStructure : validateExtractionStructure;
    function callOptions(value) {
        optionsObject(value, CALL_FIELDS, 'Routing call options');
        const { signal, onAmbiguity, ...json } = value;
        const call = { ...cloneJson(json, 'routing call options', 'CONFIGURATION_ERROR'), signal, onAmbiguity };
        const route = call.route ?? options.defaultRoute;
        check(route !== undefined && (route === 'auto' ? !!policy : registry.has(route)), 'Select a configured route or set defaultRoute.', 'CONFIGURATION_ERROR');
        if (call.candidates !== undefined) {
            ids(call.candidates, 'call.candidates');
            check(route === 'auto' && call.candidates.every(id => policy.candidates.includes(id)), 'Call candidates must narrow auto.candidates.', 'CONFIGURATION_ERROR');
        }
        if (call.labels !== undefined) check(Array.isArray(call.labels) && call.labels.length <= 100 &&
            call.labels.every(label => typeof label === 'string' && label.length > 0 && label.length <= 100), 'Invalid routing labels.', 'CONFIGURATION_ERROR');
        check(call.routingDescription === undefined || typeof call.routingDescription === 'string', 'routingDescription must be text.', 'CONFIGURATION_ERROR');
        check(call.onAmbiguity === undefined || typeof call.onAmbiguity === 'function', 'onAmbiguity must be a function.', 'CONFIGURATION_ERROR');
        check(call.clarify === undefined || typeof call.clarify === 'boolean', 'clarify must be boolean.', 'CONFIGURATION_ERROR');
        if (call.timeoutMs !== undefined) integer(call.timeoutMs, 'timeoutMs');
        return { ...call, route };
    }
    function callback(call) {
        return call.route === 'auto' && call.clarify !== false && policy.clarification?.enabled !== false
            ? call.onAmbiguity ?? options.onAmbiguity : undefined;
    }
    function prerequisites(call, clarify) {
        if (call.route !== 'auto') {
            const target = registry.get(call.route);
            check(target.enabled, 'The requested route is disabled.', 'ROUTE_UNAVAILABLE');
            check(target.operation === operation, 'Requested route has a different operation.', 'UNSUPPORTED_OPERATION');
            check(target.isReady(), 'Requested route lacks local provider configuration.', 'CONFIGURATION_ERROR');
        } else {
            assertRequired(registry, policy, operation);
            check(policy.policy !== 'decision-assisted' || !!clarify || selectorReadiness(policy, registry).ready,
                'Unattended decision-assisted routing requires a ready decision selector, model and explicit minProbability/minMargin.', 'CONFIGURATION_ERROR');
        }
    }
    function errorWithDiagnostics(error, ticket) {
        const safe = error instanceof DecisionError ? error : new DecisionError('Routing failed.', { code: 'PROVIDER_ERROR' });
        return new DecisionError(safe.message, { ...safe.toJSON(), routing: freezeJson(cloneJson({ ...ticket.diagnostics,
            timings: ticket.budget.timings() })) });
    }
    async function prepare(input, value = {}, admission) {
        const call = callOptions(value);
        const budget = routingBudget(options, call, admission?.startedAt);
        const ticket = { call, budget, admission, requestedRoute: call.route, clarify: callback(call), diagnostics: {
            requestedRoute: call.route, ...(options.policyRevision === undefined ? {} : { policyRevision: options.policyRevision }), attempts: [],
        } };
        try {
            await budget.run('work', async signal => {
                ticket.request = freezeJson(structure(input));
                prerequisites(call, ticket.clarify);
                if (options.prepare) {
                    let prepared;
                    try { prepared = await options.prepare(ticket.request, Object.freeze({ operation, requestedRoute: call.route, signal })); }
                    catch { throw new DecisionError('Routing preparation failed.', { code: 'EXTENSION_ERROR' }); }
                    ticket.request = freezeJson(structure(prepared === undefined ? ticket.request : prepared));
                }
                const direct = call.route === 'auto' ? undefined : call.route;
                let report = eligible(registry, policy, ticket.request, operation, call, cooldowns, { direct });
                // Only locally possible, enabled targets initialize. Never import disabled modules.
                for (const id of [...report.verified, ...report.provisional]) {
                    if (signal.aborted) return;
                    await registry.get(id).initialize(signal);
                }
                report = await refreshEligibility(state, ticket.request, call, signal, { direct });
                ticket.report = report;
                ticket.diagnostics.candidates = report.entries.map(({ id, status, code }) => ({ id, status, ...(code ? { code } : {}) }));
                if (!report.verified.length) noEligible(report);
            });
            return ticket;
        } catch (error) {
            admission?.done(); budget.close();
            throw errorWithDiagnostics(error, ticket);
        }
    }
    async function execute(ticket) {
        try {
            const selected = await selectRoute(ticket, state);
            const result = await executeSelected(ticket, state, selected);
            ticket.budget.close();
            return await observe(result, ticket, state);
        } catch (error) { throw errorWithDiagnostics(error, ticket); }
        finally { ticket.admission?.done(); ticket.budget.close(); }
    }
    const router = Object.freeze({
        operation,
        inspect(input, value = {}) {
            const call = callOptions(value);
            const request = structure(input);
            return inspection(registry, policy, request, operation, call, cooldowns, !!options.prepare, call.route, !!callback(call));
        },
        [operation === 'decision' ? 'evaluate' : 'extract']: async (input, call = {}) => execute(await prepare(input, call)),
    });
    routerInternals.set(router, { operation, callOptions, prepare, execute });
    return router;
}
