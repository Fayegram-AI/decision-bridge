/** Additive response fields survive native boundaries and leave common shapes stable. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, createProvider, choice, noul, publicError, validateResult } from '../src/index.mjs';
import { validateNativeResult } from '../src/validation.mjs';
import { normalizeGenerated } from '../src/custom/generative/schema.mjs';
import { validateLiveCommand, validateLiveEvent } from '../src/live/validation.mjs';
import { decisionResponse } from './decisions-fixtures.mjs';
import { geminiResponse } from './gemini-fixtures.mjs';
import { copy, request, response } from './fixtures.mjs';

const extension = { note: 'opaque fixture extension', data: [null, true, 3] };
const common = { state: 'Fixture evidence', questions: { q: noul('True?') } };

test('common projection retains metadata and values without adding variant-specific fields', () => {
    const raw = copy(response);
    raw.extra = extension;
    raw.usage.extra = extension;
    raw.answers.yes.probabilities = [{ extra: extension }];
    raw.answers.route.extra = extension;
    raw.meta = { extra: extension };
    const original = copy(raw);
    const expected = { ...copy(response), meta: { extra: extension } };
    assert.deepEqual(validateResult(raw, request.questions), expected);
    assert.deepEqual(raw, original);
    assert.deepEqual(validateResult(JSON.parse(JSON.stringify(raw)), request.questions), expected);
    assert.deepEqual(validateNativeResult(raw, request.questions), original);

    const questions = { q: choice('Pick.', [{ value: true }, { value: 'true' }]), b: { type: 'box', instructions: 'Target' } };
    const typed = { model: 'fixture', answers: {
        q: { type: 'choice', choice: true, probabilities: [{ value: true, probability: 0.8, extra: extension },
            { value: 'true', probability: 0.2 }], confidence: 0.6, extra: extension },
        b: { type: 'box', box: { top: 0.1, bottom: 0.8, left: 0.2, right: 0.9, extra: extension },
            confidence: 0.7, probabilities: ['ignored'] },
    }, usage: { input_tokens: 1, output_tokens: 0 } };
    const result = validateResult(typed, questions);
    assert.deepEqual(result.answers.q.probabilities, [{ value: true, probability: 0.8 }, { value: 'true', probability: 0.2 }]);
    assert.deepEqual(result.answers.b, { type: 'box', box: { top: 0.1, bottom: 0.8, left: 0.2, right: 0.9 }, confidence: 0.7 });
    assert.equal(result.answers.q.confidence, 0.6);
});

function extendOpenAI(raw) {
    raw.extra = extension;
    for (const answer of raw.answers) {
        answer.extra = extension;
        for (const item of answer.probabilities ?? []) item.extra = extension;
    }
    raw.usage.extra = extension;
    raw.usage.input_tokens_details.extra = extension;
    raw.usage.input_tokens_details.cache_write_tokens_details = { ttl_30m_tokens: 2, ttl_12h_tokens: 0, extra: extension };
    raw.usage.output_tokens_details.extra = extension;
    return raw;
}

test('OpenAI native extensions survive nested responses and full usage metadata', async () => {
    const provider = createProvider({ type: 'openai-decisions', apiKey: 'fixture', fetchImpl: async (_url, init) =>
        Response.json(extendOpenAI(decisionResponse(JSON.parse(init.body)))) });
    const direct = await provider.createDecision({ input: '', questions: [{ type: 'choice', instructions: '',
        choices: [{ value: true }, { value: false }] }] });
    assert.deepEqual(direct.decision.extra, extension);
    assert.deepEqual(direct.decision.answers[0].extra, extension);
    assert.deepEqual(direct.decision.answers[0].probabilities[0].extra, extension);
    assert(Object.isFrozen(direct.decision.extra.data));
    const result = await createBridge({ provider }).evaluate({ state: '', questions: { q: choice('Pick.', [{ value: true }, { value: false }]) } });
    assert.deepEqual(result.meta.openaiDecisions.usage, direct.decision.usage);
    assert.deepEqual(result.answers.q, { type: 'choice', choice: true, confidence: 0.8,
        probabilities: [{ value: true, probability: 0.8 }, { value: false, probability: 0.2 }] });
    assert.equal(Object.hasOwn(result, 'extra'), false);
    assert.equal(Object.hasOwn(result.usage, 'extra'), false);
});

test('OpenAI predicate extensions are opaque during common projection', async () => {
    for (const probabilities of [{ future: true }, [null], 'opaque fixture distribution']) {
        const provider = createProvider({ type: 'openai-decisions', apiKey: 'fixture', fetchImpl: async (_url, init) => {
            const raw = decisionResponse(JSON.parse(init.body));
            raw.answers[0].probabilities = probabilities;
            raw.answers[0].confidence = extension;
            return Response.json(raw);
        } });
        const native = await provider.createDecision({ input: common.state, questions: [{ type: 'predicate', instructions: 'True?' }] });
        assert.deepEqual(native.decision.answers[0].probabilities, probabilities);
        assert.deepEqual(native.decision.answers[0].confidence, extension);
        const result = await createBridge({ provider }).evaluate(common);
        assert.deepEqual(result.answers.q, { type: 'noul', noul: 0.7 });
        assert.deepEqual(result.meta.openaiDecisions.answers.q, { type: 'predicate' });
    }
});

test('Cloudflare Noul extensions do not become typed confidence metadata', async () => {
    const raw = { model: 'served', answers: { q: { type: 'noul', noul: 0.8, confidence: extension, probabilities: extension } },
        usage: { input_tokens: 1, output_tokens: 0 } };
    const provider = createProvider({ type: 'cloudflare-decisions', accountId: 'fixture', apiKey: 'fixture',
        fetchImpl: async () => Response.json({ success: true, result: raw }) });
    const native = await provider.createDecision(common);
    assert.deepEqual(native.decision.answers.q, raw.answers.q);
    const result = await createBridge({ provider }).evaluate(common);
    assert.deepEqual(result.answers.q, { type: 'noul', noul: 0.8 });
    assert.deepEqual(result.meta.cloudflareDecisions.answers.q, { type: 'noul' });
});

for (const type of ['jev', 'cloudflare-decisions', 'openrouter-decisions', 'gemini-decisions']) {
    test(`${type} preserves native additions and keeps common answers stable`, async () => {
        const provider = createProvider({ type, apiKey: 'fixture', ...(type === 'cloudflare-decisions' ? { accountId: 'fixture' } : {}),
            ...(type === 'openrouter-decisions' ? { model: 'cloudflare/clef' } : {}), fetchImpl: async (_url, init) => {
                const input = JSON.parse(init.body);
                const raw = type === 'gemini-decisions' ? copy(geminiResponse(input)) : { model: 'served',
                    answers: { q: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 1, output_tokens: 0 } };
                raw.extra = extension;
                raw.meta = { extra: extension };
                raw.usage.extra = extension;
                for (const answer of Object.values(raw.answers)) answer.extra = extension;
                return Response.json(type === 'cloudflare-decisions' ? { success: true, result: raw } : raw);
            } });
        const direct = await provider.createDecision(type === 'gemini-decisions' ? { input: common.state, questions: common.questions } : common);
        assert.deepEqual(direct.decision.extra, extension);
        assert.deepEqual(Object.values(direct.decision.answers)[0].extra, extension);
        assert.deepEqual(direct.decision.usage.extra, extension);
        const result = await createBridge({ provider }).evaluate(common);
        assert.deepEqual(result.answers.q, { type: 'noul', noul: 0.8 });
        assert.equal(Object.hasOwn(result, 'extra'), false);
        assert.equal(Object.hasOwn(result.usage, 'extra'), false);
        if (type === 'jev') assert.deepEqual(result.meta.extra, extension);
        else {
            const key = { 'cloudflare-decisions': 'cloudflareDecisions', 'openrouter-decisions': 'openRouter', 'gemini-decisions': 'geminiDecisions' }[type];
            assert.deepEqual(result.meta[key].usage.extra, extension);
        }
    });
}

test('generated answer extensions are discarded without fabricating confidence', () => {
    const payload = { extra: extension, answers: { q: { noul: 0.8, confidence: 0.9, extra: extension },
        pick: { probabilities: { a: 0.8, b: 0.2 }, confidence: 0.9, extra: extension } } };
    const result = normalizeGenerated(payload, { ...common, questions: { ...common.questions, pick: choice('Pick.', { a: null, b: null }) }, model: 'fixture' });
    assert.deepEqual(result.answers.q, { type: 'noul', noul: 0.8 });
    assert.deepEqual(result.answers.pick, { type: 'choice', choice: 'a', probabilities: { a: 0.8, b: 0.2 } });
    assert.equal(result.meta.confidenceSource, 'unavailable');
    assert.equal(Object.hasOwn(result, 'extra'), false);
    assert.deepEqual(payload.answers.q.extra, extension);
});

test('refusals retain understood usage diagnostics without exposing response extensions', async () => {
    const provider = createProvider({ type: 'openai-decisions', apiKey: 'fixture', fetchImpl: async (_url, init) => {
        const raw = extendOpenAI(decisionResponse(JSON.parse(init.body)));
        raw.answers[0] = { type: 'refusal', name: raw.answers[0].name, extra: extension };
        return Response.json(raw);
    } });
    await assert.rejects(provider.evaluate(common), error => {
        assert.equal(error.code, 'MODEL_REFUSAL');
        const diagnostic = publicError(error);
        assert.equal(JSON.stringify(diagnostic).includes(extension.note), false);
        assert.deepEqual(diagnostic.usage.input_tokens_details.cache_write_tokens_details, { ttl_30m_tokens: 2, ttl_12h_tokens: 0 });
        assert.equal(diagnostic.usage.input_tokens, 42);
        return true;
    });
});

test('Live acknowledgements accept nested additions while outgoing commands remain strict', () => {
    const question = { type: 'choice', instructions: [{ type: 'input_text', text: 'Pick.', extra: extension }],
        choices: [{ value: true, extra: extension }, { value: false }], extra: extension };
    const session = { delegation: { type: 'decisions', extra: extension, decisions: { model: 'reported-future-model',
        questions: [question], extra: extension } }, triggers: [{ type: 'decisions', event_type: 'session.input_transcript.delta',
        decisions: { questions: [question], extra: extension }, extra: extension }] };
    const event = { type: 'session.updated', event_id: 'session', session, extra: extension };
    assert.deepEqual(validateLiveEvent(event), event);
    assert.throws(() => validateLiveCommand({ type: 'session.update', session }), { code: 'VALIDATION_ERROR' });
    const created = { type: 'decision.item.created', event_id: 'item', item: { id: 'id', role: 'user',
        content: [{ type: 'input_text', text: 'Evidence', extra: extension }], extra: extension } };
    assert.deepEqual(validateLiveEvent(created), created);
    assert.throws(() => validateLiveCommand({ type: 'decision.item.create', item: created.item }), { code: 'VALIDATION_ERROR' });
    const invalid = copy(event); invalid.session.delegation.decisions.questions[0].choices[0].value = null;
    assert.throws(() => validateLiveEvent(invalid), { code: 'INVALID_RESPONSE' });
});

test('extensions cannot hide provider errors or bypass JSON safety and known value checks', async () => {
    const raw = copy(response); raw.extra = extension; raw.answers.yes.noul = '0.7';
    assert.throws(() => validateResult(raw, request.questions), { code: 'INVALID_RESPONSE' });
    const unsafe = copy(response);
    let invoked = false;
    Object.defineProperty(unsafe, 'extra', { enumerable: true, get() { invoked = true; return extension; } });
    assert.throws(() => validateResult(unsafe, request.questions), { code: 'INVALID_RESPONSE' });
    assert.equal(invoked, false);
    for (const type of ['openai-decisions', 'jev', 'cloudflare-decisions', 'openrouter-decisions', 'gemini-decisions']) {
        const provider = createProvider({ type, apiKey: 'fixture', ...(type === 'cloudflare-decisions' ? { accountId: 'fixture' } : {}),
            ...(type === 'openrouter-decisions' ? { model: 'cloudflare/clef' } : {}), fetchImpl: async (_url, init) => {
                const input = JSON.parse(init.body);
                const data = type === 'openai-decisions' ? decisionResponse(input) : type === 'gemini-decisions' ? copy(geminiResponse(input))
                    : { model: 'served', answers: { q: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 1, output_tokens: 0 } };
                data.error = { message: extension.note };
                return Response.json(type === 'cloudflare-decisions' ? { success: true, result: data } : data);
            } });
        await assert.rejects(provider.evaluate(common), error => error.code === 'INVALID_RESPONSE' && !JSON.stringify(publicError(error)).includes(extension.note));
    }
});
