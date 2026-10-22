// Deterministic adapter contracts: no hosted inference or service quota probing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIDecisionsProvider, createBridge, noul, publicError } from '../src/index.mjs';
import { CloudflareExtractionProvider } from '../src/extraction/index.mjs';
import { decisionResponse, image } from './decisions-fixtures.mjs';
import { fixture as cloudflareFixture } from './cloudflare-fixtures.mjs';
import { jsonResponse } from './fixtures.mjs';

const questions = [{ type: 'predicate', instructions: '', name: 'q' }];
const conversation = [
    { role: 'system', content: [{ type: 'input_text', text: '' }] },
    { role: 'developer', content: 'Use supplied evidence.' },
    { role: 'user', content: [{ type: 'input_image', image_url: 'https://example.com/a.png',
        detail: 'high', prompt_cache_breakpoint: { mode: 'explicit' } }, { type: 'input_text', text: 'Inspect.' }] },
    { role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Checking.' }] },
    { type: 'function_call', name: 'lookup', call_id: 'a', arguments: '{ "id": 1 }', id: null, namespace: null, status: 'completed' },
    { type: 'function_call_output', call_id: 'a', output: [{ type: 'input_text', text: 'Found.' }] },
    { type: 'custom_tool_call', name: 'inspect', call_id: 'b', input: 'verbatim', namespace: 'tools' },
    { type: 'custom_tool_call_output', call_id: 'b', output: [{ type: 'input_image', image_url: image }] },
    { role: 'assistant', phase: 'final_answer', content: [{ type: 'refusal', refusal: '' }] },
];
function openai(options = {}) {
    const requests = [];
    const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture-secret', ...options, fetchImpl: async (_url, init) => {
        const request = JSON.parse(init.body); requests.push(request);
        return jsonResponse(decisionResponse(request));
    } });
    return { provider, requests };
}

test('all Decisions history and cache fields survive native encoding unchanged', async () => {
    const { provider, requests } = openai();
    const input = { input: conversation, questions, prompt_cache_key: null,
        prompt_cache_options: { mode: 'explicit', ttl: '30m' }, safety_identifier: '' };
    await provider.createDecision(input);
    assert.deepEqual(requests[0], { ...input, model: 'gpt-6-luna' });
    assert(!Object.isFrozen(input));
    assert.equal(requests[0].input[4].arguments, '{ "id": 1 }');
});

test('common conversations, preparation and remote/cache parts use schema 5', async () => {
    const { provider, requests } = openai();
    const bridge = createBridge({ provider, extensions: [{ name: 'history', prepareConversation(items) {
        assert(Object.isFrozen(items)); return [...items, { role: 'user', content: 'New evidence.' }];
    } }] });
    const result = await bridge.evaluate({ conversation, questions: { q: noul('True?') },
        promptCacheKey: 'tenant', promptCacheOptions: { mode: 'implicit' } });
    assert.equal(result.meta.schemaVersion, 5);
    assert.equal(requests[0].input.length, conversation.length + 1);
    assert.equal(requests[0].prompt_cache_key, 'tenant');
    const plain = createBridge({ provider });
    assert.equal((await plain.evaluate({ input: [{ type: 'image', url: 'https://example.com/a.png',
        promptCacheBreakpoint: null }], questions: { q: noul('True?') } })).meta.schemaVersion, 5);
    assert.deepEqual(requests[1].input[0].content[0], { type: 'input_image', image_url: 'https://example.com/a.png', prompt_cache_breakpoint: null });
    assert.equal((await plain.evaluate({ state: '', questions: { q: noul('True?') } })).meta.schemaVersion, 1);
});

test('unsupported new features and malformed transformed conversations prevent dispatch', async () => {
    const { provider, requests } = openai();
    const bridge = createBridge({ provider, extensions: [{ name: 'bad', prepareConversation() {
        return [{ role: 'assistant', content: [{ type: 'input_text', text: 'wrong form' }] }];
    } }] });
    await assert.rejects(bridge.evaluate({ conversation, questions: { q: noul('True?') } }), { code: 'VALIDATION_ERROR' });
    const custom = createBridge({ provider: { kind: 'decision', name: 'legacy', defaultModel: 'x', async evaluate() { throw Error('must not run'); } } });
    assert.throws(() => custom.validate({ conversation, questions: { q: noul('True?') } }), { code: 'UNSUPPORTED_CAPABILITY' });
    for (const input of [
        [{ type: 'function_call_output', call_id: 'unknown', output: '' }],
        [{ role: 'system', content: [{ type: 'input_image', image_url: image }] }],
        [{ role: 'user', content: [{ type: 'input_image', image_url: 'file:///private' }] }],
    ]) await assert.rejects(provider.createDecision({ input, questions }), { code: 'VALIDATION_ERROR' });
    assert.equal(requests.length, 0);
});

test('service question/image/choice counts are forwarded within client budgets', async () => {
    const { provider, requests } = openai();
    await provider.createDecision({ questions: Array.from({ length: 401 }, () => questions[0]),
        input: [{ role: 'user', content: Array.from({ length: 129 }, () => ({ type: 'input_image', image_url: image })) }] });
    await provider.createDecision({ input: '', questions: [{ type: 'choice', instructions: '',
        choices: Array.from({ length: 256 }, (_, i) => ({ value: String(i) })) }] });
    assert.equal(requests.length, 2);
    const cf = cloudflareFixture();
    await cf.bridge.evaluate({ state: '', questions: Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['q' + i, noul('True?')])) });
    await cf.provider.createDecision({ state: '', questions: { q: noul('True?') }, images: Array(5).fill(image) });
    assert.equal(cf.requests.length, 2);
    assert.equal(cf.bridge.getCapabilities().maxImages, null);
});

test('429 billing failures are classified and never retried; retry hints and status survive', async () => {
    for (const code of ['credit_balance_exhausted', 'project_spend_limit_exceeded', 'insufficient_quota']) {
        let calls = 0;
        const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture-secret', maxRetries: 2, fetchImpl: async () => {
            calls++; return jsonResponse({ error: { code, type: 'insufficient_quota', message: 'fixture-secret private prompt' } }, 429,
                { 'retry-after': '12', 'x-request-id': 'safe-id' });
        } });
        await assert.rejects(provider.createDecision({ input: '', questions }), error => {
            assert.equal(error.code, 'ALLOCATION_EXCEEDED'); assert.equal(error.retryable, false);
            assert.equal(error.retryAfterMs, 12000); assert.equal(error.status, 429);
            assert.equal(error.source, 'provider'); assert.equal(error.requestId, 'safe-id');
            assert.equal(error.upstreamErrorCode, code);
            assert(!JSON.stringify(publicError(error)).includes('fixture-secret'));
            return true;
        });
        assert.equal(calls, 1);
    }
    const malformed = new OpenAIDecisionsProvider({ apiKey: 'key', maxResponseBytes: 10,
        fetchImpl: async () => new Response('x'.repeat(20), { status: 429, headers: { 'retry-after': '1', 'x-request-id': 'id' } }) });
    await assert.rejects(malformed.createDecision({ input: '', questions }), { code: 'RATE_LIMITED', status: 429, requestId: 'id', retryAfterMs: 1000 });
});

test('ambiguous custom-fetch exceptions are not converted into retryable HTTP responses', async () => {
    let calls = 0;
    const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture', maxRetries: 1, fetchImpl: async () => {
        calls++; throw Object.assign(Error('private'), { status: 429, code: 'credit_balance_exhausted' });
    } });
    await assert.rejects(provider.createDecision({ input: '', questions }), { code: 'NETWORK_ERROR' });
    assert.equal(calls, 1);
});

test('interrupted rejection bodies preserve HTTP diagnostics and caller-selected retries', async () => {
    for (const cloudflare of [false, true]) for (const status of [403, 429]) {
        let calls = 0;
        const options = { apiKey: 'fixture-secret', maxRetries: 1, fetchImpl: async () => {
            calls++;
            return new Response(new ReadableStream({ start(stream) {
                stream.error(new Error('fixture-secret private body failure'));
            } }), { status, headers: { 'x-request-id': 'safe-id', 'retry-after': '0', 'cf-aig-log-id': 'safe-log' } });
        } };
        const provider = cloudflare ? new CloudflareExtractionProvider({ ...options, accountId: 'fixture-account' })
            : new OpenAIDecisionsProvider(options);
        const result = cloudflare ? provider.extract({ state: 'Evidence', fields: { q: { type: 'text' } } })
            : provider.createDecision({ input: '', questions });
        await assert.rejects(result, error => {
            assert.equal(error.status, status);
            assert.equal(error.code, status === 403 ? 'PERMISSION_DENIED' : 'RATE_LIMITED');
            assert.equal(error.requestId, 'safe-id');
            if (cloudflare) assert.equal(error.gatewayLogId, 'safe-log');
            assert.equal(error.retryAfterMs, 0);
            assert.equal(error.retryable, status === 429);
            assert.equal(error.attempts, status === 429 ? 2 : 1);
            assert(!JSON.stringify(publicError(error)).includes('fixture-secret'));
            return true;
        });
        assert.equal(calls, status === 429 ? 2 : 1);
    }
});

test('HTTP rejection body fallback preserves cancellation and deadline precedence', async () => {
    for (const cancel of [true, false]) {
        const abort = new AbortController();
        let calls = 0;
        let bodyStarted;
        const reading = new Promise(resolve => { bodyStarted = resolve; });
        const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture', timeoutMs: cancel ? 5000 : 200,
            maxRetries: 1, fetchImpl: async () => {
                calls++;
                return new Response(new ReadableStream({ pull() { bodyStarted(); return new Promise(() => {}); } }),
                    { status: 429, headers: { 'x-request-id': 'safe-id', 'retry-after': '0' } });
            } });
        const rejected = assert.rejects(provider.createDecision({ input: '', questions }, { signal: abort.signal }),
            { code: cancel ? 'ABORTED' : 'TIMEOUT', requestId: 'safe-id', attempts: 1 });
        await reading;
        if (cancel) abort.abort();
        await rejected;
        assert.equal(calls, 1);
    }
});
