import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cleanEnv } from './support.mjs';
import { createBridge, createProvider, choice, noul, score, scoreLevels, evaluateBatch, validateResult, decideChoice } from '../src/index.mjs';
import { fixture, image, native, cloudflareResponse, json } from './cloudflare-fixtures.mjs';
import { media } from './media-fixtures.mjs';

for (const model of ['clef', 'clef-flash', 'clef-omni', '@cf/cloudflare/clef', '@cf/cloudflare/clef-flash', '@cf/cloudflare/clef-omni']) {
    test('Cloudflare model routing and native response: ' + model, async () => {
        const { provider, requests } = fixture({ model });
        const { decision, meta } = await provider.createDecision(native);
        const short = model.replace('@cf/cloudflare/', '');
        assert.equal(requests[0].url, 'https://api.cloudflare.com/client/v4/accounts/fixture-account/ai/run/@cf/cloudflare/' + short);
        assert.equal(requests[0].request.model, short);
        assert.equal(requests[0].init.headers.authorization, 'Bearer fixture-key');
        assert.equal(requests[0].init.redirect, 'error');
        assert.equal(decision.model, short);
        assert.equal(decision.answers.q.noul, 0.7);
        assert.equal(meta.requestId, 'fixture-request-id');
        assert.equal(meta.gatewayLogId, 'fixture-log-id');
        assert(Object.isFrozen(decision.answers));
    });
}

test('mixed common mapping preserves structured state, instructions, rubric and native metadata', async () => {
    const { bridge, requests } = fixture();
    const request = { state: { record: [1, true] }, questions: {
        route: choice({ query: 'Choose.' }, { a: null, b: { note: 'Other' } }),
        yes: noul('True?', { false: ['No'] }), rating: score('Rate.', ['Low', { value: 'High' }]),
    } };
    const result = await bridge.evaluate(request);
    assert.deepEqual(requests[0].request.state, request.state);
    assert.deepEqual(requests[0].request.questions, request.questions);
    assert.deepEqual(result.answers.route.probabilities, { a: 0.8, b: 0.2 });
    assert.equal(result.answers.yes.noul, 0.7);
    assert.deepEqual(result.answers.rating.legend, { 0: 'Low', 1: { value: 'High' } });
    assert.deepEqual(result.usage, { input_tokens: 42, output_tokens: 0 });
    assert.equal(result.meta.schemaVersion, 1);
    assert.equal(result.meta.confidenceSource, 'native');
    assert.equal(result.meta.modelSource, 'reported');
    assert.equal(result.meta.probabilitySource, 'native');
    assert.equal(result.meta.cloudflareDecisions.answers.route.confidence, 0.8);
    assert(!Object.isFrozen(request.state));
});

test('typed choice identity, labelled scores and ordered image-prefix input are lossless', async () => {
    const { bridge, requests } = fixture();
    const levels = [{ label: 'Low' }, { label: 'High', description: { test: true } }];
    const request = { input: [{ type: 'image', dataUrl: image, detail: 'auto' },
        { type: 'text', text: 'First' }, { type: 'text', text: 'Second' }], questions: {
        q: choice('Pick.', [{ value: true }, { value: 'true' }, { value: '' }, { value: false }]),
        rating: scoreLevels('Rate.', levels),
    } };
    const result = await bridge.evaluate(request);
    assert.equal(requests[0].request.state, 'FirstSecond');
    assert.deepEqual(requests[0].request.images, [image]);
    assert.deepEqual(requests[0].request.questions.q.criteria, {
        option_0: { value: true }, option_1: { value: 'true' }, option_2: { value: '' }, option_3: { value: false },
    });
    assert.equal(result.answers.q.choice, true);
    assert.deepEqual(result.answers.q.probabilities.map(item => item.value), [true, 'true', '', false]);
    assert.deepEqual(result.answers.rating.legend, { 0: levels[0], 1: levels[1] });
    assert.equal(result.meta.schemaVersion, 2);
});

test('255 rounded probabilities pass native, map, typed and final bridge validation without renormalization', async () => {
    const { provider, bridge } = fixture();
    const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => ['value_' + i, null]));
    const nativeResult = await provider.createDecision({ state: '', questions: { q: choice('Pick.', criteria) } });
    assert.equal(Object.values(nativeResult.decision.answers.q.probabilities).reduce((sum, p) => sum + p, 0).toFixed(4), '0.9945');
    const map = await bridge.evaluate({ state: '', questions: { q: choice('Pick.', criteria) } });
    assert.equal(map.answers.q.probabilities.value_0, 0.0039);
    const typed = await bridge.evaluate({ state: '', questions: { q: choice('Pick.',
        Array.from({ length: 255 }, (_, i) => ({ value: String(i) }))) } });
    assert.equal(typed.answers.q.probabilities[0].probability, 0.0039);
    assert.throws(() => validateResult(map, { q: choice('Pick.', criteria) }), { code: 'INVALID_RESPONSE' });
    assert.throws(() => validateResult(typed, { q: choice('Pick.',
        Array.from({ length: 255 }, (_, i) => ({ value: String(i) }))) }), { code: 'INVALID_RESPONSE' });
    for (const result of [map, typed]) {
        assert.throws(() => decideChoice(result.answers.q, { minProbability: 0 }), { code: 'INVALID_RESPONSE' });
        const policy = decideChoice(result.answers.q, { minProbability: 0,
            probabilityDecimalPlaces: provider.getResultValidationOptions(result.model).probabilityDecimalPlaces });
        assert.equal(policy.status, 'selected');
        assert.equal(policy.choice, result.answers.q.choice);
        assert.equal(policy.selectedProbability, 0.0039);
    }
});

test('choice policy precision retains distribution and selection checks', () => {
    for (const typed of [false, true]) {
        for (const probability of [0.00391, 0.0038]) {
            const entries = Array.from({ length: 255 }, (_, i) => [String(i), probability]);
            const probabilities = typed ? entries.map(([value, probability]) => ({ value, probability }))
                : Object.fromEntries(entries);
            assert.throws(() => decideChoice({ type: 'choice', choice: '0', probabilities },
                { minProbability: 0, probabilityDecimalPlaces: 4 }), { code: 'INVALID_RESPONSE' });
        }
        const probabilities = typed ? [{ value: 'a', probability: 0.8 }, { value: 'b', probability: 0.2 }]
            : { a: 0.8, b: 0.2 };
        assert.throws(() => decideChoice({ type: 'choice', choice: 'b', probabilities },
            { minProbability: 0, probabilityDecimalPlaces: 4 }), { code: 'INVALID_RESPONSE' });
    }
    const answer = { type: 'choice', choice: 'a', probabilities: { a: 0.8, b: 0.2 } };
    for (const probabilityDecimalPlaces of [null, 0, 1.5, 16, '4']) {
        assert.throws(() => decideChoice(answer, { minProbability: 0, probabilityDecimalPlaces }),
            { code: 'CONFIGURATION_ERROR' });
    }
});

for (const [label, mutate] of [
    ['missing answer', data => { delete data.answers.q; }],
    ['extra answer', data => { data.answers.extra = data.answers.q; }],
    ['invalid noul', data => { data.answers.q.noul = 1.1; }],
    ['missing usage', data => { delete data.usage; }],
    ['negative usage', data => { data.usage.output_tokens = -1; }],
    ['invented cache usage', data => { data.usage.cache_read_input_tokens = 1; }],
]) test('native response rejects ' + label, async () => {
    const { provider } = fixture({ mutate });
    await assert.rejects(provider.createDecision(native), { code: 'INVALID_RESPONSE', requestId: 'fixture-request-id' });
});

for (const [label, mutate] of [
    ['wrong selection', data => { data.answers.q.choice = 'b'; }],
    ['missing confidence', data => { delete data.answers.q.confidence; }],
    ['bad probabilities', data => { data.answers.q.probabilities.a = 0.9; }],
    ['extra option', data => { data.answers.q.probabilities.extra = 0; }],
]) test('choice response rejects ' + label, async () => {
    const { bridge } = fixture({ mutate });
    await assert.rejects(bridge.evaluate({ state: '', questions: { q: choice('Pick.', { a: null, b: null }) } }),
        { code: 'INVALID_RESPONSE' });
});

test('rounding allowance rejects nongrid distributions and errors beyond the rounding budget', async () => {
    const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [String(i), null]));
    for (const value of [0.00391, 0.0038]) {
        const { provider } = fixture({ mutate: data => {
            data.answers.q.probabilities = Object.fromEntries(Object.keys(criteria).map(key => [key, value]));
        } });
        await assert.rejects(provider.createDecision({ state: '', questions: { q: choice('Pick.', criteria) } }),
            { code: 'INVALID_RESPONSE' });
    }
});

test('score legend and weighted score consistency are enforced', async () => {
    for (const mutate of [data => { data.answers.q.legend[0] = 'Wrong'; }, data => { data.answers.q.score = 0.9; }]) {
        const { bridge } = fixture({ mutate });
        await assert.rejects(bridge.evaluate({ state: '', questions: { q: score('Rate.', ['Low', 'High']) } }),
            { code: 'INVALID_RESPONSE' });
    }
});

test('binding dispatch uses raw Response and per-response ids under concurrency', async () => {
    const calls = [];
    const binding = { lastRequestId: 'wrong-shared-id', aiGatewayLogId: 'wrong-shared-log',
        async run(model, input, options) {
            calls.push({ model, input, options });
            await new Promise(resolve => setTimeout(resolve, input.state === 'slow' ? 15 : 1));
            return json(cloudflareResponse(input), 200, { 'cf-ai-req-id': input.state, 'cf-aig-log-id': input.state + '-log' });
        } };
    const provider = createProvider({ type: 'cloudflare-decisions', transport: 'binding', ai: binding, model: 'clef-flash',
        rejectIfBusy: true, gateway: { id: 'existing', metadata: { test: true }, retries: { maxAttempts: 1 } } });
    const bridge = createBridge({ provider });
    const results = await evaluateBatch(bridge, [{ ...native, state: 'slow' }, { ...native, state: 'fast' }]);
    assert.deepEqual(results.map(record => record.result.meta.requestId), ['slow', 'fast']);
    assert.deepEqual(results.map(record => record.result.meta.gatewayLogId), ['slow-log', 'fast-log']);
    assert.equal(calls[0].model, '@cf/cloudflare/clef-flash');
    assert.equal(calls[0].input.model, 'clef-flash');
    assert.equal(calls[0].input.options, undefined);
    assert.equal(calls[0].options.returnRawResponse, true);
    assert.equal(calls[0].options.rejectIfBusy, true);
    assert(calls[0].options.signal instanceof AbortSignal);
    assert.equal(calls[0].options.gateway.id, 'existing');
    await assert.rejects(bridge.listModels(), { code: 'UNSUPPORTED_OPERATION' });
});

test('Cloudflare ambient credentials are limited to the official origin', () => {
    const entry = new URL('../src/index.mjs', import.meta.url).href;
    const code = `import assert from 'node:assert/strict';
const { CloudflareDecisionsProvider } = await import(${JSON.stringify(entry)});
let called = false;
const provider = new CloudflareDecisionsProvider({ fetchImpl: async (url, init) => {
    called = true;
    assert.equal(new URL(url).pathname, '/client/v4/accounts/ambient-account/ai/run/@cf/cloudflare/clef');
    assert.equal(init.headers.authorization, 'Bearer ambient-fixture-key');
    return Response.json({ success: true, result: { model: 'clef',
        answers: { q: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: 1, output_tokens: 0 } } });
} });
await provider.createDecision({ state: '', questions: { q: { type: 'noul', instructions: 'True?' } } });
assert(called);
assert.throws(() => new CloudflareDecisionsProvider({ baseURL: 'https://third-party.example' }),
    { code: 'CONFIGURATION_ERROR' });
assert.throws(() => new CloudflareDecisionsProvider({ baseURL: 'https://third-party.example', accountId: 'explicit' }),
    { code: 'CONFIGURATION_ERROR' });
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        env: cleanEnv({ CLOUDFLARE_ACCOUNT_ID: 'ambient-account', CLOUDFLARE_API_TOKEN: 'ambient-fixture-key' }),
        encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
});

test('Cloudflare SDK imports and evaluates without a Node process global', () => {
    const entry = new URL('../src/index.mjs', import.meta.url).href;
    const code = `import assert from 'node:assert/strict';
delete globalThis.process;
const { createBridge, CloudflareDecisionsProvider, noul } = await import(${JSON.stringify(entry)});
const input = { state: '', questions: { q: noul('True?') } };
const response = { model: 'clef', answers: { q: { type: 'noul', noul: 0.7 } },
    usage: { input_tokens: 1, output_tokens: 0 } };
const rest = new CloudflareDecisionsProvider({ accountId: 'fixture', apiKey: 'fixture', fetchImpl: async () =>
    Response.json({ result: response, success: true }) });
assert.equal((await createBridge({ provider: rest }).evaluate(input)).answers.q.noul, 0.7);
const binding = new CloudflareDecisionsProvider({ transport: 'binding', ai: { async run() { return Response.json(response); } } });
assert.equal((await binding.createDecision(input)).decision.answers.q.noul, 0.7);
const omni = new CloudflareDecisionsProvider({ model: 'clef-omni', accountId: 'fixture', apiKey: 'fixture',
    fetchImpl: async () => Response.json({ result: { ...response, model: 'clef-omni' }, success: true }) });
assert.equal((await createBridge({ provider: omni }).evaluate({ input: [{ type: 'audio', dataUrl: ${JSON.stringify(media.wav)} },
    { type: 'video', dataUrl: ${JSON.stringify(media.webm)} }], questions: input.questions })).meta.schemaVersion, 3);
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: cleanEnv(),
        encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
});
