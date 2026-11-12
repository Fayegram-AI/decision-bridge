/** Bounded snapshot budgets, selected by caller/provider contracts before cloning. */
import { requireCondition as check } from './errors.mjs';

export const DEFAULT_JSON_NODES = 200000;
export const MAX_JSON_NODES = 1000000;

export function jsonNodeLimit(value = DEFAULT_JSON_NODES) {
    check(Number.isSafeInteger(value) && value > 0 && value <= MAX_JSON_NODES,
        'maxJsonNodes must be an integer from 1 to 1000000.', 'CONFIGURATION_ERROR');
    return value;
}
