import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, createProvider, choice, noul, score, decideChoice, validateRequest, validateResult, evaluateBatch, JevProvider } from '../src/index.mjs';
import { request, response, jsonResponse, copy } from './fixtures.mjs';

const fake = () => ({ kind: 'decision', name: 'test-fixture', defaultModel: 'fixture', evaluate: async () => copy(response) });
const policyAnswer = { type: 'choice', choice: 'go', probabilities: { go: 0.8, stop: 0.2 } };

test('standalone request validation requires a request model or explicit default', () => {
    assert.throws(() => validateRequest(request), { code: 'VALIDATION_ERROR', message: 'model must be a nonempty string.' });
    assert.equal(validateRequest(request, 'chosen-model').model, 'chosen-model');
    assert.equal(validateRequest({ ...request, model: 'request-model' }, 'chosen-model').model, 'request-model');
    assert.equal(validateRequest({ ...request, model: 'request-model' }).model, 'request-model');
});

test('provider factory rejects implicit selection before resolving credentials', () => {
    for (const config of [undefined, {}, { apiKey: 'fixture' }, { type: undefined }, { type: null }, { type: '' }]) {
        assert.throws(() => createProvider(config), { code: 'CONFIGURATION_ERROR' });
    }
    assert.throws(() => createProvider(), { code: 'CONFIGURATION_ERROR' });
});

test('builders preserve literal option labels and freeze their result', () => {
  assert.deepEqual(choice('Choose.', { a: null, b: 'Other' }), { type: 'choice', instructions: 'Choose.', criteria: { a: null, b: 'Other' } });
  assert.deepEqual(noul('True?'), { type: 'noul', instructions: 'True?' });
  assert.deepEqual(score('Rate.', ['Low', 'High']).criteria, ['Low', 'High']);
  const q = choice('Choose.', { a: null, b: null });
  assert.throws(() => { q.criteria.a = 'mutate'; }, TypeError);
});

test('structured instructions and descriptions are preserved', () => {
  const q = choice({ task: 'Classify', examples: [] }, { a: { description: 'One' }, b: ['Two'] });
  assert.deepEqual(validateRequest({ model: 'fixture-model', state: [], questions: { q } }).questions.q, q);
  assert.deepEqual(noul('Evaluate the statement.', { true: { meaning: 'yes' }, false: ['no'] }).criteria.true, { meaning: 'yes' });
});

for (const [label, input] of [
  ['no questions', { state: 'x', questions: {} }],
  ['null state', { state: null, questions: request.questions }],
  ['numeric state', { state: 3, questions: request.questions }],
  ['gateway boolean type', { state: 'x', questions: { q: { type: 'boolean', instructions: 'yes?' } } }],
  ['empty choice map', { state: 'x', questions: { q: { type: 'choice', criteria: {} } } }],
  ['one score level', { state: 'x', questions: { q: { type: 'score', criteria: ['One'] } } }],
  ['eleven score levels', { state: 'x', questions: { q: { type: 'score', criteria: Array(11).fill('Level') } } }],
  ['unknown top-level field', { ...request, temperature: 0 }],
  ['unknown question field', { state: 'x', questions: { q: { type: 'noul', prompt: '?' } } }],
  ['unknown noul criterion', { state: 'x', questions: { q: { type: 'noul', criteria: { maybe: 'maybe' } } } }],
  ['nonfinite value', { ...request, state: { number: NaN } }],
  ['undefined value', { ...request, state: { number: undefined } }],
  ['Date instead of JSON', { ...request, state: new Date() }],
  ['numeric instructions', { state: 'x', questions: { q: { type: 'noul', instructions: 5 } } }],
]) {
  test(`request rejects ${label}`, () => {
    assert.throws(() => validateRequest(input, 'fixture-model'), { code: 'VALIDATION_ERROR' });
  });
}

test('cyclic state is rejected without running the provider', async () => {
  let calls = 0;
  const state = {}; state.loop = state;
  const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async () => { calls++; return jsonResponse(); } } });
  await assert.rejects(client.evaluate({ ...request, state }), { code: 'VALIDATION_ERROR' });
  assert.equal(calls, 0);
});

test('shared JSON objects are permitted while sparse arrays are rejected', () => {
  const item = { a: 1 };
  assert.deepEqual(validateRequest({ model: 'fixture-model', ...request, state: [item, item] }).state, [item, item]);
  assert.throws(() => validateRequest({ model: 'fixture-model', ...request, state: Array(2) }), { code: 'VALIDATION_ERROR' });
});

for (const [label, change] of [
  ['missing question', r => { delete r.answers.yes; }],
  ['extra question', r => { r.answers.extra = { type: 'noul', noul: 1 }; }],
  ['wrong answer type', r => { r.answers.yes.type = 'choice'; }],
  ['out-of-range probability', r => { r.answers.yes.noul = 1.2; }],
  ['missing probability label', r => { delete r.answers.route.probabilities.b; }],
  ['probabilities not summing to 1', r => { r.answers.route.probabilities.a = 0.5; }],
  ['unknown selected option', r => { r.answers.route.choice = 'c'; }],
  ['selected option not maximal', r => { r.answers.route.choice = 'b'; }],
  ['missing confidence', r => { delete r.answers.route.confidence; }],
  ['out-of-range score', r => { r.answers.level.score = 2; }],
  ['wrong weighted score', r => { r.answers.level.score = 0.4; }],
  ['wrong score legend', r => { r.answers.level.legend[0] = 'Unknown'; }],
  ['missing usage', r => { delete r.usage; }],
  ['negative tokens', r => { r.usage.input_tokens = -1; }],
  ['missing model', r => { delete r.model; }],
]) {
  test(`response rejects ${label}`, () => {
    const changed = copy(response); change(changed);
    assert.throws(() => validateResult(changed, request.questions, { native: true }), { code: 'INVALID_RESPONSE' });
  });
}

test('minor probability rounding is tolerated without renormalization', () => {
  const changed = copy(response); changed.answers.route.probabilities.b = 0.1999;
  const result = validateResult(changed, request.questions);
  assert.equal(result.answers.route.probabilities.b, 0.1999);
});

test('score legends can preserve structured criterion descriptions', () => {
  const req = copy(request); req.questions.level.criteria[0] = { meaning: { label: 'Low', rank: 0 }, tags: ['start'] };
  const res = copy(response); res.answers.level.legend[0] = { tags: ['start'], meaning: { rank: 0, label: 'Low' } };
  assert.deepEqual(validateResult(res, req.questions).answers.level.legend[0], res.answers.level.legend[0]);
  res.answers.level.legend[0].meaning.rank = 1;
  assert.throws(() => validateResult(res, req.questions), { code: 'INVALID_RESPONSE' });
});

test('choice policy requires an explicit probability threshold', () => {
  assert.throws(() => decideChoice(response.answers.route), { code: 'VALIDATION_ERROR' });
  assert.equal(decideChoice(response.answers.route, { minProbability: 0.8 }).status, 'selected');
  assert.equal(decideChoice(response.answers.route, { minProbability: 0.81 }).status, 'review');
});

test('choice policy distinguishes selected probability from confidence and supports abstention', () => {
  const answer = response.answers.route;
  const decision = decideChoice(answer, { minProbability: 0.75, minMargin: 0.5 });
  assert.equal(decision.status, 'selected'); // confidence is 0.6, but selected probability is 0.8.
  assert.equal(decision.selectedProbability, 0.8);
  assert.equal(decideChoice(answer, { minProbability: 0, abstainOptions: ['a'] }).reason, 'abstain_option');
  assert.equal(decideChoice(answer, { minProbability: 0, minMargin: 0.7 }).reason, 'margin_below_threshold');
  assert.equal(answer.choice, 'a');
});

test('null model is rejected instead of silently choosing another model', () => {
  assert.throws(() => validateRequest({ model: 'fixture-model', ...request, model: null }), { code: 'VALIDATION_ERROR' });
});

test('JSON copying never invokes non-enumerable toJSON methods', () => {
  const state = { text: 'original' };
  Object.defineProperty(state, 'toJSON', { value() { throw Error('must not be called'); } });
  assert.throws(() => validateRequest({ model: 'fixture-model', ...request, state }), { code: 'VALIDATION_ERROR' });
});

test('a sparse array with an extra property cannot hide missing indices', () => {
  const state = Array(1); state.extra = 'value';
  assert.throws(() => validateRequest({ model: 'fixture-model', ...request, state }), { code: 'VALIDATION_ERROR' });
});

test('object keys named __proto__ are preserved without prototype mutation', () => {
  const state = JSON.parse('{"__proto__":{"polluted":true}}');
  const normalized = validateRequest({ model: 'fixture-model', ...request, state });
  assert(Object.hasOwn(normalized.state, '__proto__'));
  assert.equal({}.polluted, undefined);
});

for (const instructions of [undefined, null, '', '  ', 4, true]) {
  test(`required instructions reject ${JSON.stringify(instructions)}`, () => {
    const q = { type: 'noul', ...(instructions === undefined ? {} : { instructions }) };
    assert.throws(() => validateRequest({ model: 'fixture-model', state: 'x', questions: { q } }), { code: 'VALIDATION_ERROR' });
  });
}

test('non-enumerable and accessor properties are rejected without invocation', () => {
  for (const enumerable of [false, true]) {
    let called = false;
    const state = {};
    Object.defineProperty(state, 'secret', { get() { called = true; return 'x'; }, enumerable });
    assert.throws(() => validateRequest({ model: 'fixture-model', ...request, state }), { code: 'VALIDATION_ERROR' });
    assert.equal(called, false);
  }
});

test('oversized JSON node graph is rejected before provider dispatch', () => {
  assert.throws(() => validateRequest({ model: 'fixture-model', ...request, state: Array(200001).fill(null) }), { code: 'VALIDATION_ERROR' });
});

test('missing confidence is supported only as absence, not a synthesized number', () => {
  const changed = copy(response); delete changed.answers.route.confidence;
  const result = validateResult(changed, request.questions);
  assert.equal(Object.hasOwn(result.answers.route, 'confidence'), false);
});

for (const options of [null, [], { provder: fake() }]) {
  test(`bridge rejects malformed or misspelled options ${JSON.stringify(options)}`, () => {
    assert.throws(() => createBridge(options), { code: 'CONFIGURATION_ERROR' });
  });
}

test('bridge, provider, batch and extension reject misspelled operational options', async () => {
  const bridge = createBridge({ provider: fake() });
  await assert.rejects(bridge.evaluate(request, { timoutMs: 5 }), { code: 'CONFIGURATION_ERROR' });
  await assert.rejects(bridge.listModels({ timeOut: 5 }), { code: 'CONFIGURATION_ERROR' });
  await assert.rejects(evaluateBatch(bridge, [], { concurrencyy: 4 }), { code: 'CONFIGURATION_ERROR' });
  assert.throws(() => createBridge({ provider: fake(), extensions: [{ name: 'x', onResults() {} }] }), { code: 'CONFIGURATION_ERROR' });
  const provider = new JevProvider({ apiKey: 'test-key', fetchImpl: async () => jsonResponse(response) });
  await assert.rejects(provider.evaluate(request, { timeoutMs: 5 }), { code: 'CONFIGURATION_ERROR' });
});

test('result validation rejects unexpected decision, usage and envelope fields', () => {
  for (const mutate of [r => { r.extra = true; }, r => { r.answers.yes.explanation = 'extra'; },
    r => { r.answers.route.extra = true; }, r => { r.usage.extra = 0; }]) {
    const data = copy(response); mutate(data);
    assert.throws(() => validateResult(data, request.questions), { code: 'INVALID_RESPONSE' });
  }
});

for (const options of [null, { minProbability: 0.7, minMargn: 0.5 }]) {
  test(`choice policy rejects malformed/unknown options ${JSON.stringify(options)}`, () => {
    assert.throws(() => decideChoice(policyAnswer, options), { code: 'CONFIGURATION_ERROR' });
  });
}

test('choice policy rejects unknown abstention labels rather than silently ignoring a typo', () => {
  assert.throws(() => decideChoice(policyAnswer, { minProbability: 0.7, abstainOptions: ['stpo'] }), { code: 'VALIDATION_ERROR' });
});

test('choice policy rejects lossy abstention arrays without invoking accessors', () => {
    let reads = 0;
    const accessor = ['stop'];
    Object.defineProperty(accessor, '0', { enumerable: true, get() { reads++; return 'stop'; } });
    const extra = Object.assign(['stop'], { note: 'unexpected property' });
    for (const abstainOptions of [new Array(1), accessor, extra]) {
        assert.throws(() => decideChoice(policyAnswer, { minProbability: 0.7, abstainOptions }),
            { code: 'VALIDATION_ERROR' });
    }
    assert.equal(reads, 0);
});

test('choice permits the native 255-option boundary and rejects 256 before dispatch', () => {
  const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`option-${i}`, null]));
  assert.equal(Object.keys(validateRequest({ model: 'fixture-model', state: '', questions: { pick: {
    type: 'choice', instructions: 'Choose.', criteria,
  } } }).questions.pick.criteria).length, 255);
  assert.throws(() => validateRequest({ model: 'fixture-model', state: '', questions: { pick: {
    type: 'choice', instructions: 'Choose.', criteria: { ...criteria, extra: null },
  } } }), { code: 'VALIDATION_ERROR' });
});

for (const q of [
  { type: 'score', instructions: 'Rate.', criteria: ['Low', null] },
  { type: 'noul', instructions: 'True?', criteria: null },
  { type: 'noul', instructions: 'True?', criteria: { true: null } },
]) {
  test(`native question descriptions reject undocumented null form ${JSON.stringify(q)}`, () => {
    assert.throws(() => validateRequest({ model: 'fixture-model', state: '', questions: { q } }), { code: 'VALIDATION_ERROR' });
  });
}

test('standalone result validation rejects an oversized choice space before argmax', () => {
  const criteria = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), null]));
  const result = { model: 'fixture', answers: { q: { type: 'choice' } }, usage: { input_tokens: 0, output_tokens: 0 } };
  assert.throws(() => validateResult(result, { q: { type: 'choice', criteria } }), { code: 'VALIDATION_ERROR' });
});

for (const options of [null, { natvie: true }, { native: 'false' }, { native: 0 }, { native: 1 }]) {
  test(`result validator rejects invalid options ${JSON.stringify(options)}`, () => {
    assert.throws(() => validateResult(response, request.questions, options), { code: 'CONFIGURATION_ERROR' });
  });
}

test('result-validator options must not execute accessors', () => {
  let reads = 0;
  const options = { get native() { reads++; return false; } };
  assert.throws(() => validateResult(response, request.questions, options), { code: 'CONFIGURATION_ERROR' });
  assert.equal(reads, 0);
});

test('undefined optional native setting retains the default non-native validation', () => {
  const result = structuredClone(response); delete result.answers.route.confidence; delete result.answers.level.confidence;
  assert.deepEqual(validateResult(result, request.questions, { native: undefined }), result);
  assert.throws(() => validateResult(result, request.questions, { native: true }), { code: 'INVALID_RESPONSE' });
});

test('hidden and symbolic result-validation options are rejected', () => {
  const hidden = {}; Object.defineProperty(hidden, 'native', { value: true });
  for (const options of [hidden, { [Symbol('native')]: true }]) {
    assert.throws(() => validateResult(response, request.questions, options), { code: 'CONFIGURATION_ERROR' });
  }
});
