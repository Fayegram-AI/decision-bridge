import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, normalizeGenerated } from '../src/custom/generative/index.mjs';

const request = { model: 'fixture', state: { evidence: ['observed'] }, questions: {
    choice: { type: 'choice', instructions: 'Pick', criteria: { a: null, b: 'Other' } },
    score: { type: 'score', instructions: 'Rate', criteria: [{ meaning: 'low' }, { meaning: 'high' }] },
    yes: { type: 'noul', instructions: 'True?' },
} };
const payload = { answers: {
    choice: { probabilities: { a: 0.75, b: 0.25 } },
    score: { probabilities: { 0: 0.25, 1: 0.75 } },
    yes: { noul: 0.7 },
} };
const helpers = [buildPrompt, input => normalizeGenerated(payload, input)];

test('public generative helpers preserve structured legacy requests and canonical answers', () => {
    const before = JSON.stringify(request);
    const prompt = buildPrompt(request);
    assert.deepEqual(JSON.parse(prompt.user), { state: request.state });
    assert(prompt.system.includes(JSON.stringify(request.questions)));
    const result = normalizeGenerated(payload, request);
    assert.equal(result.model, 'fixture');
    assert.equal(result.answers.choice.choice, 'a');
    assert.equal(result.answers.score.score, 0.75);
    assert.deepEqual(result.answers.score.legend, { 0: { meaning: 'low' }, 1: { meaning: 'high' } });
    assert.equal(result.answers.yes.noul, 0.7);
    assert.equal(result.meta.probabilitySource, 'elicited');
    assert.equal(result.meta.confidenceSource, 'unavailable');
    assert.deepEqual(result.usage, { input_tokens: null, output_tokens: null });
    assert.equal(JSON.stringify(request), before);
});

test('public generative helpers reject richer common requests instead of discarding input', () => {
    const { state, ...withoutState } = request;
    void state;
    const unsupported = [
        { ...withoutState, input: [{ type: 'text', text: 'Required evidence' }] },
        { ...request, safetyIdentifier: 'required-trace' },
        { ...request, questions: { choice: { type: 'choice', instructions: 'Pick',
            options: [{ value: true }, { value: false }] } } },
        { ...request, questions: { score: { type: 'score', instructions: 'Rate',
            levels: [{ label: 'low' }, { label: 'high' }] } } },
    ];
    for (const helper of helpers) for (const input of unsupported) {
        assert.throws(() => helper(input), { code: 'UNSUPPORTED_CAPABILITY' });
    }
});

test('public generative helpers validate request JSON without invoking accessors', () => {
    let accessed = false;
    const accessor = { ...request };
    Object.defineProperty(accessor, 'state', { enumerable: true,
        get() { accessed = true; return 'unexpected'; } });
    for (const helper of helpers) for (const input of [accessor, { ...request, model: '' },
        { ...request, state: undefined }, { ...request, extra: true }]) {
        assert.throws(() => helper(input), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(accessed, false);
});
