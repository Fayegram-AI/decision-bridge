// JSON configuration adapts to the browser-safe routing registry without eager imports.
import { optionsObject } from '../options.mjs';
import { cloneJson, isRecord } from '../validation.mjs';
import { requireCondition as check } from '../errors.mjs';
import { autoPolicy, integer, validId } from '../routing/configuration.mjs';
import { validateConfig, KEY_ENVS, isModule } from './config-validation.mjs';
import { configuredProvider } from './provider-loader.mjs';
import { validateApiKey } from '../transport.mjs';

const ROUTE_KEYS = ['operation', 'enabled', 'required', 'description', 'config', 'singleDispatch', 'allowGenerative', 'cooldownGroup'];
export function validateRoutingConfig(input) {
    const config = cloneJson(input, 'routing configuration', 'CONFIGURATION_ERROR');
    optionsObject(config, ['$schema', 'schemaVersion', 'routes', 'defaultRoute', 'policyRevision', 'workTimeoutMs', 'clarificationTimeoutMs', 'observerTimeoutMs'], 'Routing configuration');
    check(config.schemaVersion === 2 && isRecord(config.routes), 'Routing configuration requires schemaVersion: 2 and routes.', 'CONFIGURATION_ERROR');
    check(config.$schema === undefined || (typeof config.$schema === 'string' && config.$schema.trim()), 'Invalid schema reference.', 'CONFIGURATION_ERROR');
    const names = Object.keys(config.routes);
    check(names.length > 0 && names.length <= 257 && names.every(validId), 'Invalid registry IDs.', 'CONFIGURATION_ERROR');
    check(config.defaultRoute === undefined || names.includes(config.defaultRoute), 'Unknown defaultRoute.', 'CONFIGURATION_ERROR');
    check(config.policyRevision === undefined || (typeof config.policyRevision === 'string' && config.policyRevision.length <= 100), 'Invalid policyRevision.', 'CONFIGURATION_ERROR');
    for (const key of ['workTimeoutMs', 'clarificationTimeoutMs', 'observerTimeoutMs']) if (config[key] !== undefined) integer(config[key], key);
    if (Object.hasOwn(config.routes, 'auto')) config.routes.auto = autoPolicy(config.routes.auto, names.filter(id => id !== 'auto'));
    for (const [id, route] of Object.entries(config.routes)) {
        if (id === 'auto') continue;
        optionsObject(route, ROUTE_KEYS, 'Configured route');
        check(isRecord(route.config) && route.config.schemaVersion !== 2 && typeof route.config.provider === 'string', 'Concrete route requires provider configuration.', 'CONFIGURATION_ERROR');
        route.config = validateConfig(route.config, { complete: route.enabled !== false });
        check(route.operation === undefined || ['decision', 'extraction'].includes(route.operation), 'Unknown route operation.', 'CONFIGURATION_ERROR');
        check(route.operation === undefined || (route.operation === 'extraction') === (route.config.provider === 'cloudflare-extraction'), 'Route operation mismatch.', 'CONFIGURATION_ERROR');
        for (const key of ['enabled', 'required', 'singleDispatch', 'allowGenerative']) check(route[key] === undefined || typeof route[key] === 'boolean', 'Route flags must be boolean.', 'CONFIGURATION_ERROR');
        check(route.description === undefined || (typeof route.description === 'string' && route.description.length <= 2000), 'Invalid route description.', 'CONFIGURATION_ERROR');
        check(route.cooldownGroup === undefined || (typeof route.cooldownGroup === 'string' && route.cooldownGroup.length > 0 && route.cooldownGroup.length <= 100), 'Invalid cooldownGroup.', 'CONFIGURATION_ERROR');
        check(route.config.provider !== 'custom-generative' || route.allowGenerative === true, 'Generative routes require allowGenerative: true.', 'CONFIGURATION_ERROR');
    }
    return config;
}

export function routingOptions(loaded) {
    const { schemaVersion: _version, $schema: _schema, routes, ...settings } = loaded.config;
    const targets = Object.fromEntries(Object.entries(routes).map(([id, route]) => {
        if (id === 'auto') return [id, route];
        const { config: original, ...rest } = route;
        let config = original;
        if (config.preset && routes.auto?.failover && routes.auto.candidates.includes(id) && route.enabled !== false) {
            check((config.maxRetries ?? 0) === 0, 'Routed failover requires preset maxRetries: 0.', 'CONFIGURATION_ERROR');
            config = { ...config, maxRetries: 0 };
            rest.singleDispatch = true;
        }
        const keyEnv = config.apiKeyEnv ?? KEY_ENVS[config.preset ?? config.provider];
        const apiKey = keyEnv ? loaded.env[keyEnv] : undefined;
        if (['custom-decision', 'custom-generative'].includes(config.provider)) {
            let ready = true;
            if (!config.noAuth && (!isModule(config) || config.apiKeyEnv)) {
                try { validateApiKey(apiKey); } catch { ready = false; }
            }
            return [id, { ...rest, kind: config.provider === 'custom-decision' ? 'decision' : 'generative',
                ...(config.model === undefined ? {} : { model: config.model }), ready,
                factory: ({ signal }) => configuredProvider({ ...loaded, config }, { signal }) }];
        }
        const native = Object.fromEntries(Object.entries(config).filter(([key]) => !['$schema', 'schemaVersion', 'provider', 'apiKeyEnv'].includes(key)));
        check(config.baseURL === undefined || config.apiKeyEnv !== undefined,
            'A custom baseURL requires apiKeyEnv.', 'CONFIGURATION_ERROR');
        native.type = config.provider;
        // Never fall back to process.env inside a lazily constructed SDK provider.
        native.apiKey = apiKey ?? '';
        if (config.provider.startsWith('cloudflare-')) native.accountId = config.accountId ??
            (config.baseURL === undefined ? loaded.env.CLOUDFLARE_ACCOUNT_ID : undefined);
        if (native.accountId === undefined) delete native.accountId;
        return [id, { ...rest, config: native }];
    }));
    return { ...settings, routes: targets };
}

export function routingSecrets(loaded) {
    return Object.values(loaded.config.routes).filter(route => route.config?.apiKeyEnv)
        .map(route => loaded.env[route.config.apiKeyEnv]).filter(value => typeof value === 'string' && value);
}
