// Preflight must reject static request errors before a neighboring batch call spends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionError, createBridge, OpenAIDecisionsProvider, evaluateBatch, choice, noul, scoreLevels, validateRequest } from '../src/index.mjs';
import { decisionResponse } from './decisions-fixtures.mjs';
import { jsonResponse } from './fixtures.mjs';

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

test('OpenAI choice limits apply to common and native requests before batch dispatch', async () => {
    const { provider, bridge, requests } = fixture();
    assert.equal(bridge.getCapabilities().maxChoiceOptions, 255);
    for (const count of [2, 255]) {
        const options = Array.from({ length: count }, (_, i) => ({ value: String(i) }));
        const typed = { state: '', questions: { q: choice('Pick.', options) } };
        const mapped = { state: '', questions: { q: choice('Pick.',
            Object.fromEntries(options.map(({ value }) => [value, null]))) } };
        for (const request of [typed, mapped]) {
            assert.equal((await bridge.evaluate(request)).answers.q.choice, '0');
        }
        const { decision } = await provider.createDecision({ input: '', questions: [
            { type: 'choice', instructions: 'Pick.', choices: options },
        ] });
        assert.equal(decision.answers[0].probabilities.length, count);
    }
    assert.equal(requests.length, 6);
    requests.length = 0;
    for (const count of [0, 1, 256]) {
        const options = Array.from({ length: count }, (_, i) => ({ value: String(i) }));
        await assert.rejects(provider.createDecision({ input: '', questions: [
            { type: 'choice', instructions: 'Pick.', choices: options },
        ] }), { code: 'VALIDATION_ERROR' });
        if (!count) continue;
        for (const typed of [false, true]) {
            const request = { state: '', questions: { q: { type: 'choice', instructions: 'Pick.',
                ...(typed ? { options } : { criteria: Object.fromEntries(options.map(({ value }) => [value, null])) }),
            } } };
            const code = typed && count === 256 ? 'UNSUPPORTED_CAPABILITY' : 'VALIDATION_ERROR';
            assert.throws(() => bridge.validate(request), { code });
            await assert.rejects(evaluateBatch(bridge, [common, request]), { code });
        }
    }
    assert.equal(requests.length, 0);
});

test('common preflight checks encoded native field limits before any batch dispatch', async () => {
    const { bridge, requests } = fixture();
    const oversized = 'x'.repeat(1048577);
    const inputs = [
        { ...common, questions: { q: noul(oversized) } },
        { ...common, questions: { [oversized]: noul('True?') } },
        { ...common, questions: { q: noul({ evidence: '\\'.repeat(600000) }) } },
        { ...common, questions: { q: scoreLevels('Rate.', [{ label: oversized }, { label: 'Other' }]) } },
    ];
    for (const input of inputs) {
        validateRequest(input, 'gpt-6-luna');
        assert.throws(() => bridge.validate(input), { code: 'VALIDATION_ERROR' });
        await assert.rejects(evaluateBatch(bridge, [common, input]), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(requests.length, 0);
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
