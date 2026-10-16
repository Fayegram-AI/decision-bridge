import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli } from '../src/cli/main.mjs';
import { loadConfig, validateConfig } from '../src/cli/config.mjs';
import { streams, temporaryWorkspace } from './support.mjs';
import { image, native, jevResponse } from './jev-fixtures.mjs';

async function invoke(args, request, context = {}) {
    const io = streams(); if (request !== undefined) io.stdin.end(request);
    const code = await runCli(args, { ...io, env: {}, ...context });
    return { code, stdout: io.output(), stderr: io.error() };
}

test('Jev CLI validates native and common images offline with explicit opt-in', async () => {
    const common = { model: 'jev-preview', input: [{ type: 'image', dataUrl: image }], questions: native.questions };
    for (const [request, flags] of [[native, ['--native']], [common, []]]) {
        const result = await invoke(['validate', '-', '--jev-images', ...flags], JSON.stringify(request));
        assert.equal(result.code, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).questionCount, 2);
        const disabled = await invoke(['validate', '-', ...flags], JSON.stringify(request));
        assert.equal(disabled.code, 2);
        assert.equal(JSON.parse(disabled.stderr).error.code, 'UNSUPPORTED_CAPABILITY');
    }
    for (const flags of [['--jev-images', '--no-jev-images'], ['--jev-long-context', '--no-jev-long-context']]) {
        assert.equal((await invoke(['validate', '-', ...flags], JSON.stringify(native))).code, 2);
    }
});

test('Jev CLI config precedence preserves independent opt-ins and clears them on provider switch', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'jev', dangerZone: { images: true, longContext: true } }));
    const loaded = await loadConfig({ cwd, configPath: 'config.json', env: { DECISION_JEV_IMAGES: 'false' },
        overrides: { dangerZone: { images: true } } });
    assert.deepEqual(loaded.config.dangerZone, { images: true, longContext: true });
    const switched = await loadConfig({ cwd, configPath: 'config.json', env: {}, overrides: { provider: 'openai-decisions' } });
    assert.equal(switched.config.dangerZone, undefined);
    assert.throws(() => validateConfig({ provider: 'openai-decisions', dangerZone: { images: true } }), { code: 'CONFIGURATION_ERROR' });
    await assert.rejects(loadConfig({ env: { DECISION_JEV_LONG_CONTEXT: '1' } }), { code: 'CONFIGURATION_ERROR' });
    const disabled = await invoke(['validate', '-', '--config', 'config.json', '--native', '--no-jev-images'], JSON.stringify(native), { cwd });
    assert.equal(disabled.code, 2);
});

test('malformed experimental settings fail before partial layers can hide them', async t => {
    const cwd = await temporaryWorkspace(t);
    for (const dangerZone of [null, true, 42, 'enabled', [], { images: 'true' }, { typo: true }]) {
        assert.throws(() => validateConfig({ dangerZone }), { code: 'CONFIGURATION_ERROR' });
        await assert.rejects(loadConfig({ env: {}, overrides: { dangerZone } }), { code: 'CONFIGURATION_ERROR' });
        // The provider may be omitted from a valid Jev profile. A flag must not
        // make a malformed file acceptable by spreading its value into an object.
        await writeFile(join(cwd, 'config.json'), JSON.stringify({ dangerZone }));
        const result = await invoke(['validate', '-', '--config', 'config.json', '--jev-images'],
            JSON.stringify({ state: 'Text', questions: { q: { type: 'noul', instructions: 'True?' } } }), { cwd });
        assert.equal(result.code, 2, result.stdout);
        assert.equal(JSON.parse(result.stderr).error.code, 'CONFIGURATION_ERROR');
    }
    const loaded = await loadConfig({ env: { DECISION_JEV_LONG_CONTEXT: 'true' }, overrides: { dangerZone: { images: true } } });
    assert.deepEqual(loaded.config.dangerZone, { images: true, longContext: true });
});

test('offline native validation rejects shadowed asset references before credentials are needed', async () => {
    const request = { ...native, state: 'reference-photo-long', assets: {
        'reference-photo': Object.values(native.assets)[0], 'reference-photo-long': Object.values(native.assets)[0],
    } };
    for (const command of ['validate', 'evaluate']) {
        const result = await invoke([command, '-', '--native', '--jev-images'], JSON.stringify(request));
        assert.equal(result.code, 2);
        assert.equal(JSON.parse(result.stderr).error.code, 'VALIDATION_ERROR');
    }
    const accepted = await invoke(['validate', '-', '--native', '--jev-images'],
        JSON.stringify({ ...request, state: ['reference-photo', 'reference-photo-long'] }));
    assert.equal(accepted.code, 0, accepted.stderr);
});

test('Jev CLI native evaluate, ordered batch, models and initialization share the provider contract', async t => {
    const bodies = [];
    const server = createServer(async (req, res) => {
        assert.equal(req.headers.authorization, 'Bearer fixture-key');
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') { res.end(JSON.stringify({ models: [{ name: 'jev-preview' }] })); return; }
        assert.equal(req.url, '/v1/systemone');
        assert.equal(req.headers['typesafe-danger-zone-images'], 'true');
        assert.equal(req.headers['typesafe-danger-zone-long-context'], 'true');
        let body = ''; for await (const chunk of req) body += chunk;
        const request = JSON.parse(body); bodies.push(request);
        res.end(JSON.stringify(jevResponse(request)));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const flags = ['--base-url', `http://127.0.0.1:${server.address().port}`, '--api-key-env', 'TEST_API_KEY',
        '--jev-images', '--jev-long-context'];
    const context = { env: { TEST_API_KEY: 'fixture-key' } };
    const result = await invoke(['evaluate', '-', '--native', ...flags], JSON.stringify(native), context);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).decision.answers.target.box.left, 0.2);
    const batch = await invoke(['batch', '-', '--native', ...flags], JSON.stringify(native) + '\n' + JSON.stringify(native) + '\n', context);
    assert.equal(batch.code, 0, batch.stderr);
    assert.deepEqual(batch.stdout.trim().split('\n').map(line => JSON.parse(line).line), [1, 2]);
    assert.equal(bodies.length, 3);
    const models = await invoke(['models', ...flags], undefined, context);
    assert.equal(models.code, 0, models.stderr);
    assert.equal(JSON.parse(models.stdout).models[0].name, 'jev-preview');
    const cwd = await temporaryWorkspace(t);
    const initialized = await invoke(['init', '--native', '--model', 'jev-preview', '--jev-images'], undefined, { cwd });
    assert.equal(initialized.code, 0, initialized.stderr);
    const config = JSON.parse(await readFile(join(cwd, 'decision.config.json'), 'utf8'));
    assert.equal(config.dangerZone.images, true);
    const validated = await invoke(['validate', 'request.json', '--config', 'decision.config.json', '--native'], undefined, { cwd });
    assert.equal(validated.code, 0, validated.stderr);
});
