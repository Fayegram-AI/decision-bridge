import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareExtractionProvider, validateExtractionRequest, extractBatch } from '../src/extraction/index.mjs';
import { image } from './decisions-fixtures.mjs';
import { envelope, json } from './cloudflare-fixtures.mjs';

const fields = { text: { type: 'text' }, number: { type: 'number', integer: true }, date: { type: 'date' },
    time: { type: 'time' }, datetime: { type: 'datetime' }, duration: { type: 'duration', unit: 'days' },
    list: { type: 'list', items: 'text' }, estimate: { type: 'estimate', min: 0, max: 100, step: 1 },
    forecast: { type: 'forecast', min: 0, max: 100, horizon: 128, interval: 'day' } };
const request = { state: 'Invoice facts', fields, reference_date: '2026-10-20',
    options: { include_quantiles: true, return_state_text: true } };
function response(input) {
    return { model: 'clairic', answers: Object.fromEntries(Object.entries(input.fields).map(([name, spec]) => [name,
        { type: spec.type, value: spec.type === 'list' ? [] : ['number', 'duration', 'estimate'].includes(spec.type) ? 4
            : spec.type === 'forecast' ? [4, 5] : null, ...(spec.type === 'text' ? { guess: 'INV-1', span: [0, 5], p_null: 1 } : {}),
        ...(spec.type === 'estimate' ? { mean: 4.1, p10: 1, p90: 8, quantiles: [1, 4, 8] } : {}),
        ...(spec.type === 'forecast' ? { steps: [{ value: 4, vendor_extra: true }, { value: 5 }] } : {}) }])),
        truncated: true, state_text: 'Invoice facts', usage: { input_tokens: 655, output_tokens: 0, passes: 3 }, vendor_extra: { preserved: true } };
}
function fixture(options = {}, mutate = value => value) {
    const calls = [];
    const provider = new CloudflareExtractionProvider({ apiKey: 'fixture', accountId: 'account', ...options,
        fetchImpl: async (url, init) => { const input = JSON.parse(init.body); calls.push({ url, input });
            return json(envelope(mutate(response(input))), 200, { 'cf-ai-req-id': 'req', 'cf-aig-log-id': 'log' }); } });
    return { provider, calls };
}

test('Clairic REST preserves all field families, predictive JSON, nulls and diagnostics', async () => {
    const { provider, calls } = fixture();
    const result = await provider.extract({ ...request, model: '@cf/cloudflare/clairic' });
    assert.deepEqual(result.extraction, response(request));
    assert.equal(result.meta.requestedModel, '@cf/cloudflare/clairic');
    assert.equal(result.meta.resolvedModel, 'clairic');
    assert.equal(result.meta.gatewayLogId, 'log');
    assert(Object.isFrozen(result.extraction.answers.forecast.steps[0]));
    assert(!Object.isFrozen(request));
    assert(calls[0].url.endsWith('/ai/run/@cf/cloudflare/clairic'));
    assert.deepEqual(calls[0].input.options, request.options);
    assert.equal(calls[0].input.fields.forecast.horizon, 128);
});

test('binding keeps inference options in inputs and execution/Gateway options separately', async () => {
    let call;
    const provider = new CloudflareExtractionProvider({ transport: 'binding', rejectIfBusy: true,
        gateway: { id: 'gateway' }, ai: { async run(model, input, options) {
            call = { model, input, options }; return json(response(input));
        } } });
    await provider.extract(request);
    assert.deepEqual(call.input.options, request.options);
    assert.equal(call.options.rejectIfBusy, true);
    assert.equal(call.options.returnRawResponse, true);
    assert.equal(call.options.gateway.id, 'gateway');
    assert.equal(call.model, '@cf/cloudflare/clairic');
});

test('extraction preflight is offline, checks structure and client budgets before dispatch', async () => {
    assert.equal(validateExtractionRequest({ images: Array(5).fill(image), fields: { x: { type: 'text' } } }).model, 'clairic');
    const { provider, calls } = fixture({ maxRequestBytes: 100 });
    await assert.rejects(provider.extract(request), { code: 'REQUEST_TOO_LARGE', source: 'client' });
    for (const bad of [
        null,
        { ...request, fields: {} }, { ...request, fields: { x: { type: 'unknown' } } },
        { ...request, fields: { x: { type: 'list' } } }, { ...request, fields: { x: { type: 'estimate', min: 2, max: 1 } } },
        { ...request, options: { include_quantiles: 'yes' } }, { ...request, state: 1 },
        { ...request, options: null },
    ]) assert.throws(() => validateExtractionRequest(bad), { code: 'VALIDATION_ERROR' });
    await assert.rejects(provider.extract(null), { code: 'VALIDATION_ERROR' });
    assert.equal(calls.length, 0);
});

test('malformed required extraction results fail while additional JSON remains preserved', async () => {
    for (const mutate of [data => { delete data.answers.text; return data; }, data => { data.answers.number.value = 'wrong'; return data; },
        data => { data.usage.input_tokens = -1; return data; }]) {
        const { provider } = fixture({}, mutate);
        await assert.rejects(provider.extract(request), { code: 'INVALID_RESPONSE', requestId: 'req' });
    }
});

test('extraction batches preflight every array request and retain order and failures', async () => {
    const { provider, calls } = fixture();
    await assert.rejects(extractBatch(provider, [request, { ...request, fields: {} }]), { code: 'VALIDATION_ERROR' });
    assert.equal(calls.length, 0);
    const results = await extractBatch(provider, [request, request], { concurrency: 2 });
    assert.deepEqual(results.map(row => [row.index, row.ok]), [[0, true], [1, true]]);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(provider.extract(request, { signal: controller.signal }), { code: 'ABORTED' });
    assert.equal(calls.length, 2);
});

test('structured binding allocation errors preserve status and do not retry', async () => {
    let calls = 0;
    const provider = new CloudflareExtractionProvider({ transport: 'binding', maxRetries: 2, ai: { async run() {
        calls++; throw Object.assign(Error('private'), { status: 429, internalCode: 3036 });
    } } });
    await assert.rejects(provider.extract(request), { code: 'ALLOCATION_EXCEEDED', status: 429, upstreamCode: 3036, retryable: false });
    assert.equal(calls, 1);
});

test('extraction selection metadata comes from the request snapshot after dispatch', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const provider = new CloudflareExtractionProvider({ apiKey: 'fixture', accountId: 'account', fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); await gate; return json(envelope(response(body)));
    } });
    const input = { ...request, model: '@cf/cloudflare/clairic' };
    const pending = provider.extract(input);
    let reads = 0;
    Object.defineProperty(input, 'model', { get() { reads++; throw Error('caller changed after dispatch'); } });
    release();
    assert.equal((await pending).meta.requestedModel, '@cf/cloudflare/clairic');
    assert.equal(reads, 0);
});

test('extraction batches preserve caller model selectors in ordered diagnostics', async () => {
    const { provider, calls } = fixture();
    const inputs = [{ ...request, model: '@cf/cloudflare/clairic' }, { ...request, model: 'clairic' }, request];
    const results = await extractBatch(provider, inputs, { concurrency: 2 });
    assert(results.every(row => row.ok));
    assert.deepEqual(results.map(row => row.result.meta.requestedModel), ['@cf/cloudflare/clairic', 'clairic', 'clairic']);
    assert(results.every(row => row.result.meta.resolvedModel === 'clairic'));
    assert(calls.every(call => call.input.model === 'clairic'));
    assert.equal(inputs[0].model, '@cf/cloudflare/clairic');
    assert(!Object.isFrozen(inputs[0]));
});
