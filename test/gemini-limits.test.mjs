/** Structural admission budgets cover the native matrix without relaxing legacy defaults. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, GeminiDecisionsProvider, validateRequest, validateResult } from '../src/index.mjs';
import { createDecisionRouter } from '../src/routing/index.mjs';
import { JsonTransport } from '../src/transport.mjs';
import { validateConfig } from '../src/cli/config.mjs';
import { validateResultOptions } from '../src/probabilities.mjs';
import { geminiResponse } from './gemini-fixtures.mjs';

const config = { type: 'gemini-decisions', apiKey: 'fixture', maxRequestBytes: 167772160, maxResponseBytes: 67108864 };
const { type: _type, ...providerOptions } = config;
const reply = async (_url, init) => Response.json(geminiResponse(JSON.parse(init.body)));

test('Gemini byte ceilings agree across SDK, CLI config and routing; response/legacy ceilings remain', () => {
    new GeminiDecisionsProvider(providerOptions);
    validateConfig({ provider: 'gemini-decisions', maxRequestBytes: 167772160 });
    createDecisionRouter({ routes: { google: { config } } });
    for (const options of [{ maxRequestBytes: 167772161 }, { maxResponseBytes: 67108865 }]) {
        assert.throws(() => new GeminiDecisionsProvider({ ...providerOptions, ...options }), { code: 'CONFIGURATION_ERROR' });
        assert.throws(() => validateConfig({ provider: 'gemini-decisions', ...options }), { code: 'CONFIGURATION_ERROR' });
        assert.throws(() => createDecisionRouter({ routes: { google: { config: { ...config, ...options } } } }), { code: 'CONFIGURATION_ERROR' });
    }
    assert.throws(() => new JsonTransport({ baseURL: 'https://example.com', maxRequestBytes: 67108865 }), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => validateConfig({ provider: 'openai-decisions', maxRequestBytes: 67108865 }), { code: 'CONFIGURATION_ERROR' });
});

test('request/result snapshot policies remain explicit, bounded and accessor-safe', () => {
    const request = { state: Array(200001).fill(null), questions: { q: { type: 'noul', instructions: 'Check' } } };
    assert.throws(() => validateRequest(request, 'fixture'), { code: 'VALIDATION_ERROR' });
    assert.equal(validateRequest(request, 'fixture', { maxJsonNodes: 1000000 }).state.length, 200001);
    for (const maxJsonNodes of [null, 0, -1, 1.5, 1000001, '1000000', Infinity]) {
        assert.throws(() => validateRequest({ state: 'x', questions: request.questions }, 'fixture', { maxJsonNodes }), { code: 'CONFIGURATION_ERROR' });
        assert.throws(() => validateResultOptions({ maxJsonNodes }), { code: 'CONFIGURATION_ERROR' });
    }
    let read = false;
    const options = Object.defineProperty({}, 'maxJsonNodes', { enumerable: true, get() { read = true; return 1000000; } });
    assert.throws(() => validateRequest(request, 'fixture', options));
    assert.throws(() => validateResultOptions(options));
    assert.equal(read, false);
    assert.throws(() => validateRequest({ ...request, state: Array(1000000).fill(null) }, 'fixture', { maxJsonNodes: 1000000 }),
        { code: 'VALIDATION_ERROR' });
});

test('request node policies use own fields without executing inherited getters', () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'maxJsonNodes');
    let reads = 0;
    Object.defineProperty(Object.prototype, 'maxJsonNodes', { configurable: true,
        get() { reads++; return 1000000; } });
    try {
        const questions = { q: { type: 'noul', instructions: 'Check' } };
        const request = { state: Array(200001).fill(null), questions };
        assert.throws(() => validateRequest(request, 'fixture'), { code: 'VALIDATION_ERROR' });
        assert.throws(() => validateRequest(request, 'fixture', {}), { code: 'VALIDATION_ERROR' });
        assert.equal(validateRequest({ state: 'x', questions }, 'fixture').state, 'x');
        assert.equal(validateRequest(request, 'fixture', { maxJsonNodes: 1000000 }).state.length, 200001);
        assert.equal(validateResultOptions({}).maxJsonNodes, 200000);
        assert.equal(reads, 0);
    } finally {
        if (original) Object.defineProperty(Object.prototype, 'maxJsonNodes', original);
        else delete Object.prototype.maxJsonNodes;
    }
});

test('1000 questions with 255 choices or score levels pass native/common snapshots and routing', async () => {
    let calls = 0;
    const fetchImpl = async (...args) => { calls++; return reply(...args); };
    const provider = new GeminiDecisionsProvider({ ...providerOptions, fetchImpl });
    for (const type of ['choice', 'score']) {
        const criteria = type === 'choice' ? Object.fromEntries(Array.from({ length: 255 }, (_, i) => ['c' + i, '']))
            : Array.from({ length: 255 }, (_, i) => 'Level ' + i);
        const questions = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => ['q' + i, { type, instructions: 'Select.', criteria }]));
        const native = await provider.createDecision({ input: 'x', questions });
        assert.equal(Object.keys(native.decision.answers).length, 1000);
        const bridge = createBridge({ provider, timeoutMs: 120000, extensions: [{ name: 'prepare', prepareState: value => value }] });
        const result = await bridge.evaluate({ state: 'x', questions });
        assert.equal(Object.keys(result.answers).length, 1000);
        assert.throws(() => validateResult(result, questions, { native: true }), { code: 'INVALID_RESPONSE' });
        assert.equal(Object.keys(validateResult(result, questions, provider.getResultValidationOptions()).answers).length, 1000);
        if (type === 'choice') {
            const router = createDecisionRouter({ defaultRoute: 'auto', workTimeoutMs: 120000, routes: {
                auto: { policy: 'deterministic', candidates: ['google', 'legacy'] },
                google: { config: { ...config, fetchImpl } },
                legacy: { provider: { name: 'legacy', kind: 'decision', defaultModel: 'legacy', evaluate() { throw Error('Must not dispatch'); } } },
            } });
            const inspected = router.inspect({ state: 'x', questions });
            assert.equal(inspected.selectedRoute, 'google');
            assert.equal((await router.evaluate({ state: 'x', questions })).meta.routing.selectedRoute, 'google');
        }
    }
    assert.equal(calls, 5);
});
