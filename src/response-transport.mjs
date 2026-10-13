import { optionsObject } from './options.mjs';
import { DecisionError, requireCondition as check } from './errors.mjs';
import { deadline, withSignal } from './async.mjs';

const RETRY_STATUSES = new Set([429, 502, 503, 504, 529]);
const MAX_BYTES = 64 * 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();
// Inspect actual byte-view slots; custom chunks can shadow byteLength or toStringTag.
const BYTE_VIEW_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const BYTE_VIEW_LENGTH = Object.getOwnPropertyDescriptor(BYTE_VIEW_PROTOTYPE, 'byteLength').get;
const BYTE_VIEW_KIND = Object.getOwnPropertyDescriptor(BYTE_VIEW_PROTOTYPE, Symbol.toStringTag).get;

/** Shared wire-size check for offline preflight and actual HTTP dispatch. */
export function serializeRequestBody(body, maxRequestBytes = 8 * 1024 * 1024) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  check(serialized === undefined || UTF8_ENCODER.encode(serialized).byteLength <= maxRequestBytes,
    'Provider request exceeds the byte limit.', 'REQUEST_TOO_LARGE');
  return serialized;
}

function sleep(delay, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
    const aborted = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export function sanitizeId(value, secrets = []) {
  if (typeof value !== 'string') return undefined;
  let safe = value;
  for (const secret of secrets) if (secret) safe = safe.split(secret).join('[REDACTED]');
  return safe.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || undefined;
}

function retryDelay(headers, attempt) {
  const raw = headers.get('retry-after');
  if (raw !== null) {
    const seconds = Number(raw);
    const milliseconds = raw.trim() !== '' && Number.isFinite(seconds)
      ? seconds * 1000 : Date.parse(raw) - Date.now();
    if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  }
  return Math.min(8000, 250 * 2 ** attempt) * (0.5 + Math.random());
}

async function readJson(response, maxBytes, budget) {
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > maxBytes) {
        response.body?.cancel().catch(() => {});
        throw new DecisionError('Provider response exceeds the byte limit.', { code: 'RESPONSE_TOO_LARGE' });
    }
    const reader = response.body?.getReader();
    check(reader, 'Provider returned an empty body.', 'INVALID_RESPONSE');
    // Bound storage by payload bytes rather than the number of stream fragments.
    let bytes = new Uint8Array(0);
    let size = 0;
    let reads = 0;
    try {
        while (true) {
            // Ready streams can starve timers by continuously scheduling microtasks.
            budget.throwIfAborted();
            if (++reads % 256 === 0) await sleep(0, budget.signal);
            const { value, done } = await withSignal(reader.read(), budget.signal);
            budget.throwIfAborted();
            if (done) break;
            check(ArrayBuffer.isView(value) && BYTE_VIEW_KIND.call(value) === 'Uint8Array',
                'Provider response body must contain Uint8Array byte chunks.', 'INVALID_RESPONSE');
            const length = BYTE_VIEW_LENGTH.call(value);
            if (length === 0) continue;
            const nextSize = size + length;
            check(nextSize <= maxBytes, 'Provider response exceeds the byte limit.', 'RESPONSE_TOO_LARGE');
            if (nextSize > bytes.length) {
                const grown = new Uint8Array(Math.min(maxBytes, Math.max(nextSize, bytes.length * 2, 4096)));
                grown.set(bytes.subarray(0, size));
                bytes = grown;
            }
            bytes.set(value, size);
            size = nextSize;
        }
    } finally {
        // Do not await a malicious/custom stream's non-settling cancellation callback.
        reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))); }
    catch { throw new DecisionError('Provider returned invalid UTF-8 or JSON.', { code: 'INVALID_RESPONSE' }); }
}

/** Execute a bounded JSON exchange independently of HTTP or a Workers binding. */
export class JsonResponseTransport {
    #options;
    #secrets;
    #errorDecoder;
    #responseMetadata;

    constructor({ secrets = [], timeoutMs = 30000, maxRetries = 2,
        maxRequestBytes = 8 * 1024 * 1024, maxResponseBytes = 8 * 1024 * 1024,
        errorDecoder, responseMetadata } = {}) {
        check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2147483647,
            'timeoutMs must be a positive 32-bit integer.', 'CONFIGURATION_ERROR');
        check(Number.isSafeInteger(maxRetries) && maxRetries >= 0 && maxRetries <= 10,
            'maxRetries must be an integer from 0 to 10.', 'CONFIGURATION_ERROR');
        for (const bytes of [maxRequestBytes, maxResponseBytes]) check(Number.isSafeInteger(bytes) &&
            bytes > 0 && bytes <= MAX_BYTES, 'Byte limits must be integers in [1, 67108864].', 'CONFIGURATION_ERROR');
        this.#options = { timeoutMs, maxRetries, maxRequestBytes, maxResponseBytes };
        this.#secrets = [...secrets];
        this.#errorDecoder = errorDecoder;
        this.#responseMetadata = responseMetadata;
    }

    async request(body, dispatch, callOptions = {}) {
        const { signal } = optionsObject(callOptions, ['signal'], 'Provider call options');
        const started = performance.now();
        const budget = deadline(this.#options.timeoutMs, signal);
        let attempts = 0;
        let lastRequestId;
        let lastGatewayLogId;
        try {
            const serialized = serializeRequestBody(body, this.#options.maxRequestBytes);
            for (let retry = 0; ; retry++) {
                budget.throwIfAborted();
                attempts++;
                const response = await withSignal(dispatch(serialized, budget.signal), budget.signal);
                check(response instanceof Response, 'Provider must return a Response.', 'INVALID_RESPONSE');
                const extra = this.#responseMetadata?.(response) ?? {};
                lastRequestId = sanitizeId(extra.requestId ?? response.headers.get('x-request-id') ??
                    response.headers.get('request-id'), this.#secrets);
                lastGatewayLogId = sanitizeId(extra.gatewayLogId, this.#secrets);
                const meta = {
                    attempts, durationMs: Math.round((performance.now() - started) * 1000) / 1000,
                    ...(lastRequestId ? { requestId: lastRequestId } : {}),
                    ...(lastGatewayLogId ? { gatewayLogId: lastGatewayLogId } : {}),
                };
                if (response.ok) {
                    const data = await readJson(response, this.#options.maxResponseBytes, budget);
                    budget.throwIfAborted();
                    meta.durationMs = Math.round((performance.now() - started) * 1000) / 1000;
                    return { data, meta };
                }
                let data;
                if (this.#errorDecoder) {
                    try { data = await readJson(response, this.#options.maxResponseBytes, budget); }
                    catch (error) { if (error.code !== 'INVALID_RESPONSE') throw error; }
                } else response.body?.cancel().catch(() => {});
                const error = this.#errorDecoder?.(data, response.status, meta) ??
                    new DecisionError(`Provider returned HTTP ${response.status}.`, {
                        code: 'HTTP_ERROR', status: response.status, ...meta,
                    });
                budget.throwIfAborted();
                if (!RETRY_STATUSES.has(response.status) || retry >= this.#options.maxRetries) throw error;
                const delay = retryDelay(response.headers, retry);
                if (delay >= budget.remainingMs) throw new DecisionError('Retry delay exceeds the remaining request deadline.', {
                    ...error.toJSON(), code: 'RETRY_BUDGET_EXCEEDED',
                });
                await sleep(delay, budget.signal);
            }
        } catch (error) {
            const diagnostics = { attempts, ...(lastRequestId ? { requestId: lastRequestId } : {}),
                ...(lastGatewayLogId ? { gatewayLogId: lastGatewayLogId } : {}) };
            if (signal?.aborted) throw new DecisionError('Request cancelled by caller.', { code: 'ABORTED', ...diagnostics });
            if (budget.timedOut) throw new DecisionError('Provider request deadline exceeded.', { code: 'TIMEOUT', ...diagnostics });
            if (error instanceof DecisionError) {
                error.attempts ??= attempts;
                if (lastRequestId) error.requestId ??= lastRequestId;
                if (lastGatewayLogId) error.gatewayLogId ??= lastGatewayLogId;
                throw error;
            }
            throw new DecisionError('Network request failed; no automatic network retry was made.', {
                code: 'NETWORK_ERROR', ...diagnostics,
            });
        } finally { budget.close(); }
    }
}
