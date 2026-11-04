// Shared saved-envelope checks bind protocol validation to the configured provider.
import { requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';

export function extractionResult(input, request, { provider, requestedModel, validateResponse }) {
    const saved = cloneJson(input, 'extraction result', 'INVALID_RESPONSE');
    const valid = (condition, message) => check(condition, message, 'INVALID_RESPONSE');
    valid(isRecord(saved) && isRecord(saved.meta), 'Invalid extraction result envelope.');
    const meta = saved.meta;
    valid(meta.provider === provider && meta.resolvedModel === request.model && meta.requestedModel === requestedModel,
        'Extraction result provenance does not match the request.');
    valid(Number.isSafeInteger(meta.attempts) && meta.attempts >= 1 && typeof meta.durationMs === 'number' && meta.durationMs >= 0,
        'Invalid extraction transport metadata.');
    for (const key of ['requestId', 'gatewayLogId', 'responseId', 'upstreamProvider']) valid(meta[key] === undefined || typeof meta[key] === 'string',
        'Invalid extraction transport identity.');
    saved.extraction = validateResponse(saved.extraction, request);
    return freezeJson(saved);
}

export function extractionProviderContract(provider) {
    check(provider && provider.kind === 'extraction' && typeof provider.name === 'string' && provider.name.trim() &&
        ['validate', 'extract', 'validateResult'].every(key => typeof provider[key] === 'function'),
    'An extraction provider with request and result validation is required.', 'CONFIGURATION_ERROR');
    return provider;
}
