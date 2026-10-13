// Deadline checks must also cover synchronous work that delays timer callbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBridge, OpenAIDecisionsProvider, noul } from '../src/index.mjs';
import { deadline } from '../src/async.mjs';
import { JsonTransport } from '../src/transport.mjs';
import { configuredProvider } from '../src/cli/config.mjs';
import { jsonResponse } from './fixtures.mjs';
import { decisionResponse } from './decisions-fixtures.mjs';
import { temporaryWorkspace } from './support.mjs';

const request = { state: '', questions: { q: noul('True?') } };
const response = { model: 'fixture', answers: { q: { type: 'noul', noul: 0.7 } },
    usage: { input_tokens: 0, output_tokens: 0 } };
const provider = { kind: 'decision', name: 'fixture', defaultModel: 'fixture', async evaluate() { return response; } };

// Deliberately keep timers from running; asynchronous sleeping cannot reproduce this bug.
function occupyEventLoop(milliseconds = 20) {
    const until = performance.now() + milliseconds;
    while (performance.now() < until) { /* Simulate synchronous preparation or encoding. */ }
}

test('large Decisions preflight cannot dispatch after the bridge deadline', async () => {
    let calls = 0;
    const backend = new OpenAIDecisionsProvider({ apiKey: 'fixture-key', fetchImpl: async (_, init) => {
        calls++;
        return jsonResponse(decisionResponse(JSON.parse(init.body)));
    } });
    const bridge = createBridge({ provider: backend, timeoutMs: 5 });
    await assert.rejects(bridge.evaluate({ questions: request.questions, input: [{ type: 'image',
        dataUrl: 'data:image/png;base64,' + 'AAAA'.repeat(1500000),
    }] }), { code: 'TIMEOUT' });
    assert.equal(calls, 0);
});

test('HTTP transport inherits an expired outer budget before its timer has run', async () => {
    let calls = 0;
    const outer = deadline(5);
    const transport = new JsonTransport({ baseURL: 'https://example.com', timeoutMs: 60000,
        fetchImpl: async () => { calls++; return jsonResponse({}); } });
    try {
        occupyEventLoop();
        await assert.rejects(transport.request('GET', '/test', undefined, { signal: outer.signal }),
            error => error.code === 'TIMEOUT' && error.attempts === 0);
        assert.equal(calls, 0);
    } finally { outer.close(); }
});

test('HTTP serialization cannot spend after exhausting its own deadline', async () => {
    let calls = 0;
    const transport = new JsonTransport({ baseURL: 'https://example.com', timeoutMs: 5,
        fetchImpl: async () => { calls++; return jsonResponse({}); } });
    const body = { toJSON() { occupyEventLoop(); return {}; } };
    await assert.rejects(transport.request('POST', '/test', body),
        error => error.code === 'TIMEOUT' && error.attempts === 0);
    assert.equal(calls, 0);
});

test('synchronous ordered-input preparation exhausting the budget prevents inference', async () => {
    let calls = 0;
    const bridge = createBridge({ timeoutMs: 5, provider: { ...provider,
        getCapabilities() { return { orderedInput: true }; },
        async evaluate() { calls++; return response; },
    }, extensions: [{ name: 'prepare', prepareInput(parts) { occupyEventLoop(); return parts; } }] });
    await assert.rejects(bridge.evaluate({ questions: request.questions, input: [{ type: 'text', text: '' }] }),
        { code: 'TIMEOUT' });
    assert.equal(calls, 0);
});

for (const operation of ['evaluate', 'listModels']) {
    test(`synchronous ${operation} completion after the deadline cannot return success`, async t => {
        let calls = 0;
        // Advance inside dispatch so scheduling/preflight cannot exhaust this test's budget first.
        let now = 0;
        t.mock.method(performance, 'now', () => now);
        const backend = { ...provider, [operation]() {
            calls++; now = 20;
            return Promise.resolve(operation === 'evaluate' ? response : { models: [{ name: 'fixture' }] });
        } };
        const bridge = createBridge({ provider: backend, timeoutMs: 5 });
        await assert.rejects(operation === 'evaluate' ? bridge.evaluate(request) : bridge.listModels(),
            { code: 'TIMEOUT' });
        assert.equal(calls, 1);
    });
}

test('synchronous observer overruns remain isolated from successful inference', async () => {
    const bridge = createBridge({ provider, observerTimeoutMs: 5,
        extensions: [{ name: 'slow-observer', onResult() { occupyEventLoop(); } }] });
    const result = await bridge.evaluate(request);
    assert.equal(result.answers.q.noul, 0.7);
    assert.deepEqual(result.meta.observerFailures, ['slow-observer']);
});

test('synchronous custom initialization cannot return success after its deadline', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'provider.mjs'), `export function createProvider() {
        const until = performance.now() + 20;
        while (performance.now() < until) {}
        return { kind: 'decision', name: 'fixture', async evaluate() {} };
    }`);
    await assert.rejects(configuredProvider({ config: { provider: 'custom-decision', module: 'provider.mjs', timeoutMs: 5 },
        env: {}, moduleBase: cwd }), { code: 'TIMEOUT' });
});
