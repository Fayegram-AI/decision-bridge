// Pure policy and capability filtering is shared by inspection and execution.
import { DecisionError, requireCondition as check } from '../errors.mjs';
import { freezeJson } from '../validation.mjs';
import { matches, requestFacts, publicTarget } from './context.mjs';
import { cooldownKey } from './cooldown.mjs';

const EXCLUSIONS = new Set(['VALIDATION_ERROR', 'UNSUPPORTED_CAPABILITY', 'UNSUPPORTED_OPERATION', 'REQUEST_TOO_LARGE', 'INPUT_TOO_LARGE']);

export function eligible(registry, policy, request, operation, call, cooldowns, { direct, prepared = true } = {}) {
    const facts = requestFacts(request, operation, call.labels);
    let permitted = new Set(direct ? [direct] : policy.candidates);
    if (!direct) {
        if (call.candidates) permitted = new Set([...permitted].filter(id => call.candidates.includes(id)));
        for (const rule of policy.rules ?? []) if (prepared && rule.effect === 'require' && matches(rule.when, facts)) {
            permitted = new Set([...permitted].filter(id => rule.routes.includes(id)));
        }
    }
    const entries = [];
    for (const id of direct ? [direct] : policy.candidates) {
        const target = registry.get(id);
        let status = !target.enabled ? 'disabled' : target.operation !== operation ? 'wrong-operation'
            : !target.isReady() ? 'unavailable' : !permitted.has(id) ? 'constrained' : undefined;
        let code;
        let retryAt;
        if (!status && !prepared) status = 'preparation-required';
        if (!status) {
            try { status = target.preflight(request) === undefined ? 'provisional' : 'eligible'; }
            catch (error) {
                if (!(error instanceof DecisionError) || !EXCLUSIONS.has(error.code)) throw error;
                status = 'unsupported'; code = error.code;
            }
        }
        // A temporary cooldown cannot make an incompatible request retryable.
        const expires = cooldowns.get(cooldownKey(target));
        if (!direct && ['eligible', 'provisional', 'preparation-required'].includes(status) && expires > Date.now()) {
            status = 'cooldown'; retryAt = expires;
        }
        entries.push({ ...publicTarget(target), status, ...(code ? { code } : {}), ...(retryAt ? { retryAt } : {}) });
    }
    const verified = entries.filter(item => item.status === 'eligible').map(item => item.id);
    const provisional = entries.filter(item => ['provisional', 'preparation-required'].includes(item.status)).map(item => item.id);
    return { entries, verified, provisional, facts };
}

export function localChoice(policy, verified, facts) {
    if (verified.length === 1) return { id: verified[0], method: 'single' };
    for (const rule of policy.rules ?? []) if (rule.effect === 'prefer' && matches(rule.when, facts)) {
        const id = rule.routes.find(id => verified.includes(id));
        if (id) return { id, method: 'rule' };
    }
    const id = policy.priority?.find(id => verified.includes(id));
    return id ? { id, method: 'priority' } : undefined;
}

export function selectorReadiness(policy, registry) {
    if (policy.policy !== 'decision-assisted') return { ready: false, reason: 'policy' };
    const selector = policy.selector;
    if (!selector) return { ready: false, reason: 'missing-selector' };
    const target = registry.get(selector.route);
    if (!target.enabled || target.operation !== 'decision' || target.kind !== 'decision' || !target.isReady()) return { ready: false, reason: 'selector-unavailable' };
    if (target.model === undefined) return { ready: false, reason: 'selector-model-required' };
    if (selector.minProbability === undefined || selector.minMargin === undefined) return { ready: false, reason: 'selector-thresholds-required' };
    return { ready: true };
}

export function assertRequired(registry, policy, operation) {
    for (const id of policy.candidates) {
        const target = registry.get(id);
        check(!target.enabled || !target.required || target.operation !== operation || target.isReady(),
            'A required enabled route lacks local provider configuration.', 'CONFIGURATION_ERROR');
    }
}

export function noEligible(report) {
    const cooldown = report.entries.filter(item => item.status === 'cooldown');
    throw new DecisionError(cooldown.length ? 'Eligible routes are temporarily unavailable.' : 'No configured route can execute this request.',
        { code: cooldown.length ? 'ROUTE_UNAVAILABLE' : 'NO_ELIGIBLE_ROUTE',
            ...(cooldown.length ? { retryAfterMs: Math.max(0, Math.min(...cooldown.map(item => item.retryAt)) - Date.now()) } : {}) });
}

export function inspection(registry, policy, request, operation, call, cooldowns, needsPrepare, requestedRoute, canClarify) {
    const direct = requestedRoute === 'auto' ? undefined : requestedRoute;
    const report = eligible(registry, policy, request, operation, call, cooldowns, { direct, prepared: !needsPrepare });
    const requiresSelector = !direct && policy.policy === 'decision-assisted' && policy.selector?.when === 'multiple' && report.verified.length > 1;
    const choice = report.provisional.length || requiresSelector ? undefined : direct && report.verified.length ? { id: direct, method: 'direct' }
        : !direct ? localChoice(policy, report.verified, report.facts) : undefined;
    const prerequisite = direct ? undefined : selectorReadiness(policy, registry);
    return freezeJson({ operation, requestedRoute, validationScope: needsPrepare || report.provisional.length ? 'structure' : 'provider',
        requiresPreparation: needsPrepare, routes: report.entries, eligible: report.verified, provisional: report.provisional,
        outcome: report.provisional.length ? 'unresolved' : report.verified.length === 0 ? 'impossible' : choice ? 'selected' : 'ambiguous',
        ...(choice ? { selectedRoute: choice.id, method: choice.method } : {}),
        ...(prerequisite ? { selector: prerequisite, missingUnattendedPrerequisite: policy.policy === 'decision-assisted' && !prerequisite.ready,
            clarificationAvailable: canClarify } : {}) });
}
