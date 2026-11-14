// Native OpenRouter policy and transport; independent from the chat-completions preset.
import { optionsObject, TRANSPORT_FIELDS } from '../options.mjs';
import { DecisionError, requireCondition as check, withResponseMeta } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { isTextWithinLimit } from '../input.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../transport.mjs';
import { providerEnvironmentValue } from '../runtime-env.mjs';

export function openRouterModel(value) {
    check(typeof value === 'string' && value.trim(), 'OpenRouter requires an explicit model ID.');
    return value.trim();
}

/** Preserve provider-specific JSON options; routing controls are validated locally. */
export function openRouterPreferences(input = {}) {
    const value = cloneJson(input, 'OpenRouter provider preferences', 'CONFIGURATION_ERROR');
    const fields = ['allow_fallbacks', 'require_parameters', 'data_collection', 'zdr', 'enforce_distillable_text',
        'order', 'only', 'ignore', 'quantizations', 'sort', 'max_price', 'options', 'preferred_max_latency', 'preferred_min_throughput'];
    check(isRecord(value) && Object.keys(value).every(key => fields.includes(key)), 'Invalid OpenRouter preferences.', 'CONFIGURATION_ERROR');
    for (const key of ['allow_fallbacks', 'require_parameters', 'zdr', 'enforce_distillable_text']) {
        check(value[key] === undefined || value[key] === null || typeof value[key] === 'boolean', 'Invalid routing flag.', 'CONFIGURATION_ERROR');
    }
    for (const key of ['order', 'only', 'ignore', 'quantizations']) check(value[key] == null ||
        Array.isArray(value[key]) && value[key].every(v => typeof v === 'string' && v.trim()), 'Invalid provider list.', 'CONFIGURATION_ERROR');
    check(value.data_collection == null || ['allow', 'deny'].includes(value.data_collection), 'Invalid data collection setting.', 'CONFIGURATION_ERROR');
    for (const key of ['max_price', 'options']) check(value[key] === undefined || isRecord(value[key]), 'Invalid provider options.', 'CONFIGURATION_ERROR');
    return freezeJson({ ...value, allow_fallbacks: value.allow_fallbacks ?? false });
}

export function openRouterSettings(input = {}, { extraction = false } = {}) {
    const options = optionsObject(input, ['apiKey', 'model', 'baseURL', 'providerPreferences',
        ...(extraction ? [] : ['api']), ...TRANSPORT_FIELDS], 'OpenRouter native options');
    const api = options.api ?? 'decisions';
    check(['decisions', 'systemone'].includes(api), 'Unknown OpenRouter Decisions API.', 'CONFIGURATION_ERROR');
    const endpoint = parseBaseURL(options.baseURL ?? 'https://openrouter.ai', { originOnly: true });
    const model = options.model === undefined ? undefined : openRouterModel(options.model);
    const providerPreferences = openRouterPreferences(options.providerPreferences);
    const maxRequestBytes = options.maxRequestBytes ?? 8 * 1024 * 1024;
    check(Number.isSafeInteger(maxRequestBytes) && maxRequestBytes > 0 && maxRequestBytes <= 67108864,
        'OpenRouter maxRequestBytes must be within 1 to 64 MiB.', 'CONFIGURATION_ERROR');
    return { ...options, model, ...(extraction ? {} : { api }), providerPreferences, maxRequestBytes, baseURL: endpoint.baseURL };
}

export function openRouterTransport(settings) {
    const key = validateApiKey(settings.apiKey === undefined && settings.baseURL === 'https://openrouter.ai'
        ? providerEnvironmentValue('OPENROUTER_API_KEY') : settings.apiKey, 'OPENROUTER_API_KEY');
    const options = Object.fromEntries(TRANSPORT_FIELDS.filter(k => settings[k] !== undefined).map(k => [k, settings[k]]));
    return new JsonTransport({ maxRetries: 0, ...options, baseURL: settings.baseURL,
        headers: { authorization: `Bearer ${key}` }, secrets: [key], errorDecoder: openRouterError });
}

/** Classify explicit admission failures for local recovery without exposing upstream input. */
function openRouterError(_data, status, meta) {
    const code = status === 429 ? 'RATE_LIMITED' : status === 503 ? 'CAPACITY_EXCEEDED' : 'HTTP_ERROR';
    return new DecisionError(`OpenRouter returned HTTP ${status}.`, { ...meta, code, status, source: 'provider' });
}

export function openRouterRequest(input, settings, allowed) {
    const request = cloneJson(input, 'OpenRouter request');
    check(isRecord(request) && Object.keys(request).every(key => [...allowed, 'model', 'provider', 'session_id', 'user', 'trace'].includes(key)),
        'Invalid OpenRouter native request fields.');
    request.model = openRouterModel(request.model === undefined ? settings.model : request.model);
    check(request.provider == null || isRecord(request.provider), 'provider must be an object or null.');
    request.provider = openRouterPreferences({ ...settings.providerPreferences, ...request.provider });
    for (const key of ['session_id', 'user']) check(request[key] === undefined || isTextWithinLimit(request[key], 256),
        'OpenRouter identifiers must be strings up to 256 characters.');
    check(request.trace === undefined || isRecord(request.trace), 'trace must be an object.');
    return request;
}

export function openRouterResponse(input) {
    const data = cloneJson(input, 'OpenRouter response', 'INVALID_RESPONSE');
    const valid = (condition, message) => check(condition, message, 'INVALID_RESPONSE');
    valid(isRecord(data) && typeof data.model === 'string' && data.model.trim() && isRecord(data.answers) && isRecord(data.usage),
        'Invalid OpenRouter response.');
    valid(!data.error, 'Provider returned an error response.');
    for (const key of ['input_tokens', 'output_tokens']) valid(Number.isSafeInteger(data.usage[key]) && data.usage[key] >= 0, 'Invalid token usage.');
    if (data.usage.cost !== undefined) valid(typeof data.usage.cost === 'number' && data.usage.cost >= 0, 'Invalid usage cost.');
    for (const key of ['id', 'provider']) valid(data[key] === undefined || typeof data[key] === 'string' && data[key].length > 0, 'Invalid response identity.');
    return data;
}

export function openRouterMeta(data, meta, model) {
    return { ...meta, requestedModel: model, resolvedModel: model,
        ...(data.id === undefined ? {} : { responseId: data.id }),
        ...(data.provider === undefined ? {} : { upstreamProvider: data.provider }) };
}

export async function openRouterModels(transport, options, api = 'decisions') {
    const { data, meta } = await transport.request('GET', '/api/v1/models', undefined, options,
        { endpoints: api === 'systemone' ? '/api/v1/systemone' : '/api/alpha/decisions' });
    return withResponseMeta(meta, () => {
        check(isRecord(data) && Array.isArray(data.data) && data.data.every(m => isRecord(m) && typeof m.id === 'string' && m.id.trim()),
            'Invalid OpenRouter model catalogue.', 'INVALID_RESPONSE');
        return freezeJson({ models: data.data.map(m => ({ ...m, name: m.id })) });
    });
}
