import { requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { optionsObject } from '../options.mjs';

export const CLOUDFLARE_REQUEST_LIMIT = 13 * 1024 * 1024;
export const CLOUDFLARE_OMNI_REQUEST_LIMIT = 36 * 1024 * 1024;
export const CLOUDFLARE_MAX_REQUEST_LIMIT = 64 * 1024 * 1024;
export const CLOUDFLARE_RESULT_OPTIONS = Object.freeze({ native: true, probabilityDecimalPlaces: 4 });

/** Client byte budgets are distinct from the hosted token context and decoded-media limits. */
export const CLOUDFLARE_MODELS = freezeJson({
    clef: { requestBytes: CLOUDFLARE_REQUEST_LIMIT, maxRequestBytes: CLOUDFLARE_REQUEST_LIMIT, omni: false },
    'clef-flash': { requestBytes: CLOUDFLARE_REQUEST_LIMIT, maxRequestBytes: CLOUDFLARE_REQUEST_LIMIT, omni: false },
    'clef-omni': { requestBytes: CLOUDFLARE_OMNI_REQUEST_LIMIT, maxRequestBytes: CLOUDFLARE_MAX_REQUEST_LIMIT, omni: true },
});

/** Endpoint ids and the required model-input selector are normalized together. */
export function cloudflareModel(value = 'clef') {
    check(typeof value === 'string', 'Cloudflare model must be clef, clef-flash, or clef-omni.', 'UNSUPPORTED_CAPABILITY');
    const model = value.trim().replace(/^@cf\/cloudflare\//, '');
    check(Object.hasOwn(CLOUDFLARE_MODELS, model), 'Cloudflare model must be clef, clef-flash, or clef-omni.', 'UNSUPPORTED_CAPABILITY');
    return model;
}

export function cloudflareRequestLimit(model, ceiling) {
    const profile = CLOUDFLARE_MODELS[cloudflareModel(model)];
    return ceiling === undefined ? profile.requestBytes : Math.min(profile.maxRequestBytes, ceiling);
}

export function validateCloudflareLimits({ maxRequestBytes, maxRetries = 0,
    rejectIfBusy = false, gateway } = {}) {
    check(maxRequestBytes === undefined || (Number.isSafeInteger(maxRequestBytes) && maxRequestBytes > 0 &&
        maxRequestBytes <= CLOUDFLARE_MAX_REQUEST_LIMIT),
    'Cloudflare maxRequestBytes must be within 1 to 64 MiB.', 'CONFIGURATION_ERROR');
    check(Number.isSafeInteger(maxRetries) && maxRetries >= 0 && maxRetries <= 10,
        'maxRetries must be an integer from 0 to 10.', 'CONFIGURATION_ERROR');
    check(typeof rejectIfBusy === 'boolean', 'rejectIfBusy must be boolean.', 'CONFIGURATION_ERROR');
    check(!rejectIfBusy || (maxRetries === 0 && (gateway?.retries?.maxAttempts ?? 1) === 1),
        'rejectIfBusy cannot be combined with client or Gateway retries.', 'CONFIGURATION_ERROR');
    return { ...(maxRequestBytes === undefined ? {} : { maxRequestBytes }), maxRetries, rejectIfBusy };
}

// Cloudflare's one-month TTL is 30 days in its official Gateway reference:
// https://github.com/cloudflare/skills/blob/0cb6116228ad153126f474dce1dfbd05f7944604/skills/cloudflare/references/ai-gateway/README.md
const GATEWAY_MAX_CACHE_TTL = 30 * 24 * 60 * 60;
const headerString = (value, maxLength = 200) => typeof value === 'string' && value.trim().length > 0 &&
    value.length <= maxLength && !/[^\x20-\x7e]/.test(value);

/** Use the documented Workers Gateway shape for both transports. */
export function cloudflareGateway(input) {
    if (input === undefined) return undefined;
    const gateway = cloneJson(input, 'Cloudflare gateway', 'CONFIGURATION_ERROR');
    optionsObject(gateway, ['id', 'cacheKey', 'cacheTtl', 'skipCache', 'metadata', 'collectLog',
        'requestTimeoutMs', 'retries'], 'Cloudflare gateway');
    check(headerString(gateway.id, 64), 'Gateway id must be a printable ASCII string up to 64 characters.', 'CONFIGURATION_ERROR');
    if (gateway.cacheKey !== undefined) check(headerString(gateway.cacheKey),
        'Gateway cacheKey must be a printable ASCII string up to 200 characters.', 'CONFIGURATION_ERROR');
    for (const key of ['skipCache', 'collectLog']) check(gateway[key] === undefined || typeof gateway[key] === 'boolean',
        'Gateway cache and logging flags must be boolean.', 'CONFIGURATION_ERROR');
    check(gateway.cacheTtl === undefined || (Number.isSafeInteger(gateway.cacheTtl) &&
        gateway.cacheTtl >= 60 && gateway.cacheTtl <= GATEWAY_MAX_CACHE_TTL),
    'Gateway cacheTtl must be integer seconds from 60 to 2592000 (30 days).', 'CONFIGURATION_ERROR');
    check(gateway.requestTimeoutMs === undefined || (Number.isSafeInteger(gateway.requestTimeoutMs) &&
        gateway.requestTimeoutMs > 0 && gateway.requestTimeoutMs <= 2147483647),
    'Gateway requestTimeoutMs must be a positive 32-bit integer.', 'CONFIGURATION_ERROR');
    if (gateway.metadata !== undefined) check(isRecord(gateway.metadata) && Object.values(gateway.metadata).every(value =>
        value === null || ['string', 'number', 'boolean'].includes(typeof value)),
    'Gateway metadata must contain JSON primitive values.', 'CONFIGURATION_ERROR');
    if (gateway.metadata !== undefined) {
        // Reject predictable metadata loss instead of truncating or stripping caller data.
        const keys = Object.keys(gateway.metadata);
        check(keys.length <= 5, 'Gateway metadata accepts at most five entries.', 'CONFIGURATION_ERROR');
        check(keys.every(key => !key.startsWith('cf.')),
            'Gateway metadata keys beginning with cf. are reserved.', 'CONFIGURATION_ERROR');
    }
    const retries = gateway.retries === undefined ? {} : gateway.retries;
    optionsObject(retries, ['maxAttempts', 'retryDelayMs', 'backoff'], 'Gateway retries');
    const maxAttempts = retries.maxAttempts === undefined ? 1 : retries.maxAttempts;
    check(Number.isSafeInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 5,
        'Gateway maxAttempts must be from 1 to 5.', 'CONFIGURATION_ERROR');
    check(retries.retryDelayMs === undefined || (Number.isSafeInteger(retries.retryDelayMs) &&
        retries.retryDelayMs >= 0 && retries.retryDelayMs <= 60000),
    'Gateway retryDelayMs must be from 0 to 60000.', 'CONFIGURATION_ERROR');
    check(retries.backoff === undefined || ['constant', 'linear', 'exponential'].includes(retries.backoff),
        'Invalid Gateway backoff.', 'CONFIGURATION_ERROR');
    return freezeJson({ ...gateway, retries: { ...retries, maxAttempts } });
}

/** JSON metadata is escaped to ASCII so it remains safe in HTTP header values. */
export function cloudflareGatewayHeaders(gateway) {
    if (!gateway) return {};
    const fields = { id: 'gateway-id', cacheKey: 'cache-key', cacheTtl: 'cache-ttl', skipCache: 'skip-cache',
        collectLog: 'collect-log', requestTimeoutMs: 'request-timeout' };
    const headers = Object.fromEntries(Object.entries(fields).filter(([key]) => gateway[key] !== undefined)
        .map(([key, suffix]) => ['cf-aig-' + suffix, String(gateway[key])]));
    if (gateway.metadata !== undefined) headers['cf-aig-metadata'] = JSON.stringify(gateway.metadata)
        .replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
    for (const [key, suffix] of Object.entries({ maxAttempts: 'max-attempts', retryDelayMs: 'retry-delay', backoff: 'backoff' })) {
        if (gateway.retries[key] !== undefined) headers['cf-aig-' + suffix] = String(gateway.retries[key]);
    }
    return headers;
}
