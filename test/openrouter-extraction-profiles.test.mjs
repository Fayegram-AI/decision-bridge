// Extraction fixtures cover adapter-specific fields/assets and reusable common snapshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExtractionProvider, extractBatch } from '../src/extraction/index.mjs';
import { prepareOpenRouterExtraction } from '../src/extraction/openrouter.mjs';
import { validateExtractionStructure } from '../src/extraction/validation.mjs';
import { image, asset } from './jev-fixtures.mjs';

const fields = { name: { type: 'text' } };
const webpBytes = Buffer.alloc(30);
webpBytes.write('RIFF'); webpBytes.writeUInt32LE(22, 4); webpBytes.write('WEBPVP8X', 8); webpBytes.writeUInt32LE(10, 16);
const webp = { type: 'image', format: 'webp', data_base64: webpBytes.toString('base64') };
const pdf = { type: 'document', format: 'pdf', data_base64: btoa('%PDF-1.7\nfixture') };
const native = (request, model = 'cloudflare/clairic') => prepareOpenRouterExtraction({ model, fields, ...request });

test('asset-only extraction accepts omitted/empty state and does not require references', () => {
    for (const state of [undefined, '']) {
        const request = { ...(state === undefined ? {} : { state }), assets: { photo: asset, second: webp } };
        const snapshot = structuredClone(request);
        const prepared = native(request);
        assert.equal(prepared.state, state);
        assert.equal(Object.keys(prepared.assets).length, 2);
        assert.deepEqual(request, snapshot);
    }
    assert.throws(() => native({}), { code: 'VALIDATION_ERROR' });
    assert.throws(() => native({ state: null, assets: { photo: asset } }));
    assert.throws(() => native({ state: 'Read the invoice', assets: { photo: asset } }));
    native({ state: 'Read photo', assets: { photo: asset } });
    native({ state: 'Read the invoice', assets: { photo: asset }, fields: { name: { type: 'text', instructions: 'Read photo' } } });
    for (const state of ['photo', undefined]) {
        assert.throws(() => native({ state, assets: { photo: asset, second: webp },
            fields: { name: { type: 'text', instructions: 'photo' } } }));
    }
});

test('Clairic, ScaleDown and text-only extraction profiles enforce media formats', () => {
    native({ assets: { photo: webp } });
    assert.throws(() => native({ assets: { file: pdf } }), { code: 'UNSUPPORTED_CAPABILITY' });
    for (const file of [pdf, asset]) {
        native({ assets: { file } }, 'scaledown/extract');
        native({ state: 'file', assets: { file } }, 'scaledown/extract');
        assert.throws(() => native({ state: 'Read file', assets: { file } }, 'scaledown/extract'));
    }
    assert.throws(() => native({ assets: { file: webp } }, 'scaledown/extract'), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.throws(() => native({ assets: { a: asset, b: asset } }, 'scaledown/extract'));
    for (const model of ['inception/mercury-decide', 'inference-net/schematron-v2-small', 'inference-net/schematron-v2-turbo',
        'levanto/sage-2', 'perplexity/pplx-decider-v1.3', 'perplexity/pplx-decider-flash-v1.3:free']) {
        assert.throws(() => native({ assets: { file: asset } }, model), { code: 'UNSUPPORTED_CAPABILITY' });
    }
    native({ assets: { file: pdf } }, 'vendor/future');
});

test('model-aware field rules retain general grammar for unknown extraction IDs', () => {
    for (const type of ['text', 'date', 'time', 'datetime']) native({ state: 'Evidence', fields: { q: { type, unit: 'label', null_threshold: 0.2 } } });
    native({ state: 'Evidence', fields: { q: { type: 'list', items: 'number', integer: true, decimals: 2, unit: 'USD' } } });
    assert.throws(() => validateExtractionStructure({ state: 'Evidence', fields: { q: { type: 'list', items: 'number', integer: true } } }));
    for (const type of ['list', 'estimate', 'forecast']) {
        const spec = type === 'list' ? { type, items: 'text' } : { type, min: 0, max: 1, ...(type === 'forecast' ? { horizon: 2, interval: 'day' } : {}) };
        native({ state: 'Evidence', fields: { q: spec } });
        assert.throws(() => native({ state: 'Evidence', fields: { q: { ...spec, null_threshold: 0.5 } } }), { code: 'UNSUPPORTED_CAPABILITY' });
    }
    assert.throws(() => native({ state: 'Evidence', fields: { q: { type: 'text', null_threshold: 0 } } }));
    for (const model of ['inference-net/schematron-v2-small', 'levanto/sage-2', 'perplexity/pplx-decider-v1.3:free', 'scaledown/extract']) {
        for (const q of [{ type: 'text', unit: 'label' }, { type: 'list', items: 'text', unit: 'label' },
            { type: 'list', items: 'text', null_threshold: 0.5 }]) assert.throws(() => native({ state: 'Evidence', fields: { q } }, model), { code: 'UNSUPPORTED_CAPABILITY' });
        assert.throws(() => native({ state: 'Evidence', reference_date: '2026-11-13' }, model), { code: 'UNSUPPORTED_CAPABILITY' });
    }
    for (const model of ['inference-net/schematron-v2-turbo', 'levanto/sage-2']) {
        native({ state: 'Evidence', fields: { q: { type: 'number', integer: true } } }, model);
        assert.throws(() => native({ state: 'Evidence', fields: { q: { type: 'number', unit: 'USD' } } }, model));
    }
    for (const model of ['inception/mercury-decide', 'perplexity/pplx-decider-flash-v1.3', 'scaledown/extract']) {
        native({ state: 'Evidence', fields: { q: { type: 'list', items: 'text' } } }, model);
        for (const q of [{ type: 'date' }, { type: 'list', items: 'number' }]) assert.throws(() => native({ state: 'Evidence', fields: { q } }, model));
    }
    native({ state: 'Evidence', fields: { q: { type: 'list', items: 'number', integer: false, unit: 'label', null_threshold: 0 } } }, 'vendor/future');
    for (const q of [{ type: 'list', items: 'text', integer: true }, { type: 'text', integer: true },
        { type: 'number', decimals: 7 }, { type: 'forecast', min: 0, max: 1, horizon: 65, interval: 'day' }]) {
        assert.throws(() => native({ state: 'Evidence', fields: { q } }, 'vendor/future'));
    }
});

test('common image-only extraction, WebP and optional spans survive batches and saved validation', async () => {
    const bodies = [];
    const provider = createExtractionProvider({ type: 'openrouter-extraction', model: 'cloudflare/clairic', apiKey: 'fixture',
        fetchImpl: async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            return Response.json({ model: 'served', answers: { names: { type: 'list', value: ['Ada', 'Lin'], spans: [null, [0, 3]], source: 'image', spell_confidence: 0.93751 } },
                usage: { input_tokens: 1, output_tokens: 0 }, state_text: null });
        } });
    const request = { images: [image, 'data:image/webp;base64,' + webp.data_base64], fields: { names: { type: 'list', items: 'text', unit: 'label' } } };
    const snapshot = structuredClone(request);
    const validated = provider.validate(request);
    const result = await provider.extract(validated);
    assert.equal(bodies[0].state, undefined);
    assert.equal(Object.keys(bodies[0].assets).length, 2);
    assert.equal(result.extraction.answers.names.spell_confidence, 0.93751);
    assert.deepEqual(provider.validateResult(JSON.parse(JSON.stringify(result)), validated), result);
    assert.equal((await extractBatch(provider, [validated]))[0].ok, true);
    assert.deepEqual(request, snapshot);
    const withText = { ...request, state: 'Read the receipts' };
    await provider.extract(withText);
    assert(bodies.at(-1).state.includes('__decision_bridge_image_0__'));
    assert.deepEqual(provider.validate(validated), validated);
});
