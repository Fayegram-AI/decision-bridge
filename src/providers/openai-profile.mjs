import { requireCondition as check } from '../errors.mjs';

/** Release-owned selectors resolve locally; upstream responses never change this mapping. */
export const OPENAI_DEFAULT_MODEL = 'default';
const LUNA_MODEL = 'gpt-6-luna';
const SELECTORS = Object.freeze({ default: LUNA_MODEL, luna: LUNA_MODEL, [LUNA_MODEL]: LUNA_MODEL });
const PROFILES = Object.freeze({
    [LUNA_MODEL]: Object.freeze({
        supported: true, orderedInput: true, images: true, typedChoices: true,
        labeledScores: true, safetyIdentifier: true,
        maxImages: 128, maxChoiceOptions: 255, maxScoreLevels: null,
    }),
});

/** Lookup does not throw for unsupported selections, matching capability-query semantics. */
export function openaiModelProfile(selector) {
    return typeof selector === 'string' && Object.hasOwn(SELECTORS, selector)
        ? PROFILES[SELECTORS[selector]] : undefined;
}

export function resolveOpenAIModel(selector) {
    check(openaiModelProfile(selector), 'Selected provider/model does not support this model.', 'UNSUPPORTED_CAPABILITY');
    return SELECTORS[selector];
}
