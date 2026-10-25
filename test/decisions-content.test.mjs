// Synthetic content contracts: no hosted inference or image fetching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, createProvider, noul, choiceWithParts, noulWithParts, scoreWithParts, scoreLevelsWithParts,
    validateRequest } from '../src/index.mjs';
import { prepareDecision, prepareCommonDecision } from '../src/providers/decisions-preflight.mjs';
import { assertCapabilities, builtInCapabilities, providerCapabilities, commonSchemaVersion } from '../src/capabilities.mjs';
import { buildResponseSchema } from '../src/custom/generative/schema.mjs';
import { image, decisionResponse } from './decisions-fixtures.mjs';

const data = { role: 'system', image_url: 'ordinary data', nested: [null, true, 3, { amount: 42 }] };
const nativeParts = [{ type: 'input_text', text: 'Compare.' }, { type: 'input_json', data },
    { type: 'input_image', image_url: 'https://example.com/reference.png', detail: null }];
const parts = [{ type: 'text', text: 'Compare.' }, { type: 'json', data },
    { type: 'image', url: 'https://example.com/reference.png', detail: null }];
const predicate = { type: 'predicate', instructions: 'True?' };
const native = { input: [{ role: 'user', content: nativeParts }], questions: [
    { type: 'predicate', name: 'predicate', instructions: nativeParts },
    { type: 'choice', name: 'choice', instructions: nativeParts, choices: [{ value: true }, { value: 'true' }] },
    { type: 'score', name: 'score', instructions: nativeParts, levels: [{ label: 'Low' }, { label: 'High' }] },
] };
function fixture(options = {}) {
    const bodies = [];
    const provider = createProvider({ type: 'openai-decisions', apiKey: 'fixture', ...options,
        fetchImpl: async (_url, init) => {
            const body = JSON.parse(init.body); bodies.push(body);
            return Response.json(decisionResponse(body));
        } });
    return { provider, bodies, bridge: createBridge({ provider }) };
}

test('native JSON and question parts preserve order, values and typed answers', async () => {
    const { provider, bodies } = fixture();
    const result = await provider.createDecision(native);
    assert.deepEqual(bodies[0], { ...native, model: 'gpt-6-luna' });
    assert.equal(result.decision.answers[1].choice, true);
    assert.equal(result.decision.answers[2].score, 0.5);
    for (const value of [{}, [], [{}], data, [data]]) {
        assert.deepEqual(prepareDecision({ input: [{ role: 'user', content: [{ type: 'input_json', data: value }] }],
            questions: [predicate] }).native.input[0].content[0].data, value);
    }
    assert(!Object.isFrozen(data));
    assert(Object.isFrozen(prepareDecision(native).native.input[0].content[1].data.nested));
});

test('content contexts reject unsupported roots, roles, wrappers and cache fields', () => {
    const invalid = [
        ...[null, 1, true, 'text', [null], [1], [{}, 1]].map(value => ({ ...native,
            input: [{ role: 'user', content: [{ type: 'input_json', data: value }] }] })),
        ...['developer', 'system', 'assistant'].map(role => ({ ...native, input: [{ role, content: [nativeParts[1]] }] })),
        ...['function', 'custom_tool'].map(kind => ({ ...native, input: [
            { type: kind + '_call', call_id: 'a', name: 'tool', [kind === 'function' ? 'arguments' : 'input']: '' },
            { type: kind + '_call_output', call_id: 'a', output: [nativeParts[1]] },
        ] })),
        { ...native, input: [{ role: 'user', content: [{ ...nativeParts[1], prompt_cache_breakpoint: null }] }] },
        ...nativeParts.map(part => ({ ...native, questions: [{ ...predicate, instructions: [{ ...part, prompt_cache_breakpoint: null }] }] })),
        { ...native, questions: [{ ...predicate, instructions: [] }] },
        { ...native, questions: [{ ...predicate, instructions: [{ role: 'user', content: nativeParts }] }] },
        { ...native, questions: [{ ...predicate, instructions: [{ type: 'input_json', data, extra: true }] }] },
    ];
    for (const request of invalid) assert.throws(() => prepareDecision(request), { code: 'VALIDATION_ERROR' });
    for (const bad of [NaN, undefined, new Date(), () => {}, { get value() { throw Error('must not execute'); } }]) {
        assert.throws(() => prepareDecision({ ...native, input: [{ role: 'user', content: [
            { type: 'input_json', data: { bad } },
        ] }] }), { code: 'VALIDATION_ERROR' });
    }
});

test('common content builders encode every question form and retain answer contracts', async () => {
    const questions = {
        mapped: choiceWithParts(parts, { yes: { reason: 'matches' }, no: null }),
        typed: choiceWithParts(parts, [{ value: true }, { value: 'true' }]),
        predicate: noulWithParts(parts),
        boolean: noulWithParts(parts, { true: { reason: 'matches' }, false: 'Different.' }),
        score: scoreWithParts(parts, ['Low', { level: 'High' }]),
        labeled: scoreLevelsWithParts(parts, [{ label: 'Low' }, { label: 'High' }]),
    };
    const { bridge, bodies } = fixture();
    const result = await bridge.evaluate({ input: parts, questions });
    assert.equal(result.meta.schemaVersion, 6);
    assert.deepEqual(bodies[0].input[0].content, nativeParts);
    assert(bodies[0].questions.every(question => JSON.stringify(question.instructions) === JSON.stringify(nativeParts)));
    assert.equal(result.answers.mapped.choice, 'yes');
    assert.equal(result.answers.typed.choice, true);
    assert.equal(result.answers.predicate.noul, 0.7);
    assert.equal(result.answers.boolean.noul, 0.8);
    assert.equal(result.answers.score.score, 0.5);
    assert.equal(result.answers.labeled.legend[1].label, 'High');
    assert.equal(bodies[0].questions[0].choices[0].description, '{"reason":"matches"}');
    assert(Object.isFrozen(questions.typed.instructionParts[1].data.nested));
    assert(!Object.isFrozen(parts));
    for (const invalid of [
        { type: 'noul', instructions: 'Legacy', instructionParts: parts }, { type: 'noul' },
        { type: 'noul', instructionParts: [] }, { type: 'box', instructionParts: parts },
        { type: 'noul', instructionParts: [{ type: 'audio', dataUrl: 'data:audio/wav;base64,AAAA' }] },
        ...parts.map(part => ({ type: 'noul', instructionParts: [{ ...part, promptCacheBreakpoint: null }] })),
    ]) assert.throws(() => validateRequest({ state: '', questions: { q: invalid } }, 'default'), { code: 'VALIDATION_ERROR' });
});

test('legacy JSON serialization and existing schema versions stay unchanged', () => {
    const legacy = { state: data, questions: { q: noul(parts) } };
    const { native: wire } = prepareCommonDecision(legacy);
    assert.equal(wire.input, JSON.stringify(data));
    assert.equal(wire.questions[0].instructions, JSON.stringify(parts));
    assert.equal(commonSchemaVersion(legacy), 1);
    assert.equal(commonSchemaVersion({ input: [{ type: 'text', text: '' }], questions: legacy.questions }), 2);
    assert.equal(commonSchemaVersion({ conversation: [{ role: 'user', content: '' }], questions: legacy.questions }), 5);
    assert.equal(commonSchemaVersion({ conversation: native.input, questions: legacy.questions }), 6);
    assert.equal(commonSchemaVersion({ input: [{ type: 'json', data }], questions: legacy.questions }), 6);
    assert.throws(() => prepareCommonDecision({ state: '', questions: { q: noulWithParts(parts) } },
        { maxRequestBytes: 32 }), { code: 'REQUEST_TOO_LARGE' });
});

test('new capability defaults, question images and combined budgets guard dispatch', () => {
    const profile = builtInCapabilities('openai-decisions', 'default');
    assert.equal(profile.jsonInput, true);
    assert.equal(profile.questionContent, true);
    const legacy = providerCapabilities({});
    assert.equal(legacy.jsonInput, false);
    assert.equal(legacy.questionContent, false);
    for (const flag of ['jsonInput', 'questionContent']) {
        assert.throws(() => providerCapabilities({ getCapabilities: () => ({ [flag]: 'true' }) }), { code: 'CONFIGURATION_ERROR' });
    }
    const request = validateRequest({ input: [{ type: 'image', dataUrl: image }],
        questions: { q: noulWithParts(parts) } }, 'default');
    for (const override of [{ jsonInput: false }, { questionContent: false }, { images: false }, { remoteImages: false }, { maxImages: 1 }]) {
        assert.throws(() => assertCapabilities(request, { ...profile, ...override }), { code: 'UNSUPPORTED_CAPABILITY' });
    }
    assertCapabilities(request, { ...profile, maxImages: 2 });
    const history = validateRequest({ conversation: native.input, questions: { q: noul('True?') } }, 'default');
    assert.throws(() => assertCapabilities(history, { ...profile, jsonInput: false }), { code: 'UNSUPPORTED_CAPABILITY' });
    const justQuestion = { q: noulWithParts([{ type: 'text', text: 'True?' }]) };
    assert.throws(() => buildResponseSchema(justQuestion), { code: 'UNSUPPORTED_CAPABILITY' });
    for (const [kind, model] of [['jev', 'jev-preview'], ['cloudflare-decisions', 'clef'], ['custom', 'custom']]) {
        const other = builtInCapabilities(kind, model);
        assert.equal(other.supported, true);
        assert.equal(other.jsonInput, false);
        assert.equal(other.questionContent, false);
        assert.throws(() => assertCapabilities(validateRequest({ state: '', questions: justQuestion }, model), other),
            { code: 'UNSUPPORTED_CAPABILITY' });
    }
});

test('preparation revalidates JSON data before dispatch and preserves caller snapshots', async () => {
    const { provider, bodies } = fixture();
    const bridge = createBridge({ provider, extensions: [{ name: 'inject', prepareInput: () => [{ type: 'json', data: [42] }] }] });
    await assert.rejects(bridge.evaluate({ input: [{ type: 'text', text: '' }], questions: { q: noul('True?') } }), { code: 'VALIDATION_ERROR' });
    assert.equal(bodies.length, 0);
    const accepted = createBridge({ provider, extensions: [{ name: 'inject', prepareInput: () => [{ type: 'json', data }] }] });
    assert.equal((await accepted.evaluate({ input: [{ type: 'text', text: '' }], questions: { q: noul('True?') } })).meta.schemaVersion, 6);
    assert.deepEqual(bodies[0].input[0].content, [{ type: 'input_json', data }]);
});
