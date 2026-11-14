// Native provider failures, saved envelopes and generated configuration boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDecisionRouter, createExtractionRouter } from '../src/routing/index.mjs';
import { createExtractionProvider, extractBatch } from '../src/extraction/index.mjs';
import { initialize } from '../src/cli/initialize.mjs';
import { decisionProfile } from '../src/cli/decisions.mjs';
import { extractionProfile } from '../src/cli/extractions.mjs';
import { temporaryWorkspace } from './support.mjs';
import { createProvider } from '../src/index.mjs';
import { asset, image } from './jev-fixtures.mjs';

const usage = { input_tokens: 1, output_tokens: 0 };
const questions = { q: { type: 'noul', instructions: 'True?' } };
const forecast = { type: 'forecast', min: 0, max: 10, horizon: 2, interval: 'day' };
const extraction = fetchImpl => createExtractionProvider({ type: 'openrouter-extraction', model: 'vendor/model', apiKey: 'fixture', fetchImpl });

test('OpenRouter routes canonicalize request models and retain request-selected model support', async () => {
    for (const extracting of [false, true]) for (const hasDefault of [false, true]) {
        let calls = 0;
        const model = extracting ? 'cloudflare/clairic' : 'google/gemini-decision-1';
        const router = (extracting ? createExtractionRouter : createDecisionRouter)({ defaultRoute: 'p', routes: {
            p: { config: { type: extracting ? 'openrouter-extraction' : 'openrouter-decisions',
                ...(hasDefault ? { model } : {}), apiKey: 'fixture', fetchImpl: async (_url, init) => {
                    calls++;
                    assert.equal(JSON.parse(init.body).model, model);
                    return Response.json({ model: 'served', answers: { q: extracting ? { type: 'text', value: 'Ada' }
                        : { type: 'noul', noul: 0.5 } }, usage });
                } } },
        } });
        const request = { model: ' ' + model + ' ', ...(extracting ? { fields: { q: { type: 'text' } }, images: [image] }
            : { questions, input: [{ type: 'document', dataUrl: 'data:text/csv;base64,YQ==' }] }) };
        const snapshot = structuredClone(request);
        assert.equal(router.inspect(request).selectedRoute, 'p');
        assert.equal(calls, 0);
        await router[extracting ? 'extract' : 'evaluate'](request);
        assert.equal(calls, 1);
        assert.deepEqual(request, snapshot);
    }
});

test('validated OpenRouter extraction requests remain reusable across common operations', async () => {
    const bodies = [];
    const provider = extraction(async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return Response.json({ model: 'served', answers: { q: { type: 'text', value: 'Ada' } }, usage });
    });
    for (const images of [undefined, [image]]) {
        const input = { model: ' vendor/model ', state: 'Ada', fields: { q: { type: 'text' } },
            ...(images ? { images } : {}) };
        const snapshot = structuredClone(input);
        const validated = provider.validate(input);
        assert.deepEqual(validated, { ...snapshot, model: 'vendor/model' });
        assert.deepEqual(provider.validate(validated), validated);
        assert.deepEqual(input, snapshot);
        assert(Object.isFrozen(validated) && Object.isFrozen(validated.fields));
        assert.equal(bodies.length, images ? 3 : 0);
        const result = await provider.extract(validated);
        assert.deepEqual(provider.validateResult(result, validated), result);
        assert.equal((await extractBatch(provider, [validated]))[0].ok, true);
        const router = createExtractionRouter({ defaultRoute: 'extract', routes: {
            extract: { operation: 'extraction', provider },
        } });
        assert.equal((await router.extract(validated)).meta.provider, 'openrouter-extraction');
        assert.equal(Object.keys(bodies.at(-1).assets ?? {}).length, images ? 1 : 0);
        assert.equal(Object.hasOwn(bodies.at(-1), 'images'), false);
        if (images) assert(Object.isFrozen(validated.images));
    }
    assert.equal(bodies.length, 6);
});

test('native OpenRouter rejects explicit invalid models before selecting a default', async () => {
    for (const extracting of [false, true]) {
        let calls = 0;
        const provider = (extracting ? createExtractionProvider : createProvider)({
            type: extracting ? 'openrouter-extraction' : 'openrouter-decisions', model: 'vendor/default', apiKey: 'fixture',
            fetchImpl: async (_url, init) => {
                calls++;
                assert.equal(JSON.parse(init.body).model, 'vendor/default');
                return Response.json({ model: 'served', usage,
                    answers: { q: extracting ? { type: 'text', value: 'Ada' } : { type: 'noul', noul: 0.5 } } });
            },
        });
        const request = { state: 'Ada', ...(extracting ? { fields: { q: { type: 'text' } } } : { questions }) };
        const run = input => provider[extracting ? 'createExtraction' : 'createDecision'](input);
        for (const model of [null, '', 123, [], {}]) {
            await assert.rejects(run({ ...request, model }), { code: 'VALIDATION_ERROR' });
        }
        assert.equal(calls, 0);
        await run(request);
        assert.equal(calls, 1);
    }
});

test('native OpenRouter identifier limits count Unicode characters in both protocols', async () => {
    for (const extracting of [false, true]) {
        const calls = [];
        const provider = (extracting ? createExtractionProvider : createProvider)({
            type: extracting ? 'openrouter-extraction' : 'openrouter-decisions', model: 'vendor/model', apiKey: 'fixture',
            fetchImpl: async (_url, init) => {
                calls.push(JSON.parse(init.body));
                return Response.json({ model: 'served', usage,
                    answers: { q: extracting ? { type: 'text', value: 'Ada' } : { type: 'noul', noul: 0.5 } } });
            },
        });
        const request = { state: 'Evidence', ...(extracting ? { fields: { q: { type: 'text' } } } : { questions }) };
        const run = input => provider[extracting ? 'createExtraction' : 'createDecision'](input);
        for (const identifier of ['a'.repeat(256), '\u{1f600}'.repeat(256)]) {
            await run({ ...request, session_id: identifier, user: identifier });
            assert.equal(calls.at(-1).session_id, identifier);
            assert.equal(calls.at(-1).user, identifier);
        }
        for (const field of ['session_id', 'user']) {
            for (const identifier of ['a'.repeat(257), '\u{1f600}'.repeat(257), null, 123]) {
                await assert.rejects(run({ ...request, [field]: identifier }), { code: 'VALIDATION_ERROR' });
            }
        }
        assert.equal(calls.length, 2);
    }
});

for (const kind of ['decision', 'extraction']) test(`OpenRouter ${kind} recovery classifies rejections without retrying ambiguous failures`, async () => {
    const extracting = kind === 'extraction';
    const request = extracting ? { state: 'Ada', fields: { q: { type: 'text' } } } : { state: 'Evidence', questions };
    const response = { model: 'served', answers: { q: extracting ? { type: 'text', value: 'Ada' } : { type: 'noul', noul: 0.5 } }, usage };
    for (const status of [429, 503, 402, 500, 502]) {
        const calls = [];
        const config = name => ({ type: extracting ? 'openrouter-extraction' : 'openrouter-decisions', model: 'vendor/model', apiKey: 'fixture',
            fetchImpl: async (_url, init) => {
                calls.push(name); assert.equal(JSON.parse(init.body).provider.allow_fallbacks, false);
                return name === 'a' ? Response.json({ error: { code: status, message: 'private upstream input' } },
                    { status, headers: { 'retry-after': '2' } }) : Response.json(response);
            } });
        const router = (extracting ? createExtractionRouter : createDecisionRouter)({ defaultRoute: 'auto', routes: {
            auto: { policy: 'deterministic', candidates: ['a', 'b'], priority: ['a'], failover: { routes: ['b'] } },
            a: { config: config('a') }, b: { config: config('b') },
        } });
        const run = options => router[extracting ? 'extract' : 'evaluate'](request, options);
        if ([429, 503].includes(status)) {
            const result = await run();
            assert.deepEqual(calls, ['a', 'b']);
            assert.equal(result.meta.routing.selectedRoute, 'b');
            assert.equal(result.meta.routing.attempts[0].code, status === 429 ? 'RATE_LIMITED' : 'CAPACITY_EXCEEDED');
        } else {
            await assert.rejects(run(), error => error.status === status && !JSON.stringify(error).includes('private upstream input'));
            assert.deepEqual(calls, ['a']);
        }
        await assert.rejects(run({ route: 'a' }), error => error.status === status && error.attempts === 1 && error.retryAfterMs === 2000);
    }
});

test('OpenRouter saved extraction uses the same normalized model identity as dispatch', async () => {
    const provider = extraction(async () => Response.json({ model: 'served', answers: { q: { type: 'text', value: 'Ada' } }, usage }));
    const request = { model: ' vendor/model ', state: 'Ada', fields: { q: { type: 'text' } } };
    const result = await provider.extract(request);
    assert.deepEqual(provider.validateResult(result, request), result);
    assert.throws(() => provider.validateResult(result, { ...request, model: 'vendor/different' }), { code: 'INVALID_RESPONSE' });
});

test('OpenRouter forecast values and predictive members are validated on dispatch and saved replay', async () => {
    let answer = { type: 'forecast', value: [1, 2], guess: [1, 2], mean: [1, 2],
        steps: [{ value: 1, quantiles: [0, 1, 2], p_below: 0.1 }, { value: null }], provider_extension: { retained: true } };
    const provider = extraction(async () => Response.json({ model: 'served', answers: { q: answer }, usage }));
    const request = { state: 'Evidence', fields: { q: forecast } };
    const result = await provider.extract(request);
    assert.deepEqual(provider.validateResult(result, request), result);
    for (const changes of [{ value: 'bad' }, { value: [false] }, { guess: [null] }, { mean: {} },
        { steps: [null] }, { steps: [{}] }, { steps: [{ value: true }] },
        { steps: [{ value: 1, quantiles: [false] }] }, { steps: [{ value: 1, p_above: 2 }] }]) {
        answer = { ...result.extraction.answers.q, ...changes };
        await assert.rejects(provider.createExtraction(request), { code: 'INVALID_RESPONSE' });
        assert.throws(() => provider.validateResult({ ...result, extraction: { ...result.extraction, answers: { q: answer } } }, request),
            { code: 'INVALID_RESPONSE' });
    }
    answer = { type: 'forecast', value: null };
    assert.equal((await provider.createExtraction(request)).extraction.answers.q.value, null);
    answer = { type: 'forecast', value: ['2026-11-04', '2026-11-05'] };
    await provider.createExtraction({ ...request, fields: { q: { ...forecast, min: '2026-11-01', max: '2026-12-01' } } });
});

test('OpenRouter extraction applies native precision and horizon bounds before dispatch', async () => {
    let calls = 0;
    const provider = extraction(async () => { calls++; throw Error('Unexpected dispatch'); });
    for (const spec of [{ ...forecast, horizon: 65 }, { type: 'number', decimals: 7 },
        { type: 'duration', decimals: 7 }, { type: 'list', items: 'number', decimals: 7 }]) {
        await assert.rejects(provider.createExtraction({ state: 'Evidence', fields: { q: spec } }), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(calls, 0);
    assert.doesNotThrow(() => provider.validate({ state: 'Evidence', fields: { q: { ...forecast, horizon: 64 }, n: { type: 'number', decimals: 6 } } }));
});

test('native OpenRouter initialization inherits configurable routing preferences', async t => {
    const cwd = await temporaryWorkspace(t);
    for (const provider of ['openrouter-decisions', 'openrouter-extraction']) {
        const directory = join(cwd, provider);
        const config = { provider, model: 'vendor/model', providerPreferences: { only: ['chosen'], allow_fallbacks: true } };
        await initialize(directory, config, true);
        const generated = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
        const profile = provider.endsWith('extraction') ? extractionProfile(provider) : decisionProfile(provider);
        for (const allow_fallbacks of [true, false]) {
            const prepared = profile.native(generated, { model: config.model, providerPreferences: { ...config.providerPreferences, allow_fallbacks } });
            assert.deepEqual(prepared.provider, { only: ['chosen'], allow_fallbacks });
        }
    }
});

test('OpenRouter validates reserved-name image assets in both native protocols', async () => {
    for (const extracting of [false, true]) {
        let calls = 0;
        const options = { model: 'cloudflare/clef', apiKey: 'fixture', fetchImpl: async () => {
            calls++; return Response.json({ model: 'served', answers: { q: extracting ? { type: 'text', value: 'Ada' }
                : { type: 'noul', noul: 0.5 } }, usage });
        } };
        const provider = extracting ? createExtractionProvider({ ...options, type: 'openrouter-extraction' })
            : createProvider({ ...options, type: 'openrouter-decisions' });
        const request = { state: extracting ? '__proto__' : ['__proto__'],
            ...(extracting ? { fields: { q: { type: 'text' } } } : { questions }) };
        const run = input => provider[extracting ? 'createExtraction' : 'createDecision'](input);
        await assert.rejects(run({ ...request, assets: Object.fromEntries([
            ['__proto__', { format: 'png', data_base64: 'invalid image' }],
        ]) }), { code: 'VALIDATION_ERROR' });
        assert.equal(calls, 0);
        const references = ['__proto__', 'constructor', 'photo'];
        await run({ ...request, state: extracting ? references.join(' ') : references,
            assets: Object.fromEntries(references.map(ref => [ref, asset])) });
        assert.equal(calls, 1);
    }
});

test('native OpenRouter score legends validate their guidance values', async () => {
    let entry = 7;
    const provider = createProvider({ type: 'openrouter-decisions', apiKey: 'fixture', model: 'vendor/model', fetchImpl: async () =>
        Response.json({ model: 'served', answers: { q: { type: 'score', score: 0, legend: { 0: entry } } }, usage }) });
    const request = { state: 'Evidence', questions: { q: { type: 'score', instructions: 'Rate', criteria: ['One'] } } };
    for (const invalid of [7, false, null]) {
        entry = invalid;
        await assert.rejects(provider.createDecision(request), { code: 'INVALID_RESPONSE' });
    }
    for (const valid of ['One', { label: 'one', detail: ['structured', 1] }, ['One', { value: 1 }]]) {
        entry = valid;
        assert.deepEqual((await provider.createDecision(request)).decision.answers.q.legend[0], valid);
    }
});
