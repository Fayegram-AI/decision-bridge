/** Native and common Gemini contracts, including provider-owned failure paths. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiDecisionsProvider, createProvider, createBridge, choice, noul, score, scoreLevels, choiceWithParts,
    DecisionError, publicError } from '../src/index.mjs';
import { validateRequest } from '../src/validation.mjs';
import { providerCapabilities, LEGACY_CAPABILITIES } from '../src/capabilities.mjs';
import { prepareGeminiDecision } from '../src/providers/gemini-input.mjs';
import { validateGeminiDecision } from '../src/providers/gemini-response.mjs';
import { compareUtf8 } from '../src/providers/gemini-profile.mjs';
import { geminiResponse, nativeRequest, usage, pdf } from './gemini-fixtures.mjs';

const provider = extra => new GeminiDecisionsProvider({ apiKey: 'fixture', fetchImpl: async (_url, init) =>
    Response.json(geminiResponse(JSON.parse(init.body))), ...extra });

test('Gemini factory, first-party endpoint, discovery and native identity', async () => {
    const calls = [];
    const backend = createProvider({ type: 'gemini-decisions', apiKey: 'fixture', fetchImpl: async (url, init) => {
        calls.push({ url, init });
        assert.equal(init.headers['x-goog-api-key'], 'fixture');
        assert.equal(init.headers.authorization, undefined);
        return Response.json(init.method === 'GET' ? { name: 'models/gemini-decision-1', displayName: 'Decision' }
            : { ...geminiResponse(JSON.parse(init.body)), extra: 'native metadata' });
    } });
    const result = await backend.createDecision(nativeRequest);
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/decisions');
    assert.equal(result.decision.extra, 'native metadata');
    assert.equal(result.meta.requestedModel, 'gemini-decision-1');
    assert.equal(result.decision.model, undefined);
    assert(Object.isFrozen(result.decision));
    assert.equal((await backend.listModels()).models[0].resourceName, 'models/gemini-decision-1');
    assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-decision-1');
    await assert.rejects(provider({ fetchImpl: async () => Response.json({ name: 'wrong' }) }).listModels(), { code: 'INVALID_RESPONSE' });
    assert.equal(backend.getCapabilities('other-model').supported, false);
    assert.throws(() => provider({ model: 'other-model' }), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.throws(() => provider({ model: null }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(backend.createDecision({ ...nativeRequest, model: null }), { code: 'VALIDATION_ERROR' });
});

test('Gemini environment aliases prefer the SDK-scoped key without custom-origin inheritance', async t => {
    const name = 'GEMINI_API_KEY';
    const scoped = 'DECISION_BRIDGE_GEMINI_API_KEY';
    const previous = new Map([name, scoped].map(key => [key, process.env[key]]));
    t.after(() => {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    });
    delete process.env[name];
    process.env[scoped] = 'preferred-fixture';
    assert.equal(new GeminiDecisionsProvider().defaultModel, 'gemini-decision-1');
    process.env[name] = 'environment-fixture';
    assert.equal(new GeminiDecisionsProvider().defaultModel, 'gemini-decision-1');
    let calls = 0;
    const backend = new GeminiDecisionsProvider({ fetchImpl: async (_url, init) => {
        calls++;
        assert.equal(init.headers['x-goog-api-key'], 'preferred-fixture');
        return Response.json(geminiResponse(JSON.parse(init.body)));
    } });
    await backend.createDecision(nativeRequest);
    assert.equal(calls, 1);
    assert.throws(() => new GeminiDecisionsProvider({ baseURL: 'https://proxy.example' }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(new GeminiDecisionsProvider({ baseURL: 'http://127.0.0.1', apiKey: 'explicit' }).defaultModel, 'gemini-decision-1');
    assert.throws(() => provider({ maxRequestBytes: 167772161 }), { code: 'CONFIGURATION_ERROR' });
});

test('common mappings preserve typed values, labels, JSON and original question names', async () => {
    const request = { state: { fact: true }, questions: Object.fromEntries([
        ['a question / 名', choice('Select', [{ value: true }, { value: 'true', description: { meaning: 'string' } }])],
        ['__proto__', noul({ check: 'present' }, { true: { yes: true } })],
        ['scale', score('Rate', ['low', { meaning: 'high' }])],
        ['labels', scoreLevels('Rate', [{ label: 'L', description: 'low' }, { label: 'H', description: 'high' }])],
        ['record', choice('Select', { '😀': '', ' z ': null, a: { meaning: 'A' } })],
    ]) };
    const original = structuredClone(request);
    const backend = provider({ fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.input, '{"fact":true}');
        assert.deepEqual(Object.keys(body.questions), ['q000', 'q001', 'q002', 'q003', 'q004']);
        assert.deepEqual(body.questions.q001.criteria, { true_description: '{"yes":true}' });
        assert.equal(JSON.parse(body.questions.q000.criteria.o000).value, true);
        assert.equal(JSON.parse(body.questions.q000.criteria.o001).value, 'true');
        return Response.json({ ...geminiResponse(body), prompt_feedback: {} });
    } });
    const result = await createBridge({ provider: backend }).evaluate(request);
    assert.equal(result.answers['a question / 名'].choice, true);
    assert.deepEqual(result.answers['a question / 名'].probabilities, [{ value: true, probability: 0.8 }, { value: 'true', probability: 0.2 }]);
    assert.equal(result.answers.__proto__.noul, 0.8);
    assert.deepEqual(result.answers.scale.legend['1'], { meaning: 'high' });
    assert.equal(result.answers.labels.legend['1'].label, 'H');
    assert.equal(result.answers.record.choice, ' z ');
    assert.equal(result.meta.geminiDecisions.answers.__proto__.confidence, 0.8);
    assert.equal(result.meta.modelSource, 'requested');
    assert.equal(result.meta.geminiDecisions.usage.total_output_tokens, 0);
    assert.deepEqual(request, original);
    assert(compareUtf8('a', 'a') === 0 && compareUtf8('a', 'aa') < 0);
    assert(compareUtf8('\uE000', '😀') < 0);
});

test('Google text question parts concatenate without altering caller separators', async () => {
    const backend = provider({ fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.deepEqual(body.input, [{ type: 'text', text: 'before ' }, { type: 'text', text: '{"fact":1}' }, { type: 'text', text: ' after' }]);
        assert.deepEqual(body.questions.q000.instructions, [{ type: 'text', text: 'Check ' }, { type: 'text', text: '{"rule":true}' }]);
        return Response.json(geminiResponse(body));
    } });
    await backend.evaluate({ input: [{ type: 'text', text: 'before ' }, { type: 'json', data: { fact: 1 } }, { type: 'text', text: ' after' }],
        questions: { q: choiceWithParts([{ type: 'text', text: 'Check ' }, { type: 'json', data: { rule: true } }], { a: '', b: '' }) } });
});

test('common inline and remote media round trip with schema 7 and immutable signed references', async () => {
    const signed = 'https://media.example/file?signature=a%2Fb&expires=7';
    const input = [{ type: 'document', dataUrl: pdf }, { type: 'document', url: signed },
        { type: 'image', url: signed, mimeType: 'image/jpeg', detail: 'high' },
        { type: 'image', dataUrl: 'data:image/png;base64,YQ==', detail: 'auto' },
        { type: 'audio', url: signed, mimeType: 'audio/ogg' },
        { type: 'video', url: signed, mimeType: 'video/webm' },
        { type: 'audio', dataUrl: 'data:audio/wav;base64,YQ==' }, { type: 'video', dataUrl: 'data:video/mp4;base64,YQ==' }];
    const backend = provider({ fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.input[0].mime_type, 'application/pdf');
        assert.equal(body.input[1].uri, signed);
        assert.equal(body.input[2].resolution, 'high');
        assert.equal(Object.hasOwn(body.input[3], 'resolution'), false);
        assert.equal(body.input[4].mime_type, 'audio/ogg');
        return Response.json(geminiResponse(body));
    } });
    const result = await createBridge({ provider: backend }).evaluate({ input, questions: { yes: noul('Present?') } });
    assert.equal(result.meta.schemaVersion, 7);
    assert.deepEqual(backend.getCapabilities().questionContentTypes, ['text', 'json']);
});

test('capability failures and media declarations are rejected before dispatch', async () => {
    let calls = 0;
    const backend = provider({ fetchImpl: async () => { calls++; throw Error('Unexpected call'); } });
    const questions = { yes: noul('Present?') };
    for (const input of [
        [{ type: 'image', url: 'https://example.com/a.png' }],
        [{ type: 'image', dataUrl: 'data:image/png;base64,YQ==', detail: 'original' }],
        [{ type: 'audio', url: 'https://example.com/audio' }],
        [{ type: 'document', dataUrl: 'data:application/octet-stream;base64,YQ==' }],
        [{ type: 'video', url: 'http://example.com/video', mimeType: 'video/mp4' }],
        [{ type: 'document', url: 'https://example.com/a.pdf#page=1' }],
        [{ type: 'audio', dataUrl: 'data:audio/wav;base64,YQ==', mimeType: 'audio/wav' }],
    ]) await assert.rejects(backend.evaluate({ input, questions }));
    await assert.rejects(backend.evaluate({ state: 'x', questions, promptCacheKey: 'key' }), { code: 'UNSUPPORTED_CAPABILITY' });
    await assert.rejects(backend.evaluate({ conversation: [{ role: 'user', content: 'x' }], questions }), { code: 'UNSUPPORTED_CAPABILITY' });
    await assert.rejects(backend.evaluate({ state: 'x', questions: { q: choiceWithParts([{ type: 'image', dataUrl: 'data:image/png;base64,YQ==' }], { a: '', b: '' }) } }),
        { code: 'UNSUPPORTED_CAPABILITY' });
    assert.equal(calls, 0);
    assert.equal(providerCapabilities({ getCapabilities: () => ({ questionContent: true }) }).questionContentTypes.length, 3);
    assert.throws(() => providerCapabilities({ getCapabilities: () => ({ ...LEGACY_CAPABILITIES, questionContentTypes: ['audio'] }) }), { code: 'CONFIGURATION_ERROR' });
});

test('native media shapes, resolutions, criteria and structural limits', () => {
    const accepted = [
        'text', { type: 'text', text: 'text' },
        { type: 'image', data: 'YQ==', mime_type: 'image/heic', resolution: 'ultra_high' },
        { type: 'audio', uri: 'https://example.com/a.opus', mime_type: 'audio/opus' },
        { type: 'video', data: 'YQ==', mime_type: 'video/mp4', resolution: 'medium' },
        { type: 'document', uri: 'https://generativelanguage.googleapis.com/v1beta/files/one', mime_type: 'application/pdf' },
    ];
    for (const input of accepted) assert.equal(prepareGeminiDecision({ ...nativeRequest, input }).model, 'gemini-decision-1');
    assert(prepareGeminiDecision({ input: 'x', questions: {
        a: { type: 'noul', instructions: { type: 'text', text: 'Check' }, criteria: { false_description: '' } },
        b: { type: 'choice', instructions: [{ type: 'text', text: 'Check' }], criteria: { 'Option A': '', '😀': 'B' } },
        c: { type: 'score', instructions: 'Rate', criteria: ['low', 'high'] },
    } }));
    const invalid = [
        { ...nativeRequest, model: null }, { ...nativeRequest, input: '' }, { ...nativeRequest, input: [] },
        { ...nativeRequest, input: [{ type: 'text', text: '' }] },
        { ...nativeRequest, input: { type: 'audio', data: 'YQ==', uri: 'https://example.com/a', mime_type: 'audio/wav' } },
        { ...nativeRequest, input: { type: 'audio', data: 'YQ==', mime_type: 'audio/unknown' } },
        { ...nativeRequest, input: { type: 'audio', data: 'YQ==', mime_type: 'audio/wav', resolution: 'low' } },
        { ...nativeRequest, input: { type: 'video', uri: 'https://youtu.be/id', mime_type: 'video/mp4' } },
        { ...nativeRequest, input: { type: 'document', uri: 'gs://bucket/file', mime_type: 'application/pdf' } },
        { ...nativeRequest, questions: { 'bad key': nativeRequest.questions.yes } },
        { ...nativeRequest, questions: { q: { type: 'choice', instructions: 'Select', criteria: { ' bad': '', ok: '' } } } },
        { ...nativeRequest, questions: { q: { type: 'choice', instructions: 'Select', criteria: { 'a\u00A0b': '', ok: '' } } } },
        { ...nativeRequest, questions: { q: { type: 'choice', instructions: 'Select', criteria: { ['a'.repeat(129)]: '', ok: '' } } } },
        { ...nativeRequest, questions: { q: { type: 'score', instructions: 'Rate', criteria: [''] } } },
        { ...nativeRequest, questions: { q: { type: 'noul', instructions: [] } } },
        { ...nativeRequest, questions: { q: { type: 'noul', instructions: ' ' } } },
        { ...nativeRequest, questions: { q: { type: 'noul', instructions: [{ type: 'text', text: ' ' }] } } },
        { ...nativeRequest, questions: { q: { type: 'noul', instructions: 'Check', criteria: { true_description: 1 } } } },
        { ...nativeRequest, questions: {} },
        { ...nativeRequest, questions: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => ['q' + i, nativeRequest.questions.yes])) },
    ];
    for (const request of invalid) assert.throws(() => prepareGeminiDecision(request));
    assert.throws(() => prepareGeminiDecision(nativeRequest, { maxRequestBytes: 2 }), { code: 'REQUEST_TOO_LARGE' });
    assert.throws(() => validateRequest({ input: [{ type: 'image', dataUrl: 'data:image/png;base64,YQ==', mimeType: 'image/png' }], questions: { q: noul('Check') } }, 'gemini-decision-1'));
});

test('native Unicode option IDs fail preflight without restricting common values', async () => {
    let calls = 0;
    const backend = provider({ fetchImpl: async (_url, init) => {
        calls++;
        return Response.json(geminiResponse(JSON.parse(init.body)));
    } });
    for (const character of ['\u0000', '\u200D', '\uD800', '\uE000', '\u0378', '\u00A0']) {
        await assert.rejects(backend.createDecision({ input: 'Text', questions: {
            q: { type: 'choice', instructions: 'Select', criteria: { ['a' + character + 'b']: '', ok: '' } },
        } }), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(calls, 0);
    await backend.createDecision({ input: 'Text', questions: {
        q: { type: 'choice', instructions: 'Select', criteria: { 'é': '', '😀': '', 'Option A': '' } },
    } });
    const common = await backend.evaluate({ state: 'Text', questions: {
        q: choice('Select', { ['a\u200Db']: '', ok: '' }),
    } });
    assert.equal(common.answers.q.choice, 'a\u200Db');
    assert.equal(calls, 2);
});

test('native answer validation preserves data while rejecting mismatches and blocked feedback', () => {
    const request = prepareGeminiDecision({ input: 'x', questions: {
        yes: { type: 'noul', instructions: 'Check' },
        pick: { type: 'choice', instructions: 'Select', criteria: { a: '', b: '' } },
        rate: { type: 'score', instructions: 'Rate', criteria: ['low', 'high'] },
    } });
    const response = geminiResponse(request);
    assert.deepEqual(validateGeminiDecision(response, request), response);
    const invalid = [
        value => { value.answers.yes.noul = 0; },
        value => { value.answers.yes.confidence = 0.5; },
        value => { value.answers.pick.choice = 'missing'; },
        value => { value.answers.pick.confidence = 0.1; },
        value => { value.answers.pick.probabilities.b = 0.4; },
        value => { value.answers.rate.legend[0] = 'other'; },
        value => { value.answers.rate.score = 10; },
        value => { value.answers.yes.type = 'score'; },
        value => { delete value.answers.yes; },
        value => { value.usage.total_output_tokens = 1; },
        value => { value.usage.total_tokens = -1; },
        value => { value.usage.input_tokens_by_modality = [{ modality: 'text', tokens: -1 }]; },
        value => { value.prompt_feedback = []; },
        value => { value.prompt_feedback = { block_reason: false }; },
    ];
    for (const mutate of invalid) {
        const value = structuredClone(response); mutate(value);
        assert.throws(() => validateGeminiDecision(value, request), { code: 'INVALID_RESPONSE' });
    }
    for (const reason of ['SAFETY', 'safety', 'unknown-reason', 1]) assert.throws(() =>
        validateGeminiDecision({ prompt_feedback: { block_reason: reason } }, request), { code: 'MODEL_REFUSAL' });
    for (const reason of [0, 'BLOCK_REASON_UNSPECIFIED', 'BLOCKED_REASON_UNSPECIFIED', 'UNSPECIFIED']) {
        assert(validateGeminiDecision({ ...response, prompt_feedback: { blockReason: reason } }, request));
    }
    assert.throws(() => validateGeminiDecision(null, request), { code: 'INVALID_RESPONSE' });
});

test('Gemini error diagnostics retain numeric and textual public field contracts', async () => {
    const cases = [
        { status: 400, data: { error: { code: 'safety', message: 'fixture-secret-value' } }, text: 'safety' },
        { status: 200, data: { prompt_feedback: { block_reason: 'SAFETY' } }, text: 'SAFETY' },
        { status: 200, data: { prompt_feedback: { block_reason: 'fixture-secret-value' } }, text: 'content_blocked' },
        { status: 200, data: { prompt_feedback: { block_reason: 1 } }, number: 1 },
        { status: 429, data: { error: { code: 429 } }, number: 429 },
    ];
    for (const fixture of cases) for (const native of [true, false]) {
        const backend = provider({ fetchImpl: async () => Response.json(fixture.data,
            { status: fixture.status, headers: { 'x-request-id': 'diagnostic-1' } }) });
        const operation = native ? backend.createDecision(nativeRequest)
            : backend.evaluate({ state: 'Text', questions: nativeRequest.questions });
        await assert.rejects(operation, error => {
            assert(error instanceof DecisionError);
            assert.equal(error.code, fixture.status === 429 ? 'RATE_LIMITED' : 'MODEL_REFUSAL');
            for (const details of [error, error.toJSON(), publicError(error)]) {
                assert.equal(details.upstreamCode, fixture.number);
                assert.equal(details.upstreamErrorCode, fixture.text);
                assert.equal(details.upstreamCode?.toFixed(0), fixture.number?.toFixed(0));
                assert.equal(details.attempts, 1);
                assert.equal(details.requestId, 'diagnostic-1');
                assert(!JSON.stringify(details).includes('fixture-secret-value'));
            }
            return true;
        });
    }
});

test('provider errors, secret-safe refusals, response metadata and cancellation', async () => {
    for (const [status, error, expected] of [[400, { code: 'safety' }, 'MODEL_REFUSAL'], [429, { code: 429 }, 'RATE_LIMITED'],
        [503, {}, 'CAPACITY_EXCEEDED'], [403, { code: 'untrusted-secret-message' }, 'HTTP_ERROR']]) {
        const backend = provider({ fetchImpl: async () => Response.json({ error: { ...error, message: 'fixture private text' } },
            { status, headers: { 'x-request-id': 'request-1' } }) });
        await assert.rejects(backend.createDecision(nativeRequest), value => {
            assert.equal(value.code, expected);
            assert.equal(value.status, status);
            assert(!JSON.stringify(value).includes('private text'));
            return true;
        });
    }
    const signal = AbortSignal.abort();
    await assert.rejects(provider().createDecision(nativeRequest, { signal }), { code: 'ABORTED' });
    await assert.rejects(provider({ fetchImpl: async () => Response.json({ answers: {}, usage }) }).createDecision(nativeRequest),
        { code: 'INVALID_RESPONSE' });
});
