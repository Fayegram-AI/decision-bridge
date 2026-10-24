import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createBridge, evaluateBatch, DecisionError, publicError, noul } from '../src/index.mjs';
import { request, response, jsonResponse, copy } from './fixtures.mjs';
import { one } from './support.mjs';

function bridge(extra = {}) {
  return createBridge({ jev: { apiKey: 'test-only-not-a-real-key', model: 'jev-latest', fetchImpl: async () => jsonResponse() }, ...extra });
}
function fakeProvider(evaluate = async () => copy(response)) {
  return { kind: 'decision', name: 'fixture-custom', defaultModel: 'fixture-model', evaluate };
}
const fake = () => ({ kind: 'decision', name: 'test-fixture', defaultModel: 'fixture', evaluate: async () => copy(response) });
const batchFixtureProvider = { kind: 'decision', name: 'test-fixture', defaultModel: 'fixture', async evaluate(request) {
  return { model: request.model, answers: { yes: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: null, output_tokens: null } };
} };
const fixture = { kind: 'decision', name: 'test-fixture', defaultModel: 'fixture', async evaluate() { return response; } };

test('SDK construction requires exactly one explicit provider or Jev selection', () => {
    for (const options of [undefined, {}, { provider: undefined }, { jev: undefined },
        { provider: null }, { jev: null }, { provider: fixture, jev: {} },
        { provider: null, jev: {} }, { provider: fixture, jev: null }]) {
        assert.throws(() => createBridge(options), { code: 'CONFIGURATION_ERROR' });
    }
    assert.throws(() => createBridge(), error => error.code === 'CONFIGURATION_ERROR' &&
        !error.message.includes('API key'));
    assert.equal(createBridge({ provider: fixture, jev: undefined }).provider, fixture.name);
    assert.equal(createBridge({ provider: undefined, jev: { apiKey: 'fixture-key' } }).provider, 'typesafe');
});

test('explicit provider and model selection ignores inherited fields and getters', () => {
    const entry = new URL('../src/index.mjs', import.meta.url).href;
    // Isolate temporary prototype changes from other tests and the test runner.
    const code = `import assert from 'node:assert/strict';
import { createBridge, createProvider, validateRequest } from ${JSON.stringify(entry)};
const keys = ['provider', 'jev', 'type', 'model'];
const saved = Object.getOwnPropertyDescriptors(Object.prototype);
let reads = 0, calls = 0;
const provider = { kind: 'decision', name: 'fixture', defaultModel: 'fixture', async evaluate() { calls++; } };
const request = { state: '', questions: { q: { type: 'noul', instructions: 'True?' } } };
function missingSelections() {
    for (const options of [{}, { provider: undefined }, { jev: undefined }]) {
        assert.throws(() => createBridge(options), { code: 'CONFIGURATION_ERROR' });
    }
    assert.throws(() => createProvider({ apiKey: 'fixture-key', model: 'fixture' }),
        { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => validateRequest(request), { code: 'VALIDATION_ERROR' });
}
try {
    for (const [key, value] of Object.entries({ provider, jev: {}, type: 'jev', model: 'inherited' })) {
        Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
    }
    missingSelections();
    assert.equal(createBridge({ provider }).provider, 'fixture');
    assert.equal(createBridge({ jev: { apiKey: 'fixture-key', model: 'fixture' } }).provider, 'typesafe');
    assert.equal(createProvider({ type: 'jev', apiKey: 'fixture-key', model: 'fixture' }).name, 'typesafe');
    assert.equal(validateRequest(request, 'explicit-default').model, 'explicit-default');
    assert.equal(validateRequest({ ...request, model: 'explicit-request' }, 'explicit-default').model,
        'explicit-request');
    for (const key of keys) {
        Object.defineProperty(Object.prototype, key, { configurable: true,
            get() { reads++; throw Error('Inherited selector must not be read.'); } });
    }
    missingSelections();
    assert.equal(createBridge({ provider }).provider, 'fixture');
    assert.equal(validateRequest(request, 'explicit-default').model, 'explicit-default');
    assert.equal(validateRequest({ ...request, model: 'explicit-request' }).model, 'explicit-request');
    assert.equal(reads, 0);
    assert.equal(calls, 0);
} finally {
    for (const key of keys) {
        if (Object.hasOwn(saved, key)) Object.defineProperty(Object.prototype, key, saved[key]);
        else delete Object.prototype[key];
    }
}
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code],
        { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
});

test('explicit Jev provider posts the native request and preserves model answers', async () => {
  let seen;
  const client = createBridge({ jev: { apiKey: 'test-only-not-a-real-key', model: 'jev-latest', fetchImpl: async (url, init) => {
    seen = { url, init };
    return jsonResponse(response, 200, { 'x-request-id': 'local-fixture-id' });
  } } });
  const result = await client.evaluate(request);
  assert.equal(seen.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.authorization, 'Bearer test-only-not-a-real-key');
  assert.equal(seen.init.redirect, 'error');
  assert.deepEqual(JSON.parse(seen.init.body), { ...request, model: 'jev-latest' });
  assert.deepEqual(result.answers, response.answers);
  assert.deepEqual(result.usage, response.usage);
  assert.equal(result.model, 'jev-test-fixture');
  assert.equal(result.meta.provider, 'typesafe');
  assert.equal(result.meta.requestedModel, 'jev-latest');
  assert.equal(result.meta.requestId, 'local-fixture-id');
  assert.equal(result.meta.attempts, 1);
  assert(result.meta.durationMs >= 0);
  assert(Object.isFrozen(result.answers.route.probabilities));
});

test('explicit model override is sent without being replaced by the default', async () => {
  let model;
  const client = createBridge({ jev: { apiKey: 'test', model: 'default-version', fetchImpl: async (_, init) => {
    model = JSON.parse(init.body).model; return jsonResponse();
  } } });
  const result = await client.evaluate({ ...request, model: 'pinned-version' });
  assert.equal(model, 'pinned-version');
  assert.equal(result.meta.requestedModel, 'pinned-version');
});

test('extensions run in order and do not mutate caller state', async () => {
  let received;
  const observed = [];
  const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async (_, init) => {
    received = JSON.parse(init.body); return jsonResponse();
  } }, extensions: [
    { name: 'first', prepareState: state => ({ original: state, one: 1 }) },
    { name: 'second', prepareState: state => ({ ...state, two: 2 }),
      onResult: result => { observed.push(result.model); } },
  ] });
  const result = await client.evaluate(request);
  assert.deepEqual(received.state, { original: request.state, one: 1, two: 2 });
  assert.equal(request.state, 'Local test input');
  assert.deepEqual(observed, ['jev-test-fixture']);
  assert.deepEqual(result.meta.observerFailures, []);
});

test('failed preparation prevents inference', async () => {
  let calls = 0;
  const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async () => { calls++; return jsonResponse(); } },
    extensions: [{ name: 'broken', prepareState() { throw Error('private details'); } }] });
  await assert.rejects(client.evaluate(request), error => error.code === 'EXTENSION_ERROR' && !error.message.includes('private'));
  assert.equal(calls, 0);
});

test('invalid prepared state is revalidated', async () => {
  const client = bridge({ extensions: [{ name: 'invalid', prepareState: () => 42 }] });
  await assert.rejects(client.evaluate(request), { code: 'VALIDATION_ERROR' });
});

test('observer failure is reported without losing the successful inference', async () => {
  const client = bridge({ extensions: [{ name: 'metrics', onResult() { throw Error('down'); } }] });
  const result = await client.evaluate(request);
  assert.deepEqual(result.answers, response.answers);
  assert.deepEqual(result.meta.observerFailures, ['metrics']);
});

test('observers cannot alter native probabilities', async () => {
  const client = bridge({ extensions: [{ name: 'mutator', onResult(result) { result.answers.route.probabilities.a = 1; } }] });
  const result = await client.evaluate(request);
  assert.equal(result.answers.route.probabilities.a, 0.8);
  assert.deepEqual(result.meta.observerFailures, ['mutator']);
});

test('a custom backend needs no TypeSafe key and uses the same validated contract', async () => {
  const provider = {
    kind: 'decision', name: 'test-provider', defaultModel: 'local-fixture',
    async evaluate(req) { assert.equal(req.model, 'local-fixture'); return copy(response); },
  };
  const client = createBridge({ provider });
  const result = await client.evaluate(request);
  assert.equal(result.meta.provider, 'test-provider');
  assert.deepEqual(result.answers, response.answers);
  await assert.rejects(client.listModels(), { code: 'UNSUPPORTED_OPERATION' });
});

test('custom provider responses are validated, not blindly trusted', async () => {
  const client = createBridge({ provider: { kind: 'decision', name: 'bad', defaultModel: 'bad',
    async evaluate() { return { model: 'bad', answers: {}, usage: response.usage }; } } });
  await assert.rejects(client.evaluate(request), { code: 'INVALID_RESPONSE' });
});

test('duplicate extension names fail configuration', () => {
  assert.throws(() => bridge({ extensions: [{ name: 'same' }, { name: 'same' }] }), { code: 'CONFIGURATION_ERROR' });
});

test('explicit Jev shortcut reads TYPESAFE_API_KEY and JEV_MODEL', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createBridge } from './src/index.mjs';
    const bridge = createBridge({ jev: {} });
    console.log(typeof bridge.evaluate);
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {
    ...process.env, TYPESAFE_API_KEY: 'local-test-key', JEV_MODEL: 'test-version',
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function');
});

test('structured read-only templates can be reused without mutation', async () => {
  const questions = Object.freeze({ yes: noul({ task: 'Is this true?', examples: ['x'] }) });
  const client = createBridge({ provider: { kind: 'decision', name: 'fixture', defaultModel: 'm', async evaluate(r) {
    assert.equal(Object.isFrozen(r.questions.yes.instructions.examples), true);
    return { model: r.model, answers: { yes: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: null, output_tokens: null } };
  } } });
  const result = await client.evaluate({ state: { nested: ['data'] }, questions });
  assert.equal(result.meta.probabilitySource, 'unspecified');
  assert.equal(result.meta.bridgeVersion, '0.1.4');
  assert.equal(Object.isFrozen(result.answers.yes), true);
});

test('a stalled preparation hook is bounded by the bridge deadline', async () => {
  let calls = 0;
  const client = createBridge({ provider: fakeProvider(async () => { calls++; return copy(response); }), timeoutMs: 25,
    extensions: [{ name: 'stall', prepareState: () => new Promise(() => {}) }] });
  await assert.rejects(client.evaluate(request), { code: 'TIMEOUT' });
  assert.equal(calls, 0);
});

test('abort during preparation remains cancellation rather than an extension error', async () => {
  const controller = new AbortController();
  const client = createBridge({ provider: fakeProvider(), extensions: [{ name: 'cancel', prepareState() {
    controller.abort(); return new Promise(() => {});
  } }] });
  await assert.rejects(client.evaluate(request, { signal: controller.signal }), { code: 'ABORTED' });
});

test('stalled observers cannot block successful evaluations indefinitely', async () => {
  const client = createBridge({ provider: fakeProvider(), observerTimeoutMs: 20,
    extensions: [{ name: 'stall', onResult: () => new Promise(() => {}) }] });
  const result = await client.evaluate(request);
  assert.deepEqual(result.meta.observerFailures, ['stall']);
  assert.equal(result.answers.yes.noul, 0.7);
});

test('custom provider rejecting after timeout does not create an unhandled rejection', async () => {
  const client = createBridge({ provider: fakeProvider(() => new Promise((_, reject) => setTimeout(() => reject(Error('late secret')), 25))), timeoutMs: 5 });
  await assert.rejects(client.evaluate(request), { code: 'TIMEOUT' });
  await new Promise(resolve => setTimeout(resolve, 35));
});

test('unknown custom errors are sanitized', async () => {
  const client = createBridge({ provider: fakeProvider(async () => { throw Error('private-token'); }) });
  await assert.rejects(client.evaluate(request), e => e.code === 'PROVIDER_ERROR' && !JSON.stringify(e).includes('private-token'));
  assert.deepEqual(publicError(Error('private')), { code: 'UNEXPECTED_ERROR', message: 'Unexpected bridge failure.' });
  assert.deepEqual(new DecisionError('Safe', { code: 'CUSTOM', status: 502, attempts: 1 }).toJSON(),
    { code: 'CUSTOM', message: 'Safe', status: 502, attempts: 1 });
});

test('call timeout and AbortSignal options are validated', async () => {
  const client = createBridge({ provider: fakeProvider() });
  await assert.rejects(client.evaluate(request, { signal: {} }), { code: 'CONFIGURATION_ERROR' });
  await assert.rejects(client.evaluate(request, { timeoutMs: 0 }), { code: 'CONFIGURATION_ERROR' });
  assert.throws(() => createBridge({ provider: fakeProvider(), observerTimeoutMs: -1 }), { code: 'CONFIGURATION_ERROR' });
});

test('custom model listing is bounded by the bridge deadline', async () => {
  const provider = { ...fakeProvider(), listModels: () => new Promise(() => {}) };
  await assert.rejects(createBridge({ provider, timeoutMs: 10 }).listModels(), { code: 'TIMEOUT' });
});

test('batch respects concurrency and returns input order', async () => {
  let active = 0;
  let maximum = 0;
  const client = createBridge({ provider: fakeProvider(async r => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, r.state === '0' ? 25 : 2));
    active--; return { ...copy(response), model: r.state };
  }) });
  const results = await evaluateBatch(client, Array.from({ length: 7 }, (_, i) => ({ ...request, state: String(i) })), { concurrency: 3 });
  assert.equal(maximum, 3);
  assert.deepEqual(results.map(r => r.result.model), ['0', '1', '2', '3', '4', '5', '6']);
  assert.deepEqual(results.map(r => r.index), [0, 1, 2, 3, 4, 5, 6]);
});

test('batch validates all requests before dispatch', async () => {
  let calls = 0;
  const client = createBridge({ provider: fakeProvider(async () => { calls++; return copy(response); }) });
  await assert.rejects(evaluateBatch(client, [request, { state: 1, questions: request.questions }]), { code: 'VALIDATION_ERROR' });
  assert.equal(calls, 0);
  assert.deepEqual(await evaluateBatch(client, []), []);
});

test('batch stopOnError preserves failures and marks undispatched requests skipped', async () => {
  let calls = 0;
  const client = createBridge({ provider: fakeProvider(async () => {
    if (++calls === 1) throw new DecisionError('Failure', { code: 'HTTP_ERROR' });
    return copy(response);
  }) });
  const results = await evaluateBatch(client, [request, request, request], { concurrency: 1, stopOnError: true });
  assert.equal(calls, 1);
  assert.deepEqual(results.map(r => r.error.code), ['HTTP_ERROR', 'BATCH_SKIPPED', 'BATCH_SKIPPED']);
});

test('batch pre-abort sends no requests and records aborted rows', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const client = createBridge({ provider: fakeProvider(async () => { calls++; return copy(response); }) });
  const result = await evaluateBatch(client, [request, request], { signal: controller.signal });
  assert.equal(calls, 0);
  assert.deepEqual(result.map(row => row.error.code), ['ABORTED', 'ABORTED']);
});

for (const config of [{ concurrency: 0 }, { concurrency: 65 }, { concurrency: 1.5 }, { stopOnError: 'yes' }]) {
  test(`invalid batch options ${JSON.stringify(config)}`, async () => {
    await assert.rejects(evaluateBatch(createBridge({ provider: fakeProvider() }), [], config), { code: 'CONFIGURATION_ERROR' });
  });
}

test('observers receive metadata matching the public contract', async () => {
  let seen;
  const bridge = createBridge({ provider: fake(), extensions: [{ name: 'observe', onResult(result) { seen = result; } }] });
  const result = await bridge.evaluate(request);
  assert.equal(seen.meta.observerDurationMs, 0);
  assert.equal(Object.isFrozen(seen.meta), true);
  assert.equal(typeof result.meta.observerDurationMs, 'number');
});

test('model listing snapshots without freezing provider-owned data', async () => {
  const data = { models: [{ name: 'fixture' }] };
  const result = await createBridge({ provider: { ...fake(), listModels: async () => data } }).listModels();
  assert.equal(Object.isFrozen(result.models[0]), true);
  assert.equal(Object.isFrozen(data.models[0]), false);
  data.models[0].name = 'changed';
  assert.equal(result.models[0].name, 'fixture');
});

test('model listing rejects list and name accessors without invoking them', async () => {
    let reads = 0;
    const getter = { enumerable: true, get() { reads++; return 'fixture'; } };
    const data = { models: [{ name: 'fixture' }] };
    Object.defineProperty(data, 'models', { ...getter, get() { reads++; return []; } });
    const model = {};
    Object.defineProperty(model, 'name', getter);
    for (const value of [data, { models: [model] }]) {
        const bridge = createBridge({ provider: { ...fake(), listModels: async () => value } });
        await assert.rejects(bridge.listModels(), { code: 'INVALID_RESPONSE' });
    }
    assert.equal(reads, 0);
});

test('SDK sparse batch is rejected before any paid dispatch', async () => {
  let calls = 0;
  const bridge = createBridge({ provider: { ...batchFixtureProvider, async evaluate(r) { calls++; return batchFixtureProvider.evaluate(r); } } });
  const requests = [one]; requests.length = 2;
  await assert.rejects(evaluateBatch(bridge, requests), { code: 'VALIDATION_ERROR' });
  assert.equal(calls, 0);
});

test('sparse extensions fail at construction with a configuration error', () => {
  assert.throws(() => createBridge({ provider: fixture, extensions: new Array(1) }), { code: 'CONFIGURATION_ERROR' });
});

test('a rejected policy Promise from another realm cannot terminate the caller', () => {
    const entry = new URL('../src/index.mjs', import.meta.url).href;
    const code = `import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createBridge } from ${JSON.stringify(entry)};
let calls = 0;
const provider = { kind: 'decision', name: 'fixture', defaultModel: 'fixture', getResultValidationOptions() {
    return vm.runInNewContext('Promise.reject(new Error("private foreign policy rejection"))');
}, async evaluate() { calls++; } };
await assert.rejects(createBridge({ provider }).evaluate({
    state: '', questions: { q: { type: 'noul', instructions: 'True?' } },
}), { code: 'CONFIGURATION_ERROR' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls, 0);
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
});

test('invalid policies are rejected without invoking own then accessors', async () => {
    let reads = 0, calls = 0;
    for (const factory of [() => ({}), () => Promise.reject(new Error('private policy rejection'))]) {
        const policy = factory();
        Object.defineProperty(policy, 'then', { get() { reads++; throw new Error('private accessor'); } });
        const provider = { kind: 'decision', name: 'fixture', defaultModel: 'fixture',
            getResultValidationOptions() { return policy; }, async evaluate() { calls++; } };
        await assert.rejects(createBridge({ provider }).evaluate(request), { code: 'CONFIGURATION_ERROR' });
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 0);
    assert.equal(calls, 0);
});
