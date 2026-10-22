import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli } from '../src/cli/main.mjs';
import { loadConfig } from '../src/cli/config.mjs';
import { streams, temporaryWorkspace } from './support.mjs';
import { decisionResponse } from './decisions-fixtures.mjs';

const request = { state: '4 USD', fields: { amount: { type: 'number' } }, options: { include_quantiles: true } };
async function invoke(args, input, context = {}) {
    const io = streams(); io.stdin.end(typeof input === 'string' ? input : input === undefined ? '' : JSON.stringify(input));
    const code = await runCli(args, { ...io, env: {}, ...context });
    return { code, stdout: io.output(), stderr: io.error() };
}

test('extraction namespace defaults to Clairic and validates/initializes without credentials', async t => {
    const valid = await invoke(['extraction', 'validate', '-'], request);
    assert.equal(valid.code, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout), { valid: true, operation: 'extraction', validationScope: 'provider', fieldCount: 1, model: 'clairic' });
    const mismatch = await invoke(['extraction', 'validate', '-', '--provider', 'jev'], request);
    assert.equal(mismatch.code, 2);
    const cwd = await temporaryWorkspace(t);
    const initialized = await invoke(['extraction', 'init'], undefined, { cwd });
    assert.equal(initialized.code, 0, initialized.stderr);
    const config = JSON.parse(await readFile(join(cwd, 'decision.config.json'), 'utf8'));
    assert.equal(config.provider, 'cloudflare-extraction');
    assert.equal(config.apiKeyEnv, 'CLOUDFLARE_API_TOKEN');
    const sample = await invoke(['extraction', 'validate', 'request.json', '--config', 'decision.config.json'], undefined, { cwd });
    assert.equal(sample.code, 0, sample.stderr);
    const ajvModule = await import('ajv/dist/2020.js'); const ajv = new ajvModule.default({ strict: false });
    const schema = JSON.parse(await readFile(join(cwd, 'decision.config.schema.json'), 'utf8'));
    delete config.$schema;
    assert.equal(ajv.compile(schema)(config), true);
});

test('extraction runs REST and streams mixed JSONL results through its own operation', async t => {
    const bodies = [];
    const server = createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        const input = JSON.parse(body); bodies.push(input);
        assert(req.url.endsWith('/ai/run/@cf/cloudflare/clairic'));
        if (input.state === 'fail') { res.writeHead(429); res.end(JSON.stringify({ errors: [{ code: 3036 }] })); return; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, result: { model: 'clairic', answers: { amount: { type: 'number', value: 4 } },
            truncated: false, usage: { input_tokens: 10, output_tokens: 0 } }, errors: [], messages: [] }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const flags = ['--base-url', `http://127.0.0.1:${server.address().port}`, '--account-id', 'test', '--api-key-env', 'TEST_KEY'];
    const env = { TEST_KEY: 'fixture' };
    const result = await invoke(['extraction', 'run', '-', ...flags], request, { env });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).extraction.answers.amount.value, 4);
    for (const enabled of [true, false]) {
        const flag = enabled ? '--reject-if-busy' : '--no-reject-if-busy';
        const overridden = await invoke(['extraction', 'run', '-', ...flags, flag], {
            ...request, options: { ...request.options, rejectIfBusy: !enabled },
        }, { env });
        assert.equal(overridden.code, 0, overridden.stderr);
        assert.equal(bodies.at(-1).options.rejectIfBusy, enabled);
        assert.equal(bodies.at(-1).options.include_quantiles, true);
    }
    const rows = [request, { ...request, fields: {} }, { ...request, state: 'fail' }, request].map(JSON.stringify).join('\n');
    const batch = await invoke(['extraction', 'batch', '-', ...flags], rows, { env });
    assert.equal(batch.code, 1, batch.stderr);
    const records = batch.stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(row => row.ok), [true, false, false, true]);
    assert.equal(records[2].error.code, 'ALLOCATION_EXCEEDED');
    assert.equal(bodies.length, 6);
    assert(bodies.every(body => body.options.include_quantiles));
});

test('extraction provider switching clears inherited credentials and options', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'jev', model: 'jev-preview', apiKeyEnv: 'OLD_KEY',
        baseURL: 'https://old.example', dangerZone: { images: true } }));
    const loaded = await loadConfig({ cwd, configPath: 'config.json', env: {}, overrides: { provider: 'cloudflare-extraction' } });
    assert.equal(loaded.config.model, 'clairic');
    assert.equal(loaded.config.apiKeyEnv, undefined);
    assert.equal(loaded.config.baseURL, undefined);
    assert.equal(loaded.config.dangerZone, undefined);
});

test('Live CLI validates each wire kind and replays correlation offline', async () => {
    const questions = [{ type: 'predicate', instructions: 'True?', name: 'q' }];
    const configuration = { triggers: [{ type: 'decisions', event_type: 'session.input_transcript.delta', decisions: { questions } }] };
    const event = { type: 'decision.event', event_id: 'decision', delegation_id: null, trigger_id: 'trigger',
        source_event_id: 'source', source_event_type: 'session.input_transcript.delta',
        event: { type: 'decision.completed', decision: decisionResponse({ model: 'gpt-6-luna', questions }) } };
    for (const [kind, input] of [['config', configuration], ['command', { type: 'decision.create', event_id: 'client' }], ['event', event]]) {
        const result = await invoke(['live', 'validate', '-', '--kind', kind], input);
        assert.equal(result.code, 0, result.stderr);
    }
    const records = [
        { direction: 'client', event: { type: 'session.update', event_id: 'configuration', session: configuration } },
        { direction: 'server', event: { type: 'session.updated', event_id: 'configured', client_event_id: 'configuration', session: configuration } },
        { direction: 'server', event: { type: 'session.input_transcript.delta', event_id: 'source', delta: 'word', start_ms: 0, end_ms: 1 } },
        { direction: 'server', event }, { direction: 'server', event },
    ];
    const replay = await invoke(['live', 'replay', '-'], records.map(JSON.stringify).join('\n'));
    assert.equal(replay.code, 0, replay.stderr);
    const output = replay.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(output[3].event.correlation.matched, true);
    assert.equal(output[4].event.type, 'duplicate');
    assert.equal((await invoke(['live', 'validate', '-', '--kind', 'config'], { unsupported: true })).code, 2);

    const ordering = await invoke(['live', 'replay', '-'], [...records.slice(0, 3),
        { direction: 'client', event: { type: 'session.update', event_id: 'pending', session: { triggers: [] } } },
        { direction: 'server', event: { type: 'session.input_transcript.delta', event_id: 'newer-source', delta: 'new', start_ms: 1, end_ms: 2 } },
        { direction: 'server', event: { ...event, event_id: 'newer-result', source_event_id: 'newer-source' } },
        { direction: 'server', event },
    ].map(JSON.stringify).join('\n'));
    assert.equal(ordering.code, 0, ordering.stderr);
    const orderingRows = ordering.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(orderingRows[5].event.correlation.matched, false);
    assert.equal(orderingRows[6].event.correlation.matched, true);
    assert.equal(orderingRows[6].event.correlation.stale, true);

    const closed = await invoke(['live', 'replay', '-'], [...records,
        { direction: 'server', event: { type: 'session.closed', event_id: 'closed', session: configuration } },
        { direction: 'server', event: { ...event, event_id: 'late' } },
        { direction: 'client', event: { type: 'decision.create', event_id: 'after-close' } },
    ].map(JSON.stringify).join('\n'));
    assert.equal(closed.code, 1, closed.stderr);
    const closedRows = closed.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(closedRows[5].event.type, 'closed');
    assert.deepEqual(closedRows.slice(6).map(row => [row.ok, row.error.code]),
        [[false, 'CONNECTION_CLOSED'], [false, 'CONNECTION_CLOSED']]);
});

test('Live replay marks unidentified configuration changes as uncertain', async () => {
    const questions = [{ type: 'predicate', instructions: 'True?', name: 'q' }];
    const configuration = { triggers: [{ type: 'decisions', event_type: 'session.input_transcript.delta', decisions: { questions } }] };
    const records = [
        { direction: 'server', event: { type: 'session.created', event_id: 'initial', session: configuration } },
        { direction: 'client', event: { type: 'session.update', session: { triggers: [] } } },
        { direction: 'server', event: { type: 'session.input_transcript.delta', event_id: 'source', delta: '', start_ms: 0, end_ms: 0 } },
        { direction: 'server', event: { type: 'decision.event', event_id: 'result', delegation_id: null, trigger_id: 'trigger',
            source_event_id: 'source', source_event_type: 'session.input_transcript.delta',
            event: { type: 'decision.completed', decision: decisionResponse({ model: 'gpt-6-luna', questions }) } } },
    ];
    const replay = await invoke(['live', 'replay', '-'], records.map(JSON.stringify).join('\n'));
    assert.equal(replay.code, 0, replay.stderr);
    const result = replay.stdout.trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(result.event.correlation.matched, false);
});

test('offline Live event validation reports input errors while replay preserves response failures', async () => {
    const malformed = [
        {},
        { type: 'decision.item.created', event_id: 'bad-item', item: { role: 'assistant', content: 'private input' } },
        { type: 'session.updated', event_id: 'bad-trigger', session: { triggers: [null] } },
    ];
    const results = [];
    for (const event of malformed) results.push(await invoke(['live', 'validate', '-', '--kind', 'event'], event));
    assert.deepEqual(results.map(result => result.code), [2, 2, 2]);
    assert.deepEqual(results.map(result => JSON.parse(result.stderr).error.code), Array(3).fill('VALIDATION_ERROR'));
    assert(results.every(result => JSON.parse(result.stderr).error.source === 'client' && result.stdout === ''));
    assert(results.every(result => !result.stderr.includes('private input')));
    const replay = await invoke(['live', 'replay', '-'], [
        ...malformed.map(event => ({ direction: 'server', event })),
        { direction: 'client', event: { type: 'decision.create', event_id: 'valid-command' } },
    ].map(JSON.stringify).join('\n'));
    assert.equal(replay.code, 1, replay.stderr);
    const rows = replay.stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.slice(0, 3).map(row => [row.ok, row.error.code]), Array.from({ length: 3 }, () => [false, 'INVALID_RESPONSE']));
    assert.equal(rows[3].event.type, 'command');
});
