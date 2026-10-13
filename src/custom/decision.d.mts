import type { Provider, DecisionProvider } from '../index.mjs';

/** Callbacks return canonical results and retain the definition as their receiver. */
export type DecisionProviderDefinition = Omit<Provider, 'kind'>;
export function defineDecisionProvider(definition: DecisionProviderDefinition): DecisionProvider;
