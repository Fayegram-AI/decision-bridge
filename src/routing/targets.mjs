// Lazy targets separate local readiness and pure preflight from client construction.
import { optionsObject, TRANSPORT_FIELDS } from '../options.mjs';
import { DecisionError, requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson } from '../validation.mjs';
import { providerContract } from '../provider-contract.mjs';
import { createBridge } from '../bridge.mjs';
import { createProvider, JevProvider, OpenAIDecisionsProvider, CloudflareDecisionsProvider } from '../providers/index.mjs';
import { CloudflareExtractionProvider } from '../extraction/index.mjs';
import { validateExtractionRequest, extractionModel } from '../extraction/validation.mjs';
import { preflightCommonJevDecision } from '../providers/jev-preflight.mjs';
import { preflightCommonDecision } from '../providers/decisions-preflight.mjs';
import { preflightCommonCloudflareDecision } from '../providers/cloudflare-preflight.mjs';
import { cloudflareModel, cloudflareGateway, validateCloudflareLimits } from '../providers/cloudflare-profile.mjs';
import { resolveOpenAIModel } from '../providers/openai-profile.mjs';
import { jevDangerZone, jevRequestLimit } from '../providers/jev-profile.mjs';
import { validateApiKey, parseBaseURL } from '../transport.mjs';
import { ROUTE_FIELDS, integer } from './configuration.mjs';

const NATIVE = ['jev', 'openai-decisions', 'cloudflare-decisions', 'cloudflare-extraction'];
const pure = { jev: preflightCommonJevDecision, 'openai-decisions': preflightCommonDecision,
    'cloudflare-decisions': preflightCommonCloudflareDecision, 'cloudflare-extraction': validateExtractionRequest };
const modelDefault = { jev: 'jev-latest', 'openai-decisions': 'default', 'cloudflare-decisions': 'clef', 'cloudflare-extraction': 'clairic' };
const normalize = { 'openai-decisions': resolveOpenAIModel, 'cloudflare-decisions': cloudflareModel, 'cloudflare-extraction': extractionModel };

function nativeConfig(input) {
    const type = Object.getOwnPropertyDescriptor(input ?? {}, 'type')?.value;
    check(NATIVE.includes(type), 'Unknown routing native provider type.', 'CONFIGURATION_ERROR');
    const cloudflare = type.startsWith('cloudflare-');
    optionsObject(input, ['type', 'apiKey', 'baseURL', 'model', ...TRANSPORT_FIELDS,
        ...(cloudflare ? ['transport', 'accountId', 'ai', 'rejectIfBusy', 'gateway'] : []),
        ...(type === 'jev' ? ['dangerZone'] : [])], 'Route provider config');
    // Snapshot JSON settings, retaining only the explicitly supported opaque handles.
    const { fetchImpl, ai, ...json } = input;
    const config = { ...cloneJson(Object.fromEntries(Object.entries(json).filter(([, value]) => value !== undefined)), 'route config', 'CONFIGURATION_ERROR'),
        ...(fetchImpl === undefined ? {} : { fetchImpl }), ...(ai === undefined ? {} : { ai }) };
    check(fetchImpl === undefined || typeof fetchImpl === 'function', 'fetchImpl must be a function.', 'CONFIGURATION_ERROR');
    if (config.model !== undefined) check(typeof config.model === 'string' && config.model.trim(), 'Invalid route model.', 'CONFIGURATION_ERROR');
    config.model ??= modelDefault[type];
    if (normalize[type]) normalize[type](config.model);
    for (const key of ['timeoutMs', 'maxResponseBytes', 'maxRequestBytes']) if (config[key] !== undefined) integer(config[key], key, key.endsWith('Bytes') ? 67108864 : 2147483647);
    check(config.maxRetries === undefined || (Number.isSafeInteger(config.maxRetries) && config.maxRetries >= 0 && config.maxRetries <= 10), 'Invalid maxRetries.', 'CONFIGURATION_ERROR');
    check(config.apiKey === undefined || typeof config.apiKey === 'string', 'apiKey must be text.', 'CONFIGURATION_ERROR');
    if (config.baseURL !== undefined) {
        parseBaseURL(config.baseURL, { originOnly: true });
    }
    if (type === 'jev') { config.dangerZone = jevDangerZone(config.dangerZone); jevRequestLimit(config.maxRequestBytes); }
    if (cloudflare) {
        config.transport ??= 'rest';
        check(['rest', 'binding'].includes(config.transport), 'Unknown transport.', 'CONFIGURATION_ERROR');
        check(config.transport !== 'binding' || ['accountId', 'apiKey', 'baseURL', 'fetchImpl'].every(key => config[key] === undefined), 'Binding cannot use REST settings.', 'CONFIGURATION_ERROR');
        check(config.transport !== 'rest' || ai === undefined, 'REST cannot use a binding.', 'CONFIGURATION_ERROR');
        check(config.accountId === undefined || typeof config.accountId === 'string', 'Invalid accountId.', 'CONFIGURATION_ERROR');
        if (config.gateway !== undefined) config.gateway = cloudflareGateway(config.gateway);
        validateCloudflareLimits(config);
    }
    return Object.freeze(config);
}

function readyNative(config) {
    if (config.transport === 'binding') return typeof config.ai?.run === 'function';
    try { validateApiKey(config.apiKey); } catch { return false; }
    return !config.type.startsWith('cloudflare-') || typeof config.accountId === 'string' &&
        /^[A-Za-z0-9_-]+$/.test(config.accountId.trim()) && !/^(replace_with_|your_actual_|paste_)/i.test(config.accountId.trim());
}

/** Does not inspect supplied provider methods until an execution or inspection preflight. */
export function target(id, input, recovery) {
    optionsObject(input, ROUTE_FIELDS, 'Concrete route');
    input = { ...input };
    check([input.provider, input.config, input.factory].filter(value => value !== undefined).length === 1,
        'Each route needs exactly one provider, config or factory.', 'CONFIGURATION_ERROR');
    for (const key of ['enabled', 'required', 'ready', 'singleDispatch', 'allowGenerative']) check(input[key] === undefined || typeof input[key] === 'boolean', `${key} must be boolean.`, 'CONFIGURATION_ERROR');
    check(input.operation === undefined || ['decision', 'extraction'].includes(input.operation), 'Unknown route operation.', 'CONFIGURATION_ERROR');
    check(input.description === undefined || (typeof input.description === 'string' && input.description.length <= 2000), 'Route description exceeds 2000 characters.', 'CONFIGURATION_ERROR');
    check(input.cooldownGroup === undefined || (typeof input.cooldownGroup === 'string' && input.cooldownGroup.length > 0 && input.cooldownGroup.length <= 100), 'Invalid cooldownGroup.', 'CONFIGURATION_ERROR');
    check(input.model === undefined || (typeof input.model === 'string' && input.model.trim()), 'Invalid route model.', 'CONFIGURATION_ERROR');
    let config = input.config === undefined ? undefined : nativeConfig(input.config);
    const operation = input.operation ?? (config?.type === 'cloudflare-extraction' ? 'extraction' : 'decision');
    check(input.kind === undefined || !config && operation === 'decision' && ['decision', 'generative'].includes(input.kind),
        'kind applies only to supplied decision providers or factories.', 'CONFIGURATION_ERROR');
    check(!config || (config.type === 'cloudflare-extraction') === (operation === 'extraction'), 'Provider operation mismatch.', 'CONFIGURATION_ERROR');
    check(input.factory === undefined || (operation === 'decision' && typeof input.factory === 'function' && ['decision', 'generative'].includes(input.kind)),
        'Factories require an explicit decision or generative kind.', 'CONFIGURATION_ERROR');
    check(operation !== 'extraction' || config || input.provider instanceof CloudflareExtractionProvider,
        'Extraction routes require the Cloudflare extraction adapter.', 'CONFIGURATION_ERROR');
    let provider = input.provider;
    check(input.provider === undefined || !!provider, 'A supplied provider must be an object.', 'CONFIGURATION_ERROR');
    const providerType = () => config?.type ?? (provider instanceof JevProvider ? 'jev'
        : provider instanceof OpenAIDecisionsProvider ? 'openai-decisions'
            : provider instanceof CloudflareDecisionsProvider ? 'cloudflare-decisions'
                : provider instanceof CloudflareExtractionProvider ? 'cloudflare-extraction' : undefined);
    const contract = provider && operation === 'decision' ? providerContract(provider) : undefined;
    const kind = contract?.kind ?? input.kind ?? (operation === 'extraction' ? 'extraction' : 'decision');
    check(input.kind === undefined || input.kind === (contract?.kind ?? kind), 'Provider kind mismatch.', 'CONFIGURATION_ERROR');
    check(kind !== 'generative' || input.allowGenerative === true, 'Generative routing requires allowGenerative: true.', 'CONFIGURATION_ERROR');
    if (recovery && input.enabled !== false) {
        if (config) {
            check((config.maxRetries ?? 0) === 0 && (config.gateway?.retries?.maxAttempts ?? 1) === 1,
                'Failover requires maxRetries: 0 and Gateway maxAttempts: 1.', 'CONFIGURATION_ERROR');
            config = Object.freeze({ ...config, maxRetries: 0 });
        } else check(input.singleDispatch === true, 'Failover requires singleDispatch: true for supplied providers and factories.', 'CONFIGURATION_ERROR');
    }
    const selectedModel = input.model ?? config?.model ?? provider?.defaultModel;
    check(!config || input.model === undefined || canonical(config.type, input.model) === canonical(config.type, config.model), 'Conflicting route model settings.', 'CONFIGURATION_ERROR');
    const descriptor = { id, operation, kind, enabled: input.enabled !== false, required: input.required === true,
        description: input.description ?? '', model: selectedModel, cooldownGroup: input.cooldownGroup,
        isReady: () => input.ready !== false && (config ? readyNative(config) : true),
        isInitialized: () => !!provider, canonical: value => canonical(providerType(), value),
        preflight(request) {
            // A factory's model aliases and capabilities are unknown until it initializes.
            if (!config && !provider) return undefined;
            const model = selectedModel ?? provider?.defaultModel;
            if (request.model !== undefined && model !== undefined) check(descriptor.canonical(request.model) === descriptor.canonical(model),
                'Request model conflicts with the concrete route.', 'UNSUPPORTED_CAPABILITY');
            const resolved = request.model === undefined && model !== undefined ? { ...request, model } : request;
            if (config) return pure[config.type](resolved, preflightOptions(config));
            return operation === 'extraction' ? provider.validate(resolved) : createBridge({ provider }).validate(resolved);
        },
        async initialize(signal) {
            if (provider) {
                if (operation === 'decision') check(providerContract(provider).kind === kind, 'Registered provider kind changed.', 'CONFIGURATION_ERROR');
                return provider;
            }
            // Failures are never cached; one caller's cancellation cannot poison future calls.
            let initialized;
            try {
                initialized = config ? config.type === 'cloudflare-extraction'
                    ? new CloudflareExtractionProvider(withoutType(config)) : createProvider(config)
                    : await input.factory(Object.freeze({ signal }));
            } catch (error) {
                if (config && error instanceof DecisionError) throw error;
                throw new DecisionError('Route provider initialization failed.', { code: 'CONFIGURATION_ERROR' });
            }
            if (operation === 'decision') check(providerContract(initialized).kind === kind, 'Initialized provider kind mismatch.', 'CONFIGURATION_ERROR');
            if (!signal.aborted) provider = initialized;
            return initialized;
        },
        // Private identity is never exposed in inspection or diagnostics.
        identity: input.provider ?? input.factory ?? config,
        config,
    };
    return Object.freeze(descriptor);
}

function withoutType(config) { const { type: _type, ...rest } = config; return rest; }
function canonical(type, value) { return normalize[type] ? normalize[type](value) : value; }
function preflightOptions(config) {
    return Object.fromEntries(['model', 'maxRequestBytes', ...(config.type === 'jev' ? ['dangerZone'] : []),
        ...(config.type.startsWith('cloudflare-') ? ['transport', 'gateway', 'maxRetries', 'rejectIfBusy'] : [])]
        .filter(key => config[key] !== undefined).map(key => [key, config[key]]));
}

export function createTargets(options) {
    const entries = Object.entries(options.routes).filter(([id]) => id !== 'auto').map(([id, value]) => [id,
        target(id, value, !!options.auto?.failover && options.auto.candidates.includes(id))]);
    // Reject duplicates we can prove; opaque factories/accounts are not guessed equivalent.
    for (let i = 0; i < entries.length; i++) for (let j = 0; j < i; j++) {
        const a = entries[i][1]; const b = entries[j][1];
        const sameConfig = a.config && b.config && a.config.fetchImpl === b.config.fetchImpl && a.config.ai === b.config.ai &&
            JSON.stringify(Object.entries(a.config).filter(([key]) => !['model', 'fetchImpl', 'ai'].includes(key)).sort()) ===
            JSON.stringify(Object.entries(b.config).filter(([key]) => !['model', 'fetchImpl', 'ai'].includes(key)).sort());
        check(!(a.operation === b.operation && a.canonical(a.model) === b.canonical(b.model) &&
            (a.identity === b.identity || sameConfig)), 'Duplicate concrete route target.', 'CONFIGURATION_ERROR');
    }
    return new Map(entries);
}
