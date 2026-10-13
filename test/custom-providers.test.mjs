import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createBridge, createProvider, noul, choice } from '../src/index.mjs';
import { defineDecisionProvider } from '../src/custom/decision.mjs';
import { defineGenerativeProvider, createGenerativeProvider } from '../src/custom/generative/index.mjs';

const request = { state: 'fixture', questions: { q: noul('True?') } };
const result = { model: 'fixture', answers: { q: { type: 'noul', noul: 0.7 } },
    usage: { input_tokens: null, output_tokens: null } };

test('async capability hooks reject safely without dispatch or unhandled rejections', () => {
    const entry = new URL('../src/index.mjs', import.meta.url).href;
    // Strict child execution detects process-level failures without affecting the runner.
    const code = `import assert from 'node:assert/strict';
import { createBridge } from ${JSON.stringify(entry)};
let calls = 0;
const request = { state: 'fixture', questions: { q: { type: 'noul', instructions: 'True?' } } };
for (const kind of ['decision', 'generative']) {
    for (const reject of [false, true]) {
        const bridge = createBridge({ provider: { kind, name: 'fixture', defaultModel: 'fixture',
            async getCapabilities() { if (reject) throw Error('fixture hook failure'); return {}; },
            async evaluate() { calls++; } } });
        assert.throws(() => bridge.getCapabilities(), { code: 'CONFIGURATION_ERROR' });
        assert.throws(() => bridge.validate(request), { code: 'CONFIGURATION_ERROR' });
        await assert.rejects(bridge.evaluate(request), { code: 'CONFIGURATION_ERROR' });
    }
}
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls, 0);
`;
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', code],
        { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
});

test('two custom paths preserve receiver, hooks and immutable authoritative classification', async () => {
    for (const [define, kind] of [[defineDecisionProvider, 'decision'], [defineGenerativeProvider, 'generative']]) {
        const definition = { name: 'custom', defaultModel: 'fixture',
            async evaluate() { assert.equal(this, definition); return { ...result, meta: { providerKind: 'wrong' } }; },
            async listModels() { assert.equal(this, definition); return { models: [{ name: 'fixture' }] }; },
            getCapabilities() { assert.equal(this, definition); return {}; },
            validateRequest() { assert.equal(this, definition); },
            getResultValidationOptions() { assert.equal(this, definition); return {}; } };
        const provider = define(definition);
        assert(Object.isFrozen(provider));
        const bridge = createBridge({ provider });
        assert.equal(bridge.providerKind, kind);
        const response = await bridge.evaluate(request);
        assert.equal(response.meta.providerKind, kind);
        assert.equal(response.meta.probabilitySource, kind === 'generative' ? 'elicited' : 'unspecified');
        assert(Object.isFrozen(response));
        assert.equal((await bridge.listModels()).models[0].name, 'fixture');
    }
});

test('custom decision classification does not impose Jev native confidence or usage', async () => {
    const provider = defineDecisionProvider({ name: 'custom', async evaluate(input) { return { ...result, model: input.model }; } });
    const bridge = createBridge({ provider });
    assert.throws(() => bridge.validate(request), { code: 'VALIDATION_ERROR' });
    assert.equal((await bridge.evaluate({ ...request, model: 'supplied' })).model, 'supplied');
});

test('custom definitions reject invalid methods, fields, kinds and conflicting provenance', () => {
    for (const definition of [{ name: 'custom' }, { name: 'custom', evaluate: 1 },
        { name: 'custom', evaluate() {}, listModels: true }, { name: 'custom', evaluate() {}, typo: true }]) {
        assert.throws(() => defineDecisionProvider(definition), { code: 'CONFIGURATION_ERROR' });
    }
    let invoked = false;
    assert.throws(() => defineDecisionProvider({ name: 'custom', get evaluate() { invoked = true; } }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(invoked, false);
    for (const kind of [undefined, 'native', null]) assert.throws(() => createBridge({
        provider: { kind, name: 'custom', evaluate() {} } }), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => defineGenerativeProvider({ name: 'custom', probabilitySource: 'native', evaluate() {} }), { code: 'CONFIGURATION_ERROR' });
});

test('generative results reject invented native probability/confidence claims', async () => {
    for (const meta of [{ probabilitySource: 'native' }, { confidenceSource: 'native' }]) {
        const provider = defineGenerativeProvider({ name: 'custom', defaultModel: 'fixture', async evaluate() { return { ...result, meta }; } });
        await assert.rejects(createBridge({ provider }).evaluate(request), { code: 'INVALID_RESPONSE' });
    }
    const questions = { q: choice('Pick', { a: null, b: null }) };
    const provider = defineGenerativeProvider({ name: 'custom', defaultModel: 'fixture', async evaluate() { return {
        ...result, answers: { q: { type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.3 }, confidence: 0.8 } } }; } });
    await assert.rejects(createBridge({ provider }).evaluate({ state: 'fixture', questions }), { code: 'INVALID_RESPONSE' });
});

test('decision provenance rejects invalid labels and preserves custom labels and defaults', async () => {
    const evaluate = meta => createBridge({ provider: defineDecisionProvider({
        name: 'custom', defaultModel: 'fixture', probabilitySource: 'declared-source',
        async evaluate() { return { ...result, meta }; },
    }) }).evaluate(request);
    for (const field of ['probabilitySource', 'confidenceSource']) {
        for (const value of [null, false, 3, {}, [], '', '   ']) {
            await assert.rejects(evaluate({ [field]: value }), { code: 'INVALID_RESPONSE' });
        }
    }
    const custom = { probabilitySource: 'service-distribution', confidenceSource: 'service-score',
        calibration: { version: 1 } };
    const actual = await evaluate(custom);
    for (const [key, value] of Object.entries(custom)) assert.deepEqual(actual.meta[key], value);
    const fallback = await evaluate({});
    assert.equal(fallback.meta.probabilitySource, 'declared-source');
    assert.equal(Object.hasOwn(fallback.meta, 'confidenceSource'), false);
});

test('root registry is native-only and generative presets are explicit', () => {
    for (const type of ['openai-compatible', 'openrouter', 'anthropic']) {
        assert.throws(() => createProvider({ type, apiKey: 'fixture' }), { code: 'CONFIGURATION_ERROR' });
        assert.equal(createGenerativeProvider({ type, apiKey: 'fixture' }).kind, 'generative');
    }
    let invoked = false;
    assert.throws(() => createGenerativeProvider({ get type() { invoked = true; return 'openai-compatible'; } }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(invoked, false);
});

test('generative factory never selects an inherited preset or reads its getter', () => {
    let invoked = false;
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'type');
    Object.defineProperty(Object.prototype, 'type', { configurable: true,
        get() { invoked = true; return 'openai-compatible'; } });
    try {
        assert.throws(() => createGenerativeProvider({ apiKey: 'fixture' }), { code: 'CONFIGURATION_ERROR' });
        assert.equal(invoked, false);
    } finally {
        if (original) Object.defineProperty(Object.prototype, 'type', original);
        else delete Object.prototype.type;
    }
});
