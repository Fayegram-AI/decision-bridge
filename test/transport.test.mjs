import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createBridge, JevProvider } from '../src/index.mjs';
import { JsonTransport, parseBaseURL } from '../src/transport.mjs';
import { request, response, jsonResponse } from './fixtures.mjs';

async function localServer(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const status of [429, 502, 503, 504, 529]) {
  test(`HTTP ${status} is retried within the retry budget`, async () => {
    let calls = 0;
    const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async () => ++calls === 1
      ? jsonResponse({ detail: 'temporary' }, status, { 'retry-after': '0' }) : jsonResponse() } });
    const result = await client.evaluate(request);
    assert.equal(calls, 2);
    assert.equal(result.meta.attempts, 2);
  });
}

for (const status of [400, 401, 403, 404, 422, 500]) {
  test(`HTTP ${status} is not retried by the default policy`, async () => {
    let calls = 0;
    const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async () => {
      calls++; return jsonResponse({ secret: 'private source and credentials' }, status);
    } } });
    await assert.rejects(client.evaluate(request), error => error.code === 'HTTP_ERROR' && error.status === status && !error.message.includes('private'));
    assert.equal(calls, 1);
  });
}

test('retry count is bounded and zero disables retries', async () => {
  for (const retries of [0, 2]) {
    let calls = 0;
    const client = createBridge({ jev: { apiKey: 'test', maxRetries: retries, fetchImpl: async () => {
      calls++; return jsonResponse({}, 429, { 'retry-after': '0' });
    } } });
    await assert.rejects(client.evaluate(request), error => error.code === 'HTTP_ERROR' && error.attempts === retries + 1);
    assert.equal(calls, retries + 1);
  }
});

test('long Retry-After is not ignored or shortened', async () => {
  let calls = 0;
  const client = createBridge({ jev: { apiKey: 'test', timeoutMs: 1000, fetchImpl: async () => {
    calls++; return jsonResponse({}, 429, { 'retry-after': '3600' });
  } } });
  await assert.rejects(client.evaluate(request), { code: 'RETRY_BUDGET_EXCEEDED' });
  assert.equal(calls, 1);
});

test('network errors do not trigger ambiguous duplicate requests or leak raw errors', async () => {
  let calls = 0;
  const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async () => {
    calls++; throw Error('secret-key-and-private-body');
  } } });
  await assert.rejects(client.evaluate(request), error => error.code === 'NETWORK_ERROR' && !error.message.includes('secret'));
  assert.equal(calls, 1);
});

test('invalid JSON is not silently treated as an answer or retried', async () => {
  let calls = 0;
  const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async () => { calls++; return new Response('not-json'); } } });
  await assert.rejects(client.evaluate(request), { code: 'INVALID_RESPONSE' });
  assert.equal(calls, 1);
});

test('cancellation before dispatch makes no request', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async () => { calls++; return jsonResponse(); } } });
  await assert.rejects(client.evaluate(request, { signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(calls, 0);
});

test('cancellation interrupts backoff', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = createBridge({ jev: { apiKey: 'test', timeoutMs: 10000, fetchImpl: async () => {
    calls++; setTimeout(() => controller.abort(), 10);
    return jsonResponse({}, 429, { 'retry-after': '2' });
  } } });
  await assert.rejects(client.evaluate(request, { signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(calls, 1);
});

test('models endpoint uses GET and preserves model cards', async () => {
  const client = createBridge({ jev: { apiKey: 'test', fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/models');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    return jsonResponse({ models: [{ name: 'fixture', description: 'local fixture' }] });
  } } });
  assert.equal((await client.listModels()).models[0].name, 'fixture');
});

test('actual HTTP integration posts and reads a mixed native response', async t => {
  const baseURL = await localServer(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.url, '/v1/systemone');
    assert.equal(req.headers.authorization, 'Bearer local-test-key');
    assert.equal(JSON.parse(body).questions.route.type, 'choice');
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'http-fixture' });
    res.end(JSON.stringify(response));
  });
  const result = await createBridge({ jev: { apiKey: 'local-test-key', baseURL } }).evaluate(request);
  assert.deepEqual(result.answers, response.answers);
  assert.equal(result.meta.requestId, 'http-fixture');
});

test('default fetch uses the global receiver required by browser fetch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function () {
    assert.equal(this, globalThis);
    return jsonResponse({ ok: true });
  };
  try {
    const transport = new JsonTransport({ baseURL: 'https://example.com' });
    assert.deepEqual((await transport.request('GET', '/test')).data, { ok: true });
  } finally { globalThis.fetch = original; }
});

test('deadline covers stalled HTTP response bodies, not just headers', async t => {
  const baseURL = await localServer(t, (req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"unfinished":');
  });
  const client = createBridge({ jev: { apiKey: 'local-test-key', baseURL, timeoutMs: 60 } });
  await assert.rejects(client.evaluate(request), error => error.code === 'TIMEOUT' && error.attempts === 1);
});

test('caller can cancel an in-flight HTTP request', async t => {
  const controller = new AbortController();
  const baseURL = await localServer(t, (req, res) => {
    req.resume(); res.writeHead(200); res.write('{'); controller.abort();
  });
  const client = createBridge({ jev: { apiKey: 'local-test-key', baseURL, timeoutMs: 1000 } });
  await assert.rejects(client.evaluate(request, { signal: controller.signal }), { code: 'ABORTED' });
});

for (const url of ['http://example.com', 'https://a:b@example.com', 'https://example.com?key=x',
  'https://example.com/#frag', 'file:///tmp/api', 'https://example.com\\evil', 'not a URL']) {
  test(`endpoint validation rejects ${url}`, () => assert.throws(() => parseBaseURL(url), { code: 'CONFIGURATION_ERROR' }));
}

test('transport rejects oversized outbound payload before issuing a call', async () => {
  let calls = 0;
  const transport = new JsonTransport({ baseURL: 'https://example.com', maxRequestBytes: 10,
    fetchImpl: async () => { calls++; return jsonResponse(); } });
  await assert.rejects(transport.request('POST', '/test', { message: 'too-long' }), { code: 'REQUEST_TOO_LARGE' });
  assert.equal(calls, 0);
});

test('transport enforces declared and streamed inbound byte limits', async () => {
  for (const headers of [{}, { 'content-length': '10000' }]) {
    const transport = new JsonTransport({ baseURL: 'https://example.com', maxResponseBytes: 5,
      fetchImpl: async () => jsonResponse({ long: 'value' }, 200, headers) });
    await assert.rejects(transport.request('GET', '/test'), { code: 'RESPONSE_TOO_LARGE' });
  }
});

test('transport rejects invalid UTF-8', async () => {
  const transport = new JsonTransport({ baseURL: 'https://example.com',
    fetchImpl: async () => new Response(new Uint8Array([123, 34, 255, 34, 58, 49, 125])) });
  await assert.rejects(transport.request('GET', '/test'), { code: 'INVALID_RESPONSE' });
});

test('noncooperative custom fetch is bounded', async () => {
  const transport = new JsonTransport({ baseURL: 'https://example.com', timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(transport.request('GET', '/test'), { code: 'TIMEOUT' });
});

test('stream cancellation cannot extend a deadline', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([123])); },
    cancel() { return new Promise(() => {}); } });
  const transport = new JsonTransport({ baseURL: 'https://example.com', timeoutMs: 10,
    fetchImpl: async () => new Response(stream) });
  await assert.rejects(transport.request('GET', '/test'), { code: 'TIMEOUT' });
});

test('continuously ready response chunks respect deadlines and caller cancellation', () => {
    const entry = new URL('../src/transport.mjs', import.meta.url).href;
    const code = `import assert from 'node:assert/strict';
import { JsonTransport } from ${JSON.stringify(entry)};
const transport = new JsonTransport({ baseURL: 'https://example.com', timeoutMs: 20,
    fetchImpl: async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(0)); },
    })) });
await assert.rejects(transport.request('GET', '/fixture'), { code: 'TIMEOUT' });
const controller = new AbortController();
const cancellable = new JsonTransport({ baseURL: 'https://example.com', timeoutMs: 1000,
    fetchImpl: async () => new Response(new ReadableStream({
        pull(stream) { stream.enqueue(new Uint8Array(0)); },
    })) });
const timer = setTimeout(() => controller.abort(), 5);
try {
    await assert.rejects(cancellable.request('GET', '/fixture', undefined, { signal: controller.signal }),
        { code: 'ABORTED' });
} finally { clearTimeout(timer); }`;
    // A regression would starve this process's timers; contain it in a subprocess.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        timeout: 10000, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
});

test('fragmented response bytes preserve UTF-8 across empty chunks and buffer growth', async () => {
    const data = { text: '界'.repeat(1800) };
    const payload = new TextEncoder().encode(JSON.stringify(data));
    let offset = 0;
    const transport = new JsonTransport({ baseURL: 'https://example.com', maxResponseBytes: payload.length,
        fetchImpl: async () => new Response(new ReadableStream({
            pull(controller) {
                controller.enqueue(new Uint8Array(0));
                if (offset < payload.length) controller.enqueue(payload.subarray(offset, ++offset));
                else controller.close();
            },
        })) });
    assert.deepEqual((await transport.request('GET', '/fixture')).data, data);
});

test('request IDs are bounded and redact credentials', async () => {
  const transport = new JsonTransport({ baseURL: 'https://example.com', secrets: ['secret-value'],
    fetchImpl: async () => jsonResponse({}, 200, { 'x-request-id': 'secret-value-' + 'x'.repeat(300) }) });
  const result = await transport.request('GET', '/test');
  assert.equal(result.meta.requestId.includes('secret-value'), false);
  assert.equal(result.meta.requestId.length, 200);
});

test('Retry-After HTTP dates are respected rather than shortened', async () => {
  const transport = new JsonTransport({ baseURL: 'https://example.com', timeoutMs: 10,
    fetchImpl: async () => jsonResponse({}, 429, { 'retry-after': new Date(Date.now() + 60000).toUTCString() }) });
  await assert.rejects(transport.request('GET', '/test'), { code: 'RETRY_BUDGET_EXCEEDED' });
});

test('native provider cancellation retains safe request ID and attempt count', async () => {
  const controller = new AbortController(); let contacted;
  const reached = new Promise(resolve => { contacted = resolve; });
  const provider = new JevProvider({ apiKey: 'fixture-secret', maxRetries: 1, timeoutMs: 5000,
    fetchImpl: async () => {
      contacted();
      return jsonResponse({}, 429, { 'x-request-id': 'retry-fixture-id', 'retry-after': '1' });
    } });
  const result = provider.evaluate(request, { signal: controller.signal });
  await reached;
  // Allow the transport to record the response metadata and enter its retry delay.
  await new Promise(resolve => setTimeout(resolve, 20)); controller.abort();
  await assert.rejects(result, error => {
    assert.equal(error.code, 'ABORTED');
    assert.equal(error.attempts, 1);
    assert.equal(error.requestId, 'retry-fixture-id');
    return true;
  });
});

test('native provider timeout retains sanitized metadata from a retry response', async () => {
  let calls = 0;
  const provider = new JevProvider({ apiKey: 'fixture-secret', maxRetries: 1, timeoutMs: 250,
    fetchImpl: async () => ++calls === 1
      ? jsonResponse({}, 429, { 'x-request-id': 'fixture-secret-id', 'retry-after': '0' })
      : new Promise(() => {}) });
  await assert.rejects(provider.evaluate(request), error => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.attempts, 2);
    assert.equal(error.requestId, '[REDACTED]-id');
    return true;
  });
});
