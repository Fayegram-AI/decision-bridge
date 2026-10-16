import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createBridge, createProvider, JevProvider, OpenAIDecisionsProvider, CloudflareDecisionsProvider,
    box, noul, validateResult } from '../src/index.mjs';
import { OpenAICompatibleProvider } from '../src/custom/generative/index.mjs';
import { copy, jsonResponse } from './fixtures.mjs';
import { image, asset, native, png, jevResponse } from './jev-fixtures.mjs';

const common = { input: [{ type: 'text', text: 'Before' }, { type: 'image', dataUrl: image },
    { type: 'text', text: 'After' }], questions: { present: noul('Is a target visible?'), target: box('The target in the image') } };
const options = { apiKey: 'fixture-key', model: 'jev-1.14.0', dangerZone: { images: true, longContext: true } };
const providerFor = (extra = {}) => new JevProvider({ ...options, fetchImpl: async (_, init) =>
    jsonResponse(jevResponse(JSON.parse(init.body)), 200, { 'x-request-id': 'jev-test' }), ...extra });

test('Jev common images preserve order, flags, box values and unknown usage', async () => {
    let wire;
    const bridge = createBridge({ provider: providerFor({ fetchImpl: async (url, init) => {
        assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
        assert.equal(init.headers.authorization, 'Bearer fixture-key');
        assert.equal(init.headers['TypeSafe-Danger-Zone-Images'], 'true');
        assert.equal(init.headers['TypeSafe-Danger-Zone-Long-Context'], 'true');
        wire = JSON.parse(init.body);
        assert.deepEqual(wire.state, ['Before', '__decision_bridge_image_1__', 'After']);
        assert.deepEqual(wire.assets[wire.state[1]], asset);
        return jsonResponse(jevResponse(wire));
    } }) });
    const result = await bridge.evaluate(common);
    assert.equal(result.answers.target.box.left, 0.2);
    assert.equal(result.answers.present.noul, 0.8);
    assert.equal(result.usage.input_tokens, null);
    assert.equal(result.meta.schemaVersion, 4);
    assert.equal(result.meta.requestedModel, 'jev-1.14.0');
    assert(Object.isFrozen(result.answers.target.box));
    assert.equal(Object.hasOwn(common, 'assets'), false);
});

test('Jev native assets support nested instructions and criteria without rewriting references', async () => {
    const request = { ...native, questions: { present: noul({ question: 'Is this visible?', reference: 'test-photo-reference' },
        { true: ['test-photo-reference'] }), target: box('The target in photo') } };
    const original = copy(request);
    const provider = providerFor({ fetchImpl: async (_, init) => {
        assert.deepEqual(JSON.parse(init.body), request);
        return jsonResponse(jevResponse(request));
    } });
    const result = await provider.createDecision(request);
    assert.equal(result.decision.answers.target.confidence, 0.7);
    assert.equal(result.meta.requestedModel, request.model);
    assert.deepEqual(request, original);
    assert(Object.isFrozen(result.decision));
});

test('Jev text defaults preserve the existing protocol without experimental headers', async () => {
    const provider = createProvider({ type: 'jev', apiKey: 'fixture-key', fetchImpl: async (_, init) => {
        assert.equal(init.headers['TypeSafe-Danger-Zone-Images'], undefined);
        assert.equal(init.headers['TypeSafe-Danger-Zone-Long-Context'], undefined);
        const request = JSON.parse(init.body);
        assert.equal(request.model, 'jev-latest');
        assert(request.state === 'Text' || JSON.stringify(request.state) === '["Text"]');
        return jsonResponse(jevResponse(request));
    } });
    await createBridge({ provider }).evaluate({ state: 'Text', questions: { q: noul('True?') } });
    const result = await provider.evaluate({ input: [{ type: 'text', text: 'Text' }], questions: { q: noul('True?') } });
    assert.equal(result.model, 'jev-1.14.0');
});

test('Jev capabilities require opt-in and distinguish known box-capable selectors', () => {
    assert.equal(new JevProvider({ apiKey: 'fixture' }).getCapabilities().images, false);
    const provider = providerFor();
    for (const model of ['jev-preview', 'jev-1.14.0', 'jev-1.15.0', 'jev-2.0.0']) {
        assert.equal(provider.getCapabilities(model).boxes, true);
    }
    for (const model of ['jev-latest', 'jev-1.13.0', 'jev-test']) assert.equal(provider.getCapabilities(model).boxes, false);
    assert.equal(provider.getCapabilities('jev-1.13.0').images, true);
});

test('experimental flags are validated and snapshotted at construction', () => {
    const dangerZone = { images: true };
    const provider = providerFor({ dangerZone }); dangerZone.images = false;
    assert.equal(provider.getCapabilities().images, true);
    for (const dangerZone of [null, [], { images: 1 }, { longContext: 'true' }, { typo: true }]) {
        assert.throws(() => providerFor({ dangerZone }), { code: 'CONFIGURATION_ERROR' });
    }
    assert.throws(() => providerFor({ maxRequestBytes: 33554433 }), { code: 'CONFIGURATION_ERROR' });
});

test('image and box preflight rejects unsupported use without dispatch', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('Unexpected dispatch'); };
    for (const [request, extra, code] of [
        [common, { dangerZone: {} }, 'UNSUPPORTED_CAPABILITY'],
        [common, { model: 'jev-1.13.0' }, 'UNSUPPORTED_CAPABILITY'],
        [{ state: 'Text', questions: { q: box('Target') } }, {}, 'VALIDATION_ERROR'],
        [{ ...common, input: [{ type: 'audio', dataUrl: 'data:audio/wav;base64,AAAA' }] }, {}, 'UNSUPPORTED_CAPABILITY'],
        [{ ...common, input: [{ type: 'image', dataUrl: image, detail: 'low' }] }, {}, 'UNSUPPORTED_CAPABILITY'],
        [{ ...common, input: [{ type: 'image', dataUrl: 'data:image/webp;base64,AAAA' }] }, {}, 'VALIDATION_ERROR'],
    ]) {
        const provider = providerFor({ ...extra, fetchImpl });
        assert.throws(() => createBridge({ provider }).validate(request), { code });
        await assert.rejects(provider.evaluate(request), { code });
    }
    assert.equal(calls, 0);
});

test('native assets enforce reference, JSON, size, image and box boundaries offline', async () => {
    const cases = [
        request => { request.assets = null; },
        request => { request.assets['test-photo-reference'].part = 'file'; },
        request => { request.assets['test-photo-reference'].format = 'webp'; },
        request => { request.assets['test-photo-reference'].data_base64 = 'bad'; },
        request => { request.assets['test-photo-reference'].data_base64 = Buffer.from('invalid').toString('base64'); },
        request => { request.assets['test-photo-reference'].data_base64 = png(256, 256).toString('base64'); },
        request => { request.assets['test-photo-reference'].data_base64 = png(280, 280, true).toString('base64'); },
        request => { request.state = 'Unreferenced'; },
        request => { request.state = { 'test-photo-reference': 'Keys are not references' }; },
        request => { request.assets['x'.repeat(1025)] = asset; },
        request => { request.questions.target.criteria = {}; },
        request => {
            let nested = 'test-photo-reference';
            for (let i = 0; i < 65; i++) nested = { nested };
            request.state = nested;
        },
    ];
    let calls = 0;
    const provider = providerFor({ fetchImpl: async () => { calls++; throw new Error('Unexpected dispatch'); } });
    for (const mutate of cases) {
        const request = copy(native); mutate(request);
        await assert.rejects(provider.createDecision(request), { code: 'VALIDATION_ERROR' });
    }
    await assert.rejects(providerFor({ maxRequestBytes: 100 }).createDecision(native), { code: 'REQUEST_TOO_LARGE' });
    assert.equal(calls, 0);
});

test('native reference validation follows whole-value and ordered non-overlapping substitution', async () => {
    let calls = 0;
    const provider = providerFor({ fetchImpl: async (_, init) => {
        calls++;
        return jsonResponse(jevResponse(JSON.parse(init.body)));
    } });
    const short = 'reference-photo';
    const long = 'reference-photo-long';
    const questions = { q: noul('Are the images black?') };
    const assets = { [short]: asset, [long]: asset };
    for (const state of [long, 'Compare ' + long + ' with ' + short + '.']) {
        await assert.rejects(provider.createDecision({ state, assets, questions }), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(calls, 0);
    // Whole values bypass substring matching. Within sentences, references at
    // the same position use asset-map order, matching the current native API.
    for (const request of [
        { state: [short, long], assets },
        { state: 'Compare ' + long + ' with ' + short + '.', assets: { [long]: asset, [short]: asset } },
        { state: long, assets, questions: { q: noul({ image: short, question: 'Compare the pictures.' }) } },
        { state: long, assets, questions: { q: noul('Compare the pictures.', { true: [short] }) } },
        { state: 'Literal a.* and [image] and back\\slash.', assets: { 'a.*': asset, '[image]': asset, 'back\\slash': asset } },
    ]) {
        assert.equal((await provider.createDecision({ questions, ...request })).decision.answers.q.noul, 0.8);
    }
    assert.equal(calls, 5);
    // A later-starting reference cannot reuse characters consumed by an earlier match.
    await assert.rejects(provider.createDecision({ state: 'abc', assets: { ab: asset, bc: asset }, questions }),
        { code: 'VALIDATION_ERROR' });
    assert.equal(calls, 5);
});

test('box results enforce exact coordinates, positive area and native confidence', async () => {
    for (const mutate of [
        result => { result.answers.target.box.left = -0.1; },
        result => { result.answers.target.box.top = result.answers.target.box.bottom; },
        result => { result.answers.target.box.extra = 1; },
        result => { delete result.answers.target.box.right; },
        result => { result.answers.target.box = null; },
        result => { result.answers.target.box.left = '0.2'; },
        result => { delete result.answers.target.confidence; },
        result => { result.answers.target.confidence = 1.1; },
        result => { result.usage.input_tokens = -1; },
    ]) {
        const result = jevResponse(native); mutate(result);
        const provider = providerFor({ fetchImpl: async () => jsonResponse(result, 200, { 'x-request-id': 'bad-box' }) });
        await assert.rejects(createBridge({ provider }).evaluate(common), error =>
            error.code === 'INVALID_RESPONSE' && error.requestId === 'bad-box' && error.attempts === 1);
    }
    assert.throws(() => validateResult(jevResponse(native), native.questions, { native: true }), { code: 'INVALID_RESPONSE' });
});

test('box is rejected by other providers and legacy custom profiles before inference', async () => {
    for (const provider of [new OpenAIDecisionsProvider({ apiKey: 'fixture' }),
        new CloudflareDecisionsProvider({ apiKey: 'fixture', accountId: 'account' }),
        new OpenAICompatibleProvider({ apiKey: 'fixture', model: 'fixture' }),
        { kind: 'decision', name: 'legacy', defaultModel: 'fixture', evaluate() { throw new Error('Unexpected dispatch'); } }]) {
        const bridge = createBridge({ provider });
        assert.throws(() => bridge.validate({ state: 'Text', questions: { q: box('Target') } }), { code: 'UNSUPPORTED_CAPABILITY' });
    }
});

test('common reference generation avoids collisions with user content', async () => {
    const provider = providerFor({ fetchImpl: async (_, init) => {
        const request = JSON.parse(init.body);
        assert.equal(request.state[0], '__decision_bridge_image_1__');
        assert.equal(request.state[1], '__decision_bridge_image_2__');
        assert.equal(request.state[2], '__decision_bridge_image_3__');
        assert.equal(Object.keys(request.assets).length, 2);
        return jsonResponse(jevResponse(request));
    } });
    await provider.evaluate({ ...common, input: [{ type: 'text', text: '__decision_bridge_image_1__' },
        { type: 'image', dataUrl: image }, { type: 'image', dataUrl: image }] });
});

test('common reference generation reserves overlapping tokens in text and questions', async () => {
    const overlap = '__decision_bridge_image_1__decision_bridge_image_2__';
    let wire;
    const provider = providerFor({ fetchImpl: async (_, init) => {
        wire = JSON.parse(init.body);
        return jsonResponse(jevResponse(wire));
    } });
    await createBridge({ provider }).evaluate({ input: [{ type: 'text', text: overlap },
        { type: 'text', text: 'Context' }, { type: 'image', dataUrl: image }], questions: {
            present: noul('__decision_bridge_image_3__decision_bridge_image_4__'),
        } });
    assert.equal(wire.state[0], overlap);
    const reference = wire.state[2];
    assert.equal(overlap.includes(reference), false);
    assert.equal(wire.questions.present.instructions.includes(reference), false);
    assert.deepEqual(Object.keys(wire.assets), [reference]);
});

test('SDK and CLI experimental opt-ins ignore inherited values and getters', () => {
    // Prototype changes stay in a child process so they cannot affect the test runner.
    const entry = new URL('../src/index.mjs', import.meta.url).href;
    const code = `import assert from 'node:assert/strict';
import { JevProvider, createBridge } from ${JSON.stringify(entry)};
import { runCli } from ${JSON.stringify(new URL('../src/cli/main.mjs', import.meta.url).href)};
import { loadConfig } from ${JSON.stringify(new URL('../src/cli/config.mjs', import.meta.url).href)};
import { streams } from ${JSON.stringify(new URL('./support.mjs', import.meta.url).href)};
let reads = 0, calls = 0;
const fetchImpl = async (_, init) => {
    calls++;
    assert.equal(init.headers['TypeSafe-Danger-Zone-Images'], undefined);
    assert.equal(init.headers['TypeSafe-Danger-Zone-Long-Context'], undefined);
    return Response.json({ model: 'jev-1.14.0', answers: { q: { type: 'noul', noul: 0.8 } },
        usage: { input_tokens: 1, output_tokens: 0 } });
};
try {
    for (const field of ['dangerZone', 'images', 'longContext']) {
        Object.defineProperty(Object.prototype, field, { configurable: true, get() {
            reads++; return field === 'dangerZone' ? { images: true, longContext: true } : true;
        } });
    }
    for (const extra of [{}, { dangerZone: {} }, { dangerZone: { images: false } }]) {
        const provider = new JevProvider({ apiKey: 'fixture', model: 'jev-1.14.0', fetchImpl, ...extra });
        assert.equal(provider.getCapabilities().images, false);
        assert.equal(provider.getCapabilities().boxes, false);
        await createBridge({ provider }).evaluate({ state: 'Text', questions: { q: { type: 'noul', instructions: 'True?' } } });
    }
    for (const flags of [[], ['--jev-images'], ['--jev-long-context'], ['--no-jev-images', '--no-jev-long-context']]) {
        const io = streams();
        io.stdin.end(JSON.stringify({ state: 'Text', questions: { q: { type: 'noul', instructions: 'True?' } } }));
        const code = await runCli(['validate', '-', ...flags], { ...io, env: {} });
        assert.equal(code, 0, io.error());
    }
    const configured = await loadConfig({ env: { DECISION_JEV_IMAGES: 'true' } });
    assert.deepEqual(configured.config.dangerZone, { images: true, longContext: false });
    assert.equal(reads, 0);
    assert.equal(calls, 3);
} finally {
    for (const field of ['dangerZone', 'images', 'longContext']) delete Object.prototype[field];
}
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
});
