import { isRecord } from '../validation.mjs';
import { requireCondition as check } from '../errors.mjs';
import { DecisionError } from '../errors.mjs';
import { JevProvider } from './jev.mjs';
import { OpenAIDecisionsProvider } from './openai-decisions.mjs';
import { CloudflareDecisionsProvider } from './cloudflare-decisions.mjs';

export { JevProvider, OpenAIDecisionsProvider, CloudflareDecisionsProvider };

/** Programmatic factory. Custom providers are passed directly to createBridge. */
export function createProvider(configuration) {
  check(isRecord(configuration), 'Provider configuration must be a plain object.', 'CONFIGURATION_ERROR');
  check(Object.getOwnPropertySymbols(configuration).length === 0 &&
    Object.values(Object.getOwnPropertyDescriptors(configuration)).every(d => d.enumerable && 'value' in d),
  'Provider configuration must not contain accessors or symbol keys.', 'CONFIGURATION_ERROR');
    // Require an own data property before reading the selector or provider options.
    check(Object.hasOwn(configuration, 'type') && typeof configuration.type === 'string' && configuration.type.trim().length > 0,
        'Provider type must be explicitly configured.', 'CONFIGURATION_ERROR');
    const { type, ...options } = configuration;
  switch (type) {
    case 'jev': return new JevProvider(options);
    case 'openai-decisions': return new OpenAIDecisionsProvider(options);
    case 'cloudflare-decisions': return new CloudflareDecisionsProvider(options);
    default: throw new DecisionError('Unknown native decision provider. General-purpose adapters require custom-generative presets.', { code: 'CONFIGURATION_ERROR' });
  }
}
