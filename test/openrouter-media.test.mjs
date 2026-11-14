// Offline endpoint-contract fixtures; media payloads are never fetched by the SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, createBridge, validateResult, noul } from '../src/index.mjs';
import { createDecisionRouter, evaluateRoutedBatch } from '../src/routing/index.mjs';
import { taskContext } from '../src/routing/context.mjs';
import { providerCapabilities } from '../src/capabilities.mjs';
import { OPENROUTER_DOCUMENT_TYPES } from '../src/providers/openrouter-profile.mjs';
import { image, asset } from './jev-fixtures.mjs';
import { runCli } from '../src/cli/main.mjs';
import { streams } from './support.mjs';

const questions = { q: noul('Present?') };
const usage = { input_tokens: 3, output_tokens: 0, cost: 0.123456 };
const reply = { model: 'served', answers: { q: { type: 'noul', noul: 0.876543, confidence: 0.765432 } }, usage };
const make = (model, fetchImpl = async () => Response.json(reply), extra = {}) => createProvider({
    type: 'openrouter-decisions', model, apiKey: 'fixture', fetchImpl, ...extra,
});
const input = [{ type: 'image', dataUrl: image }];
const imageModels = ['heygen/heygen-decision-1-turbo', 'heygen/heygen-decision-1',
    'perplexity/pplx-decider-flash-v1.3:free', 'perplexity/pplx-decider-v1.3:free',
    'perplexity/pplx-decider-flash-v1.2', 'perplexity/pplx-decider-v1.2',
    '~perplexity/pplx-decider-flash-latest', '~perplexity/pplx-decider-latest',
    'google/gemini-decision-1', 'morph/reflex', 'baseten/joey-1', 'baseten/mammoth-1', 'baseten/elephant-1',
    'liquid/d1.1', 'liquid/d1-ultra', 'liquid/d1', '~liquid/d1-ultra-latest', '~liquid/d1-latest', 'scaledown/classify-1'];

test('all qualified image profiles share capabilities and common/native codecs', async () => {
    for (const model of imageModels) {
        const provider = make(model, async (_url, init) => {
            assert.deepEqual(JSON.parse(init.body).state, [{ type: 'image_url', image_url: { url: image } }]);
            return Response.json(reply);
        });
        assert.equal(providerCapabilities(provider, model).images, true, model);
        assert.equal((await provider.evaluate({ input, questions })).answers.q.noul, 0.876543);
    }
    for (const model of ['nace-ai/drex-max', 'nace-ai/drex-max-finance', 'respan/span-02', 'vendor/unknown']) {
        const provider = make(model, async () => { throw Error('Unexpected HTTP'); });
        assert.equal(provider.getCapabilities().images, false, model);
        await assert.rejects(provider.evaluate({ input, questions }), { code: 'UNSUPPORTED_CAPABILITY' });
        await assert.rejects(provider.createDecision({ state: [{ type: 'image_url', image_url: { url: image } }], questions }),
            { code: 'UNSUPPORTED_CAPABILITY' });
        await assert.rejects(provider.createDecision({ state: ['ref'], assets: { ref: asset }, questions }), { code: 'UNSUPPORTED_CAPABILITY' });
    }
});

test('Google OpenRouter supports inline/HTTPS media and documents without rewriting references', async () => {
    const remote = 'https://media.example/invoice.PDF?signature=secret%2Bvalue';
    const parts = [{ type: 'image', dataUrl: 'data:image/heic;base64,YQ==', detail: 'high' },
        { type: 'image', url: 'https://media.example/p.png?signed=secret' },
        { type: 'audio', dataUrl: 'data:audio/x-wav;base64,YQ==' },
        { type: 'video', dataUrl: 'data:video/mp4;base64,YQ==' },
        { type: 'video', url: 'https://media.example/p.mp4?signed=secret', mimeType: 'video/mp4' },
        ...Object.values(OPENROUTER_DOCUMENT_TYPES).map(mime => ({ type: 'document', dataUrl: `data:${mime};base64,YQ==` })),
        { type: 'document', url: remote }];
    const original = structuredClone(parts);
    const provider = make('google/gemini-decision-1', async (_url, init) => {
        const state = JSON.parse(init.body).state;
        assert.deepEqual(state.slice(0, 5), [
            { type: 'image_url', image_url: { url: parts[0].dataUrl, detail: 'high' } },
            { type: 'image_url', image_url: { url: parts[1].url } },
            { type: 'input_audio', input_audio: { data: 'YQ==', format: 'wav' } },
            { type: 'video_url', video_url: { url: parts[3].dataUrl } },
            { type: 'video_url', video_url: { url: parts[4].url } },
        ]);
        assert.equal(state.at(-1).file.file_data, remote);
        return Response.json(reply);
    });
    const result = await createBridge({ provider }).evaluate({ input: parts, questions });
    assert.equal(result.meta.schemaVersion, 7);
    assert.equal(result.meta.openRouter.answers.q.confidence, 0.765432);
    assert.equal(result.meta.openRouter.usage.cost, 0.123456);
    assert.equal(validateResult(JSON.parse(JSON.stringify(result)), questions).answers.q.noul, 0.876543);
    assert.deepEqual(parts, original);
});

test('media profile boundaries reject unsupported controls, MIME types and positions before HTTP', async () => {
    let calls = 0;
    const fail = async () => { calls++; throw Error('Unexpected HTTP'); };
    const google = make('google/gemini-decision-1', fail);
    for (const part of [{ type: 'image', dataUrl: image, resolution: 'high' },
        { type: 'video', dataUrl: 'data:video/mp4;base64,YQ==', resolution: 'low' },
        { type: 'document', url: 'https://media.example/download?filename=a.pdf' },
        { type: 'document', dataUrl: 'data:text/plain;base64,YQ==' },
        { type: 'audio', url: 'https://media.example/a.wav', mimeType: 'audio/wav' },
        { type: 'image', url: 'http://media.example/a.png' },
        { type: 'image', url: 'https://user:password@media.example/a.png' }]) {
        await assert.rejects(google.evaluate({ input: [part], questions }));
    }
    for (const state of [{ nested: { type: 'file', file: { file_data: 'data:application/pdf;base64,YQ==' } } },
        [{ type: 'image_url', image_url: { url: image, resolution: 'high' } }],
        [{ type: 'video_url', video_url: { url: 'data:video/mp4;base64,YQ==', resolution: 'high' } }]]) {
        await assert.rejects(google.createDecision({ state, questions }));
    }
    for (const model of ['heygen/heygen-decision-1', 'scaledown/classify-1', 'cloudflare/clef-omni']) {
        const provider = make(model, fail);
        await assert.rejects(provider.evaluate({ input: [{ type: 'image', url: 'https://media.example/a.png' }], questions }));
    }
    const scaledown = make('scaledown/classify-1', fail);
    for (const part of [{ type: 'image', dataUrl: 'data:image/webp;base64,YQ==' },
        { type: 'document', dataUrl: 'data:text/csv;base64,YQ==' },
        { type: 'document', url: 'https://media.example/a.pdf' }]) await assert.rejects(scaledown.evaluate({ input: [part], questions }));
    assert.equal(calls, 0);
});

test('ScaleDown accepts inline PDF/image files and Google accepts whole-state files', async () => {
    for (const mime of ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff']) {
        const file = 'data:' + mime + ';base64,YQ==';
        const provider = make('scaledown/classify-1', async (_url, init) => {
            assert.equal(JSON.parse(init.body).state[0].file.file_data, file);
            return Response.json(reply);
        });
        await provider.evaluate({ input: [{ type: 'document', dataUrl: file }], questions });
    }
    await make('google/gemini-decision-1').createDecision({ state: { type: 'file', file: { file_data: 'https://media.example/a.docx?signed=secret', filename: 'ignored' } }, questions });
});

test('Jev nesting and PNG/JPEG asset constraints remain separate', async () => {
    const nested = { image: { type: 'image_url', image_url: { url: image } } };
    await make('typesafe/jev-1.14').createDecision({ state: nested, questions });
    await make('typesafe/jev-1.14').createDecision({ state: { photo: 'ref' }, assets: { ref: asset }, questions });
    await assert.rejects(make('google/gemini-decision-1').createDecision({ state: nested, questions }));
    await assert.rejects(make('typesafe/jev-1.14').createDecision({ state: [{ type: 'image_url', image_url: { url: 'data:image/webp;base64,YQ==' } }], questions }));
});

test('document MIME capabilities default custom providers to PDF and validate declarations', async () => {
    const provider = { name: 'custom', kind: 'decision', defaultModel: 'custom', evaluate() {},
        getCapabilities: () => ({ orderedInput: true, documents: true, maxDocuments: null }) };
    assert.deepEqual(providerCapabilities(provider).documentMimeTypes, ['application/pdf']);
    const bridge = createBridge({ provider });
    assert.doesNotThrow(() => bridge.validate({ input: [{ type: 'document', dataUrl: 'data:application/pdf;base64,YQ==' }], questions }));
    assert.throws(() => bridge.validate({ input: [{ type: 'document', dataUrl: 'data:text/csv;base64,YQ==' }], questions }), { code: 'UNSUPPORTED_CAPABILITY' });
    for (const value of [null, ['invalid'], ['text/csv', 'text/csv']]) {
        assert.throws(() => providerCapabilities({ getCapabilities: () => ({ documentMimeTypes: value }) }), { code: 'CONFIGURATION_ERROR' });
    }
});

test('routing document eligibility, batches and context preserve MIME while redacting media', async () => {
    let calls = 0;
    const request = { input: [{ type: 'document', dataUrl: 'data:text/csv;base64,YQ==' },
        { type: 'document', url: 'https://media.example/a.csv?signature=secret' }], questions };
    const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['direct', 'proxy'] },
        direct: { config: { type: 'gemini-decisions', apiKey: 'fixture', fetchImpl: async () => { throw Error('Invalid target'); } } },
        proxy: { provider: make('google/gemini-decision-1', async () => { calls++; return Response.json(reply); }) },
    } });
    assert.equal(router.inspect(request).selectedRoute, 'proxy');
    assert.equal(calls, 0);
    assert((await evaluateRoutedBatch(router, [request, request])).every(row => row.ok));
    assert.equal(calls, 2);
    const context = JSON.stringify(taskContext(request, 'decision'));
    assert(context.includes('text/csv'));
    assert(!context.includes('secret') && !context.includes('media.example') && !context.includes('YQ=='));
});

test('endpoint-specific discovery retains upstream model metadata', async () => {
    for (const api of ['decisions', 'systemone']) {
        const metadata = { id: 'vendor/model', endpoints: ['/api/alpha/decisions'], architecture: { input_modalities: ['text'] }, pricing: { prompt: '1' } };
        const provider = make('vendor/model', async url => {
            assert.equal(new URL(url).searchParams.get('endpoints'), api === 'systemone' ? '/api/v1/systemone' : '/api/alpha/decisions');
            assert.equal(new URL(url).searchParams.has('output_modalities'), false);
            return Response.json({ data: [metadata] });
        }, { api });
        assert.deepEqual((await provider.listModels()).models, [{ ...metadata, name: metadata.id }]);
    }
});

test('OpenRouter profile lookup follows native model normalization without coercing invalid selectors', async () => {
    const padded = ' google/gemini-decision-1 ';
    let calls = 0, coerced = 0;
    const provider = make('google/gemini-decision-1', async (_url, init) => {
        calls++;
        assert.equal(JSON.parse(init.body).model, 'google/gemini-decision-1');
        return Response.json(reply);
    });
    assert.equal(provider.getCapabilities(padded).documents, true);
    const bridge = createBridge({ provider });
    const models = [{ toString() { coerced++; return 'synthetic'; } },
        { [Symbol.toPrimitive]() { coerced++; return 'synthetic'; } }, Symbol('invalid-model')];
    for (const model of models) assert.throws(() => bridge.validate({ model, state: 'Evidence', questions }), { code: 'VALIDATION_ERROR' });
    assert.equal(coerced, 0);
    const request = { model: padded, input: [{ type: 'document', dataUrl: 'data:text/csv;base64,YQ==' }], questions };
    bridge.validate(request);
    assert.equal(calls, 0);
    const result = await bridge.evaluate(request);
    assert.equal(result.meta.requestedModel, padded);
    assert.equal(result.meta.resolvedModel, 'google/gemini-decision-1');
    assert.equal(calls, 1);
});

test('OpenRouter CLI validates media profiles and asset-only extraction without credentials', async () => {
    const invoke = async (args, request) => {
        const io = streams(); io.stdin.end(JSON.stringify(request));
        const code = await runCli(args, { ...io, env: {} });
        return { code, output: io.output(), error: io.error() };
    };
    const args = ['validate', '-', '--provider', 'openrouter-decisions', '--model', 'google/gemini-decision-1'];
    const request = { input: [{ type: 'document', dataUrl: 'data:text/csv;base64,YQ==' }], questions };
    assert.equal((await invoke(args, request)).code, 0);
    assert.equal((await invoke([...args.slice(0, -1), 'cloudflare/clef'], request)).code, 2);
    const extraction = await invoke(['extraction', 'validate', '-', '--native', '--provider', 'openrouter-extraction', '--model', 'cloudflare/clairic'],
        { fields: { q: { type: 'text', unit: 'label' } }, assets: { photo: asset } });
    assert.equal(extraction.code, 0, extraction.error);
});

test('Noul confidence metadata preserves reserved question names without changing probabilities', async () => {
    const provider = make('google/gemini-decision-1', async () => Response.json({ model: 'served', usage,
        answers: Object.fromEntries([['__proto__', { type: 'noul', noul: 0.123456, confidence: 0.654321 }]]) }));
    const result = await provider.evaluate({ state: 'Evidence', questions: Object.fromEntries([['__proto__', noul('Present?')]]) });
    assert.equal(result.answers.__proto__.noul, 0.123456);
    assert.equal(result.meta.openRouter.answers.__proto__.confidence, 0.654321);
});
