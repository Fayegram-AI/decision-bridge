import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { runCli } from '../src/cli/main.mjs';
import { child, cleanEnv, workspace, temporaryWorkspace, streams, one } from './support.mjs';

const bin = fileURLToPath(new URL('../bin/decision.mjs', import.meta.url));
async function localServer(t, handler) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function invoke(args, context = {}) {
  const io = streams();
  const code = await runCli(args, { ...io, env: {}, ...context });
  return { code, stdout: io.output(), stderr: io.error() };
}

test('help, version and offline validation need no credentials', async () => {
  assert.equal((await child(['--help'])).code, 0);
  assert.equal((await child(['--version'])).stdout.trim(), '0.1.0');
  const result = await child(['validate']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
  assert.equal((await child([])).stdout.includes('Usage:'), true);
});

test('stdin JSON validation and schema inspection', async () => {
  const result = await child(['validate', '-', '--compact'], { input: JSON.stringify(one) });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  const schema = await child(['schema', '-'], { input: JSON.stringify(one) });
  assert.equal(JSON.parse(schema.stdout).properties.answers.properties.yes.properties.noul.type, 'number');
});

for (const args of [['badcommand'], ['--unknown'], ['validate', '--pretty', '--compact'],
  ['models', 'file'], ['validate', '--concurrency', '2'], ['validate', '--model', 'a', '--model', 'b'],
  ['validate', '--timeout-ms', 'abc'], ['validate', '--force'], ['validate', '--input', 'a', 'b'],
  ['models', '--input', 'a'], ['init', '--output', 'a'], ['evaluate', '--provider', 'custom-decision', '--provider-module', 'x', '--provider', 'jev']]) {
  test(`invalid CLI usage ${args.join(' ')}`, async () => {
    const result = await invoke(args);
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error.code, 'USAGE_ERROR');
  });
}

test('invalid input is detected before credentials or a provider are required', async () => {
  const result = await child(['evaluate', '-'], { input: '{bad json' });
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'VALIDATION_ERROR');
});

test('missing credential errors never print a key or raw stack', async () => {
  const result = await child(['evaluate']);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'CONFIGURATION_ERROR');
  assert.equal(result.stderr.includes(' at '), false);
});

test('explicit custom module evaluates, selects models and lists them', async t => {
  const cwd = await workspace(t);
  const args = ['evaluate', 'request.json', '--provider', 'custom-decision', '--provider-module', 'provider.mjs', '--model', 'selected'];
  const result = await child(args, { cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).model, 'selected');
  assert.equal(JSON.parse(result.stdout).answers.yes.noul, 0.42);
  assert.equal(JSON.parse(result.stdout).meta.probabilitySource, 'synthetic');
  const models = await child(['models', '--provider', 'custom-decision', '--provider-module', 'provider.mjs'], { cwd });
  assert.equal(JSON.parse(models.stdout).models[0].name, 'local-test-fixture');
});

test('config module path is relative to its explicit configuration file', async t => {
  const cwd = await workspace(t);
  await mkdir(join(cwd, 'nested'));
  await writeFile(join(cwd, 'nested/config.json'), JSON.stringify({ provider: 'custom-decision', module: '../provider.mjs' }));
  const result = await child(['evaluate', 'request.json', '--config', 'nested/config.json'], { cwd });
  assert.equal(result.code, 0, result.stderr);
});

test('no executable config is auto-discovered', async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'decision.config.js'), `throw Error('should never execute');`);
  await writeFile(join(cwd, 'decision.config.json'), JSON.stringify({ provider: 'custom-decision', module: 'provider.mjs' }));
  const result = await child(['evaluate', 'request.json'], { cwd });
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'CONFIGURATION_ERROR');
});

test('batch preserves line order, blank lines and per-record failures', async t => {
  const cwd = await workspace(t);
  const data = JSON.stringify({ ...one, state: 'slow' }) + '\r\n\r\nnot-json\n' + JSON.stringify(one);
  await writeFile(join(cwd, 'input.jsonl'), data);
  const result = await child(['batch', 'input.jsonl', '--provider', 'custom-decision', '--provider-module', 'provider.mjs', '--concurrency', '2'], { cwd });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stderr, '');
  const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row.line), [1, 3, 4]);
  assert.deepEqual(rows.map(row => row.ok), [true, false, true]);
});

test('batch accepts streamed stdin', async t => {
  const cwd = await workspace(t);
  const result = await child(['batch', '-', '--provider', 'custom-decision', '--provider-module', 'provider.mjs'], { cwd, input: JSON.stringify(one) + '\n' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('init writes useful templates without replacing existing files', async t => {
  const cwd = await workspace(t);
  const result = await child(['init', 'project'], { cwd });
  assert.equal(result.code, 0, result.stderr);
  const config = JSON.parse(await readFile(join(cwd, 'project/decision.config.json'), 'utf8'));
  assert.equal(config.provider, 'jev'); assert.equal(config.apiKeyEnv, 'TYPESAFE_API_KEY');
  assert.equal(config.model, 'jev-latest');
  assert.equal((await child(['init', 'project'], { cwd })).code, 2);
});

test('actual Jev HTTP request from CLI uses the explicit environment file', async t => {
  const cwd = await workspace(t);
  let captured;
  const baseURL = await localServer(t, async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    captured = { auth: req.headers.authorization, url: req.url, body: JSON.parse(raw) };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'fixture-live-http', answers: { yes: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: 1, output_tokens: 0 } }));
  });
  await writeFile(join(cwd, '.env'), 'TEST_JEV_KEY=file-fixture-key\n');
  const result = await child(['evaluate', 'request.json', '--base-url', baseURL, '--api-key-env', 'TEST_JEV_KEY', '--env-file', '.env'], { cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(captured.auth, 'Bearer file-fixture-key');
  assert.equal(captured.url, '/v1/systemone');
  assert.equal(captured.body.model, 'jev-latest');
  assert.equal(result.stdout.includes('file-fixture-key'), false);
});

test('OpenAI-compatible CLI uses explicit no-auth for local models', async t => {
  const cwd = await workspace(t);
  const base = await localServer(t, async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(JSON.parse(raw).model, 'local-model');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"answers":{"yes":{"noul":0.6}}}' } }] }));
  });
  const result = await child(['evaluate', 'request.json', '--provider', 'custom-generative', '--preset', 'openai-compatible', '--base-url', base + '/v1', '--no-auth', '--model', 'local-model'], { cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).meta.modelSource, 'requested');
});

test('HTTP errors are sanitized but preserve useful status and request ID', async t => {
  const cwd = await workspace(t);
  const baseURL = await localServer(t, (req, res) => { req.resume();
    res.writeHead(401, { 'x-request-id': 'fixture-request' });
    res.end(JSON.stringify({ message: 'private input and fixture-secret' }));
  });
  const result = await child(['evaluate', 'request.json', '--base-url', baseURL, '--api-key-env', 'TEST_KEY'], { cwd, env: { TEST_KEY: 'fixture-secret' } });
  assert.equal(result.code, 1);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.status, 401); assert.equal(error.requestId, 'fixture-request');
  assert.equal(result.stderr.includes('fixture-secret'), false);
  assert.equal(result.stdout, '');
});

test('error redaction preserves JSON keys and covers explicit nonstandard credential variables', async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'provider.mjs'), `export function createProvider({ apiKey }) {
    throw Error(apiKey);
  }`);
  const result = await child(['evaluate', 'request.json', '--provider', 'custom-decision', '--provider-module', 'provider.mjs', '--api-key-env', 'PASSWORD'],
    { cwd, env: { PASSWORD: 'error' } });
  assert.equal(result.code, 2);
  const data = JSON.parse(result.stderr);
  assert(Object.hasOwn(data, 'error'));
  assert.equal(data.error.code, 'CONFIGURATION_ERROR');
});

test('validate does not invent a Jev model for an unspecified generative model', async () => {
  const result = await child(['validate', '-', '--provider', 'custom-generative', '--preset', 'openrouter'], { input: JSON.stringify(one) });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).model, null);
});

test('SIGINT cancels a stalled HTTP inference without hanging', { skip: process.platform === 'win32' }, async t => {
  let received;
  const arrival = new Promise(resolve => { received = resolve; });
  const base = await localServer(t, () => received());
  const proc = spawn(process.execPath, [bin, 'evaluate', '-', '--base-url', base, '--api-key-env', 'TEST_ACCESS'],
    { env: cleanEnv({ TEST_ACCESS: 'fixture-key' }), stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk; }); proc.stdout.resume();
  const done = once(proc, 'close');
  proc.stdin.end(JSON.stringify(one));
  await Promise.race([arrival, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Error('CLI did not issue HTTP request')), 3000); timer.unref();
  })]);
  proc.kill('SIGINT');
  const [code] = await done;
  assert.equal(code, 130, stderr);
  assert.equal(JSON.parse(stderr).error.code, 'ABORTED');
});

test('custom async factory initialization is bounded', async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'provider.mjs'), 'export const createProvider = () => new Promise(() => {});\n');
  const result = await child(['evaluate', 'request.json', '--provider', 'custom-decision', '--provider-module', 'provider.mjs', '--timeout-ms', '20'], { cwd });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(JSON.parse(result.stderr).error.code, 'TIMEOUT');
});

test('custom top-level generation options fail rather than being ignored', async t => {
  const cwd = await workspace(t);
  const result = await child(['evaluate', 'request.json', '--provider', 'custom-decision', '--provider-module', 'provider.mjs', '--max-tokens', '500'], { cwd });
  assert.equal(result.code, 2, result.stderr);
  assert.equal(JSON.parse(result.stderr).error.code, 'CONFIGURATION_ERROR');
});

for (const args of [['batch'], ['batch', '-', '--concurrency', '0'], ['batch', '-', '--concurrency', 'not-a-number']]) {
  test(`batch usage is checked before constructing a provider: ${args.join(' ')}`, async () => {
    const stdout = new PassThrough(); const stderr = new PassThrough(); let diagnostic = '';
    stderr.on('data', chunk => { diagnostic += chunk; });
    const code = await runCli(args, { stdin: new PassThrough(), stdout, stderr, env: {} });
    assert.equal(code, 2);
    assert.equal(JSON.parse(diagnostic).error.code, 'USAGE_ERROR');
  });
}

test('streaming batch emits a completed record without waiting for more input or EOF', { timeout: 6000 }, async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'provider.mjs'), `export function createProvider() { return {
    kind: 'decision', name: 'synthetic-streaming-fixture', defaultModel: 'fixture', async evaluate(r) {
      return { model: r.model, answers: { yes: { type: 'noul', noul: 0.5 } },
        usage: { input_tokens: null, output_tokens: null } };
    }
  }; }`);
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  const controller = new AbortController(); let allOutput = ''; let allErrors = '';
  stderr.on('data', chunk => { allErrors += chunk; });
  const firstRecord = new Promise(resolve => stdout.on('data', chunk => {
    allOutput += chunk;
    if (allOutput.includes('\n')) resolve(allOutput.split('\n')[0]);
  }));
  const running = runCli(['batch', '-', '--provider', 'custom-decision', '--provider-module', 'provider.mjs', '--concurrency', '4'],
    { cwd, stdin, stdout, stderr, env: {}, signal: controller.signal });
  t.after(async () => { controller.abort(); stdin.end(); await running; });
  stdin.write(JSON.stringify(one) + '\n');
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No record emitted while stdin stayed open.')), 1500); });
  try {
    const line = await Promise.race([firstRecord, timeout]);
    assert.equal(JSON.parse(line).ok, true);
    assert.equal(stdin.writableEnded, false);
    stdin.end();
    assert.equal(await running, 0, allErrors);
  } finally { clearTimeout(timer); }
});

test('cancellation interrupts a blocked stdout write', { timeout: 6000 }, async () => {
  const controller = new AbortController();
  let started;
  const writing = new Promise(resolve => { started = resolve; });
  const stdout = { write() { started(); return false; } }; // Deliberately never calls the completion callback.
  const stderr = new PassThrough(); let errors = '';
  stderr.on('data', chunk => { errors += chunk; });
  const running = runCli(['validate'], { stdout, stderr, env: {}, signal: controller.signal });
  let timer;
  try {
    await writing;
    controller.abort();
    const code = await Promise.race([running,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Blocked output ignored cancellation.')), 1500); })]);
    assert.equal(code, 130);
    assert.equal(JSON.parse(errors).error.code, 'ABORTED');
  } finally { clearTimeout(timer); }
});

test('pre-cancelled CLI init performs no filesystem mutation', async t => {
  const cwd = await temporaryWorkspace(t); const controller = new AbortController(); controller.abort();
  const io = streams();
  assert.equal(await runCli(['init', 'new-project'], { ...io, cwd, env: {}, signal: controller.signal }), 130);
  assert.deepEqual(await readdir(cwd), []);
});

for (const flag of ['config', 'env-file', 'output', 'input', 'concurrency']) {
  test(`empty --${flag} is a usage error, not silently ignored`, async t => {
    const cwd = await temporaryWorkspace(t); const io = streams();
    const code = await runCli(['validate', `--${flag}=`], { ...io, cwd, env: {} });
    assert.equal(code, 2, io.output());
    assert.equal(JSON.parse(io.error()).error.code, 'USAGE_ERROR');
  });
}
