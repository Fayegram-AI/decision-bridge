import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareExtractionProvider, OpenRouterExtractionProvider, validateExtractionRequest, extractBatch } from '../src/extraction/index.mjs';
import { image } from './decisions-fixtures.mjs';
import { envelope, json, pdf, pdfDataUrl } from './cloudflare-fixtures.mjs';

const fields = { text: { type: 'text' }, number: { type: 'number', integer: true }, date: { type: 'date' },
    time: { type: 'time' }, datetime: { type: 'datetime' }, duration: { type: 'duration', unit: 'days' },
    list: { type: 'list', items: 'text' }, estimate: { type: 'estimate', min: 0, max: 100, step: 1 },
    forecast: { type: 'forecast', min: 0, max: 100, horizon: 64, interval: 'day' } };
const request = { state: 'Invoice facts', fields, reference_date: '2026-10-20',
    options: { include_quantiles: true, return_state_text: true } };
function response(input) {
    return { model: input.model ?? 'clairic', answers: Object.fromEntries(Object.entries(input.fields).map(([name, spec]) => [name,
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
    assert.equal(calls[0].input.fields.forecast.horizon, 64);
});

test('both hosted Clairic models apply current field constraints before dispatch', async () => {
    for (const model of ['clairic', 'clairic-flash']) {
        const { provider, calls } = fixture({ model });
        for (const fields of [
            { ['x'.repeat(65)]: { type: 'number' } },
            { value: { type: 'number', decimals: 7 } },
            { value: { type: 'forecast', min: 0, max: 1, horizon: 65 } },
            { value: { type: 'text', unit: 'label' } },
            { value: { type: 'number', null_threshold: 0.2 } },
        ]) await assert.rejects(provider.extract({ state: 'Invoice', fields }), { code: 'VALIDATION_ERROR' });
        assert.equal(calls.length, 0);

        const lists = { ['x'.repeat(64)]: { type: 'list', items: 'number', integer: true, decimals: 6, unit: 'USD' },
            date: { type: 'date', null_threshold: 0.2 } };
        await provider.extract({ state: 'Invoice', fields: lists });
        assert.deepEqual(calls[0].input.fields, lists);
    }
});

test('Flash dispatches PDF-only and mixed requests with the effective model on REST and binding', async () => {
    const input = { documents: [pdfDataUrl], fields: { amount: { type: 'number' }, items: { type: 'list', items: 'text' } } };
    const { provider, calls } = fixture({ model: '@cf/cloudflare/clairic-flash' }, data => ({
        ...data, model: 'reported-build', usage: { ...data.usage, output_tokens: 2 },
        answers: { amount: { ...data.answers.amount, span: null, valid: true },
            items: { ...data.answers.items, value: ['Consulting'], spans: [null] } },
    }));
    assert.equal(provider.defaultModel, 'clairic-flash');
    const flash = await provider.extract(input);
    assert(calls[0].url.endsWith('/ai/run/@cf/cloudflare/clairic-flash'));
    assert.deepEqual(calls[0].input, { ...input, model: 'clairic-flash' });
    assert.equal(flash.meta.requestedModel, 'clairic-flash');
    assert.equal(flash.meta.resolvedModel, 'clairic-flash');
    assert.equal(flash.extraction.model, 'reported-build');
    assert.equal(flash.extraction.usage.output_tokens, 2);
    assert.equal(flash.extraction.answers.amount.span, null);
    assert.equal(flash.extraction.answers.amount.valid, true);
    assert.deepEqual(flash.extraction.answers.items.spans, [null]);
    assert.deepEqual(provider.validateResult(flash, input), flash);
    await provider.extract({ ...input, model: 'clairic' });
    assert(calls[1].url.endsWith('/ai/run/@cf/cloudflare/clairic'));

    const mixed = { ...input, state: 'Invoice', documents: [pdf], images: [image] };
    const binding = new CloudflareExtractionProvider({ transport: 'binding', ai: { async run(model, body) {
        assert.equal(model, '@cf/cloudflare/clairic-flash');
        assert.deepEqual(body, { ...mixed, model: 'clairic-flash' });
        return json(response(body));
    } } });
    assert.equal(binding.defaultModel, 'clairic');
    const result = await binding.extract({ ...mixed, model: '@cf/cloudflare/clairic-flash' });
    assert.equal(result.meta.requestedModel, '@cf/cloudflare/clairic-flash');
    assert.equal(result.meta.resolvedModel, 'clairic-flash');
    assert.throws(() => binding.validate({ ...mixed, model: 'cloudflare/clairic-flash' }), { code: 'UNSUPPORTED_CAPABILITY' });
});

test('PDF preflight rejects invalid evidence and applies attachment and serialized-body ceilings', () => {
    const input = { fields: { amount: { type: 'number' } } };
    for (const documents of [[], [null], pdf, ['https://example.test/file.pdf'],
        [{ ...pdf, content_type: 'text/plain' }], [{ ...pdf, remote: false }],
        [{ ...pdf, base64: 'JVBERi1=' }], ['data:application/pdf;base64,AAAA'],
        [pdf, pdf, pdf, pdf, pdf],
    ]) assert.throws(() => validateExtractionRequest({ ...input, documents }), { code: 'VALIDATION_ERROR' });
    assert.doesNotThrow(() => validateExtractionRequest({ ...input, images: Array(5).fill(image), documents: [] }));
    assert.throws(() => validateExtractionRequest({ ...input, images: Array(4).fill(image), documents: [pdf] }),
        { code: 'VALIDATION_ERROR' });

    const MiB = 1024 * 1024;
    const pdfOfSize = size => {
        const bytes = Buffer.alloc(size);
        bytes.write('%PDF-');
        return { ...pdf, base64: bytes.toString('base64') };
    };
    const options = { maxRequestBytes: 16 * MiB };
    const four = pdfOfSize(4 * MiB);
    const eight = { ...input, documents: [four, four] };
    assert.doesNotThrow(() => validateExtractionRequest(eight, options));
    assert.throws(() => validateExtractionRequest(eight), { code: 'REQUEST_TOO_LARGE' });
    assert.throws(() => validateExtractionRequest({ ...eight, images: [image] }, options),
        { code: 'REQUEST_TOO_LARGE', message: /total at most 8 MiB/ });
    assert.throws(() => validateExtractionRequest({ ...input, documents: [pdfOfSize(4 * MiB + 1)] }, options),
        { code: 'REQUEST_TOO_LARGE', message: /at most 4 MiB each/ });

    const withPdf = { ...input, documents: [pdf] };
    const restBytes = Buffer.byteLength(JSON.stringify({ ...withPdf, model: 'clairic' }));
    assert.doesNotThrow(() => validateExtractionRequest(withPdf, { maxRequestBytes: restBytes }));
    assert.throws(() => validateExtractionRequest(withPdf, { maxRequestBytes: restBytes, transport: 'binding' }),
        { code: 'REQUEST_TOO_LARGE' });
    const state = ' '.repeat(16 * MiB);
    const raised = { maxRequestBytes: 64 * MiB };
    assert.doesNotThrow(() => validateExtractionRequest({ ...input, state }, raised));
    assert.throws(() => validateExtractionRequest({ ...withPdf, state }, raised), { code: 'REQUEST_TOO_LARGE' });
});

test('OpenRouter common extraction requires its native API for PDF assets', async () => {
    const provider = new OpenRouterExtractionProvider({ apiKey: 'fixture', model: 'cloudflare/clairic',
        fetchImpl: () => assert.fail('Unexpected dispatch') });
    const input = { state: 'Invoice', fields: { amount: { type: 'number' } }, documents: [pdf] };
    await assert.rejects(provider.extract(input), { code: 'UNSUPPORTED_CAPABILITY' });
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
        data => { data.answers.text.span = [5, 1]; return data; },
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

test('extraction and saved-result validation use the request snapshot for model metadata', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const provider = new CloudflareExtractionProvider({ apiKey: 'fixture', accountId: 'account', fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); await gate; return json(envelope(response(body)));
    } });
    const input = { ...request, documents: [pdf], model: '@cf/cloudflare/clairic-flash' };
    const pending = provider.extract(input);
    let reads = 0;
    Object.defineProperty(input, 'model', { get() { reads++; throw Error('caller changed after dispatch'); } });
    release();
    const saved = await pending;
    assert.equal(saved.meta.requestedModel, '@cf/cloudflare/clairic-flash');
    assert.equal(reads, 0);
    const protectedInput = new Proxy({ ...request, documents: [pdf], model: '@cf/cloudflare/clairic-flash' }, {
        get(target, key, receiver) {
            if (key === 'model') assert.fail('Read the model from outside the snapshot');
            return Reflect.get(target, key, receiver);
        },
    });
    assert.deepEqual(provider.validateResult(saved, protectedInput), saved);
});

test('extraction batches preserve caller model selectors in ordered diagnostics', async () => {
    const { provider, calls } = fixture();
    const inputs = [{ fields, documents: [pdf], model: '@cf/cloudflare/clairic-flash' }, { ...request, model: 'clairic' }, request];
    const results = await extractBatch(provider, inputs, { concurrency: 2 });
    assert(results.every(row => row.ok));
    assert.deepEqual(results.map(row => row.result.meta.requestedModel), ['@cf/cloudflare/clairic-flash', 'clairic', 'clairic']);
    assert.deepEqual(results.map(row => row.result.meta.resolvedModel), ['clairic-flash', 'clairic', 'clairic']);
    assert.deepEqual(calls.find(call => call.input.model === 'clairic-flash').input.documents, [pdf]);
    assert.equal(inputs[0].model, '@cf/cloudflare/clairic-flash');
    assert(!Object.isFrozen(inputs[0]));
});
