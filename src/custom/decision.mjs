import { defineProvider } from './definition.mjs';

/** Adapt a dedicated decision API to the common provider contract. */
export function defineDecisionProvider(definition) {
    return defineProvider(definition, 'decision');
}
