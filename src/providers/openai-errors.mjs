import { DecisionError } from '../errors.mjs';
import { isRecord } from '../validation.mjs';

const BILLING_CODES = new Set(['insufficient_quota', 'credit_balance_exhausted',
    'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']);
const machineCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value) ? value : undefined;

/** Only machine codes leave the decoder; upstream messages can contain input. */
export function openaiError(data, status, meta = {}) {
    const details = isRecord(data) && isRecord(data.error) ? data.error : {};
    const upstreamErrorCode = machineCode(details.code);
    const upstreamErrorType = machineCode(details.type);
    const billing = BILLING_CODES.has(upstreamErrorCode) || upstreamErrorType === 'insufficient_quota';
    const code = billing ? 'ALLOCATION_EXCEEDED' : status === 401 ? 'AUTHENTICATION_ERROR'
        : status === 403 ? 'PERMISSION_DENIED' : status === 429 ? 'RATE_LIMITED'
        : status === 413 ? 'REQUEST_TOO_LARGE' : status === 400 || status === 422 ? 'INVALID_REQUEST' : 'HTTP_ERROR';
    return new DecisionError(`OpenAI rejected the request (${code}).`, {
        ...meta, code, status, source: 'provider',
        retryable: !billing && [429, 500, 502, 503, 504, 529].includes(status),
        ...(upstreamErrorCode ? { upstreamErrorCode } : {}),
        ...(upstreamErrorType ? { upstreamErrorType } : {}),
    });
}
