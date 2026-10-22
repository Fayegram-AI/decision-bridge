// Preflight must reject static request errors before a neighboring batch call spends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionError, createBridge, OpenAIDecisionsProvider, evaluateBatch, choice, noul, scoreLevels, validateRequest } from '../src/index.mjs';
import { decisionResponse } from './decisions-fixtures.mjs';
import { jsonResponse } from './fixtures.mjs';
import { encodeCommonDecision } from '../src/providers/decisions-codec.mjs';

const common = { state: '', questions: { q: noul('True?') } };

function fixture(options = {}) {
    const requests = [];
    const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture-key', ...options, fetchImpl: async (_, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        return jsonResponse(decisionResponse(request));
    } });
    return { provider, bridge: createBridge({ provider }), requests };
}

test('choice structures are checked while service option ceilings remain upstream', async () => {
    const { provider, bridge, requests } = fixture();
    assert.equal(bridge.getCapabilities().maxChoiceOptions, null);
    for (const count of [2, 255, 256]) {
        const options = Array.from({ length: count }, (_, i) => ({ value: String(i) }));
        const result = await bridge.evaluate({ state: '', questions: { q: choice('Pick.', options) } });
        assert.equal(result.answers.q.choice, '0');
        await provider.createDecision({ input: '', questions: [{ type: 'choice', instructions: '', choices: options }] });
    }
    const before = requests.length;
    for (const count of [0, 1]) await assert.rejects(provider.createDecision({ input: '', questions: [
        { type: 'choice', instructions: '', choices: Array.from({ length: count }, (_, i) => ({ value: String(i) })) },
    ] }), { code: 'VALIDATION_ERROR' });
    assert.equal(requests.length, before);
});
test('common preflight preserves large fields instead of predicting service admission', async () => {
    const { bridge, requests } = fixture();
    const instructions = 'x'.repeat(1048577);
    const input = { ...common, questions: { q: noul(instructions) } };
    bridge.validate(input);
    const results = await evaluateBatch(bridge, [common, input]);
    assert(results.every(row => row.ok));
    assert.equal(requests[1].questions[0].instructions, instructions);
});
test('preflight checks UTF-8 wire bytes including model and envelope before batch dispatch', async () => {
    const { bridge, provider, requests } = fixture({ maxRequestBytes: 250 });
    const input = { ...common, state: 'é'.repeat(100) };
    bridge.validate(common);
    assert.throws(() => bridge.validate(input), { code: 'REQUEST_TOO_LARGE' });
    await assert.rejects(evaluateBatch(bridge, [common, input]), { code: 'REQUEST_TOO_LARGE' });
    await assert.rejects(provider.createDecision({ input: input.state,
        questions: [{ type: 'predicate', instructions: 'True?', name: 'q' }] }), { code: 'REQUEST_TOO_LARGE' });
    assert.equal(requests.length, 0);
    const records = await evaluateBatch(bridge, [common, common]);
    assert(records.every(record => record.ok));
    assert.equal(requests.length, 2);
});

test('prepared state and ordered input are checked again against wire byte limits', async () => {
    const { provider, requests } = fixture({ maxRequestBytes: 250 });
    let prepared = 0;
    for (const [input, extension] of [[common, { name: 'state', prepareState() {
        prepared++; return 'é'.repeat(100);
    } }], [{ input: [{ type: 'text', text: '' }], questions: common.questions }, { name: 'input', prepareInput() {
        prepared++; return [{ type: 'text', text: 'é'.repeat(100) }];
    } }]]) {
        const bridge = createBridge({ provider, extensions: [extension] });
        bridge.validate(input);
        await assert.rejects(bridge.evaluate(input), { code: 'REQUEST_TOO_LARGE' });
    }
    assert.equal(prepared, 2);
    assert.equal(requests.length, 0);
});

test('selector byte budgets use the resolved model before common, native and batch dispatch', async () => {
    const input = { ...common, state: 'x'.repeat(30), model: 'luna' };
    const native = encodeCommonDecision(input);
    const maxRequestBytes = Buffer.byteLength(JSON.stringify(native));
    assert(Buffer.byteLength(JSON.stringify({ ...native, model: 'gpt-6-luna' })) > maxRequestBytes);
    const { bridge, provider, requests } = fixture({ model: 'luna', maxRequestBytes });
    bridge.validate(common);
    assert.throws(() => bridge.validate(input), { code: 'REQUEST_TOO_LARGE' });
    await assert.rejects(provider.evaluate(input), { code: 'REQUEST_TOO_LARGE' });
    await assert.rejects(provider.createDecision(native), { code: 'REQUEST_TOO_LARGE' });
    await assert.rejects(evaluateBatch(bridge, [common, input]), { code: 'REQUEST_TOO_LARGE' });
    assert.equal(requests.length, 0);
});

test('optional provider preflight receives frozen requests and rejects before inference', async () => {
    let calls = 0;
    const provider = { kind: 'decision', name: 'custom', defaultModel: 'test', validateRequest(request) {
        assert(Object.isFrozen(request));
        assert(Object.isFrozen(request.questions.q));
        if (request.state === 'blocked') throw new DecisionError('Blocked request.', { code: 'VALIDATION_ERROR' });
    }, async evaluate() {
        calls++;
        return { model: 'test', answers: { q: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: null, output_tokens: null } };
    } };
    const bridge = createBridge({ provider });
    await assert.rejects(evaluateBatch(bridge, [common, { ...common, state: 'blocked' }]), { code: 'VALIDATION_ERROR' });
    assert.equal(calls, 0);
    assert.equal((await bridge.evaluate(common)).answers.q.noul, 0.7);
    assert.equal(calls, 1);
});

test('provider preflight failures stay safe and asynchronous validation is rejected', async () => {
    let calls = 0;
    const provider = { kind: 'decision', name: 'custom', defaultModel: 'test', async evaluate() { calls++; } };
    const unsafe = createBridge({ provider: { ...provider, validateRequest() { throw Error('private-key'); } } });
    assert.throws(() => unsafe.validate(common), error => error.code === 'PROVIDER_ERROR' && !error.message.includes('private-key'));
    const asynchronous = createBridge({ provider: { ...provider, async validateRequest() { throw Error('private-key'); } } });
    assert.throws(() => asynchronous.validate(common), { code: 'CONFIGURATION_ERROR' });
    await assert.rejects(asynchronous.evaluate(common), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => createBridge({ provider: { ...provider, validateRequest: true } }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(calls, 0);
});
