// Synthetic Anthropic protocol fixtures; no hosted inference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/index.mjs';
import { AnthropicProvider, createGenerativeProvider, buildResponseSchema } from '../src/custom/generative/index.mjs';
import { request } from './fixtures.mjs';

const payload = { answers: { route: { probabilities: { a: 0.8, b: 0.2 } },
    yes: { noul: 0.7 }, level: { probabilities: { 0: 0.25, 1: 0.75 } } } };
const message = (mode = 'json_schema') => ({ model: 'reported', stop_reason: mode === 'tool' ? 'tool_use' : 'end_turn',
    content: mode === 'tool' ? [{ type: 'tool_use', name: 'submit_decisions', input: payload }]
        : [{ type: 'text', text: JSON.stringify(payload) }],
    usage: { input_tokens: 12, output_tokens: 4, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } });

for (const responseFormat of ['tool', 'json_schema']) for (const apiVersion of ['2023-06-01', '2026-10-21']) {
    test(`Anthropic ${responseFormat}/${apiVersion} preserves answers, headers and effort`, async () => {
        const calls = [];
        const model = { id: 'catalog-model', capabilities: { example: true } };
        const provider = createGenerativeProvider({ type: 'anthropic', apiKey: 'fixture', model: 'selected',
            responseFormat, apiVersion, parameters: { output_config: { effort: 'medium' } }, fetchImpl: async (url, init) => {
                calls.push({ url, ...init });
                assert.equal(init.headers['anthropic-version'], apiVersion);
                return Response.json(init.method === 'GET' ? { data: [model], has_more: true, last_id: model.id } : message(responseFormat));
            } });
        const result = await createBridge({ provider }).evaluate(request);
        const body = JSON.parse(calls[0].body);
        assert.equal(body.max_tokens, 4096);
        assert.equal(body.output_config.effort, 'medium');
        if (responseFormat === 'json_schema') {
            assert(!Object.hasOwn(body, 'tools') && !Object.hasOwn(body, 'tool_choice'));
            assert.deepEqual(body.output_config.format, { type: 'json_schema', schema: buildResponseSchema(request.questions) });
        } else {
            assert.deepEqual(body.tool_choice, { type: 'tool', name: 'submit_decisions', disable_parallel_tool_use: true });
            assert.deepEqual(body.tools[0].input_schema, buildResponseSchema(request.questions));
            assert(!Object.hasOwn(body.output_config, 'format'));
        }
        assert.equal(result.answers.route.choice, 'a');
        assert.equal(result.answers.yes.noul, 0.7);
        assert.equal(result.answers.level.score, 0.75);
        assert.equal(result.meta.schemaVersion, 1);
        assert.equal(result.meta.responseFormat, responseFormat);
        assert.equal(result.meta.probabilitySource, 'elicited');
        assert.equal(result.meta.confidenceSource, 'unavailable');
        assert(!Object.hasOwn(result.answers.route, 'confidence'));
        assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 4,
            cache_creation_input_tokens: 2, cache_read_input_tokens: 3 });
        const catalog = await provider.listModels();
        assert.deepEqual(catalog, { models: [{ ...model, name: model.id }], has_more: true, last_id: model.id });
        assert.equal(calls[1].method, 'GET');
    });
}

test('JSON text fragments join exactly while default thinking stays outside results', async () => {
    const data = message();
    const text = data.content[0].text;
    data.content = [{ type: 'thinking', thinking: 'private-thinking-marker', signature: 'synthetic' },
        { type: 'text', text: text.slice(0, 24) }, { type: 'redacted_thinking', data: 'private-thinking-marker' },
        { type: 'text', text: text.slice(24) }];
    delete data.usage;
    const result = await new AnthropicProvider({ apiKey: 'fixture', model: 'selected', responseFormat: 'json_schema',
        fetchImpl: async (_url, init) => {
            assert.equal(init.headers['anthropic-version'], '2023-06-01');
            return Response.json(data);
        } }).evaluate(request);
    assert.equal(result.answers.yes.noul, 0.7);
    assert.deepEqual(result.usage, { input_tokens: null, output_tokens: null });
    assert(!JSON.stringify(result).includes('private-thinking-marker'));
});

for (const [label, mutate, code] of [
    ['refusal', data => { data.stop_reason = 'refusal'; }, 'MODEL_REFUSAL'],
    ['refusal details', data => { data.stop_details = { type: 'refusal' }; }, 'MODEL_REFUSAL'],
    ['token truncation', data => { data.stop_reason = 'max_tokens'; }, 'TRUNCATED_OUTPUT'],
    ['context truncation', data => { data.stop_reason = 'model_context_window_exceeded'; }, 'TRUNCATED_OUTPUT'],
    ['unexpected stop', data => { data.stop_reason = 'tool_use'; }, 'INVALID_RESPONSE'],
    ['tool block', data => { data.content.push({ type: 'tool_use', name: 'submit_decisions', input: payload }); }, 'INVALID_RESPONSE'],
    ['unknown block', data => { data.content.push({ type: 'image', source: {} }); }, 'INVALID_RESPONSE'],
    ['non-object block', data => { data.content.push(null); }, 'INVALID_RESPONSE'],
    ['non-string text', data => { data.content[0].text = {}; }, 'INVALID_RESPONSE'],
    ['no text', data => { data.content = [{ type: 'thinking', thinking: '' }]; }, 'INVALID_RESPONSE'],
    ['empty text', data => { data.content[0].text = '  '; }, 'INVALID_RESPONSE'],
    ['malformed JSON', data => { data.content[0].text = '{'; }, 'INVALID_RESPONSE'],
    ['fenced JSON', data => { data.content[0].text = '```json\n' + data.content[0].text + '\n```'; }, 'INVALID_RESPONSE'],
    ['invalid distribution', data => { const bad = structuredClone(payload); bad.answers.route.probabilities.a = 2;
        data.content[0].text = JSON.stringify(bad); }, 'INVALID_RESPONSE'],
]) {
    test(`Anthropic JSON rejects ${label} without a fallback request`, async () => {
        const data = message(); mutate(data);
        let calls = 0;
        const provider = new AnthropicProvider({ apiKey: 'fixture', model: 'selected', responseFormat: 'json_schema',
            fetchImpl: async () => { calls++; return Response.json(data, { headers: { 'request-id': 'synthetic-id' } }); } });
        await assert.rejects(provider.evaluate(request), error => error.code === code && error.requestId === 'synthetic-id');
        assert.equal(calls, 1);
    });
}

test('upstream schema rejection preserves selected protocol and makes no fallback call', async () => {
    let calls = 0;
    const provider = new AnthropicProvider({ apiKey: 'fixture', model: 'selected', responseFormat: 'json_schema', apiVersion: '2026-10-21',
        fetchImpl: async () => { calls++; return Response.json({ error: { type: 'invalid_request_error', message: 'synthetic' } }, { status: 400 }); } });
    await assert.rejects(provider.evaluate(request), error => error.status === 400);
    assert.equal(calls, 1);
});
