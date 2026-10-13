import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, createProvider, OpenAIDecisionsProvider, JevProvider, choice, noul, score, scoreLevels, decideChoice, evaluateBatch, publicError, validateRequest } from '../src/index.mjs';
import { OpenAICompatibleProvider, AnthropicProvider, buildResponseSchema } from '../src/custom/generative/index.mjs';
import { image, usage, decisionResponse } from './decisions-fixtures.mjs';
import { jsonResponse } from './fixtures.mjs';

const native = { input: 'Synthetic test evidence.', questions: [{ type: 'predicate', instructions: 'True?' }] };
const common = { state: 'Synthetic test evidence.', questions: { yes: noul('True?') } };
function fixture(mutate = () => {}, options = {}) {
    const requests = [];
    const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture-key', ...options, fetchImpl: async (url, init) => {
        assert.equal(new URL(url).pathname, '/v1/decisions');
        assert.equal(init.headers.authorization, 'Bearer fixture-key');
        assert.equal(init.redirect, 'error');
        const body = JSON.parse(init.body);
        requests.push(body);
        const data = decisionResponse(body);
        mutate(data, body);
        return jsonResponse(data, 200, { 'x-request-id': 'fixture-request-id' });
    } });
    return { provider, requests, bridge: createBridge({ provider }) };
}

test('native common mapping preserves legacy contracts, criteria and usage', async () => {
    const { bridge, requests } = fixture();
    const request = { state: { message: 'sample' }, questions: {
        route: choice({ instruction: 'Route?' }, { a: null, b: { description: 'Other.' } }),
        yes: noul('True?'), rubric: score('Rate?', ['Low', { level: 'High' }]),
        conditional: noul('True?', { false: { reason: 'False case' } }),
    } };
    const result = await bridge.evaluate(request);
    assert.equal(requests[0].input, JSON.stringify(request.state));
    assert.equal(requests[0].questions[0].instructions, '{"instruction":"Route?"}');
    assert.deepEqual(requests[0].questions[0].choices, [{ value: 'a' }, { value: 'b', description: '{"description":"Other."}' }]);
    assert.equal(requests[0].questions[1].type, 'predicate');
    assert.deepEqual(requests[0].questions[3].choices, [{ value: true }, { value: false, description: '{"reason":"False case"}' }]);
    assert.equal(result.answers.conditional.noul, 0.8);
    assert.equal(result.answers.yes.noul, 0.7);
    assert.deepEqual(result.answers.rubric.legend, { 0: 'Low', 1: { level: 'High' } });
    assert.deepEqual(result.answers.route.probabilities, { a: 0.8, b: 0.2 });
    assert.deepEqual(result.usage, { input_tokens: 42, output_tokens: 0, cache_creation_input_tokens: 2, cache_read_input_tokens: 5 });
    assert.deepEqual(result.meta.openaiDecisions.usage, usage);
    assert.deepEqual(result.meta.openaiDecisions.answers.conditional, { type: 'choice', confidence: 0.8 });
    assert.deepEqual(result.meta.openaiDecisions.answers.yes, { type: 'predicate' });
    assert.equal(result.meta.schemaVersion, 1);
    assert.equal(result.meta.requestId, 'fixture-request-id');
    assert.equal(result.meta.probabilitySource, 'native');
});

test('ordered multimodal input, typed values and labelled scores are lossless', async () => {
    const { bridge, requests } = fixture();
    const levels = Array.from({ length: 12 }, (_, i) => ({ label: `Level ${i}`, description: { level: i } }));
    const request = { input: [{ type: 'text', text: 'Before' }, { type: 'image', dataUrl: image, detail: 'original' },
        { type: 'text', text: 'After' }], safetyIdentifier: 'opaque-fixture-id', questions: {
        typed: choice('Choose.', [{ value: true }, { value: 'true' }, { value: false }]),
        rating: scoreLevels('Rate.', levels),
    } };
    const result = await bridge.evaluate(request);
    assert.deepEqual(requests[0].input[0].content, [{ type: 'input_text', text: 'Before' },
        { type: 'input_image', image_url: image, detail: 'original' }, { type: 'input_text', text: 'After' }]);
    assert.equal(requests[0].safety_identifier, 'opaque-fixture-id');
    assert.equal(result.answers.typed.choice, true);
    assert.deepEqual(result.answers.typed.probabilities, [{ value: true, probability: 0.8 },
        { value: 'true', probability: 0.1 }, { value: false, probability: 0.1 }]);
    assert.deepEqual(result.answers.rating.legend[11], levels[11]);
    assert.equal(result.meta.schemaVersion, 2);
    assert.equal(decideChoice(result.answers.typed, { minProbability: 0.7, abstainOptions: ['true'] }).status, 'selected');
    assert.equal(decideChoice(result.answers.typed, { minProbability: 0.7, abstainOptions: [true] }).status, 'review');
    assert(Object.isFrozen(result.answers.typed.probabilities));
    assert(!Object.isFrozen(request.input));
});

test('native access keeps multiple messages, unnamed questions and original response arrays', async () => {
    const { provider, requests } = fixture(data => { data.answers[1].probabilities.reverse(); });
    const request = { input: [{ role: 'user', content: 'First' }, { type: 'message', role: 'user', content: [
        { type: 'input_image', image_url: image, detail: null }, { type: 'input_text', text: 'Second' },
    ] }], safety_identifier: null, questions: [native.questions[0],
        { type: 'choice', name: '', instructions: '', choices: [{ value: true }, { value: 'true' }] }] };
    const { decision, meta } = await provider.createDecision(request);
    assert.deepEqual(requests[0].input, request.input);
    assert.equal(decision.answers[0].name, null);
    assert.equal(decision.answers[1].name, '');
    assert.equal(decision.answers[1].probabilities[0].value, 'true');
    assert.deepEqual(decision.usage, usage);
    assert.equal(meta.requestId, 'fixture-request-id');
    assert(Object.isFrozen(decision.answers));
    assert.equal(typeof createProvider({ type: 'openai-decisions', apiKey: 'fixture-key' }).createDecision, 'function');
});

for (const [label, mutate] of [
    ['missing answer', d => d.answers.pop()],
    ['extra answer', d => d.answers.push(d.answers[0])],
    ['wrong name', d => { d.answers[0].name = 'incorrect'; }],
    ['wrong type', d => { d.answers[0].type = 'choice'; }],
    ['invalid probability', d => { d.answers[0].probability = 1.1; }],
    ['missing usage', d => { delete d.usage; }],
    ['negative cache usage', d => { d.usage.input_tokens_details.cached_tokens = -1; }],
    ['invented field', d => { d.explanation = 'private upstream body'; }],
]) test(`native response rejects ${label} with safe HTTP diagnostics`, async () => {
    const { provider } = fixture(mutate);
    await assert.rejects(provider.createDecision(native), error => error.code === 'INVALID_RESPONSE' &&
        error.requestId === 'fixture-request-id' && !JSON.stringify(publicError(error)).includes('private upstream body'));
});

for (const [label, mutate] of [
    ['duplicate option', d => { d.answers[0].probabilities[1].value = d.answers[0].probabilities[0].value; }],
    ['missing distribution entry', d => d.answers[0].probabilities.pop()],
    ['wrong total', d => { d.answers[0].probabilities[0].probability = 0.1; }],
    ['unknown selection', d => { d.answers[0].choice = 'other'; }],
    ['invalid confidence', d => { d.answers[0].confidence = null; }],
]) test(`choice rejects ${label}`, async () => {
    const { provider } = fixture(mutate);
    await assert.rejects(provider.createDecision({ input: '', questions: [{ type: 'choice', instructions: '',
        choices: [{ value: true }, { value: 'true' }] }] }), { code: 'INVALID_RESPONSE' });
});

test('score distributions are matched by index and label without reordering native arrays', async () => {
    const { provider, bridge } = fixture(data => data.answers[0].probabilities.reverse());
    const request = { input: '', questions: [{ type: 'score', instructions: '', levels: [{ label: 'Low' }, { label: 'High' }] }] };
    assert.equal((await provider.createDecision(request)).decision.answers[0].probabilities[0].value, 1);
    assert.equal((await bridge.evaluate({ state: '', questions: { score: score('Rate.', ['Low', 'High']) } })).answers.score.score, 0.5);
    const bad = fixture(data => { data.answers[0].probabilities[0].label = 'Wrong'; }).provider;
    await assert.rejects(bad.createDecision(request), { code: 'INVALID_RESPONSE' });
});

test('native confidence and selection are preserved; common invariants still reject inconsistent answers', async () => {
    const { provider } = fixture(data => { data.answers[0].choice = 'b'; data.answers[0].confidence = 1.2; });
    const questions = [{ type: 'choice', instructions: '', choices: [{ value: 'a' }, { value: 'b' }] }];
    const result = await provider.createDecision({ input: '', questions });
    assert.equal(result.decision.answers[0].choice, 'b');
    assert.equal(result.decision.answers[0].confidence, 1.2);
    await assert.rejects(provider.evaluate({ state: '', questions: { choice: choice('Choose.', { a: null, b: null }) } }), { code: 'INVALID_RESPONSE' });
});

test('complete and partial refusals fail both entry points with usage and no sibling answers', async () => {
    for (const all of [false, true]) {
        const { provider, bridge } = fixture(data => {
            data.answers = data.answers.map((answer, i) => all || i === 0 ? { type: 'refusal', name: answer.name } : answer);
        });
        let observed = 0;
        const observedBridge = createBridge({ provider, extensions: [{ name: 'observe', onResult() { observed++; } }] });
        const checkError = error => {
            assert.equal(error.code, 'MODEL_REFUSAL');
            assert.deepEqual(error.usage, usage);
            assert.equal(error.refusedQuestions.length, all ? 2 : 1);
            assert.equal(error.requestId, 'fixture-request-id');
            assert(!Object.hasOwn(error.toJSON(), 'answers'));
            return true;
        };
        await assert.rejects(provider.createDecision({ input: '', questions: [native.questions[0], { ...native.questions[0], name: 'yes' }] }), checkError);
        const request = { state: '', questions: { a: noul('True?'), b: noul('True?') } };
        await assert.rejects(bridge.evaluate(request), checkError);
        await assert.rejects(observedBridge.evaluate(request), checkError);
        assert.equal(observed, 0);
    }
});

test('providers and legacy custom providers reject new features without fetching', async () => {
    let calls = 0;
    const options = { apiKey: 'fixture', model: 'test', fetchImpl: async () => { calls++; throw Error('Unexpected fetch'); } };
    const providers = [new JevProvider(options), new OpenAICompatibleProvider(options), new AnthropicProvider(options),
        { kind: 'decision', name: 'custom', defaultModel: 'test', async evaluate() { calls++; } }];
    const requests = [{ input: [{ type: 'text', text: 'Test' }], questions: common.questions },
        { ...common, safetyIdentifier: null }, { state: '', questions: { q: choice('Pick.', [{ value: true }]) } },
        { state: '', questions: { q: scoreLevels('Rate.', [{ label: 'Low' }, { label: 'High' }]) } }];
    for (const provider of providers) for (const request of requests) {
        await assert.rejects(createBridge({ provider }).evaluate(request), { code: 'UNSUPPORTED_CAPABILITY' });
        if (provider.name !== 'custom') await assert.rejects(provider.evaluate(request), { code: 'UNSUPPORTED_CAPABILITY' });
    }
    assert.equal(calls, 0);
});

test('capabilities, model restrictions and batch preflight are synchronous and offline', async () => {
    const { bridge, requests } = fixture();
    assert.equal(bridge.getCapabilities().images, true);
    assert.equal(bridge.getCapabilities('unverified-model').supported, false);
    assert.throws(() => bridge.validate({ ...common, model: 'unverified-model' }), { code: 'UNSUPPORTED_CAPABILITY' });
    const legacy = createBridge({ provider: { kind: 'decision', name: 'legacy', defaultModel: 'test', async evaluate() { throw Error('Unexpected'); } } });
    await assert.rejects(evaluateBatch(legacy, [common, { ...common, safetyIdentifier: 'opaque' }]), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.equal(requests.length, 0);
});

test('input preparations are ordered, immutable and revalidated before dispatch', async () => {
    const { provider, requests } = fixture();
    const input = { input: [{ type: 'text', text: 'Before' }], questions: common.questions };
    const bridge = createBridge({ provider, extensions: [{ name: 'prepare', prepareInput(parts) {
        assert(Object.isFrozen(parts));
        return [...parts, { type: 'text', text: 'After' }];
    } }, { name: 'observe', onResult(result) { assert.equal(result.meta.schemaVersion, 2); throw Error('Observer failure'); } }] });
    const result = await bridge.evaluate(input);
    assert.deepEqual(requests[0].input[0].content.map(part => part.text), ['Before', 'After']);
    assert.deepEqual(result.meta.observerFailures, ['observe']);
    assert.equal(input.input.length, 1);
    assert.equal(requests.length, 1);
    const incompatible = createBridge({ provider, extensions: [{ name: 'state-only', prepareState(s) { return s; } }] });
    await assert.rejects(incompatible.evaluate(input), { code: 'UNSUPPORTED_CAPABILITY' });
    const bad = createBridge({ provider, extensions: [{ name: 'bad', prepareInput() { return [{ type: 'image', dataUrl: 'https://example.com/image.png' }]; } }] });
    await assert.rejects(bad.evaluate(input), { code: 'VALIDATION_ERROR' });
    assert.equal(requests.length, 1);
});

test('malformed and unsupported native inputs fail before dispatch', async () => {
    const { provider, requests } = fixture();
    for (const input of [
        { ...native, model: 'unknown' }, { ...native, safety_identifier: 'x'.repeat(129) },
        { ...native, temperature: 1 }, { ...native, input: [{ role: 'system', content: '' }] },
        { ...native, input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://example.com/img.png' }] }] },
        { ...native, input: [{ role: 'user', content: [{ type: 'input_image', image_url: image, detail: 'invalid' }] }] },
        { ...native, input: [{ role: 'user', content: Array.from({ length: 129 }, () => ({ type: 'input_image', image_url: image })) }] },
    ]) await assert.rejects(provider.createDecision(input), error => ['VALIDATION_ERROR', 'UNSUPPORTED_CAPABILITY'].includes(error.code));
    assert.equal(requests.length, 0);
    assert.throws(() => validateRequest({ ...common, input: [{ type: 'text', text: '' }] }, 'gpt-6-luna'), { code: 'VALIDATION_ERROR' });
    assert.throws(() => choice('Choose.', [{ value: true }, { value: true }]), { code: 'VALIDATION_ERROR' });
    assert.throws(() => buildResponseSchema({ q: choice('Pick.', [{ value: true }]) }), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.throws(() => new OpenAIDecisionsProvider({ apiKey: 'fixture', maxTokens: 10 }), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => new OpenAIDecisionsProvider({ baseURL: 'https://example.com' }), { code: 'CONFIGURATION_ERROR' });
});

test('Decisions retries default to zero; explicit retry opts into another HTTP attempt', async () => {
    for (const options of [{}, { maxRetries: undefined }, { maxRetries: 1 }]) {
        let calls = 0;
        const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture', ...options,
            fetchImpl: async (_, init) => ++calls === 1 ? jsonResponse({ error: { message: 'private' } }, 429, { 'retry-after': '0' })
                : jsonResponse(decisionResponse(JSON.parse(init.body))) });
        if (!options.maxRetries) await assert.rejects(provider.createDecision(native), { code: 'HTTP_ERROR' });
        else await provider.createDecision(native);
        assert.equal(calls, options.maxRetries ? 2 : 1);
    }
});

test('native calls retain bounded timeouts and cancellation', async () => {
    const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture', timeoutMs: 15, fetchImpl: async () => new Promise(() => {}) });
    await assert.rejects(provider.createDecision(native), { code: 'TIMEOUT' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(provider.createDecision(native, { signal: controller.signal }), { code: 'ABORTED' });
});
