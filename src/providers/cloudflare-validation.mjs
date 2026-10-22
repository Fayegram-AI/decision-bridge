import { DecisionError, requireCondition as check } from '../errors.mjs';
import { cloneJson, isRecord, validateResult } from '../validation.mjs';
import { CLOUDFLARE_RESULT_OPTIONS } from './cloudflare-profile.mjs';

const CODES = new Map([
    [3006, ['REQUEST_TOO_LARGE', 'Cloudflare rejected an oversized inference request.']],
    ...[5018, 5016, 3023, 3041, 5035].map(code => [code, ['PERMISSION_DENIED', 'Cloudflare denied access to inference.']]),
    [3040, ['CAPACITY_EXCEEDED', 'Cloudflare inference capacity is temporarily unavailable.']],
    [3036, ['ALLOCATION_EXCEEDED', 'Cloudflare inference allocation limit exceeded.']],
    [3007, ['UPSTREAM_TIMEOUT', 'Cloudflare upstream inference timed out.']],
    [3008, ['UPSTREAM_ABORTED', 'Cloudflare upstream inference was aborted.']],
]);
const STATUSES = new Map([
    [401, ['AUTHENTICATION_ERROR', 'Cloudflare authentication failed.']],
    [403, ['PERMISSION_DENIED', 'Cloudflare denied access to inference.']],
    [413, ['REQUEST_TOO_LARGE', 'Cloudflare rejected an oversized inference request.']],
    [429, ['RATE_LIMITED', 'Cloudflare inference rate limit exceeded.']],
]);

/** Keep numeric diagnostics; upstream messages and bodies never become public errors. */
export function cloudflareError(data, status, meta) {
    const value = isRecord(data) ? data.internalCode ?? data.errors?.[0]?.code : undefined;
    const upstreamCode = Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    const [code, message] = CODES.get(upstreamCode) ?? STATUSES.get(status) ??
        ['HTTP_ERROR', 'Cloudflare rejected the inference request.'];
    return new DecisionError(message, { code, status, ...meta, source: 'provider',
        retryable: !['ALLOCATION_EXCEEDED', 'AUTHENTICATION_ERROR', 'PERMISSION_DENIED', 'REQUEST_TOO_LARGE'].includes(code) &&
            (code === 'CAPACITY_EXCEEDED' || code === 'RATE_LIMITED' || [502, 503, 504, 529].includes(status)),
        ...(upstreamCode === undefined ? {} : { upstreamCode }) });
}

export function unwrapCloudflareResponse(data, transport, meta) {
    if (transport === 'binding') return data;
    check(isRecord(data) && typeof data.success === 'boolean', 'Invalid Cloudflare REST envelope.', 'INVALID_RESPONSE');
    if (!data.success) throw cloudflareError(data, 200, meta);
    check((data.errors === undefined || (Array.isArray(data.errors) && data.errors.length === 0)) &&
        (data.messages === undefined || Array.isArray(data.messages)),
    'Invalid Cloudflare REST diagnostics.', 'INVALID_RESPONSE');
    return data.result;
}

export function validateCloudflareResponse(input, request) {
    const decision = cloneJson(input, 'Cloudflare response', 'INVALID_RESPONSE');
    check(isRecord(decision) && Object.keys(decision).every(key => ['model', 'answers', 'usage'].includes(key)),
        'Cloudflare response contains an unknown field.', 'INVALID_RESPONSE');
    check(isRecord(decision.usage) && Object.keys(decision.usage).length === 2 &&
        Object.hasOwn(decision.usage, 'input_tokens') && Object.hasOwn(decision.usage, 'output_tokens'),
    'Cloudflare usage requires input_tokens and output_tokens.', 'INVALID_RESPONSE');
    return validateResult(decision, request.questions, CLOUDFLARE_RESULT_OPTIONS);
}
