import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, choice, scoreLevels, evaluateBatch, noul } from '../src/index.mjs';
import { preflightCloudflareDecision, preflightCommonCloudflareDecision } from '../src/providers/cloudflare-preflight.mjs';
import { CLOUDFLARE_REQUEST_LIMIT } from '../src/providers/cloudflare-profile.mjs';
import { fixture, image, native } from './cloudflare-fixtures.mjs';

test('question count, id syntax, choices and score levels enforce hosted boundaries before dispatch', async () => {
    const { bridge, requests } = fixture();
    const tooMany = Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['q' + i, noul('True?')]));
    for (const questions of [
        tooMany, { 'contains space': noul('True?') }, { ['q'.repeat(101)]: noul('True?') },
        { q: choice('Pick.', { only: null }) },
        { q: choice('Pick.', Array.from({ length: 256 }, (_, i) => ({ value: String(i) }))) },
        { q: scoreLevels('Rate.', Array.from({ length: 11 }, (_, i) => ({ label: String(i) }))) },
    ]) {
        assert.throws(() => bridge.validate({ state: '', questions }));
        await assert.rejects(bridge.evaluate({ state: '', questions }));
    }
    await assert.rejects(evaluateBatch(bridge, [native, { state: '', questions: tooMany }]));
    assert.equal(requests.length, 0);
    assert.equal(Object.keys(bridge.validate({ state: '', questions: Object.fromEntries(
        Array.from({ length: 64 }, (_, i) => ['q.' + i, noul('True?')])) }).questions).length, 64);
    bridge.validate({ state: '', questions: { ['q'.repeat(100)]: noul('True?') } });
});

test('unsupported common capabilities and ordered layout are rejected', () => {
    const { bridge } = fixture();
    for (const request of [
        { ...native, model: 'unknown' }, { ...native, safetyIdentifier: null },
        { questions: native.questions, input: [{ type: 'text', text: '' }, { type: 'image', dataUrl: image }] },
        { questions: native.questions, input: [{ type: 'image', dataUrl: image, detail: 'original' }] },
        { questions: native.questions, input: Array.from({ length: 5 }, () => ({ type: 'image', dataUrl: image })) },
    ]) assert.throws(() => bridge.validate(request), { code: 'UNSUPPORTED_CAPABILITY' });
    for (const detail of [null, 'auto']) bridge.validate({
        questions: native.questions, input: [{ type: 'image', dataUrl: image, detail }],
    });
    assert.equal(bridge.getCapabilities().safetyIdentifier, false);
    assert.equal(bridge.getCapabilities('unknown').supported, false);
});

test('native input has a strict dedicated shape and both supported image forms', () => {
    const base64 = image.split(',')[1];
    const input = { ...native, images: [image, { content_type: 'image/png', base64 }] };
    assert.deepEqual(preflightCloudflareDecision(input).images, input.images);
    for (const bad of [
        { ...native, input: 'extra' }, { ...native, state: null }, { ...native, model: null }, { ...native, options: null }, { ...native, images: ['https://example.com/image.png'] },
        { ...native, images: ['data:image/gif;base64,AAAA'] }, { ...native, images: ['data:image/png;base64,AAAA'] },
        { ...native, images: [{ content_type: 'image/png', base64, extra: true }] },
        { ...native, options: { unknown: true } }, { ...native, options: { rejectIfBusy: 'true' } },
        { ...native, questions: { q: choice('Pick.', [{ value: true }, { value: false }]) } },
    ]) assert.throws(() => preflightCloudflareDecision(bad), { code: 'VALIDATION_ERROR' });
});

function png(width, height, size = 33) {
    const bytes = Buffer.alloc(size);
    Buffer.from(image.split(',')[1], 'base64').copy(bytes, 0, 0, 33);
    bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
    return 'data:image/png;base64,' + bytes.toString('base64');
}

test('image header dimensions and decoded byte limits are independent of encoded JSON size', () => {
    preflightCloudflareDecision({ ...native, images: [png(4000, 4000)] });
    assert.throws(() => preflightCloudflareDecision({ ...native, images: [png(4001, 4000)] }), { code: 'VALIDATION_ERROR' });
    assert.throws(() => preflightCloudflareDecision({ ...native, images: [png(0, 1)] }), { code: 'VALIDATION_ERROR' });
    const each = png(1, 1, 4 * 1024 * 1024);
    preflightCloudflareDecision({ ...native, images: [each, each] });
    assert.throws(() => preflightCloudflareDecision({ ...native, images: [png(1, 1, 4 * 1024 * 1024 + 1)] }),
        { code: 'REQUEST_TOO_LARGE' });
    assert.throws(() => preflightCloudflareDecision({ ...native, images: [each, each, image] }),
        { code: 'REQUEST_TOO_LARGE' });
});

test('JPEG and each WebP header family are inspected without a Node image dependency', () => {
    const jpeg = Buffer.from([255,216,255,192,0,11,8,0,2,0,3,1,1,17,0,255,217]);
    preflightCloudflareDecision({ ...native, images: ['data:image/jpeg;base64,' + jpeg.toString('base64')] });
    for (const [kind, data] of [
        ['VP8X', Buffer.alloc(10)], ['VP8L', Buffer.from([47,0,0,0,0])],
        ['VP8 ', Buffer.from([0,0,0,157,1,42,1,0,1,0])],
    ]) {
        const bytes = Buffer.alloc(20 + data.length + data.length % 2);
        bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WEBP', 8);
        bytes.write(kind, 12); bytes.writeUInt32LE(data.length, 16); data.copy(bytes, 20);
        preflightCloudflareDecision({ ...native, images: ['data:image/webp;base64,' + bytes.toString('base64')] });
    }
    assert.throws(() => preflightCloudflareDecision({ ...native,
        images: ['data:image/jpeg;base64,' + jpeg.subarray(0, 7).toString('base64')] }), { code: 'VALIDATION_ERROR' });
});

test('complete serialized request and binding envelope overhead enforce the byte limit', () => {
    const resolved = preflightCloudflareDecision(native);
    const length = Buffer.byteLength(JSON.stringify(resolved));
    preflightCloudflareDecision(native, { maxRequestBytes: length });
    assert.throws(() => preflightCloudflareDecision(native, { maxRequestBytes: length - 1 }), { code: 'REQUEST_TOO_LARGE' });
    assert.throws(() => preflightCloudflareDecision(native, { transport: 'binding', maxRequestBytes: length }),
        { code: 'REQUEST_TOO_LARGE' });
    assert.throws(() => preflightCommonCloudflareDecision({ ...native, state: 'é'.repeat(200) }, { maxRequestBytes: 400 }),
        { code: 'REQUEST_TOO_LARGE' });
    // A larger configured ceiling never raises the older models' 13 MiB wire limit.
    assert.throws(() => preflightCloudflareDecision({ ...native, state: 'x'.repeat(CLOUDFLARE_REQUEST_LIMIT) },
        { maxRequestBytes: CLOUDFLARE_REQUEST_LIMIT + 1 }), { code: 'REQUEST_TOO_LARGE' });
});

test('invalid constructor and Gateway combinations are rejected before any call', async () => {
    for (const options of [
        { transport: 'other' }, { transport: null },
        { gateway: { id: 'existing', retries: null } },
        { gateway: { id: 'existing', retries: { maxAttempts: null } } }, { transport: 'binding', ai: { run() {} }, apiKey: 'key' },
        { rejectIfBusy: true, maxRetries: 1 }, { rejectIfBusy: true, gateway: { id: 'existing', retries: { maxAttempts: 2 } } },
        { gateway: { id: 'bad\nheader' } }, { gateway: { id: 'existing', retries: { retryDelayMs: 60001 } } },
        { gateway: { id: 'existing', metadata: { nested: {} } } }, { accountId: '../escape' },
        { accountId: 'valid', unknown: true },
    ]) assert.throws(() => createProvider({ type: 'cloudflare-decisions', accountId: 'fixture', apiKey: 'key', ...options }),
        { code: 'CONFIGURATION_ERROR' });
    const { provider, requests } = fixture({ maxRetries: 1 });
    await assert.rejects(provider.createDecision({ ...native, options: { rejectIfBusy: true } }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(requests.length, 0);
});

test('Gateway service limits reject invalid configuration before REST or binding dispatch', () => {
    let calls = 0;
    const invalid = [
        { id: 'g'.repeat(65) },
        ...[0, 1, 59, 60.5, 2592001, 2147483647].map(cacheTtl => ({ id: 'existing', cacheTtl })),
        { id: 'existing', metadata: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } },
        { id: 'existing', metadata: { 'cf.user_id': 'caller' } },
        { id: 'existing', metadata: { 'cf.': true } },
    ];
    for (const transport of ['rest', 'binding']) {
        const options = transport === 'rest' ? { accountId: 'fixture', apiKey: 'key', fetchImpl() { calls++; } }
            : { transport, ai: { run() { calls++; } } };
        for (const gateway of invalid) {
            assert.throws(() => createProvider({ type: 'cloudflare-decisions', ...options, gateway }),
                { code: 'CONFIGURATION_ERROR' });
            assert.throws(() => preflightCloudflareDecision(native, { transport, gateway }),
                { code: 'CONFIGURATION_ERROR' });
            assert.throws(() => preflightCommonCloudflareDecision(native, { transport, gateway }),
                { code: 'CONFIGURATION_ERROR' });
        }
    }
    assert.equal(calls, 0);
});

test('explicit null native defaults and preflight transport fail before inference', async () => {
    const { provider, requests } = fixture();
    for (const input of [{ ...native, model: null }, { ...native, options: null }]) {
        await assert.rejects(provider.createDecision(input), { code: 'VALIDATION_ERROR' });
    }
    assert.throws(() => preflightCloudflareDecision(native, { transport: null }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(requests.length, 0);
});
