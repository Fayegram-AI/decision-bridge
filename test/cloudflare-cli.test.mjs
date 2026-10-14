import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli } from '../src/cli/main.mjs';
import { loadConfig } from '../src/cli/config.mjs';
import { streams, temporaryWorkspace } from './support.mjs';
import { image, native, cloudflareResponse, envelope } from './cloudflare-fixtures.mjs';
import { media, dataUrl, mp4 } from './media-fixtures.mjs';

async function invoke(args, input, context = {}) {
    const io = streams();
    if (input !== undefined) io.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
    const code = await runCli(args, { ...io, env: {}, ...context });
    return { code, stdout: io.output(), stderr: io.error() };
}
async function serverFor(t) {
    const bodies = [], headers = [];
    const server = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        assert.match(req.url, /^\/client\/v4\/accounts\/fixture-account\/ai\/run\/@cf\/cloudflare\/clef(?:-flash|-omni)?$/);
        assert.equal(req.headers.authorization, 'Bearer fixture-secret');
        const input = JSON.parse(body); bodies.push(input); headers.push(req.headers);
        res.setHeader('content-type', 'application/json');
        if (input.state === 'busy') {
            res.writeHead(429); res.end(JSON.stringify({ errors: [{ code: 3040, message: 'fixture-secret private' }], success: false }));
        } else res.end(JSON.stringify(envelope(cloudflareResponse(input))));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return { bodies, headers, flags: ['--provider', 'cloudflare-decisions', '--account-id', 'fixture-account',
        '--base-url', 'http://127.0.0.1:' + server.address().port, '--api-key-env', 'TEST_TOKEN'],
    env: { TEST_TOKEN: 'fixture-secret' } };
}

test('offline common/native validation has Cloudflare defaults and never requires credentials', async () => {
    for (const extra of [[], ['--native'], ['--native', '--model', '@cf/cloudflare/clef-flash']]) {
        const result = await invoke(['validate', '-', '--provider', 'cloudflare-decisions', ...extra], native);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).questionCount, 1);
    }
    const models = await invoke(['models', '--provider', 'cloudflare-decisions']);
    assert.equal(models.code, 1);
    assert.equal(JSON.parse(models.stderr).error.code, 'UNSUPPORTED_OPERATION');
    const bad = await invoke(['evaluate', '-', '--provider', 'cloudflare-decisions'], {
        ...native, input: [], state: undefined,
    });
    assert.equal(bad.code, 2);
    assert.equal(JSON.parse(bad.stderr).error.code, 'VALIDATION_ERROR');
});

test('Cloudflare native initialization produces placeholders and an offline-valid request', async t => {
    const cwd = await temporaryWorkspace(t);
    const init = await invoke(['init', '--provider', 'cloudflare-decisions', '--model', '@cf/cloudflare/clef-flash', '--native'],
        undefined, { cwd });
    assert.equal(init.code, 0, init.stderr);
    const config = JSON.parse(await readFile(join(cwd, 'decision.config.json'), 'utf8'));
    assert.equal(config.apiKeyEnv, 'CLOUDFLARE_API_TOKEN');
    const example = await readFile(join(cwd, '.env.example'), 'utf8');
    assert.match(example, /CLOUDFLARE_API_TOKEN=replace_with_/);
    assert.match(example, /CLOUDFLARE_ACCOUNT_ID=replace_with_/);
    assert.equal(JSON.parse(await readFile(join(cwd, 'request.json'), 'utf8')).model, 'clef-flash');
    const result = await invoke(['validate', 'request.json', '--config', 'decision.config.json', '--native'], undefined, { cwd });
    assert.equal(result.code, 0, result.stderr);
});

test('HTTP common/native evaluation, disabled busy overrides and Gateway configuration work through CLI', async t => {
    const { flags, env, bodies, headers } = await serverFor(t);
    const common = { input: [{ type: 'image', dataUrl: image }, { type: 'text', text: 'test' }], questions: {
        q: { type: 'choice', instructions: 'Pick.', options: [{ value: true }, { value: 'true' }] },
    } };
    const result = await invoke(['evaluate', '-', ...flags, '--gateway-id', 'existing'], common, { env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).answers.q.choice, true);
    assert.equal(Object.hasOwn(bodies[0], 'options'), false);
    assert.equal(headers[0]['cf-aig-gateway-id'], 'existing');
    const direct = await invoke(['evaluate', '-', ...flags, '--native', '--model', 'clef-flash'], native, { env });
    assert.equal(direct.code, 0, direct.stderr);
    assert.equal(JSON.parse(direct.stdout).decision.answers.q.noul, 0.7);
    assert.equal(bodies[1].model, 'clef-flash');
    assert.equal(Object.hasOwn(bodies[1], 'options'), false);
    const disabled = await invoke(['evaluate', '-', ...flags, '--native', '--no-reject-if-busy'],
        { ...native, options: { rejectIfBusy: true } }, { env });
    assert.equal(disabled.code, 0, disabled.stderr);
    assert.equal(Object.hasOwn(bodies[2], 'options'), false);
});

test('offline CLI rejects REST busy mode and invalid Gateway settings without credentials', async t => {
    const cwd = await temporaryWorkspace(t);
    for (const command of ['validate', 'evaluate']) for (const model of ['clef', 'clef-flash', 'clef-omni']) {
        for (const [input, extra] of [[native, ['--reject-if-busy']],
            [{ ...native, options: { rejectIfBusy: true } }, ['--native']]]) {
            const result = await invoke([command, '-', '--provider', 'cloudflare-decisions', '--model', model, ...extra], input);
            assert.equal(result.code, 2, result.stderr);
            const { error } = JSON.parse(result.stderr);
            assert.equal(error.code, 'UNSUPPORTED_CAPABILITY');
            assert.equal(error.status, undefined);
        }
    }
    for (const gateway of [{ id: 'g'.repeat(65) }, { id: 'test', cacheTtl: 59 }, { id: 'test', cacheTtl: 2592001 },
        { id: 'test', metadata: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } },
        { id: 'test', metadata: { 'cf.test': true } }]) {
        await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'cloudflare-decisions', gateway }));
        const result = await invoke(['validate', '-', '--config', 'config.json'], native, { cwd });
        assert.equal(result.code, 2, result.stderr);
        assert.equal(JSON.parse(result.stderr).error.code, 'CONFIGURATION_ERROR');
    }
    const disabled = await invoke(['validate', '-', '--provider', 'cloudflare-decisions', '--native', '--no-reject-if-busy'],
        { ...native, options: { rejectIfBusy: true } }, { env: { DECISION_REJECT_IF_BUSY: 'true' } });
    assert.equal(disabled.code, 0, disabled.stderr);
});

test('Cloudflare JSONL preserves row order and safe partial failure', async t => {
    const { flags, env } = await serverFor(t);
    const text = [native, { ...native, state: 'busy' }, native].map(JSON.stringify).join('\n');
    const result = await invoke(['batch', '-', ...flags, '--native'], text, { env });
    assert.equal(result.code, 1, result.stderr);
    const rows = result.stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => [row.line, row.ok]), [[1, true], [2, false], [3, true]]);
    assert.equal(rows[1].error.code, 'CAPACITY_EXCEEDED');
    assert.equal(rows[1].error.upstreamCode, 3040);
    assert(!result.stdout.includes('fixture-secret'));
});

test('Cloudflare JSONL retains row order and rejects unsupported busy records before dispatch', async t => {
    const { flags, env, bodies } = await serverFor(t);
    const text = [native, { ...native, options: { rejectIfBusy: true } }, native].map(JSON.stringify).join('\n');
    const result = await invoke(['batch', '-', ...flags, '--native', '--concurrency', '2'], text, { env });
    assert.equal(result.code, 1, result.stderr);
    const rows = result.stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => [row.line, row.ok]), [[1, true], [2, false], [3, true]]);
    assert.equal(rows[1].error.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal(rows[1].error.status, undefined);
    assert.equal(bodies.length, 2);
});

test('Cloudflare configuration precedence and provider switching keep provider fields coherent', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'config.json'), JSON.stringify({
        provider: 'cloudflare-decisions', accountId: 'file-account', rejectIfBusy: false,
        gateway: { id: 'file-gateway', collectLog: false }, model: 'clef',
    }));
    const loaded = await loadConfig({ cwd, configPath: 'config.json',
        env: { DECISION_ACCOUNT_ID: 'env-account', DECISION_REJECT_IF_BUSY: 'true', DECISION_GATEWAY_ID: 'env-gateway' },
        overrides: { accountId: 'flag-account', rejectIfBusy: false, gateway: { id: 'flag-gateway' } } });
    assert.equal(loaded.config.accountId, 'flag-account');
    assert.equal(loaded.config.rejectIfBusy, false);
    assert.equal(loaded.config.gateway.id, 'flag-gateway');
    assert.equal(loaded.config.gateway.collectLog, false);
    const switched = await loadConfig({ cwd, configPath: 'config.json', env: {}, overrides: { provider: 'openai-decisions' } });
    assert.equal(switched.config.accountId, undefined);
    assert.equal(switched.config.gateway, undefined);
    assert.equal(switched.config.rejectIfBusy, undefined);
    assert.equal(switched.config.model, 'default');
    await assert.rejects(loadConfig({ env: { DECISION_REJECT_IF_BUSY: 'yes' } }), { code: 'CONFIGURATION_ERROR' });
    const generative = await invoke(['validate', '-', '--provider', 'cloudflare-decisions', '--max-tokens', '100'], native);
    assert.equal(generative.code, 2);
});

test('Cloudflare JSON and JSONL accept records above 8 MiB and retain the 13 MiB ceiling', async () => {
    const large = JSON.stringify({ ...native, state: 'x'.repeat(8 * 1024 * 1024) });
    const result = await invoke(['validate', '-', '--provider', 'cloudflare-decisions'], large);
    assert.equal(result.code, 0, result.stderr);
    const legacy = await invoke(['validate', '-', '--provider', 'jev'], large);
    assert.equal(legacy.code, 2);
    assert.equal(JSON.parse(legacy.stderr).error.code, 'INPUT_TOO_LARGE');
    const huge = await invoke(['validate', '-', '--provider', 'cloudflare-decisions'],
        JSON.stringify({ ...native, state: 'x'.repeat(13 * 1024 * 1024) }));
    assert.equal(huge.code, 2);
    assert.equal(JSON.parse(huge.stderr).error.code, 'REQUEST_TOO_LARGE');
    const { readJsonLines } = await import('../src/cli/io.mjs');
    const io = streams(); io.stdin.end(large + '\n');
    const rows = [];
    for await (const row of readJsonLines('-', { stdin: io.stdin, maxInputBytes: 13 * 1024 * 1024 })) rows.push(row);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].input.state.length, 8 * 1024 * 1024);
});

test('Omni CLI supports offline media, native dispatch, aliases, initialization and mixed-model batch errors', async t => {
    const common = { model: 'clef-omni', input: [{ type: 'audio', dataUrl: media.wav },
        { type: 'video', dataUrl: media.webm }, { type: 'text', text: 'review' }], questions: native.questions };
    const offline = await invoke(['validate', '-', '--provider', 'cloudflare-decisions'], common);
    assert.equal(offline.code, 0, offline.stderr);
    const cwd = await temporaryWorkspace(t);
    const init = await invoke(['init', '--provider', 'cloudflare-decisions', '--model', '@cf/cloudflare/clef-omni', '--native'], undefined, { cwd });
    assert.equal(init.code, 0, init.stderr);
    assert.equal(JSON.parse(await readFile(join(cwd, 'request.json'), 'utf8')).model, 'clef-omni');
    const { flags, env, bodies } = await serverFor(t);
    for (const [request, args] of [[common, []], [{ ...native, audio: [media.mp3], videos: [media.mp4] }, ['--native', '--model', '@cf/cloudflare/clef-omni']]]) {
        const result = await invoke(['evaluate', '-', ...flags, ...args], request, { env });
        assert.equal(result.code, 0, result.stderr);
    }
    assert(bodies.every(body => body.model === 'clef-omni' && body.audio.length === 1 && body.videos.length === 1));
    const large = { ...native, model: 'clef-omni', videos: [dataUrl('video/mp4', mp4(1, 10 * 1024 * 1024))] };
    assert(Buffer.byteLength(JSON.stringify(large)) > 13 * 1024 * 1024);
    const accepted = await invoke(['validate', '-', ...flags, '--native'], large);
    assert.equal(accepted.code, 0, accepted.stderr);
    const rows = [large, { ...large, model: 'clef' }, { ...native, model: 'clef-flash' }].map(JSON.stringify).join('\n');
    const batch = await invoke(['batch', '-', ...flags, '--native', '--concurrency', '2'], rows, { env });
    assert.equal(batch.code, 1, batch.stderr);
    assert.deepEqual(batch.stdout.trim().split('\n').map(JSON.parse).map(row => [row.line, row.ok]), [[1, true], [2, false], [3, true]]);
    const override = await loadConfig({ env: { DECISION_PROVIDER: 'cloudflare-decisions', DECISION_MODEL: 'clef-flash' },
        overrides: { model: '@cf/cloudflare/clef-omni' } });
    assert.equal(override.config.model, '@cf/cloudflare/clef-omni');
});

test('native null selectors and execution options fail offline before credential resolution', async () => {
    for (const command of ['validate', 'evaluate']) {
        for (const input of [{ ...native, model: null }, { ...native, options: null }]) {
            const result = await invoke([command, '-', '--provider', 'cloudflare-decisions', '--native'], input);
            assert.equal(result.code, 2, result.stderr);
            assert.equal(JSON.parse(result.stderr).error.code, 'VALIDATION_ERROR');
        }
    }
});
