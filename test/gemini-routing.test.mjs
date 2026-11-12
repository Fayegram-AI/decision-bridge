/** Google routing preserves pure eligibility, media redaction and local recovery. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiDecisionsProvider, noul } from '../src/index.mjs';
import { createDecisionRouter, evaluateRoutedBatch } from '../src/routing/index.mjs';
import { geminiResponse, pdf } from './gemini-fixtures.mjs';

const request = { input: [{ type: 'document', dataUrl: pdf },
    { type: 'audio', url: 'https://media.example/a.ogg?secret=signed', mimeType: 'audio/ogg' }], questions: { q: noul('Present?') } };
const config = fetchImpl => ({ type: 'gemini-decisions', apiKey: 'fixture', fetchImpl });
const reply = async (_url, init) => Response.json(geminiResponse(JSON.parse(init.body)));

test('Gemini configured and supplied targets support document eligibility and local batches', async () => {
    let calls = 0;
    const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['google', 'other'],
            rules: [{ effect: 'require', when: { modalities: ['document'] }, routes: ['google'] }] },
        google: { config: config(async (...args) => { calls++; return reply(...args); }) },
        other: { config: { type: 'openai-decisions', apiKey: 'fixture', fetchImpl: async () => { throw Error('Unsupported target called'); } } },
    } });
    assert.equal(router.inspect(request).selectedRoute, 'google');
    assert.equal(calls, 0);
    const result = await router.evaluate(request);
    assert.equal(result.meta.routing.selectedRoute, 'google');
    assert.equal(result.meta.schemaVersion, 7);
    assert((await evaluateRoutedBatch(router, [request, request])).every(row => row.ok));
    assert.equal(calls, 3);
    const supplied = createDecisionRouter({ routes: { google: { provider: new GeminiDecisionsProvider({ apiKey: 'fixture', fetchImpl: reply }) } } });
    assert.equal((await supplied.evaluate(request, { route: 'google' })).model, 'gemini-decision-1');
});

test('selector context exposes media metadata without PDF payloads or signed URLs', async () => {
    let selected = 0;
    const selector = { kind: 'decision', name: 'selector', defaultModel: 'selector-model', async evaluate(input) {
        selected++;
        const text = JSON.stringify(input.state);
        assert(!text.includes('media.example') && !text.includes('signed') && !text.includes('JVBER'));
        assert(text.includes('application/pdf') && text.includes('audio/ogg'));
        const answers = Object.fromEntries(Object.entries(input.questions).map(([id, q]) => {
            const keys = Object.keys(q.criteria);
            return [id, { type: 'choice', choice: keys[0], probabilities: Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0])) }];
        }));
        return { model: input.model, answers, usage: { input_tokens: 1, output_tokens: 0 } };
    } };
    const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
        auto: { policy: 'decision-assisted', candidates: ['a', 'b'], selector: { route: 'selector', minProbability: 0.5, minMargin: 0.1 } },
        a: { config: config(reply) },
        b: { config: config(async (...args) => reply(...args)) },
        selector: { provider: selector },
    } });
    assert.equal((await router.evaluate(request)).meta.routing.method, 'selector');
    assert.equal(selected, 1);
});

test('Google admission errors fail over once and unsupported question media remains ineligible', async () => {
    let rejected = 0;
    const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['a', 'b'], priority: ['a', 'b'],
            failover: { routes: ['b'], maxAttempts: 2 } },
        a: { config: config(async () => { rejected++; return Response.json({ error: { code: 503 } }, { status: 503 }); }) },
        b: { config: config(reply) },
    } });
    assert.equal((await router.evaluate(request)).meta.routing.selectedRoute, 'b');
    assert.equal(rejected, 1);
    const imageQuestion = { state: 'x', questions: { q: { type: 'noul', instructionParts: [{ type: 'image', dataUrl: 'data:image/png;base64,YQ==' }] } } };
    assert.equal(router.inspect(imageQuestion).outcome, 'impossible');
    assert.throws(() => createDecisionRouter({ routes: { bad: { config: { ...config(reply), model: 'unsupported' } } } }), { code: 'UNSUPPORTED_CAPABILITY' });
});
