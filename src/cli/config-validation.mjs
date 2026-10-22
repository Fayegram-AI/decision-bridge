import { requireCondition as check } from '../errors.mjs';
import { cloneJson, isRecord } from '../validation.mjs';
import { cloudflareGateway, validateCloudflareLimits } from '../providers/cloudflare-profile.mjs';
import { generationOptions } from '../custom/generative/shared.mjs';
import { jevDangerZone, jevRequestLimit } from '../providers/jev-profile.mjs';

export const PROVIDERS = ['jev', 'openai-decisions', 'cloudflare-decisions', 'cloudflare-extraction', 'custom-decision', 'custom-generative'];
export const PRESETS = ['openai-compatible', 'openrouter', 'anthropic'];
export const TRANSPORT = ['baseURL', 'maxRetries', 'maxRequestBytes', 'maxResponseBytes'];
export const GENERATION = ['maxTokens', 'responseFormat', 'tokenParameter', 'parameters', 'noAuth'];
export const PROVIDER_FIELDS = [...TRANSPORT, ...GENERATION, 'apiKeyEnv', 'model', 'preset', 'module',
    'options', 'accountId', 'rejectIfBusy', 'gateway', 'dangerZone'];
const FIELDS = new Set(['$schema', 'schemaVersion', 'provider', 'timeoutMs', ...PROVIDER_FIELDS]);
export const NUMERIC = new Set(['timeoutMs', 'maxRetries', 'maxRequestBytes', 'maxResponseBytes', 'maxTokens']);
export const KEY_ENVS = { jev: 'TYPESAFE_API_KEY', 'openai-decisions': 'OPENAI_API_KEY',
    'cloudflare-decisions': 'CLOUDFLARE_API_TOKEN', 'cloudflare-extraction': 'CLOUDFLARE_API_TOKEN', 'openai-compatible': 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
export const isModule = config => ['custom-decision', 'custom-generative'].includes(config.provider) && config.module !== undefined;

/** Partial layers may omit a selector; complete execution must identify one implementation. */
export function validateConfig(input, { complete = false } = {}) {
    const config = cloneJson(input, 'configuration', 'CONFIGURATION_ERROR');
    check(isRecord(config) && Object.keys(config).every(key => FIELDS.has(key)),
        'Configuration contains an unknown field; use apiKeyEnv for credentials.', 'CONFIGURATION_ERROR');
    check(config.schemaVersion === undefined || config.schemaVersion === 1,
        'Unsupported configuration schemaVersion.', 'CONFIGURATION_ERROR');
    if (PRESETS.includes(config.provider)) check(false,
        `Provider ${config.provider} moved to provider custom-generative with preset ${config.provider}.`, 'CONFIGURATION_ERROR');
    check(config.provider === undefined || PROVIDERS.includes(config.provider),
        'Select a native provider, custom-decision or custom-generative; provider custom is no longer supported.', 'CONFIGURATION_ERROR');
    for (const field of ['$schema', 'model', 'baseURL', 'apiKeyEnv', 'module', 'accountId', 'preset']) {
        check(config[field] === undefined || (typeof config[field] === 'string' && config[field].trim()),
            'Configuration string fields must be nonempty.', 'CONFIGURATION_ERROR');
    }
    if (config.apiKeyEnv !== undefined) check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv),
        'apiKeyEnv must name an environment variable.', 'CONFIGURATION_ERROR');
    check(config.noAuth === undefined || typeof config.noAuth === 'boolean', 'noAuth must be boolean.', 'CONFIGURATION_ERROR');
    for (const field of NUMERIC) {
        if (config[field] === undefined) continue;
        const min = field === 'maxRetries' ? 0 : 1;
        const max = field === 'maxRetries' ? 10 : field === 'maxTokens' ? 1048576
            : field.endsWith('Bytes') ? 67108864 : 2147483647;
        check(Number.isSafeInteger(config[field]) && config[field] >= min && config[field] <= max,
            'Numeric configuration field is out of range.', 'CONFIGURATION_ERROR');
    }
    check(config.responseFormat === undefined || ['json_schema', 'json_object', 'text'].includes(config.responseFormat),
        'Unsupported responseFormat.', 'CONFIGURATION_ERROR');
    check(config.tokenParameter === undefined || ['max_tokens', 'max_completion_tokens'].includes(config.tokenParameter),
        'Unsupported tokenParameter.', 'CONFIGURATION_ERROR');
    for (const field of ['parameters', 'options']) check(config[field] === undefined || isRecord(config[field]),
        'parameters and options must be JSON objects.', 'CONFIGURATION_ERROR');
    if (config.options) check(!Object.hasOwn(config.options, 'apiKey') && !Object.hasOwn(config.options, 'api_key'),
        'Custom module credentials must use apiKeyEnv.', 'CONFIGURATION_ERROR');
    check(!(config.module && config.preset), 'Choose a preset or a module, not both.', 'CONFIGURATION_ERROR');
    check(config.preset === undefined || (config.provider === 'custom-generative' && PRESETS.includes(config.preset)),
        'preset requires custom-generative and a supported preset name.', 'CONFIGURATION_ERROR');
    check(config.module === undefined || ['custom-decision', 'custom-generative'].includes(config.provider),
        'module requires custom-decision or custom-generative.', 'CONFIGURATION_ERROR');
    check(config.options === undefined || isModule(config), 'options requires a custom provider module.', 'CONFIGURATION_ERROR');
    // Validate nested shape even when a partial file omits its provider selector.
    if (Object.hasOwn(config, 'dangerZone')) config.dangerZone = jevDangerZone(config.dangerZone);
    if (config.provider !== undefined) {
        if (config.provider !== 'jev') check(!Object.hasOwn(config, 'dangerZone'),
            'dangerZone requires Jev.', 'CONFIGURATION_ERROR');
        else {
            jevRequestLimit(config.maxRequestBytes);
        }
        if (!['cloudflare-decisions', 'cloudflare-extraction'].includes(config.provider)) check(['accountId', 'rejectIfBusy', 'gateway'].every(key => config[key] === undefined),
            'Cloudflare settings require a Cloudflare provider.', 'CONFIGURATION_ERROR');
        else {
            config.gateway = cloudflareGateway(config.gateway);
            if (config.gateway === undefined) delete config.gateway;
            validateCloudflareLimits(config);
        }
        if (isModule(config) || config.provider === 'custom-decision') check([...TRANSPORT, ...GENERATION].every(key => config[key] === undefined),
            'Custom module transport and generation settings belong inside options.', 'CONFIGURATION_ERROR');
        else if (config.provider !== 'custom-generative') check(GENERATION.every(key => config[key] === undefined),
            'Generation settings require a custom-generative preset.', 'CONFIGURATION_ERROR');
    }
    if (config.preset === 'anthropic') check(config.responseFormat === undefined && config.tokenParameter === undefined,
        'Anthropic uses its forced-tool response format.', 'CONFIGURATION_ERROR');
    if (config.preset) {
        generationOptions(config);
        check(config.preset !== 'anthropic' || config.parameters?.thinking === undefined,
            'Forced-tool evaluations do not enable extended thinking.', 'CONFIGURATION_ERROR');
    }
    if (config.preset === 'openrouter') check(config.baseURL === undefined,
        'The OpenRouter preset has a fixed endpoint; select preset openai-compatible for another gateway.', 'CONFIGURATION_ERROR');
    check(config.noAuth === undefined || (config.provider === 'custom-generative' && config.preset === 'openai-compatible'),
        'noAuth requires the openai-compatible custom-generative preset.', 'CONFIGURATION_ERROR');
    if (complete) {
        check(config.provider !== 'custom-decision' || !!config.module, 'custom-decision requires a module.', 'CONFIGURATION_ERROR');
        check(config.provider !== 'custom-generative' || !!(config.module || config.preset),
            'custom-generative requires a preset or module.', 'CONFIGURATION_ERROR');
    }
    return config;
}
