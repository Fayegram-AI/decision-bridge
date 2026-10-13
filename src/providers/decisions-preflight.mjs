// Pure request preflight, shared by SDK validation, provider calls, and offline CLI.
import { freezeJson, validateRequest } from '../validation.mjs';
import { assertCapabilities, builtInCapabilities } from '../capabilities.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { validateDecisionRequest } from './decisions-validation.mjs';
import { encodeCommonDecision } from './decisions-codec.mjs';

export function preflightDecision(input, { model = 'gpt-6-luna', maxRequestBytes } = {}) {
    const request = validateDecisionRequest(input, model);
    serializeRequestBody(request, maxRequestBytes);
    return request;
}

/** Check converted JSON text and wire bytes, not just the common request shape. */
export function preflightCommonDecision(input, options = {}) {
    const request = validateRequest(input, options.model ?? 'gpt-6-luna');
    assertCapabilities(request, builtInCapabilities('openai-decisions', request.model));
    preflightDecision(encodeCommonDecision(request), options);
    return freezeJson(request);
}
