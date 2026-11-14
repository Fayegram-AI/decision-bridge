/** Built-in aliases and generated templates share the SDK's environment policy. */
import { providerEnvironmentValue } from '../runtime-env.mjs';

export const KEY_ENVS = Object.freeze({
    jev: 'TYPESAFE_API_KEY',
    'openai-decisions': 'OPENAI_API_KEY',
    'gemini-decisions': 'GEMINI_API_KEY',
    'openrouter-decisions': 'OPENROUTER_API_KEY',
    'openrouter-extraction': 'OPENROUTER_API_KEY',
    'cloudflare-decisions': 'CLOUDFLARE_API_TOKEN',
    'cloudflare-extraction': 'CLOUDFLARE_API_TOKEN',
    'openai-compatible': 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
});

/** Explicit selectors are exact; CLI environment files never fall back to process.env. */
export function configuredApiKey(config, env) {
    if (config.noAuth) return null;
    if (config.apiKeyEnv !== undefined) return env[config.apiKeyEnv];
    return providerEnvironmentValue(KEY_ENVS[config.preset ?? config.provider], env);
}

/** Keep the alternative commented so a placeholder cannot override the selected key. */
export function environmentTemplate(name, { aliases = true, placeholder = 'replace_with_your_api_key' } = {}) {
    return [`${name}=${placeholder}`, ...(aliases ? [`# DECISION_BRIDGE_${name}=${placeholder}`] : [])];
}

export function credentialTemplate(config) {
    const name = KEY_ENVS[config.preset ?? config.provider];
    return environmentTemplate(config.apiKeyEnv ?? name ?? 'CUSTOM_PROVIDER_API_KEY', {
        aliases: config.apiKeyEnv === undefined && name !== undefined,
    });
}

export const ACCOUNT_ENV_TEMPLATE = Object.freeze(environmentTemplate('CLOUDFLARE_ACCOUNT_ID', {
    placeholder: 'replace_with_your_account_id',
}));
