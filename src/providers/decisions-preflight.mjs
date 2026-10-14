// Pure request preflight, shared by SDK validation, provider calls, and offline CLI.
import { freezeJson, validateRequest } from '../validation.mjs';
import { assertCapabilities, builtInCapabilities } from '../capabilities.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { validateDecisionRequest } from './decisions-validation.mjs';
import { encodeCommonDecision } from './decisions-codec.mjs';
import { OPENAI_DEFAULT_MODEL, resolveOpenAIModel } from './openai-profile.mjs';

/** Keep the caller selection separate from the resolved, size-checked wire request. */
export function prepareDecision(input, { model = OPENAI_DEFAULT_MODEL, maxRequestBytes } = {}) {
    const request = validateDecisionRequest(input, model);
    const native = freezeJson({ ...request, model: resolveOpenAIModel(request.model) });
    serializeRequestBody(native, maxRequestBytes);
    return { request, native };
}

export function preflightDecision(input, options = {}) {
    return prepareDecision(input, options).request;
}

/** Check converted JSON text and wire bytes, not just the common request shape. */
export function prepareCommonDecision(input, options = {}) {
    const request = validateRequest(input, options.model ?? OPENAI_DEFAULT_MODEL);
    assertCapabilities(request, builtInCapabilities('openai-decisions', request.model));
    const { native } = prepareDecision(encodeCommonDecision(request), options);
    return { request: freezeJson(request), native };
}

export function preflightCommonDecision(input, options = {}) {
    return prepareCommonDecision(input, options).request;
}
