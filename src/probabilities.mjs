import { requireCondition as check } from './errors.mjs';

/** Rounding allowance is selected by a provider contract, never response metadata. */
export function validateResultOptions(options) {
    check(options !== null && typeof options === 'object' && !Array.isArray(options) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(options)) &&
        Object.getOwnPropertySymbols(options).length === 0 &&
        Object.entries(Object.getOwnPropertyDescriptors(options)).every(([key, descriptor]) =>
            ['native', 'probabilityDecimalPlaces'].includes(key) && descriptor.enumerable && 'value' in descriptor),
    'Result-validation options contain an unknown field or accessor.', 'CONFIGURATION_ERROR');
    const { native = false, probabilityDecimalPlaces } = options;
    check(typeof native === 'boolean', 'native must be boolean.', 'CONFIGURATION_ERROR');
    check(probabilityDecimalPlaces === undefined || (Number.isSafeInteger(probabilityDecimalPlaces) &&
        probabilityDecimalPlaces >= 1 && probabilityDecimalPlaces <= 15),
    'probabilityDecimalPlaces must be an integer from 1 to 15.', 'CONFIGURATION_ERROR');
    return { native, ...(probabilityDecimalPlaces === undefined ? {} : { probabilityDecimalPlaces }) };
}

/** Preserve native numbers. Only grid-aligned values receive the rounding budget. */
export function validateProbabilitySum(numbers, probabilityDecimalPlaces) {
    const scale = probabilityDecimalPlaces === undefined ? undefined : 10 ** probabilityDecimalPlaces;
    const rounded = scale !== undefined && numbers.every(value =>
        Math.abs(value * scale - Math.round(value * scale)) <= 1e-9);
    const tolerance = rounded ? Math.max(0.001, numbers.length / (2 * scale)) + 1e-12 : 0.001;
    check(Math.abs(numbers.reduce((sum, value) => sum + value, 0) - 1) <= tolerance,
        'Probabilities must sum to 1 within the provider precision allowance.', 'INVALID_RESPONSE');
}
