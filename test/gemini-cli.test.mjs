/** Offline and loopback CLI integration uses the same Google codec as the SDK. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { runCli } from '../src/cli/main.mjs';
import { loadConfig, validateConfig } from '../src/cli/config.mjs';
import { streams, temporaryWorkspace } from './support.mjs';
import { geminiResponse, nativeRequest, pdf } from './gemini-fixtures.mjs';

async function invoke(args, input, context = {}) {
    const io = streams();
    if (input !== undefined) io.stdin.end(input);
    const code = await runCli(args, { ...io, env: {}, ...context });
    return { code, stdout: io.output(), stderr: io.error() };
}

test('Gemini offline CLI validation accepts native/common documents without credentials', async () => {
    const common = { input: [{ type: 'document', dataUrl: pdf }], questions: nativeRequest.questions };
    for (const [request, extra] of [[nativeRequest, ['--native']], [common, []]]) {
        const result = await invoke(['validate', '-', '--provider', 'gemini-decisions', ...extra], JSON.stringify(request));
        assert.equal(result.code, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).model, 'gemini-decision-1');
    }
    assert.equal((await invoke(['validate', '-', '--provider', 'gemini-decisions'],
        JSON.stringify({ ...common, model: 'unknown' }))).code, 2);
    assert.throws(() => validateConfig({ provider: 'gemini-decisions', apiKey: 'literal' }), { code: 'CONFIGURATION_ERROR' });
});

test('Gemini larger budgets match generated schemas, config layers and common resolution validation', async t => {
    const cwd = await temporaryWorkspace(t);
    const valid = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(
        await readFile(new URL('../schemas/decision.config.schema.json', import.meta.url), 'utf8')));
    const config = { provider: 'gemini-decisions', maxRequestBytes: 167772160 };
    assert.equal(valid(config), true, JSON.stringify(valid.errors));
    assert.equal(valid({ ...config, maxRequestBytes: 167772161 }), false);
    assert.equal(valid({ provider: 'openai-decisions', maxRequestBytes: 67108865 }), false);
    assert.equal(valid({ schemaVersion: 2, defaultRoute: 'google', routes: { google: { config } } }), true,
        JSON.stringify(valid.errors));
    await writeFile(join(cwd, 'config.json'), JSON.stringify(config));
    assert.equal((await loadConfig({ cwd, configPath: 'config.json', env: {} })).config.maxRequestBytes, 167772160);
    const loaded = await loadConfig({ cwd, configPath: 'config.json', env: {}, overrides: { maxRequestBytes: 100000000 } });
    assert.equal(loaded.config.maxRequestBytes, 100000000);
    const request = { input: [{ type: 'image', url: 'https://example.com/a.png', mimeType: 'image/png', resolution: 'ultra_high' }],
        questions: nativeRequest.questions };
    const result = await invoke(['validate', '-', '--config', 'config.json'], JSON.stringify(request), { cwd });
    assert.equal(result.code, 0, result.stderr);
});

test('Gemini init generates credential references, schema-valid profiles and native samples', async t => {
    const cwd = await temporaryWorkspace(t);
    const schema = JSON.parse(await readFile(new URL('../schemas/decision.config.schema.json', import.meta.url), 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    const valid = ajv.compile(schema);
    for (const native of [false, true]) {
        const folder = native ? 'native' : 'common';
        const result = await invoke(['init', folder, '--provider', 'gemini-decisions', ...(native ? ['--native'] : [])], undefined, { cwd });
        assert.equal(result.code, 0, result.stderr);
        const config = JSON.parse(await readFile(join(cwd, folder, 'decision.config.json'), 'utf8'));
        assert.equal(config.apiKeyEnv, undefined);
        assert.equal(config.model, 'gemini-decision-1');
        assert.equal(valid(config), true, JSON.stringify(valid.errors));
        assert.equal(config.apiKey, undefined);
        assert.match(await readFile(join(cwd, folder, '.env.example'), 'utf8'), /^GEMINI_API_KEY=/);
        const request = await readFile(join(cwd, folder, 'request.json'), 'utf8');
        const validated = await invoke(['validate', '-', '--config', join(folder, 'decision.config.json'), ...(native ? ['--native'] : [])], request, { cwd });
        assert.equal(validated.code, 0, validated.stderr);
    }
    await writeFile(join(cwd, '.env'), 'GEMINI_API_KEY=file-key\n');
    const loaded = await loadConfig({ cwd, envFile: '.env', env: { GEMINI_API_KEY: 'shell-key' },
        overrides: { provider: 'gemini-decisions' } });
    assert.equal(loaded.config.model, 'gemini-decision-1');
    assert.equal(loaded.env.GEMINI_API_KEY, 'shell-key');
    assert.equal(valid({ provider: 'gemini-decisions', apiKey: 'literal' }), false);
    const routed = await invoke(['init', 'routed', '--provider', 'gemini-decisions', '--route', 'auto'], undefined, { cwd });
    assert.equal(routed.code, 0, routed.stderr);
    const routedConfig = JSON.parse(await readFile(join(cwd, 'routed', 'decision.config.json'), 'utf8'));
    assert.equal(routedConfig.routes.primary.config.apiKeyEnv, undefined);
    assert.equal(valid(routedConfig), true, JSON.stringify(valid.errors));
    const inspected = await invoke(['inspect', '-', '--config', 'routed/decision.config.json'],
        JSON.stringify({ input: [{ type: 'document', dataUrl: pdf }], questions: nativeRequest.questions }), { cwd });
    assert.equal(inspected.code, 0, inspected.stderr);
});

test('Gemini CLI and routing support both Gemini credential environment names', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'routing.json'), JSON.stringify({ schemaVersion: 2, defaultRoute: 'google',
        routes: { google: { config: { provider: 'gemini-decisions' } } } }));
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
        calls++;
        assert.equal(init.headers['x-goog-api-key'], 'environment-fixture');
        return Response.json(geminiResponse(JSON.parse(init.body)));
    });
    const input = JSON.stringify({ state: 'Evidence', questions: nativeRequest.questions });
    for (const flags of [['--provider', 'gemini-decisions'], ['--config', 'routing.json']]) {
        const scoped = await invoke(['evaluate', '-', ...flags], input,
            { cwd, env: { DECISION_BRIDGE_GEMINI_API_KEY: 'environment-fixture' } });
        assert.equal(scoped.code, 0, scoped.stderr);
        const result = await invoke(['evaluate', '-', ...flags], input,
            { cwd, env: { GEMINI_API_KEY: 'other-fixture', DECISION_BRIDGE_GEMINI_API_KEY: 'environment-fixture' } });
        assert.equal(result.code, 0, result.stderr);
    }
    assert.equal(calls, 4);
});

test('Gemini CLI native/common execution, model listing, batches and safe refusals', async t => {
    const calls = [];
    const server = createServer(async (request, response) => {
        assert.equal(request.headers['x-goog-api-key'], 'fixture-secret');
        response.setHeader('content-type', 'application/json');
        if (request.method === 'GET') {
            assert.equal(request.url, '/v1beta/models/gemini-decision-1');
            response.end(JSON.stringify({ name: 'models/gemini-decision-1' }));
            return;
        }
        assert.equal(request.url, '/v1beta/decisions');
        let text = '';
        for await (const chunk of request) text += chunk;
        const body = JSON.parse(text);
        calls.push(body);
        if (body.input === 'blocked') {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: { code: 'safety', message: 'fixture-secret untrusted content' } }));
        } else response.end(JSON.stringify(geminiResponse(body)));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const flags = ['--provider', 'gemini-decisions', '--base-url', 'http://127.0.0.1:' + server.address().port,
        '--api-key-env', 'GEMINI_API_KEY'];
    const env = { GEMINI_API_KEY: 'fixture-secret' };
    for (const [request, extra] of [[nativeRequest, ['--native']], [{ state: 'Evidence', questions: nativeRequest.questions }, []]]) {
        const result = await invoke(['evaluate', '-', ...flags, ...extra], JSON.stringify(request), { env });
        assert.equal(result.code, 0, result.stderr);
        const batch = await invoke(['batch', '-', ...flags, ...extra], [request, request].map(JSON.stringify).join('\n'), { env });
        assert.equal(batch.code, 0, batch.stderr);
        assert(batch.stdout.trim().split('\n').map(JSON.parse).every(row => row.ok));
    }
    const models = await invoke(['models', ...flags], undefined, { env });
    assert.equal(models.code, 0, models.stderr);
    assert.equal(JSON.parse(models.stdout).models[0].name, 'gemini-decision-1');
    const blocked = await invoke(['evaluate', '-', '--native', ...flags], JSON.stringify({ ...nativeRequest, input: 'blocked' }), { env });
    assert.equal(JSON.parse(blocked.stderr).error.code, 'MODEL_REFUSAL');
    assert.equal(JSON.parse(blocked.stderr).error.upstreamErrorCode, 'safety');
    assert.equal(JSON.parse(blocked.stderr).error.upstreamCode, undefined);
    assert(!blocked.stderr.includes('fixture-secret') && !blocked.stderr.includes('untrusted content'));
    assert.equal(calls.length, 7);
});
