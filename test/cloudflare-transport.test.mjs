import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { CloudflareDecisionsProvider, publicError, createBridge } from '../src/index.mjs';
import { cloudflareResponse, envelope, json, native } from './cloudflare-fixtures.mjs';

const rest = (fetchImpl, options = {}) => new CloudflareDecisionsProvider({
    accountId: 'fixture-account', apiKey: 'fixture-secret', fetchImpl, ...options,
});

test('all REST models omit disabled execution options for common and native requests', async () => {
    for (const model of ['clef', 'clef-flash', 'clef-omni']) {
        const requests = [];
        const fetchImpl = async (_url, init) => {
            const request = JSON.parse(init.body);
            requests.push(request);
            // The live Clef input validator rejects even options: { rejectIfBusy: false }.
            assert.equal(Object.hasOwn(request, 'options'), false);
            return json(envelope(cloudflareResponse(request)));
        };
        const provider = rest(fetchImpl, { model });
        await provider.createDecision(native);
        await provider.createDecision({ ...native, options: { rejectIfBusy: false } });
        await createBridge({ provider }).evaluate(native);
        const configured = rest(fetchImpl, { model, rejectIfBusy: true });
        await configured.createDecision({ ...native, options: { rejectIfBusy: false } });
        assert.equal(requests.length, 4);
        assert(requests.every(request => request.model === model));
    }
});

test('enabled REST busy mode fails common/native preflight for every model and alias without dispatch', async () => {
    let calls = 0;
    for (const short of ['clef', 'clef-flash', 'clef-omni']) for (const model of [short, '@cf/cloudflare/' + short]) {
        for (const gateway of [undefined, { id: 'existing' }]) {
            const provider = rest(() => { calls++; throw new Error('Unexpected REST dispatch.'); }, { model, gateway });
            await assert.rejects(provider.createDecision({ ...native, options: { rejectIfBusy: true } }),
                { code: 'UNSUPPORTED_CAPABILITY' });
            const configured = rest(() => { calls++; throw new Error('Unexpected REST dispatch.'); },
                { model, gateway, rejectIfBusy: true });
            const bridge = createBridge({ provider: configured });
            assert.throws(() => bridge.validate(native), { code: 'UNSUPPORTED_CAPABILITY' });
            await assert.rejects(bridge.evaluate(native), { code: 'UNSUPPORTED_CAPABILITY' });
            await assert.rejects(configured.createDecision(native), { code: 'UNSUPPORTED_CAPABILITY' });
        }
    }
    assert.equal(calls, 0);
});

test('binding keeps capacity rejection in the third argument when defaults or overrides disable it', async () => {
    const calls = [];
    const ai = { async run(_model, input, options) {
        calls.push({ input, options });
        return json(cloudflareResponse(input));
    } };
    await new CloudflareDecisionsProvider({ transport: 'binding', ai }).createDecision(native);
    const configured = new CloudflareDecisionsProvider({ transport: 'binding', ai, rejectIfBusy: true });
    await configured.createDecision(native);
    await configured.createDecision({ ...native, options: { rejectIfBusy: false } });
    assert.deepEqual(calls.map(call => call.options.rejectIfBusy), [false, true, false]);
    assert(calls.every(call => call.options.returnRawResponse === true && !Object.hasOwn(call.input, 'options')));
});

for (const [status, upstreamCode, code] of [
    [429, 3040, 'CAPACITY_EXCEEDED'], [429, 3036, 'ALLOCATION_EXCEEDED'], [429, 9999, 'RATE_LIMITED'],
    [408, 3007, 'UPSTREAM_TIMEOUT'], [408, 3008, 'UPSTREAM_ABORTED'],
    [401, 10000, 'AUTHENTICATION_ERROR'], [403, 5018, 'PERMISSION_DENIED'], [413, 3006, 'REQUEST_TOO_LARGE'],
    [422, 5012, 'HTTP_ERROR'],
]) test('safe Cloudflare error mapping: ' + upstreamCode, async () => {
    let calls = 0;
    const provider = rest(async () => {
        calls++;
        return json({ success: false, errors: [{ code: upstreamCode, message: 'fixture-secret private prompt' }] }, status,
            { 'cf-ai-req-id': 'fixture-secret-request' });
    });
    await assert.rejects(provider.createDecision(native), error => {
        const safe = publicError(error);
        assert.equal(safe.code, code); assert.equal(safe.upstreamCode, upstreamCode); assert.equal(safe.status, status);
        assert.equal(safe.attempts, 1); assert.equal(safe.requestId, '[REDACTED]-request');
        assert(!JSON.stringify(safe).includes('fixture-secret')); assert(!JSON.stringify(safe).includes('private prompt'));
        return true;
    });
    assert.equal(calls, 1);
});

test('binding internalCode errors use the same safe mapping as REST envelopes', async () => {
    const provider = new CloudflareDecisionsProvider({ transport: 'binding', ai: { async run() {
        return json({ internalCode: 3040, description: 'private body' }, 429, { 'cf-ai-req-id': 'binding-id' });
    } }, rejectIfBusy: true });
    await assert.rejects(provider.createDecision(native), { code: 'CAPACITY_EXCEEDED', upstreamCode: 3040, requestId: 'binding-id' });
});

test('REST rejects unsuccessful or malformed envelopes without exposing diagnostics', async () => {
    for (const [data, code] of [
        [{ success: false, errors: [{ code: 3040, message: 'private' }] }, 'CAPACITY_EXCEEDED'],
        [cloudflareResponse(native), 'INVALID_RESPONSE'],
        [{ ...envelope(cloudflareResponse(native)), errors: [{ code: 5004 }] }, 'INVALID_RESPONSE'],
    ]) await assert.rejects(rest(async () => json(data)).createDecision(native), { code });
});

test('explicit retries honor the deadline and zero remains the default', async () => {
    let calls = 0;
    const provider = rest(async (_url, init) => ++calls === 1 ? json({ errors: [{ code: 3040 }] }, 429, { 'retry-after': '0' }) :
        json(envelope(cloudflareResponse(JSON.parse(init.body)))), { maxRetries: 1 });
    const result = await provider.createDecision(native);
    assert.equal(result.meta.attempts, 2);
    await assert.rejects(rest(async () => json({ errors: [{ code: 3040 }] }, 429, { 'retry-after': '60' }),
        { timeoutMs: 100, maxRetries: 1 }).createDecision(native), { code: 'RETRY_BUDGET_EXCEEDED', upstreamCode: 3040 });
});

test('Gateway configuration is snapshotted and mapped to documented REST headers', async () => {
    let headers;
    const gateway = { id: 'existing', cacheKey: 'fixture-cache', skipCache: true, cacheTtl: 60, collectLog: false,
        requestTimeoutMs: 5000, retries: { maxAttempts: 1, retryDelayMs: 0, backoff: 'constant' }, metadata: { label: 'é' } };
    const provider = rest(async (_url, init) => {
        headers = init.headers;
        assert.equal(Object.hasOwn(JSON.parse(init.body), 'options'), false);
        return json(envelope(cloudflareResponse(JSON.parse(init.body))));
    }, { gateway });
    gateway.id = 'changed';
    await provider.createDecision(native);
    assert.equal(headers['cf-aig-gateway-id'], 'existing');
    assert.equal(headers['cf-aig-cache-key'], 'fixture-cache');
    assert.equal(headers['cf-aig-skip-cache'], 'true');
    assert.equal(headers['cf-aig-cache-ttl'], '60');
    assert.equal(headers['cf-aig-collect-log'], 'false');
    assert.equal(headers['cf-aig-request-timeout'], '5000');
    assert.equal(headers['cf-aig-max-attempts'], '1');
    assert.equal(headers['cf-aig-retry-delay'], '0');
    assert.equal(headers['cf-aig-backoff'], 'constant');
    assert.deepEqual(JSON.parse(headers['cf-aig-metadata']), { label: 'é' });
    assert(!/[^\x00-\x7f]/.test(headers['cf-aig-metadata']));
});

test('Gateway name, TTL and metadata boundaries are preserved in both transports', async () => {
    const metadata = { label: 'é', count: 0, enabled: false, nullable: null, last: 'preserved' };
    for (const cacheTtl of [60, 2592000]) {
        const gateway = { id: 'g'.repeat(64), cacheTtl, requestTimeoutMs: 1, metadata };
        await rest(async (_url, init) => {
            assert.equal(init.headers['cf-aig-gateway-id'], gateway.id);
            assert.equal(init.headers['cf-aig-cache-ttl'], String(cacheTtl));
            assert.equal(init.headers['cf-aig-request-timeout'], '1');
            assert.deepEqual(JSON.parse(init.headers['cf-aig-metadata']), metadata);
            return json(envelope(cloudflareResponse(JSON.parse(init.body))));
        }, { gateway }).createDecision(native);
        await new CloudflareDecisionsProvider({ transport: 'binding', gateway, ai: { async run(_model, input, options) {
            assert.equal(options.gateway.id, gateway.id);
            assert.equal(options.gateway.cacheTtl, cacheTtl);
            assert.equal(options.gateway.requestTimeoutMs, 1);
            assert.deepEqual(options.gateway.metadata, metadata);
            return json(cloudflareResponse(input));
        } } }).createDecision(native);
    }
});

test('REST and binding reads enforce declared, streamed and invalid UTF-8 response boundaries', async () => {
    for (const response of [
        () => new Response('{}', { headers: { 'content-length': '101' } }),
        () => new Response(' '.repeat(101)),
        () => new Response(new Uint8Array([255])),
    ]) for (const transport of ['rest', 'binding']) {
        const provider = transport === 'rest' ? rest(async () => response(), { maxResponseBytes: 100 }) :
            new CloudflareDecisionsProvider({ transport, ai: { async run() { return response(); } }, maxResponseBytes: 100 });
        await assert.rejects(provider.createDecision(native), error =>
            ['RESPONSE_TOO_LARGE', 'INVALID_RESPONSE'].includes(error.code));
    }
});

test('binding noncooperation, stalled response bodies and caller cancellation are bounded', async () => {
    for (const run of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
        const provider = new CloudflareDecisionsProvider({ transport: 'binding', ai: { run }, timeoutMs: 20 });
        await assert.rejects(provider.createDecision(native), { code: 'TIMEOUT' });
    }
    let calls = 0;
    const controller = new AbortController(); controller.abort();
    const provider = new CloudflareDecisionsProvider({ transport: 'binding', ai: { async run() { calls++; return json({}); } } });
    await assert.rejects(provider.createDecision(native, { signal: controller.signal }), { code: 'ABORTED' });
    assert.equal(calls, 0);
    const active = new AbortController();
    const pending = new CloudflareDecisionsProvider({ transport: 'binding', ai: { run() { return new Promise(() => {}); } } })
        .createDecision(native, { signal: active.signal });
    active.abort();
    await assert.rejects(pending, { code: 'ABORTED' });
});

test('response metadata cannot relax validation and asynchronous policy hooks are invalid', async () => {
    const probabilities = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [String(i), 0.0039]));
    const questions = { q: { type: 'choice', instructions: 'Pick.', criteria: Object.fromEntries(Object.keys(probabilities).map(key => [key, null])) } };
    let calls = 0;
    const backend = { kind: 'decision', name: 'custom', defaultModel: 'fixture', async evaluate() { calls++; return {
        model: 'fixture', answers: { q: { type: 'choice', choice: '0', probabilities } },
        usage: { input_tokens: null, output_tokens: null }, meta: { probabilityDecimalPlaces: 4 },
    }; } };
    await assert.rejects(createBridge({ provider: backend }).evaluate({ state: '', questions }), { code: 'INVALID_RESPONSE' });
    calls = 0;
    await assert.rejects(createBridge({ provider: { ...backend, getResultValidationOptions: async () => ({ probabilityDecimalPlaces: 4 }) } })
        .evaluate({ state: '', questions }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(calls, 0);
});

test('standalone provider preserves safe timeout diagnostics after a response id is available', async () => {
    const provider = rest(async () => new Response(new ReadableStream({ start() {} }), {
        headers: { 'cf-ai-req-id': 'fixture-timeout-id' },
    }), { timeoutMs: 25 });
    await assert.rejects(provider.createDecision(native), { code: 'TIMEOUT', requestId: 'fixture-timeout-id', attempts: 1 });
});

test('a provider policy rejecting asynchronously is observed without issuing inference', async () => {
    let calls = 0;
    const provider = { kind: 'decision', name: 'fixture', defaultModel: 'fixture', getResultValidationOptions() {
        return Promise.reject(new Error('private policy error'));
    }, async evaluate() { calls++; } };
    await assert.rejects(createBridge({ provider }).evaluate(native), { code: 'CONFIGURATION_ERROR' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0);
});

test('documented request-size and permission codes retain classification in HTTP 200 error envelopes', async () => {
    for (const [upstreamCode, code] of [[3006, 'REQUEST_TOO_LARGE'],
        ...[5018, 5016, 3023, 3041, 5035].map(value => [value, 'PERMISSION_DENIED'])]) {
        await assert.rejects(rest(async () => json({ success: false,
            errors: [{ code: upstreamCode, message: 'fixture-secret private prompt' }] })).createDecision(native), error => {
            const safe = publicError(error);
            assert.equal(safe.code, code);
            assert.equal(safe.upstreamCode, upstreamCode);
            assert.equal(safe.status, 200);
            assert(!JSON.stringify(safe).includes('fixture-secret'));
            assert(!JSON.stringify(safe).includes('private prompt'));
            return true;
        });
    }
});

test('safe Gateway log IDs survive upstream, parse, validation, size and timeout failures on both transports', async () => {
    const headers = { 'cf-ai-req-id': 'observed-request', 'cf-aig-log-id': 'fixture-secret-gateway' };
    const cases = [
        ['CAPACITY_EXCEEDED', () => json({ internalCode: 3040, errors: [{ code: 3040 }] }, 429, headers)],
        ['INVALID_RESPONSE', () => new Response('{', { headers })],
        ['INVALID_RESPONSE', () => json({}, 200, headers)],
        ['RESPONSE_TOO_LARGE', () => new Response('{}', { headers: { ...headers, 'content-length': '1025' } })],
        ['TIMEOUT', () => new Response(new ReadableStream({ start() {} }), { headers })],
    ];
    for (const transport of ['rest', 'binding']) {
        for (const [code, response] of cases) {
            // Only the stalled-body case needs a short deadline; decoding errors
            // must not race CPU scheduling when the full suite runs concurrently.
            const options = { timeoutMs: code === 'TIMEOUT' ? 40 : 30000, maxResponseBytes: 1024 };
            const provider = transport === 'rest' ? rest(async () => response(), options) :
                new CloudflareDecisionsProvider({ transport, ai: { run: async () => response() }, ...options });
            await assert.rejects(provider.createDecision(native), error => {
                const safe = publicError(error);
                assert.equal(safe.code, code);
                assert.equal(safe.attempts, 1);
                assert.equal(safe.requestId, 'observed-request');
                assert.equal(safe.gatewayLogId, transport === 'rest' ? '[REDACTED]-gateway' : 'fixture-secret-gateway');
                if (transport === 'rest') assert(!JSON.stringify(safe).includes('fixture-secret'));
                return true;
            });
        }
    }
});

test('concurrent binding failures retain their own response log IDs', async () => {
    const provider = new CloudflareDecisionsProvider({ transport: 'binding', ai: {
        lastRequestId: 'shared-request', aiGatewayLogId: 'shared-log',
        async run(_model, input) {
            await new Promise(resolve => setTimeout(resolve, input.state === 'slow' ? 10 : 1));
            return json({ internalCode: 3040 }, 429, {
                'cf-ai-req-id': input.state + '-request', 'cf-aig-log-id': input.state + '-log',
            });
        },
    } });
    const results = await Promise.allSettled(['slow', 'fast'].map(state => provider.createDecision({ ...native, state })));
    assert.deepEqual(results.map(result => publicError(result.reason).gatewayLogId), ['slow-log', 'fast-log']);
    assert.deepEqual(results.map(result => publicError(result.reason).requestId), ['slow-request', 'fast-request']);
});

test('bounded readers reject non-byte chunks and use actual byte lengths before copying', async () => {
    let reads = 0;
    const cases = [
        ['INVALID_RESPONSE', () => ({ byteLength: 1, length: 11, get 0() { reads++; return 123; } })],
        ['INVALID_RESPONSE', () => new DataView(new ArrayBuffer(1))],
        ['RESPONSE_TOO_LARGE', () => {
            const value = new Uint8Array(11);
            Object.defineProperty(value, 'byteLength', { get() { reads++; return 1; } });
            return value;
        }],
    ];
    for (const transport of ['rest', 'binding']) {
        for (const [code, chunk] of cases) {
            const response = () => new Response(new ReadableStream({ start(controller) {
                controller.enqueue(chunk()); controller.close();
            } }), { headers: { 'cf-ai-req-id': 'byte-request', 'cf-aig-log-id': 'byte-log' } });
            const provider = transport === 'rest' ? rest(async () => response(), { maxResponseBytes: 10 }) :
                new CloudflareDecisionsProvider({ transport, ai: { run: async () => response() }, maxResponseBytes: 10 });
            await assert.rejects(provider.createDecision(native), {
                code, attempts: 1, requestId: 'byte-request', gatewayLogId: 'byte-log',
            });
        }
    }
    assert.equal(reads, 0);
});

test('bounded readers accept Buffer and foreign Uint8Array chunks without reading shadowed getters', async () => {
    let reads = 0;
    for (const transport of ['rest', 'binding']) {
        const decision = cloudflareResponse({ ...native, model: 'clef' });
        const encoded = Buffer.from(JSON.stringify(transport === 'rest' ? envelope(decision) : decision));
        for (const chunk of [encoded, runInNewContext('new Uint8Array(' + JSON.stringify([...encoded]) + ')')]) {
            Object.defineProperty(chunk, 'byteLength', { get() { reads++; throw new Error('private length accessor'); } });
            Object.defineProperty(chunk, Symbol.toStringTag, { get() { reads++; throw new Error('private tag accessor'); } });
            const response = () => new Response(new ReadableStream({ start(controller) {
                controller.enqueue(chunk); controller.close();
            } }));
            const provider = transport === 'rest' ? rest(async () => response(), { maxResponseBytes: encoded.length }) :
                new CloudflareDecisionsProvider({ transport, ai: { run: async () => response() }, maxResponseBytes: encoded.length });
            assert.equal((await provider.createDecision(native)).decision.answers.q.noul, 0.7);
        }
    }
    assert.equal(reads, 0);
});
