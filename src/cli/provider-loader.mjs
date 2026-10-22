import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DecisionError, requireCondition as check } from '../errors.mjs';
import { deadline, withSignal, abortError } from '../async.mjs';
import { providerContract } from '../provider-contract.mjs';
import { createProvider } from '../providers/index.mjs';
import { CloudflareExtractionProvider } from '../extraction/index.mjs';
import { validateConfig, isModule, KEY_ENVS } from './config-validation.mjs';

/** Executable modules are loaded only by explicit inference/model-list commands. */
async function moduleProvider({ config, moduleBase }, apiKey, signal) {
    const budget = deadline(config.timeoutMs ?? 30000, signal);
    try {
        budget.throwIfAborted();
        let namespace;
        try { namespace = await withSignal(import(pathToFileURL(resolve(moduleBase, config.module)).href), budget.signal); }
        catch { throw new DecisionError('Cannot load the explicitly configured provider module.', { code: 'CONFIGURATION_ERROR' }); }
        check(typeof namespace.createProvider === 'function', 'Provider module must export createProvider(options).', 'CONFIGURATION_ERROR');
        let provider;
        try {
            provider = await withSignal(Promise.resolve().then(() => {
                budget.throwIfAborted();
                return namespace.createProvider({ ...config.options, ...(apiKey === undefined ? {} : { apiKey }),
                    ...(config.model === undefined ? {} : { model: config.model }) });
            }), budget.signal);
        } catch { throw new DecisionError('Custom provider initialization failed.', { code: 'CONFIGURATION_ERROR' }); }
        budget.throwIfAborted();
        const contract = providerContract(provider);
        check(contract.kind === (config.provider === 'custom-decision' ? 'decision' : 'generative'),
            'Provider module kind does not match its configured custom path.', 'CONFIGURATION_ERROR');
        return provider;
    } catch (error) {
        if (signal?.aborted) throw abortError();
        if (budget.timedOut) throw new DecisionError('Custom provider initialization deadline exceeded.', { code: 'TIMEOUT' });
        throw error;
    } finally { budget.close(); }
}

export async function configuredProvider(loaded, { signal } = {}) {
    const config = validateConfig(loaded.config, { complete: true });
    const type = config.provider ?? 'jev';
    const keyEnv = config.apiKeyEnv ?? KEY_ENVS[config.preset ?? type];
    check(isModule(config) || config.baseURL === undefined || config.apiKeyEnv !== undefined || config.noAuth === true,
        'A custom baseURL requires apiKeyEnv or explicit noAuth.', 'CONFIGURATION_ERROR');
    const apiKey = config.noAuth ? null : keyEnv ? loaded.env[keyEnv] : undefined;
    if (isModule(config)) return moduleProvider({ ...loaded, config }, apiKey, signal);
    const options = Object.fromEntries(Object.entries(config).filter(([key]) => ![
        '$schema', 'schemaVersion', 'provider', 'preset', 'apiKeyEnv', 'noAuth', 'module', 'options',
    ].includes(key)));
    // Missing keys cannot fall back to the process environment after CLI precedence resolution.
    options.apiKey = apiKey === undefined ? '' : apiKey;
    if (type === 'custom-generative') {
        const { createGenerativeProvider } = await import('../custom/generative/index.mjs');
        return createGenerativeProvider({ type: config.preset, ...options });
    }
    if (['cloudflare-decisions', 'cloudflare-extraction'].includes(type)) options.accountId = config.accountId ??
        (config.baseURL === undefined ? loaded.env.CLOUDFLARE_ACCOUNT_ID : undefined) ?? '';
    return type === 'cloudflare-extraction' ? new CloudflareExtractionProvider(options) : createProvider({ type, ...options });
}
