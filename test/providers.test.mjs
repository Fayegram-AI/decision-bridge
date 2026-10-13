import { createGenerativeProvider } from '../src/custom/generative/index.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, createProvider, JevProvider, validateResult } from '../src/index.mjs';
import { OpenAICompatibleProvider, OpenRouterProvider, AnthropicProvider, buildResponseSchema } from '../src/custom/generative/index.mjs';
import { normalizeGenerated, parseGeneratedJson } from '../src/custom/generative/schema.mjs';
import { request, response, jsonResponse, copy } from './fixtures.mjs';

const generated = { answers: { route: { probabilities: { a: 0.8, b: 0.2 } },
  yes: { noul: 0.7 }, level: { probabilities: { 0: 0.25, 1: 0.75 } } } };
const chat = (content = generated) => ({ model: 'fixture-generative',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 200, completion_tokens: 50 } });
const message = (input = generated) => ({ model: 'fixture-anthropic', stop_reason: 'tool_use',
  content: [{ type: 'tool_use', name: 'submit_decisions', input }], usage: { input_tokens: 180, output_tokens: 40 } });
const providerFor = data => new OpenAICompatibleProvider({ apiKey: 'fixture', model: 'test', fetchImpl: async () => jsonResponse(data) });
function assertNoConfidence(result) {
  assert.equal(Object.hasOwn(result.answers.route, 'confidence'), false);
  assert.equal(Object.hasOwn(result.answers.level, 'confidence'), false);
  assert.equal(result.meta.probabilitySource, 'elicited');
}

test('OpenAI wire body, schema, model override and native normalization', async () => {
  let captured;
  const provider = new OpenAICompatibleProvider({ apiKey: 'fixture-key', model: 'default',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(init.headers.authorization, 'Bearer fixture-key');
      assert.equal(init.redirect, 'error');
      captured = JSON.parse(init.body);
      return jsonResponse(chat());
    } });
  const result = await createBridge({ provider }).evaluate({ ...request, model: 'override' });
  assert.equal(captured.model, 'override');
  assert.equal(captured.stream, false);
  assert.equal(captured.max_completion_tokens, 4096);
  assert.equal(captured.response_format.json_schema.strict, true);
  assert.deepEqual(captured.response_format.json_schema.schema, buildResponseSchema(request.questions));
  assert.deepEqual(JSON.parse(captured.messages[1].content), { state: request.state });
  assert.equal(result.answers.route.choice, 'a');
  assert.equal(result.answers.level.score, 0.75);
  assert.deepEqual(result.answers.level.legend, { 0: 'Low', 1: 'High' });
  assert.deepEqual(result.usage, { input_tokens: 200, output_tokens: 50 });
  assertNoConfidence(result);
});

for (const responseFormat of ['json_schema', 'json_object', 'text']) {
  test(`explicit ${responseFormat} mode does not silently fall back`, async () => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'fixture', model: 'test', responseFormat,
      tokenParameter: 'max_tokens', maxTokens: 512, parameters: { temperature: 0.2 },
      fetchImpl: async (_, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.temperature, 0.2);
        assert.equal(body.max_tokens, 512);
        assert.equal(body.max_completion_tokens, undefined);
        assert.equal(body.response_format?.type, responseFormat === 'text' ? undefined : responseFormat);
        return jsonResponse(chat());
      } });
    await provider.evaluate(request);
  });
}

test('missing model is a configuration requirement, not a hidden default LLM', async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider({ apiKey: 'fixture', fetchImpl: async () => { calls++; return jsonResponse(chat()); } });
  await assert.rejects(provider.evaluate(request), { code: 'VALIDATION_ERROR' });
  assert.equal(calls, 0);
  assert.equal((await provider.evaluate({ ...request, model: 'chosen' })).model, 'fixture-generative');
});

test('missing usage and unreported model remain explicit', async () => {
  const data = chat(); delete data.usage; delete data.model;
  const result = await providerFor(data).evaluate(request);
  assert.deepEqual(result.usage, { input_tokens: null, output_tokens: null });
  assert.equal(result.model, 'test');
  assert.equal(result.meta.modelSource, 'requested');
});

for (const [label, mutate, code] of [
  ['refusal', d => { d.choices[0].message.refusal = 'private refusal'; }, 'MODEL_REFUSAL'],
  ['content filter', d => { d.choices[0].finish_reason = 'content_filter'; }, 'MODEL_REFUSAL'],
  ['truncation', d => { d.choices[0].finish_reason = 'length'; }, 'TRUNCATED_OUTPUT'],
  ['unexpected finish', d => { d.choices[0].finish_reason = 'tool_calls'; }, 'INVALID_RESPONSE'],
  ['multiple candidates', d => { d.choices.push(d.choices[0]); }, 'INVALID_RESPONSE'],
  ['empty choices', d => { d.choices = []; }, 'INVALID_RESPONSE'],
  ['missing message', d => { delete d.choices[0].message; }, 'INVALID_RESPONSE'],
  ['unexpected tool', d => { d.choices[0].message.tool_calls = []; }, 'INVALID_RESPONSE'],
  ['invalid text', d => { d.choices[0].message.content = 'not-json private'; }, 'INVALID_RESPONSE'],
  ['fenced text', d => { d.choices[0].message.content = '```json\n{}\n```'; }, 'INVALID_RESPONSE'],
  ['empty content', d => { d.choices[0].message.content = ''; }, 'INVALID_RESPONSE'],
  ['negative usage', d => { d.usage.prompt_tokens = -1; }, 'INVALID_RESPONSE'],
  ['error envelope', d => { d.error = { message: 'private' }; }, 'INVALID_RESPONSE'],
]) {
  test(`OpenAI rejects ${label}`, async () => {
    const data = chat(); mutate(data);
    await assert.rejects(providerFor(data).evaluate(request), e => e.code === code && !e.message.includes('private'));
  });
}

for (const [label, mutate] of [
  ['missing answer', d => { delete d.answers.yes; }],
  ['extra answer', d => { d.answers.extra = { noul: 1 }; }],
  ['missing probability', d => { delete d.answers.route.probabilities.b; }],
  ['extra probability', d => { d.answers.route.probabilities.c = 0; }],
  ['string probability', d => { d.answers.route.probabilities.a = '0.8'; }],
  ['invalid probability', d => { d.answers.route.probabilities.a = -0.8; }],
  ['wrong total', d => { d.answers.route.probabilities.a = 0.1; }],
  ['extra confidence', d => { d.answers.route.confidence = 0.9; }],
  ['extra top-level content', d => { d.explanation = 'x'; }],
  ['invalid noul', d => { d.answers.yes.noul = 1.1; }],
]) {
  test(`generated normalization rejects ${label}`, () => {
    const data = copy(generated); mutate(data);
    assert.throws(() => normalizeGenerated(data, { ...request, model: 'test' }), { code: 'INVALID_RESPONSE' });
  });
}

test('choice tie breaks in supplied criteria order and values are not renormalized', () => {
  const data = copy(generated); data.answers.route.probabilities = { b: 0.5, a: 0.5 };
  const result = normalizeGenerated(data, { ...request, model: 'test' });
  assert.equal(result.answers.route.choice, 'a');
  data.answers.route.probabilities.b = 0.4999;
  assert.equal(normalizeGenerated(data, { ...request, model: 'test' }).answers.route.probabilities.b, 0.4999);
});

test('schema and normalization safely preserve __proto__ and Unicode labels', () => {
  const special = JSON.parse('{"__proto__":{"type":"choice","instructions":"Choose","criteria":{"__proto__":null,"日本語":null}}}');
  const schema = buildResponseSchema(special);
  assert.equal(Object.hasOwn(schema.properties.answers.properties, '__proto__'), true);
  const payload = JSON.parse('{"answers":{"__proto__":{"probabilities":{"__proto__":0.2,"日本語":0.8}}}}');
  const result = normalizeGenerated(payload, { state: '', model: 'test', questions: special });
  assert.equal(result.answers.__proto__.choice, '日本語');
  assert.equal({}.polluted, undefined);
});

test('OpenRouter fixed preset chooses its own key and requires parameter support', async () => {
  let urlSeen;
  const provider = new OpenRouterProvider({ apiKey: 'router-fixture', model: 'vendor/test', parameters: {
    provider: { sort: 'price', require_parameters: false },
  }, fetchImpl: async (url, init) => {
    urlSeen = url;
    assert.equal(init.headers.authorization, 'Bearer router-fixture');
    const body = JSON.parse(init.body);
    assert.deepEqual(body.provider, { sort: 'price', require_parameters: true });
    assert.equal(body.max_tokens, 4096);
    return jsonResponse(chat());
  } });
  const result = await provider.evaluate(request);
  assert.equal(urlSeen, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(result.meta.provider, 'openrouter');
});

test('loopback connections can explicitly omit auth; remote ones cannot', async () => {
  const provider = new OpenAICompatibleProvider({ apiKey: null, model: 'local', baseURL: 'http://127.0.0.1:1234/v1',
    fetchImpl: async (url, init) => {
      assert.equal(init.headers.authorization, undefined);
      assert.equal(url, 'http://127.0.0.1:1234/v1/chat/completions');
      return jsonResponse(chat());
    } });
  await provider.evaluate(request);
  assert.throws(() => new OpenAICompatibleProvider({ apiKey: null, baseURL: 'https://example.com/v1' }), { code: 'CONFIGURATION_ERROR' });
  assert.throws(() => new OpenAICompatibleProvider({ baseURL: 'https://example.com/v1' }), { code: 'CONFIGURATION_ERROR' });
});

for (const config of [{ responseFormat: 'auto' }, { tokenParameter: 'tokens' }, { maxTokens: 0 },
  { parameters: { messages: [] } }, { parameters: { stream: true } }, { parameters: { n: 2 } },
  { parameters: { max_tokens: 3 } }, { parameters: [] }, { model: '' }]) {
  test(`invalid generative configuration ${JSON.stringify(config)}`, () => {
    assert.throws(() => new OpenAICompatibleProvider({ apiKey: 'test', ...config }), { code: 'CONFIGURATION_ERROR' });
  });
}

test('generative presets reject legacy function controls before dispatch', () => {
    let calls = 0;
    for (const Provider of [OpenAICompatibleProvider, OpenRouterProvider, AnthropicProvider]) {
        for (const parameters of [
            { functions: [{ name: 'other_output', parameters: { type: 'object' } }] },
            { function_call: { name: 'other_output' } },
        ]) {
            assert.throws(() => new Provider({ apiKey: 'fixture', model: 'fixture', parameters,
                fetchImpl: async () => { calls++; return jsonResponse(chat()); } }),
            { code: 'CONFIGURATION_ERROR' });
        }
    }
    assert.equal(calls, 0);
});

test('Anthropic forced output protocol and cache accounting', async () => {
  const provider = new AnthropicProvider({ apiKey: 'anthropic-fixture', model: 'chosen', fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers['x-api-key'], 'anthropic-fixture');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(init.body);
    assert.deepEqual(body.tool_choice, { type: 'tool', name: 'submit_decisions', disable_parallel_tool_use: true });
    assert.deepEqual(body.tools[0].input_schema, buildResponseSchema(request.questions));
    const data = message(); data.usage.cache_read_input_tokens = 20;
    return jsonResponse(data);
  } });
  const result = await provider.evaluate(request);
  assert.equal(result.usage.cache_read_input_tokens, 20);
  assertNoConfidence(result);
});

for (const [label, mutate, code] of [
  ['refusal', d => { d.stop_reason = 'refusal'; }, 'MODEL_REFUSAL'],
  ['refusal details', d => { d.stop_details = { type: 'refusal' }; }, 'MODEL_REFUSAL'],
  ['truncation', d => { d.stop_reason = 'max_tokens'; }, 'TRUNCATED_OUTPUT'],
  ['context limit', d => { d.stop_reason = 'model_context_window_exceeded'; }, 'TRUNCATED_OUTPUT'],
  ['no tool', d => { d.content = []; }, 'INVALID_RESPONSE'],
  ['multiple tools', d => { d.content.push(d.content[0]); }, 'INVALID_RESPONSE'],
  ['wrong tool', d => { d.content[0].name = 'execute_shell'; }, 'INVALID_RESPONSE'],
  ['wrong stop', d => { d.stop_reason = 'end_turn'; }, 'INVALID_RESPONSE'],
  ['cache usage', d => { d.usage.cache_read_input_tokens = -1; }, 'INVALID_RESPONSE'],
]) {
  test(`Anthropic rejects ${label}`, async () => {
    const data = message(); mutate(data);
    const provider = new AnthropicProvider({ apiKey: 'test', model: 'fixture', fetchImpl: async () => jsonResponse(data) });
    await assert.rejects(provider.evaluate(request), { code });
  });
}

test('Anthropic missing usage is unknown, not zero; extended thinking is explicit unsupported', async () => {
  const data = message(); delete data.usage;
  const result = await new AnthropicProvider({ apiKey: 'test', model: 'fixture', fetchImpl: async () => jsonResponse(data) }).evaluate(request);
  assert.equal(result.usage.input_tokens, null);
  assert.throws(() => new AnthropicProvider({ apiKey: 'test', parameters: { thinking: {} } }), { code: 'CONFIGURATION_ERROR' });
});

for (const Provider of [OpenAICompatibleProvider, AnthropicProvider]) {
  test(`${Provider.name} model listing preserves pagination without requiring a default model`, async () => {
    const provider = new Provider({ apiKey: 'test', fetchImpl: async (_, init) => {
      assert.equal(init.method, 'GET');
      return jsonResponse({ data: [{ id: 'test-model' }], has_more: true, last_id: 'test-model' });
    } });
    const result = await createBridge({ provider }).listModels();
    assert.equal(result.models[0].name, 'test-model');
    assert.equal(result.has_more, true);
    assert.equal(result.last_id, 'test-model');
  });
}

test('native confidence and usage are still required by Jev provider', async () => {
  const data = copy(response); delete data.answers.route.confidence;
  await assert.rejects(new JevProvider({ apiKey: 'test', fetchImpl: async () => jsonResponse(data) }).evaluate(request), { code: 'INVALID_RESPONSE' });
  data.answers.route.confidence = 0.6; data.usage.input_tokens = null;
  assert.throws(() => validateResult(data, request.questions, { native: true }), { code: 'INVALID_RESPONSE' });
});

test('provider factory supports every built-in type and rejects unknown types', () => {
  assert.equal(createProvider({ type: 'jev', apiKey: 'test' }).kind, 'decision');
  for (const type of ['openai-compatible', 'openrouter', 'anthropic']) {
    assert.throws(() => createProvider({ type, apiKey: 'test' }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(createGenerativeProvider({ type, apiKey: 'test' }).kind, 'generative');
  }
  assert.throws(() => createProvider({ type: 'mystery' }), { code: 'CONFIGURATION_ERROR' });
  assert.throws(() => parseGeneratedJson(null), { code: 'INVALID_RESPONSE' });
});

for (const Provider of [JevProvider, OpenAICompatibleProvider, OpenRouterProvider, AnthropicProvider]) {
  test(`${Provider.name} rejects unknown constructor options`, () => {
    assert.throws(() => new Provider({ apiKey: 'fixture-key', modle: 'typo' }), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => new Provider(null), { code: 'CONFIGURATION_ERROR' });
  });
}

test('factory rejects getters without invoking them', () => {
  let invoked = false;
  assert.throws(() => createProvider({ get type() { invoked = true; return 'jev'; } }), { code: 'CONFIGURATION_ERROR' });
  assert.equal(invoked, false);
  assert.throws(() => createProvider(null), { code: 'CONFIGURATION_ERROR' });
});

test('custom TypeSafe origins never inherit the ambient direct-access key', t => {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'ambient-secret';
  t.after(() => { if (previous === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previous; });
  assert.throws(() => new JevProvider({ baseURL: 'https://unrelated.example' }), { code: 'CONFIGURATION_ERROR' });
});

test('decoding failures retain request diagnostics without exposing raw upstream content', async () => {
  const provider = new JevProvider({ apiKey: 'fixture-secret', fetchImpl: async () => jsonResponse({ bad: 'fixture-secret' },
    200, { 'x-request-id': 'test-request-id' }) });
  await assert.rejects(provider.evaluate(request), error => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.attempts, 1);
    assert.equal(error.requestId, 'test-request-id');
    assert.equal(JSON.stringify(error).includes('fixture-secret'), false);
    return true;
  });
});

test('invalid reported generative model IDs are rejected rather than disguised by fallback', async () => {
  const provider = new OpenAICompatibleProvider({ apiKey: 'fixture-secret', model: 'requested',
    fetchImpl: async () => jsonResponse({ model: 42, choices: [{ finish_reason: 'stop',
      message: { content: '{"answers":{"yes":{"noul":0.5}}}' } }] }) });
  await assert.rejects(provider.evaluate({ state: 'fixture', questions: { yes: { type: 'noul', instructions: 'True?' } } }),
    error => error.code === 'INVALID_RESPONSE' && error.attempts === 1);
});

for (const [Provider, data] of [[JevProvider, {}], [OpenAICompatibleProvider, { data: [{ id: 42 }] }],
  [AnthropicProvider, { data: null }]]) {
  test(`${Provider.name} malformed model list retains safe response diagnostics`, async () => {
    const provider = new Provider({ apiKey: 'fixture-secret', fetchImpl: async () =>
      jsonResponse(data, 200, { 'x-request-id': 'listing-test-id' }) });
    await assert.rejects(provider.listModels(), error => {
      assert.equal(error.code, 'INVALID_RESPONSE');
      assert.equal(error.requestId, 'listing-test-id');
      assert.equal(error.attempts, 1);
      assert.equal(JSON.stringify(error).includes('fixture-secret'), false);
      return true;
    });
  });
}

for (const Provider of [OpenRouterProvider, AnthropicProvider]) {
  test(`${Provider.name} rejects parameter accessors without executing them`, () => {
    let reads = 0;
    const parameters = {};
    Object.defineProperty(parameters, Provider === OpenRouterProvider ? 'provider' : 'thinking', {
      enumerable: true, get() { reads++; return undefined; },
    });
    assert.throws(() => new Provider({ apiKey: 'fixture-key', parameters }), { code: 'CONFIGURATION_ERROR' });
    assert.equal(reads, 0);
  });
}

test('OpenRouter rejects non-enumerable parameters instead of silently dropping them', () => {
  const parameters = {};
  Object.defineProperty(parameters, 'temperature', { value: 0, enumerable: false });
  assert.throws(() => new OpenRouterProvider({ apiKey: 'fixture-key', parameters }), { code: 'CONFIGURATION_ERROR' });
});

test('Jev provider rejects invalid keys, origins, and retry policy', () => {
  assert.throws(() => new JevProvider({ apiKey: '' }), { code: 'CONFIGURATION_ERROR' });
  assert.throws(() => new JevProvider({ apiKey: 'test', baseURL: 'http://example.com' }), { code: 'CONFIGURATION_ERROR' });
  assert.throws(() => new JevProvider({ apiKey: 'test', baseURL: 'https://api.typesafe.ai/v1' }), { code: 'CONFIGURATION_ERROR' });
  assert.throws(() => new JevProvider({ apiKey: 'test', maxRetries: -1 }), { code: 'CONFIGURATION_ERROR' });
});
