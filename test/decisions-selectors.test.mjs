// Selector contracts exercise real preparation and transport with synthetic responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, createProvider, evaluateBatch, noul } from '../src/index.mjs';
import { decisionResponse } from './decisions-fixtures.mjs';

const selectors = ['default', 'luna', 'gpt-6-luna'];
const common = { state: 'Evidence', questions: { q: noul('True?') } };
const native = { input: 'Evidence', questions: [{ type: 'predicate', instructions: 'True?' }] };

function fixture(model) {
    const requests = [];
    const provider = createProvider({ type: 'openai-decisions', apiKey: 'fixture',
        ...(model === undefined ? {} : { model }), fetchImpl: async (_, init) => {
            const request = JSON.parse(init.body);
            requests.push(request);
            return Response.json({ ...decisionResponse(request), model: 'service-reported-model' });
        } });
    return { provider, requests };
}

function identity(result, selected, nativeCall = false) {
    assert.equal(result.meta.requestedModel, selected);
    assert.equal(result.meta.resolvedModel, 'gpt-6-luna');
    assert.equal(nativeCall ? result.decision.model : result.model, 'service-reported-model');
    assert(Object.isFrozen(result));
    assert(Object.isFrozen(result.meta));
}

test('configured selectors preserve public identity across bridge, provider and native calls', async () => {
    const original = structuredClone({ common, native });
    for (const configured of [undefined, ...selectors]) {
        const selected = configured ?? 'default';
        const { provider, requests } = fixture(configured);
        const contexts = [];
        const bridge = createBridge({ provider, extensions: [{ name: 'selection', prepareState(state, context) {
            contexts.push(context.model);
            return state;
        } }] });
        assert.equal(provider.defaultModel, selected);
        assert.equal(bridge.defaultModel, selected);
        assert.equal(bridge.validate(common).model, selected);
        assert.equal(bridge.getCapabilities().supported, true);
        for (const selector of selectors) assert.deepEqual(bridge.getCapabilities(selector), bridge.getCapabilities());
        identity(await bridge.evaluate(common), selected);
        identity(await provider.evaluate(common), selected);
        identity(await provider.createDecision(native), selected, true);
        assert.deepEqual(contexts, [selected]);
        assert.deepEqual(requests.map(request => request.model), Array(3).fill('gpt-6-luna'));
    }
    assert.deepEqual({ common, native }, original);
});

test('per-request selectors override the configured selection and survive SDK batches', async () => {
    const { provider, requests } = fixture('luna');
    const bridge = createBridge({ provider });
    const inputs = selectors.map(model => ({ ...common, model }));
    const original = structuredClone(inputs);
    for (const model of selectors) {
        assert.equal(bridge.validate({ ...common, model }).model, model);
        identity(await provider.evaluate({ ...common, model }), model);
        identity(await provider.createDecision({ ...native, model }), model, true);
    }
    const results = await evaluateBatch(bridge, inputs);
    results.forEach((record, index) => {
        assert.equal(record.ok, true);
        identity(record.result, selectors[index]);
    });
    assert.deepEqual(inputs, original);
    assert(requests.every(request => request.model === 'gpt-6-luna'));
});

test('unsupported and malformed selectors fail before any request dispatch', async () => {
    const { provider, requests } = fixture();
    const bridge = createBridge({ provider });
    for (const model of ['unknown', 'constructor', '__proto__', 'LUNA', ' luna ']) {
        assert.equal(bridge.getCapabilities(model).supported, false);
        assert.throws(() => bridge.validate({ ...common, model }), { code: 'UNSUPPORTED_CAPABILITY' });
        await assert.rejects(provider.createDecision({ ...native, model }), { code: 'UNSUPPORTED_CAPABILITY' });
        await assert.rejects(evaluateBatch(bridge, [common, { ...common, model }]), { code: 'UNSUPPORTED_CAPABILITY' });
    }
    for (const model of ['', null, 42]) {
        assert.equal(bridge.getCapabilities(model).supported, false);
        assert.throws(() => bridge.validate({ ...common, model }), { code: 'VALIDATION_ERROR' });
        await assert.rejects(provider.createDecision({ ...native, model }), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(requests.length, 0);
});
