import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, createBridge, choice, noul, box, scoreLevels } from '../src/index.mjs';
import { createExtractionProvider, extractBatch } from '../src/extraction/index.mjs';
import { asset, image } from './jev-fixtures.mjs';

const questions = { q: choice('Select', { a: 'A', b: 'B' }) };
const decision = { model: 'served', answers: { q: { type: 'choice', choice: 'a', probabilities: { a: 0.8, b: 0.2 } } },
    usage: { input_tokens: 2, output_tokens: 0, cost: 0.001 }, id: 'gen-1', provider: 'upstream' };
const native = (extra = {}) => createProvider({ type: 'openrouter-decisions', apiKey: 'fixture', model: 'vendor/new-model', ...extra });

test('native OpenRouter IDs, explicit endpoints, discovery and common metadata', async () => {
    const calls = [];
    const provider = native({ fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (init.method === 'GET') return Response.json({ data: [{ id: 'vendor/new-model' }] });
        assert.equal(init.headers.authorization, 'Bearer fixture');
        assert.equal(JSON.parse(init.body).provider.allow_fallbacks, false);
        return Response.json(decision);
    } });
    const result = await createBridge({ provider }).evaluate({ state: 'Evidence', questions });
    assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(result.meta.provider, 'openrouter-decisions');
    assert.equal(result.meta.openRouter.usage.cost, 0.001);
    assert.equal(result.meta.upstreamProvider, 'upstream');
    assert.equal(result.answers.q.confidence, undefined);
    assert.equal((await provider.listModels()).models[0].name, 'vendor/new-model');
    assert.equal(calls[1].url, 'https://openrouter.ai/api/v1/models?output_modalities=decisions');
    await native({ api: 'systemone', fetchImpl: async url => {
        assert.equal(url, 'https://openrouter.ai/api/v1/systemone'); return Response.json(decision);
    } }).createDecision({ state: 'Text', questions });
});

test('valid native answers without probabilities remain distinct from common results', async () => {
    const response = structuredClone(decision); delete response.answers.q.probabilities;
    let calls = 0;
    const provider = native({ fetchImpl: async () => { calls++; return Response.json(response); } });
    const result = await provider.createDecision({ state: 'Text', questions });
    assert.equal(Object.hasOwn(result.decision.answers.q, 'probabilities'), false);
    await assert.rejects(provider.evaluate({ state: 'Text', questions }), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.equal(calls, 2);
});

test('typed choices and labelled scores round trip without changing native distributions', async () => {
    const provider = native({ model: 'cloudflare/clef', fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.deepEqual(body.questions.pick.criteria, { option_0: 'No', option_1: 'Yes' });
        return Response.json({ model: body.model, answers: {
            pick: { type: 'choice', choice: 'option_1', probabilities: { option_0: 0.2, option_1: 0.8 } },
            rating: { type: 'score', score: 0.8, probabilities: { 0: 0.2, 1: 0.8 } },
        }, usage: decision.usage });
    } });
    const result = await createBridge({ provider }).evaluate({ state: 'Evidence', questions: {
        pick: choice('Accept?', [{ value: false, description: 'No' }, { value: true, description: 'Yes' }]),
        rating: scoreLevels('Rating', [{ label: 'low', description: 'Low' }, { label: 'high', description: 'High' }]),
    } });
    assert.equal(result.answers.pick.choice, true);
    assert.deepEqual(result.answers.pick.probabilities, [{ value: false, probability: 0.2 }, { value: true, probability: 0.8 }]);
    assert.equal(result.answers.rating.legend[1].label, 'high');
});

test('native validation rejects malformed routing and media before dispatch', async () => {
    let calls = 0;
    const provider = native({ fetchImpl: async () => { calls++; throw Error('Unexpected dispatch'); } });
    for (const request of [
        { state: 'Text', questions, provider: [] },
        { state: 'Text', questions, provider: { allow_fallbacks: 'yes' } },
        { state: [{ type: 'image_url', image_url: { url: 'https://example.com/photo.png' } }], questions },
        { state: 'Text', questions, assets: { photo: asset } },
    ]) await assert.rejects(provider.createDecision(request));
    assert.equal(calls, 0);
    assert.equal(native({ model: 'typesafe/jev-future' }).getCapabilities().boxes, false);
});

test('audio/video objects remain ordinary JSON outside the native Omni profile', async () => {
    const state = { data: { type: 'input_audio', input_audio: { domainValue: 'ordinary JSON' } } };
    const provider = native({ fetchImpl: async (_url, init) => {
        assert.deepEqual(JSON.parse(init.body).state, state);
        return Response.json(decision);
    } });
    await provider.createDecision({ state, questions });
    const omni = native({ model: 'cloudflare/clef-omni', fetchImpl: async () => { throw Error('Unexpected dispatch'); } });
    await assert.rejects(omni.createDecision({ state, questions }));
});

test('known common media mappings preserve order; native assets enforce model positions', async () => {
    const provider = native({ model: 'cloudflare/clef-omni', fetchImpl: async (_url, init) => {
        assert.deepEqual(JSON.parse(init.body).state, ['Before', { type: 'image_url', image_url: { url: image } }, 'After']);
        return Response.json({ model: 'cloudflare/clef-omni', answers: { q: { type: 'noul', noul: 0.9 } }, usage: decision.usage });
    } });
    await provider.evaluate({ input: [{ type: 'text', text: 'Before' }, { type: 'image', dataUrl: image },
        { type: 'text', text: 'After' }], questions: { q: noul('Visible?') } });
    let calls = 0;
    const guarded = native({ model: 'cloudflare/clef', fetchImpl: async () => { calls++; throw Error('Unexpected dispatch'); } });
    await assert.rejects(guarded.createDecision({ state: { nested: 'photo' }, assets: { photo: asset }, questions }));
    await assert.rejects(guarded.evaluate({ state: 'Text', questions: { q: box('Target') } }), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.equal(calls, 0);
    assert.equal(native({ model: '~typesafe/jev-latest' }).getCapabilities().boxes, true);
});

test('OpenRouter extraction preserves optional fields, PDFs, common images and saved provenance', async () => {
    const fields = { name: { type: 'text' } };
    const data = { model: 'served', answers: { name: { type: 'text', value: 'Ada', span: [0, 3] } }, usage: decision.usage, state_text: null };
    const calls = [];
    const provider = createExtractionProvider({ type: 'openrouter-extraction', model: 'vendor/extract', apiKey: 'fixture',
        fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json(data); } });
    const request = { state: 'Ada', fields };
    const result = await provider.extract(request);
    assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/extractions');
    assert.equal(Object.hasOwn(result.extraction, 'truncated'), false);
    assert.equal(result.extraction.state_text, null);
    assert.deepEqual(provider.validateResult(result, request), result);
    assert.throws(() => provider.validateResult({ ...result, meta: { ...result.meta, provider: 'cloudflare-extraction' } }, request));
    await provider.createExtraction({ state: 'document-ref', fields,
        assets: { 'document-ref': { type: 'document', format: 'pdf', data_base64: btoa('%PDF-1.7\nfixture') } } });
    assert.equal(calls[1].body.assets['document-ref'].format, 'pdf');
    await provider.extract({ fields, images: [image] });
    assert.equal(Object.keys(calls[2].body.assets).length, 1);
    assert.equal((await extractBatch(provider, [request]))[0].ok, true);
});
