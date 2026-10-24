import { isRecord } from '../validation.mjs';

const USAGE_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens',
    'cache_read_input_tokens', 'state_tokens', 'image_tokens', 'schema_tokens', 'passes'];

/** Diagnostics retain known counters without executing accessors or copying arbitrary payloads. */
export function usageSnapshot(usage) {
    if (!isRecord(usage)) return null;
    const entries = USAGE_FIELDS.flatMap(key => {
        const descriptor = Object.getOwnPropertyDescriptor(usage, key);
        if (!descriptor || !('value' in descriptor)) return [];
        const value = descriptor.value;
        return value === null && ['input_tokens', 'output_tokens'].includes(key) || Number.isSafeInteger(value) && value >= 0
            ? [[key, value]] : [];
    });
    const snapshot = Object.fromEntries(entries);
    return Object.hasOwn(snapshot, 'input_tokens') && Object.hasOwn(snapshot, 'output_tokens') ? Object.freeze(snapshot) : null;
}
