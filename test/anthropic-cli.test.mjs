// Configuration parity and real loopback HTTP paths for the Anthropic preset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { AnthropicProvider, createGenerativeProvider } from '../src/custom/generative/index.mjs';
import { validateConfig, loadConfig } from '../src/cli/config.mjs';
import { runCli } from '../src/cli/main.mjs';
import { streams, temporaryWorkspace, one } from './support.mjs';

const schema = JSON.parse(await readFile(new URL('../schemas/decision.config.schema.json', import.meta.url), 'utf8'));
const schemaValid = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const base = { provider: 'custom-generative', preset: 'anthropic', model: 'fixture' };
async function invoke(args, input, context = {}) {
    const io = streams(); io.stdin.end(input === undefined ? '' : input);
    const code = await runCli(args, { ...io, env: {}, ...context });
    return { code, stdout: io.output(), stderr: io.error() };
}

test('Anthropic SDK, runtime and configuration schema agree on modes and conflicts', () => {
    const valid = [{}, { parameters: { temperature: 0, top_p: null, top_k: 1 } },
        ...['tool', 'json_schema'].flatMap(responseFormat => ['2023-06-01', '2026-10-21'].map(apiVersion =>
            ({ responseFormat, apiVersion, parameters: { output_config: { effort: 'medium' } } })))];
    const invalid = [{ responseFormat: 'text' }, { responseFormat: 'json_object' }, { apiVersion: 'latest' },
        { apiVersion: null }, { responseFormat: null }, { tokenParameter: 'max_tokens' },
        { parameters: { thinking: null } }, { parameters: { output_format: {} } },
        { parameters: { output_config: null } }, { parameters: { output_config: [] } },
        { parameters: { output_config: { format: null } } },
        ...['temperature', 'top_p', 'top_k'].flatMap(key => [0, null].map(value =>
            ({ apiVersion: '2026-10-21', parameters: { [key]: value } })))];
    for (const options of valid) {
        assert(schemaValid({ ...base, ...options }), JSON.stringify(schemaValid.errors));
        assert.doesNotThrow(() => validateConfig({ ...base, ...options }, { complete: true }));
        assert.doesNotThrow(() => new AnthropicProvider({ apiKey: 'fixture', ...options }));
    }
    for (const options of invalid) {
        assert.equal(schemaValid({ ...base, ...options }), false, JSON.stringify(options));
        assert.throws(() => validateConfig({ ...base, ...options }, { complete: true }), { code: 'CONFIGURATION_ERROR' });
        assert.throws(() => createGenerativeProvider({ type: 'anthropic', apiKey: 'fixture', ...options }), { code: 'CONFIGURATION_ERROR' });
    }
    for (const preset of ['openai-compatible', 'openrouter']) for (const options of [{ apiVersion: '2026-10-21' }, { responseFormat: 'tool' }]) {
        assert.equal(schemaValid({ ...base, preset, ...options }), false);
        assert.throws(() => validateConfig({ ...base, preset, ...options }, { complete: true }), { code: 'CONFIGURATION_ERROR' });
        assert.throws(() => createGenerativeProvider({ type: preset, apiKey: 'fixture', ...options }), { code: 'CONFIGURATION_ERROR' });
    }
});

test('Anthropic mode/version precedence, switching and initialization preserve explicit settings', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'config.json'), JSON.stringify({ ...base, responseFormat: 'tool', apiVersion: '2023-06-01' }));
    const env = { DECISION_RESPONSE_FORMAT: 'json_schema', DECISION_ANTHROPIC_API_VERSION: '2026-10-21' };
    const selected = await loadConfig({ configPath: 'config.json', cwd, env });
    assert.equal(selected.config.responseFormat, 'json_schema');
    assert.equal(selected.config.apiVersion, '2026-10-21');
    const flags = await loadConfig({ configPath: 'config.json', cwd, env,
        overrides: { responseFormat: 'tool', apiVersion: '2023-06-01' } });
    assert.equal(flags.config.responseFormat, 'tool'); assert.equal(flags.config.apiVersion, '2023-06-01');
    const switched = await loadConfig({ configPath: 'config.json', cwd, env, overrides: { preset: 'openai-compatible' } });
    assert.equal(switched.config.apiVersion, undefined); assert.equal(switched.config.responseFormat, undefined);
    const modern = ['--provider', 'custom-generative', '--preset', 'anthropic', '--response-format', 'json_schema',
        '--anthropic-api-version', '2026-10-21', '--model', 'fixture'];
    const init = await invoke(['init', 'modern', ...modern], undefined, { cwd });
    assert.equal(init.code, 0, init.stderr);
    const generated = JSON.parse(await readFile(join(cwd, 'modern/decision.config.json'), 'utf8'));
    assert.equal(generated.responseFormat, 'json_schema'); assert.equal(generated.apiVersion, '2026-10-21');
    const valid = await invoke(['validate', '-', ...modern], JSON.stringify(one));
    assert.equal(valid.code, 0, valid.stderr);
    await writeFile(join(cwd, 'bad.json'), JSON.stringify({ ...base, apiVersion: '2026-10-21', parameters: { temperature: 0 } }));
    const bad = await invoke(['validate', '-', '--config', 'bad.json'], JSON.stringify(one), { cwd });
    assert.equal(bad.code, 2); assert.equal(JSON.parse(bad.stderr).error.code, 'CONFIGURATION_ERROR');
});

test('Anthropic JSON CLI evaluation, batch and models use the configured header on loopback', async t => {
    const bodies = [];
    const server = createServer(async (req, res) => {
        assert.equal(req.headers['anthropic-version'], '2026-10-21');
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'fixture' }], has_more: false })); return; }
        let text = ''; for await (const chunk of req) text += chunk;
        const body = JSON.parse(text); bodies.push(body);
        res.end(JSON.stringify({ model: body.model, stop_reason: 'end_turn',
            content: [{ type: 'thinking', thinking: '', signature: 'synthetic' },
                { type: 'text', text: JSON.stringify({ answers: { yes: { noul: 0.7 } } }) }], usage: { input_tokens: 4, output_tokens: 2 } }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const flags = ['--provider', 'custom-generative', '--preset', 'anthropic', '--model', 'fixture', '--response-format', 'json_schema',
        '--anthropic-api-version', '2026-10-21', '--base-url', `http://127.0.0.1:${server.address().port}`, '--api-key-env', 'FIXTURE_KEY'];
    const context = { env: { FIXTURE_KEY: 'synthetic-key' } };
    const result = await invoke(['evaluate', '-', ...flags], JSON.stringify(one), context);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).answers.yes.noul, 0.7);
    const batch = await invoke(['batch', '-', ...flags], [one, one].map(JSON.stringify).join('\n'), context);
    assert.equal(batch.code, 0, batch.stderr);
    assert(batch.stdout.trim().split('\n').map(JSON.parse).every(row => row.ok && row.result.meta.responseFormat === 'json_schema'));
    const models = await invoke(['models', ...flags], undefined, context);
    assert.equal(models.code, 0, models.stderr); assert.equal(JSON.parse(models.stdout).models[0].name, 'fixture');
    assert.equal(bodies.length, 3);
    assert(bodies.every(body => body.output_config.format.type === 'json_schema' && !body.tools && !body.tool_choice));
});
