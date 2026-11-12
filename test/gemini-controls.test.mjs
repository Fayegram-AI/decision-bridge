/** Common resolution controls survive preparation, routing and provider admission. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, GeminiDecisionsProvider, noul, validateRequest } from '../src/index.mjs';
import { createDecisionRouter } from '../src/routing/index.mjs';
import { commonSchemaVersion, providerCapabilities } from '../src/capabilities.mjs';
import { geminiResponse } from './gemini-fixtures.mjs';

const questions = { q: noul('Visible?') };
const image = { type: 'image', dataUrl: 'data:image/png;base64,YQ==' };
const video = { type: 'video', url: 'https://media.example/v.mp4?signed=secret', mimeType: 'video/mp4' };

test('common Gemini exposes all inline/remote image and video resolutions with schema 8', async () => {
    const input = [];
    for (const resolution of ['low', 'medium', 'high', 'ultra_high']) {
        input.push({ ...image, resolution }, { type: 'image', url: 'https://example.com/i.png', mimeType: 'image/png', resolution });
    }
    for (const resolution of ['low', 'medium', 'high']) {
        input.push({ ...video, resolution }, { type: 'video', dataUrl: 'data:video/mp4;base64,YQ==', resolution });
    }
    let calls = 0;
    const provider = new GeminiDecisionsProvider({ apiKey: 'fixture', fetchImpl: async (_url, init) => {
        calls++;
        const body = JSON.parse(init.body);
        assert.deepEqual(body.input.map(part => part.resolution), input.map(part => part.resolution));
        return Response.json(geminiResponse(body));
    } });
    const bridge = createBridge({ provider, extensions: [{ name: 'prepare', prepareInput: parts => parts.map(part => ({ ...part })) }] });
    const result = await bridge.evaluate({ input, questions });
    assert.equal(result.meta.schemaVersion, 8);
    assert.equal(calls, 1);
    assert.deepEqual(bridge.getCapabilities().imageResolutions, ['low', 'medium', 'high', 'ultra_high']);
    assert.deepEqual(bridge.getCapabilities().videoResolutions, ['low', 'medium', 'high']);
    assert.equal(commonSchemaVersion({ input: [image], questions }), 2);
    assert.equal(commonSchemaVersion({ input: [video], questions }), 7);
    assert.equal(commonSchemaVersion({ input: [{ ...image, detail: 'high' }], questions }), 2);
    bridge.validate({ input: [{ ...image, detail: null, resolution: 'high' }], questions });
});

test('resolution conflicts, invalid modalities and unsupported profiles fail before dispatch', async () => {
    const invalid = [
        { ...image, resolution: 'auto' }, { ...video, resolution: 'ultra_high' },
        ...['auto', 'low', 'high', 'original'].map(detail => ({ ...image, resolution: 'high', detail })),
        { type: 'audio', dataUrl: 'data:audio/wav;base64,YQ==', resolution: 'low' },
        { type: 'document', url: 'https://example.com/a.pdf', resolution: 'low' },
    ];
    for (const part of invalid) assert.throws(() => validateRequest({ input: [part], questions }, 'gemini-decision-1'));
    assert.throws(() => validateRequest({ state: 'x', questions: { q: {
        type: 'noul', instructionParts: [{ ...image, resolution: 'high' }],
    } } }, 'gemini-decision-1'));
    let calls = 0;
    const provider = { name: 'fixture', kind: 'decision', defaultModel: 'fixture',
        getCapabilities: () => ({ supported: true, images: true, orderedInput: true }),
        evaluate() { calls++; throw Error('Must not dispatch'); } };
    await assert.rejects(createBridge({ provider }).evaluate({ input: [{ ...image, resolution: 'high' }], questions }),
        { code: 'UNSUPPORTED_CAPABILITY' });
    assert.equal(calls, 0);
    for (const profile of [{ imageResolutions: ['auto'] }, { videoResolutions: ['ultra_high'] },
        { imageResolutions: ['high', 'high'] }, { maxJsonNodes: 1000001 }]) {
        assert.throws(() => providerCapabilities({ getCapabilities: () => profile }), { code: 'CONFIGURATION_ERROR' });
    }
});

test('routing admits only resolution-capable providers and redacts sources from selectors', async () => {
    const request = { input: [{ ...video, resolution: 'medium' }], questions };
    let calls = 0;
    const config = id => ({ type: 'gemini-decisions', apiKey: 'fixture', baseURL: 'https://' + id + '.example',
        fetchImpl: async (_url, init) => {
            calls++;
            const body = JSON.parse(init.body);
            assert.equal(body.input[0].resolution, 'medium');
            return Response.json(geminiResponse(body));
        } });
    const selector = { name: 'selector', kind: 'decision', defaultModel: 'fixture', async evaluate(input) {
        assert.match(input.state, /"resolution":"medium"/);
        assert(!input.state.includes('media.example') && !input.state.includes('secret'));
        return { model: 'fixture', answers: { route: { type: 'choice', choice: 'r0', probabilities: { r0: 1, r1: 0, abstain: 0 } } },
            usage: { input_tokens: 0, output_tokens: 0 } };
    } };
    const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
        auto: { candidates: ['a', 'b', 'legacy'], policy: 'decision-assisted',
            selector: { route: 'selector', minProbability: 0.5, minMargin: 0.1 } },
        a: { config: config('a') }, b: { config: config('b') },
        legacy: { config: { type: 'openai-decisions', apiKey: 'fixture' } }, selector: { provider: selector },
    } });
    assert.equal(router.inspect(request).routes.find(item => item.id === 'legacy').status, 'unsupported');
    const result = await router.evaluate(request);
    assert.equal(result.meta.schemaVersion, 8);
    assert.equal(result.meta.routing.selectedRoute, 'a');
    assert.equal(calls, 1);
});
