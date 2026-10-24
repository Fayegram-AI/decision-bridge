// Configuration contains policy only. Provider construction belongs to targets.mjs.
import { optionsObject } from '../options.mjs';
import { requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';

export const ROUTER_FIELDS = ['routes', 'defaultRoute', 'policyRevision', 'prepare', 'onAmbiguity', 'onResult',
    'workTimeoutMs', 'clarificationTimeoutMs', 'observerTimeoutMs'];
export const ROUTE_FIELDS = ['enabled', 'required', 'description', 'operation', 'model', 'provider', 'config',
    'factory', 'kind', 'ready', 'singleDispatch', 'allowGenerative', 'cooldownGroup'];
export const AUTO_FIELDS = ['policy', 'candidates', 'rules', 'priority', 'selector', 'clarification', 'failover', 'cooldown'];
export const FAILURE_CLASSES = ['abstain', 'invalid-response', 'timeout', 'unavailable', 'context-too-large'];
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
export function integer(value, label, maximum = 2147483647) {
    check(Number.isSafeInteger(value) && value > 0 && value <= maximum, `${label} is out of range.`, 'CONFIGURATION_ERROR');
}
export function ids(value, label, { empty = true } = {}) {
    check(Array.isArray(value) && value.length <= 256 && (empty || value.length > 0) &&
        value.every(id => validId(id) && id !== 'auto') && new Set(value).size === value.length,
    `${label} must contain distinct concrete route IDs.`, 'CONFIGURATION_ERROR');
}

/** Shared by SDK and JSON configuration; absent selector is an execution concern. */
export function autoPolicy(value, concreteIds) {
    const policy = cloneJson(value, 'auto policy', 'CONFIGURATION_ERROR');
    optionsObject(policy, AUTO_FIELDS, 'Auto route');
    check(['deterministic', 'decision-assisted'].includes(policy.policy), 'Choose an auto policy.', 'CONFIGURATION_ERROR');
    ids(policy.candidates, 'auto.candidates');
    const references = [...policy.candidates];
    if (policy.priority !== undefined) { ids(policy.priority, 'auto.priority'); references.push(...policy.priority); }
    if (policy.rules !== undefined) {
        check(Array.isArray(policy.rules) && policy.rules.length <= 256, 'rules must be a bounded array.', 'CONFIGURATION_ERROR');
        for (const rule of policy.rules) {
            optionsObject(rule, ['effect', 'when', 'routes'], 'Routing rule');
            check(['require', 'prefer'].includes(rule.effect), 'Unknown rule effect.', 'CONFIGURATION_ERROR');
            ids(rule.routes, 'rule.routes', { empty: false });
            references.push(...rule.routes);
            optionsObject(rule.when, ['operation', 'modalities', 'questionTypes', 'fieldTypes', 'labels'], 'Rule condition');
            check(Object.keys(rule.when).length > 0, 'Rule condition cannot be empty; use priority.', 'CONFIGURATION_ERROR');
            check(rule.when.operation === undefined || ['decision', 'extraction'].includes(rule.when.operation), 'Invalid rule operation.', 'CONFIGURATION_ERROR');
            for (const key of ['modalities', 'questionTypes', 'fieldTypes', 'labels']) if (rule.when[key] !== undefined) {
                check(Array.isArray(rule.when[key]) && rule.when[key].length > 0 && rule.when[key].every(item =>
                    typeof item === 'string' && item.length > 0 && item.length <= 100) && new Set(rule.when[key]).size === rule.when[key].length,
                'Rule lists require distinct nonempty strings.', 'CONFIGURATION_ERROR');
            }
            for (const [key, allowed] of Object.entries({ modalities: ['text', 'image', 'audio', 'video'],
                questionTypes: ['choice', 'noul', 'score', 'box'],
                fieldTypes: ['text', 'number', 'date', 'time', 'datetime', 'duration', 'list', 'estimate', 'forecast'] })) {
                check(rule.when[key] === undefined || rule.when[key].every(item => allowed.includes(item)), 'Unknown rule fact.', 'CONFIGURATION_ERROR');
            }
        }
    }
    if (policy.selector !== undefined) {
        optionsObject(policy.selector, ['route', 'when', 'minProbability', 'minMargin', 'timeoutMs', 'maxContextBytes', 'fallbackOn'], 'Selector');
        check(policy.policy === 'decision-assisted' && validId(policy.selector.route) && policy.selector.route !== 'auto',
            'Selector requires decision-assisted policy and a concrete route.', 'CONFIGURATION_ERROR');
        references.push(policy.selector.route);
        check(policy.selector.when === undefined || ['ambiguous', 'multiple'].includes(policy.selector.when), 'Invalid selector.when.', 'CONFIGURATION_ERROR');
        for (const key of ['minProbability', 'minMargin']) if (policy.selector[key] !== undefined) check(
            Number.isFinite(policy.selector[key]) && policy.selector[key] >= 0 && policy.selector[key] <= 1,
            'Selector thresholds must be in [0, 1].', 'CONFIGURATION_ERROR');
        if (policy.selector.timeoutMs !== undefined) integer(policy.selector.timeoutMs, 'selector.timeoutMs');
        if (policy.selector.maxContextBytes !== undefined) integer(policy.selector.maxContextBytes, 'selector.maxContextBytes', 67108864);
        if (policy.selector.fallbackOn !== undefined) check(Array.isArray(policy.selector.fallbackOn) &&
            new Set(policy.selector.fallbackOn).size === policy.selector.fallbackOn.length &&
            policy.selector.fallbackOn.every(value => FAILURE_CLASSES.includes(value)), 'Unknown selector fallback class.', 'CONFIGURATION_ERROR');
    }
    if (policy.clarification !== undefined) {
        optionsObject(policy.clarification, ['enabled', 'timeoutMs'], 'Clarification');
        check(policy.clarification.enabled === undefined || typeof policy.clarification.enabled === 'boolean', 'clarification.enabled must be boolean.', 'CONFIGURATION_ERROR');
        if (policy.clarification.timeoutMs !== undefined) integer(policy.clarification.timeoutMs, 'clarification.timeoutMs');
    }
    if (policy.failover !== undefined) {
        optionsObject(policy.failover, ['routes', 'maxAttempts'], 'Failover');
        ids(policy.failover.routes, 'failover.routes', { empty: false });
        references.push(...policy.failover.routes);
        if (policy.failover.maxAttempts !== undefined) integer(policy.failover.maxAttempts, 'failover.maxAttempts', 256);
    }
    if (policy.cooldown !== undefined) {
        optionsObject(policy.cooldown, ['durationMs'], 'Cooldown');
        if (policy.cooldown.durationMs !== undefined) integer(policy.cooldown.durationMs, 'cooldown.durationMs');
    }
    check(references.every(id => concreteIds.includes(id)), 'Policy references an unknown route.', 'CONFIGURATION_ERROR');
    check([...(policy.priority ?? []), ...(policy.rules ?? []).flatMap(rule => rule.routes), ...(policy.failover?.routes ?? [])]
        .every(id => policy.candidates.includes(id)), 'Preferences, rules and failover must stay within auto.candidates.', 'CONFIGURATION_ERROR');
    return freezeJson(policy);
}

export function routerOptions(input) {
    const options = optionsObject(input, ROUTER_FIELDS, 'Router options');
    check(isRecord(options.routes), 'routes must be a registry object.', 'CONFIGURATION_ERROR');
    optionsObject(options.routes, Object.keys(options.routes), 'Route registry');
    const names = Object.keys(options.routes);
    check(names.length > 0 && names.length <= 257 && names.every(validId), 'Invalid route registry IDs or size.', 'CONFIGURATION_ERROR');
    const auto = Object.hasOwn(options.routes, 'auto') ? autoPolicy(options.routes.auto, names.filter(id => id !== 'auto')) : undefined;
    check(options.defaultRoute === undefined || names.includes(options.defaultRoute), 'Unknown defaultRoute.', 'CONFIGURATION_ERROR');
    for (const key of ['prepare', 'onAmbiguity', 'onResult']) check(options[key] === undefined || typeof options[key] === 'function', `${key} must be a function.`, 'CONFIGURATION_ERROR');
    for (const key of ['workTimeoutMs', 'clarificationTimeoutMs', 'observerTimeoutMs']) if (options[key] !== undefined) integer(options[key], key);
    check(options.policyRevision === undefined || (typeof options.policyRevision === 'string' && options.policyRevision.length <= 100), 'Invalid policyRevision.', 'CONFIGURATION_ERROR');
    return { ...options, auto };
}
