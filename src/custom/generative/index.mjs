import { defineProvider } from '../definition.mjs';
import { optionsObject } from '../../options.mjs';
import { DecisionError, requireCondition as check } from '../../errors.mjs';
import { OpenAICompatibleProvider, OpenRouterProvider } from './openai-compatible.mjs';
import { AnthropicProvider } from './anthropic.mjs';

export { OpenAICompatibleProvider, OpenRouterProvider, AnthropicProvider };
export { buildResponseSchema, buildPrompt, parseGeneratedJson, normalizeGenerated } from './schema.mjs';

/** Application-owned prompting/protocol implementation returning canonical results. */
export function defineGenerativeProvider(definition) {
    return defineProvider(definition, 'generative');
}

/** Explicit opt-in presets; the native createProvider registry does not load these. */
export function createGenerativeProvider(configuration) {
    optionsObject(configuration, ['type', 'apiKey', 'model', 'baseURL', 'responseFormat',
        'tokenParameter', 'maxTokens', 'parameters', 'timeoutMs', 'maxRetries',
        'maxRequestBytes', 'maxResponseBytes', 'fetchImpl'], 'Generative configuration');
    check(Object.hasOwn(configuration, 'type') && typeof configuration.type === 'string' && configuration.type.trim(),
        'Generative preset type must be explicitly configured.', 'CONFIGURATION_ERROR');
    const { type, ...options } = configuration;
    switch (type) {
        case 'openai-compatible': return new OpenAICompatibleProvider(options);
        case 'openrouter': return new OpenRouterProvider(options);
        case 'anthropic': return new AnthropicProvider(options);
        default: throw new DecisionError('Unknown custom generative preset.', { code: 'CONFIGURATION_ERROR' });
    }
}
