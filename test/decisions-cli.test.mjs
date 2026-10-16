import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { runCli } from '../src/cli/main.mjs';
import { loadConfig } from '../src/cli/config.mjs';
import { streams, temporaryWorkspace } from './support.mjs';
import { image, decisionResponse } from './decisions-fixtures.mjs';

const common = { input: [{ type: 'text', text: 'Before' }, { type: 'image', dataUrl: image, detail: 'low' }],
    questions: { q: { type: 'choice', instructions: 'Pick.', options: [{ value: true }, { value: 'true' }] } } };
const native = { input: 'Test', questions: [{ type: 'predicate', instructions: 'True?' }] };
async function invoke(args, input, context = {}) {
    const io = streams();
    if (input !== undefined) io.stdin.end(input);
    const code = await runCli(args, { ...io, env: {}, ...context });
    return { code, stdout: io.output(), stderr: io.error() };
}
async function serverFor(t, mutate = () => {}) {
    const bodies = [];
    const server = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        assert.equal(req.url, '/v1/decisions');
        assert.equal(req.headers.authorization, 'Bearer fixture-secret');
        const request = JSON.parse(body); bodies.push(request);
        const response = decisionResponse(request); mutate(response, request);
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return { bodies, flags: ['--provider', 'openai-decisions', '--base-url', `http://127.0.0.1:${server.address().port}`,
        '--api-key-env', 'TEST_API_KEY'], env: { TEST_API_KEY: 'fixture-secret' } };
}

test('common and native offline validation use model defaults without credentials', async () => {
    const identifier = '\u{1F600}'.repeat(128);
    for (const [input, extra] of [[common, []], [native, ['--native']],
        [{ ...common, safetyIdentifier: identifier }, []], [{ ...native, safety_identifier: identifier }, ['--native']]]) {
        const result = await invoke(['validate', '-', '--provider', 'openai-decisions', ...extra], JSON.stringify(input));
        assert.equal(result.code, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).model, 'default');
        assert.equal(JSON.parse(result.stdout).resolvedModel, 'gpt-6-luna');
        assert.equal(JSON.parse(result.stdout).questionCount, 1);
    }
    const result = await invoke(['evaluate', '-', '--provider', 'jev'], JSON.stringify(common));
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stderr).error.code, 'UNSUPPORTED_CAPABILITY');
});

test('native mode requires a supported provider and explicit input and is never guessed', async () => {
    for (const args of [['validate', '-', '--provider', 'custom-generative', '--preset', 'openai-compatible', '--native'], ['evaluate', '--provider', 'openai-decisions', '--native'],
        ['schema', '-', '--provider', 'openai-decisions', '--native']]) {
        const result = await invoke(args, JSON.stringify(native));
        assert.equal(result.code, 2);
        assert.equal(JSON.parse(result.stderr).error.code, 'USAGE_ERROR');
    }
    const guessed = await invoke(['validate', '-', '--provider', 'openai-decisions'], JSON.stringify(native));
    assert.equal(guessed.code, 2);
    const schema = await invoke(['schema', '-', '--provider', 'openai-decisions'], JSON.stringify(common));
    assert.equal(schema.code, 2);
    assert.equal(JSON.parse(schema.stderr).error.code, 'UNSUPPORTED_CAPABILITY');
});

test('offline CLI validates OpenAI choice boundaries without credentials', async () => {
    for (const count of [1, 2, 255, 256]) {
        const options = Array.from({ length: count }, (_, i) => ({ value: String(i) }));
        for (const isNative of [false, true]) {
            const input = isNative ? { input: '', questions: [{ type: 'choice', instructions: 'Pick.', choices: options }] }
                : { state: '', questions: { q: { type: 'choice', instructions: 'Pick.', options } } };
            const result = await invoke(['validate', '-', '--provider', 'openai-decisions',
                ...(isNative ? ['--native'] : [])], JSON.stringify(input));
            if (count === 2 || count === 255) assert.equal(result.code, 0, result.stderr);
            else {
                assert.equal(result.code, 2, result.stderr);
                assert.equal(JSON.parse(result.stderr).error.code,
                    !isNative && count === 256 ? 'UNSUPPORTED_CAPABILITY' : 'VALIDATION_ERROR');
                assert.equal(result.stdout, '');
            }
        }
    }
});

test('native init creates a request that validates with --native', async t => {
    const cwd = await temporaryWorkspace(t);
    const init = await invoke(['init', '--provider', 'openai-decisions', '--native'], undefined, { cwd });
    assert.equal(init.code, 0, init.stderr);
    const config = JSON.parse(await readFile(join(cwd, 'decision.config.json'), 'utf8'));
    assert.equal(config.model, 'default');
    assert.equal(Object.hasOwn(JSON.parse(await readFile(join(cwd, 'request.json'), 'utf8')), 'model'), false);
    assert.equal(config.apiKeyEnv, 'OPENAI_API_KEY');
    const result = await invoke(['validate', 'request.json', '--config', 'decision.config.json', '--native'], undefined, { cwd });
    assert.equal(result.code, 0, result.stderr);
});

test('actual common and native HTTP evaluations preserve their output contracts', async t => {
    const { bodies, flags, env } = await serverFor(t);
    const commonResult = await invoke(['evaluate', '-', ...flags], JSON.stringify(common), { env });
    assert.equal(commonResult.code, 0, commonResult.stderr);
    assert.equal(JSON.parse(commonResult.stdout).answers.q.choice, true);
    const nativeResult = await invoke(['evaluate', '-', ...flags, '--native'], JSON.stringify(native), { env });
    assert.equal(nativeResult.code, 0, nativeResult.stderr);
    assert.equal(JSON.parse(nativeResult.stdout).decision.answers[0].probability, 0.7);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].input[0].content[1].detail, 'low');
});

test('native JSONL batch records refusals as errors and preserves successful rows', async t => {
    const { flags, env } = await serverFor(t, (data, request) => {
        if (request.input === 'refuse') data.answers[0] = { type: 'refusal', name: null };
    });
    const rows = [native, { ...native, input: 'refuse' }, native].map(JSON.stringify).join('\n');
    const result = await invoke(['batch', '-', ...flags, '--native'], rows, { env });
    assert.equal(result.code, 1, result.stderr);
    const records = result.stdout.trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(record => [record.line, record.ok]), [[1, true], [2, false], [3, true]]);
    assert.equal(records[1].error.code, 'MODEL_REFUSAL');
    assert(!Object.hasOwn(records[1], 'result'));
});

test('OpenAI generation settings fail offline and provider switches discard them', async t => {
    const result = await invoke(['validate', '-', '--provider', 'openai-decisions', '--max-tokens', '10'], JSON.stringify(native));
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stderr).error.code, 'CONFIGURATION_ERROR');
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'custom-generative', preset: 'openai-compatible', model: 'other', responseFormat: 'text', maxTokens: 10 }));
    const loaded = await loadConfig({ configPath: 'config.json', cwd, env: {}, overrides: { provider: 'openai-decisions' } });
    assert.equal(loaded.config.model, 'default');
    assert.equal(loaded.config.maxTokens, undefined);
    assert.equal(loaded.config.responseFormat, undefined);
    assert.equal(loaded.config.maxRetries, undefined);
});

test('native model listing reports unsupported operation', async () => {
    const result = await invoke(['models', '--provider', 'openai-decisions']);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).error.code, 'UNSUPPORTED_OPERATION');
});

test('OpenAI selectors follow CLI precedence through offline validation and common/native calls', async t => {
    const cwd = await temporaryWorkspace(t);
    const { bodies, flags, env } = await serverFor(t, response => { response.model = 'reported-model'; });
    await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'openai-decisions', model: 'luna' }));
    const cases = [
        { selected: 'luna', extra: [], extraEnv: {} },
        { selected: 'default', extra: [], extraEnv: { DECISION_MODEL: 'default' } },
        { selected: 'gpt-6-luna', model: 'gpt-6-luna', extra: [], extraEnv: { DECISION_MODEL: 'luna' } },
        { selected: 'default', model: 'luna', extra: ['--model', 'default'], extraEnv: { DECISION_MODEL: 'gpt-6-luna' } },
    ];
    for (const [input, mode] of [[common, []], [native, ['--native']]]) {
        for (const entry of cases) {
            const request = { ...input, ...(entry.model ? { model: entry.model } : {}) };
            const args = ['-', '--config', 'config.json', ...mode, ...entry.extra];
            const validated = await invoke(['validate', ...args], JSON.stringify(request), { cwd, env: entry.extraEnv });
            assert.equal(validated.code, 0, validated.stderr);
            assert.equal(JSON.parse(validated.stdout).model, entry.selected);
            assert.equal(JSON.parse(validated.stdout).resolvedModel, 'gpt-6-luna');
            const evaluated = await invoke(['evaluate', ...args, ...flags], JSON.stringify(request),
                { cwd, env: { ...env, ...entry.extraEnv } });
            assert.equal(evaluated.code, 0, evaluated.stderr);
            const result = JSON.parse(evaluated.stdout);
            assert.equal(result.meta.requestedModel, entry.selected);
            assert.equal(result.meta.resolvedModel, 'gpt-6-luna');
            assert.equal(mode.length ? result.decision.model : result.model, 'reported-model');
        }
    }
    for (const model of ['unknown', '', null]) {
        const result = await invoke(['evaluate', '-', ...flags], JSON.stringify({ ...common, model }), { env });
        assert.equal(result.code, 2);
    }
    assert.equal(bodies.length, cases.length * 2);
    assert(bodies.every(body => body.model === 'gpt-6-luna'));
});

test('initialized OpenAI requests inherit later configuration changes in both modes', async t => {
    const { flags, env } = await serverFor(t);
    for (const mode of [[], ['--native']]) {
        const cwd = await temporaryWorkspace(t);
        const initialized = await invoke(['init', '--provider', 'openai-decisions', '--model', 'luna', ...mode], undefined, { cwd });
        assert.equal(initialized.code, 0, initialized.stderr);
        const request = JSON.parse(await readFile(join(cwd, 'request.json'), 'utf8'));
        assert.equal(Object.hasOwn(request, 'model'), false);
        const configPath = join(cwd, 'decision.config.json');
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        assert.equal(config.model, 'luna');
        config.model = 'default';
        await writeFile(configPath, JSON.stringify(config));
        const result = await invoke(['evaluate', 'request.json', '--config', 'decision.config.json', ...mode, ...flags], undefined, { cwd, env });
        assert.equal(result.code, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).meta.requestedModel, 'default');
    }
});

test('common and native JSONL batches retain independent row selectors', async t => {
    const { bodies, flags, env } = await serverFor(t);
    const models = ['default', 'luna', 'gpt-6-luna'];
    for (const [input, mode] of [[common, []], [native, ['--native']]]) {
        const rows = [...models, 'unknown'].map(model => JSON.stringify({ ...input, model })).join('\n');
        const result = await invoke(['batch', '-', ...flags, ...mode], rows, { env });
        assert.equal(result.code, 1, result.stderr);
        const records = result.stdout.trim().split('\n').map(JSON.parse);
        records.slice(0, 3).forEach((record, index) => {
            assert.equal(record.ok, true);
            assert.equal(record.result.meta.requestedModel, models[index]);
            assert.equal(record.result.meta.resolvedModel, 'gpt-6-luna');
        });
        assert.equal(records[3].error.code, 'UNSUPPORTED_CAPABILITY');
    }
    assert.equal(bodies.length, 6);
    assert(bodies.every(body => body.model === 'gpt-6-luna'));
});

test('offline common and native validation reject encoded field and byte limits before credentials', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'openai-decisions', maxRequestBytes: 250 }));
    const oversized = 'x'.repeat(1048577);
    for (const [input, flags, expected] of [
        [{ state: '', questions: { q: { type: 'noul', instructions: oversized } } }, [], 'VALIDATION_ERROR'],
        [{ ...native, questions: [{ type: 'predicate', instructions: oversized }] }, ['--native'], 'VALIDATION_ERROR'],
        [{ state: 'é'.repeat(100), questions: { q: { type: 'noul', instructions: 'True?' } } }, ['--config', 'config.json'], 'REQUEST_TOO_LARGE'],
        [{ ...native, input: 'é'.repeat(100) }, ['--config', 'config.json', '--native'], 'REQUEST_TOO_LARGE'],
    ]) {
        for (const command of ['validate', 'evaluate']) {
            const result = await invoke([command, '-', '--provider', 'openai-decisions', ...flags], JSON.stringify(input), { cwd });
            assert.equal(result.code, 2, result.stderr);
            assert.equal(JSON.parse(result.stderr).error.code, expected);
            assert.equal(result.stdout, '');
        }
    }
    // Generative schema construction has no native request body or transport limit.
    const schema = await invoke(['schema', '-', '--provider', 'openai-decisions', '--config', 'config.json'],
        JSON.stringify({ state: 'é'.repeat(100), questions: { q: { type: 'noul', instructions: 'True?' } } }), { cwd });
    assert.equal(schema.code, 0, schema.stderr);
    assert.equal(JSON.parse(schema.stdout).type, 'object');
});

test('native CLI preflight cannot dispatch after consuming the evaluation deadline', async t => {
    const { bodies, flags, env } = await serverFor(t);
    const input = { ...native, input: [{ role: 'user', content: [{ type: 'input_image',
        image_url: 'data:image/png;base64,' + 'AAAA'.repeat(1500000),
    }] }] };
    const result = await invoke(['evaluate', '-', ...flags, '--native', '--timeout-ms', '5'],
        JSON.stringify(input), { env });
    assert.equal(result.code, 1, result.stderr);
    assert.equal(JSON.parse(result.stderr).error.code, 'TIMEOUT');
    assert.equal(result.stdout, '');
    assert.equal(bodies.length, 0);
});
