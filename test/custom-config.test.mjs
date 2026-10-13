import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateConfig, loadConfig, configuredProvider } from '../src/cli/config.mjs';
import { runCli } from '../src/cli/main.mjs';
import { streams, temporaryWorkspace, one } from './support.mjs';

const schema = JSON.parse(await readFile(new URL('../schemas/decision.config.schema.json', import.meta.url), 'utf8'));
const schemaValid = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const presets = ['openai-compatible', 'openrouter', 'anthropic'];

test('config schema and runtime agree on native, preset and module structures', () => {
    const valid = [{}, ...['jev', 'openai-decisions', 'cloudflare-decisions'].map(provider => ({ provider })),
        ...presets.map(preset => ({ provider: 'custom-generative', preset, model: 'fixture' })),
        ...['custom-decision', 'custom-generative'].map(provider => ({ provider, module: './provider.mjs', options: { baseURL: 'https://service.example' } })),
        { provider: 'cloudflare-decisions', gateway: { id: 'fixture', metadata: { category: 'test' }, retries: { maxAttempts: 1 } } },
        { provider: 'custom-generative', preset: 'openai-compatible', baseURL: 'http://127.0.0.1/v1', noAuth: true }];
    const invalid = [{ provider: 'custom' }, { provider: 'openrouter' }, { provider: 'custom-generative' },
        { provider: 'custom-decision' }, { provider: 'custom-generative', preset: 'unknown' },
        { provider: 'custom-generative', preset: 'openrouter', module: './p.mjs' },
        { provider: 'custom-decision', module: './p.mjs', preset: 'openrouter' },
        { provider: 'jev', maxTokens: 10 }, { provider: 'jev', module: './p.mjs' },
        { provider: 'custom-generative', preset: 'anthropic', responseFormat: 'text' },
        { provider: 'custom-generative', preset: 'anthropic', parameters: { thinking: {} } },
        { provider: 'custom-generative', preset: 'openrouter', baseURL: 'https://other.example' },
        { provider: 'custom-generative', preset: 'openai-compatible', parameters: { messages: [] } },
        { provider: 'custom-generative', preset: 'openai-compatible', parameters: { functions: [] } },
        { provider: 'custom-generative', preset: 'openrouter', parameters: { function_call: 'auto' } },
        { provider: 'custom-decision', module: './p.mjs', maxRetries: 1 },
        { provider: 'custom-decision', module: './p.mjs', options: { apiKey: 'inline' } },
        { provider: 'custom-generative', preset: 'openrouter', options: {} },
        { provider: 'jev', gateway: { id: 'fixture' } },
        { provider: 'cloudflare-decisions', rejectIfBusy: true, maxRetries: 1 },
        { provider: 'cloudflare-decisions', gateway: { id: 'fixture', metadata: { 'cf.reserved': true } } }];
    for (const config of valid) {
        assert(schemaValid(config), JSON.stringify(schemaValid.errors));
        assert.doesNotThrow(() => validateConfig(config, { complete: true }));
    }
    for (const config of invalid) {
        assert.equal(schemaValid(config), false, JSON.stringify(config));
        assert.throws(() => validateConfig(config, { complete: true }), { code: 'CONFIGURATION_ERROR' }, JSON.stringify(config));
    }
});

test('preset/module changes discard implementation settings through every precedence layer', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'custom-generative', preset: 'openai-compatible',
        model: 'old', apiKeyEnv: 'OLD_KEY', baseURL: 'https://old.example', maxRetries: 4,
        maxRequestBytes: 2000, maxTokens: 100, timeoutMs: 9000 }));
    const first = await loadConfig({ configPath: 'config.json', cwd, env: {
        DECISION_PRESET: 'openrouter', DECISION_API_KEY_ENV: 'ENV_KEY', DECISION_MODEL: 'env-model',
    }, overrides: { preset: 'anthropic' } });
    assert.equal(first.config.preset, 'anthropic');
    for (const key of ['model', 'apiKeyEnv', 'baseURL', 'maxRetries', 'maxRequestBytes', 'maxTokens']) assert.equal(first.config[key], undefined);
    assert.equal(first.config.timeoutMs, 9000);
    const module = await loadConfig({ configPath: 'config.json', cwd, env: {}, overrides: { module: './p.mjs' } });
    assert.equal(module.config.preset, undefined);
    assert.equal(module.config.module, './p.mjs');
    const same = await loadConfig({ configPath: 'config.json', cwd, env: { DECISION_PRESET: 'openai-compatible' }, overrides: { model: 'new' } });
    assert.equal(same.config.apiKeyEnv, 'OLD_KEY');
    assert.equal(same.config.baseURL, 'https://old.example');
});

test('module identity includes the resolution base and preserves equivalent resolved paths', async t => {
    const cwd = await temporaryWorkspace(t);
    await mkdir(join(cwd, 'profiles'));
    await writeFile(join(cwd, 'profiles/config.json'), JSON.stringify({ provider: 'custom-generative',
        module: './provider.mjs', model: 'old-model', apiKeyEnv: 'OLD_KEY', options: { endpoint: 'old' } }));
    const switched = await loadConfig({ cwd, configPath: 'profiles/config.json', env: {},
        overrides: { module: './provider.mjs' } });
    assert.equal(switched.moduleBase, cwd);
    assert.equal(switched.config.module, './provider.mjs');
    for (const key of ['model', 'apiKeyEnv', 'options']) assert.equal(switched.config[key], undefined);
    const explicit = await loadConfig({ cwd, configPath: 'profiles/config.json', env: {},
        overrides: { module: './provider.mjs', apiKeyEnv: 'NEW_KEY', options: { endpoint: 'new' } } });
    assert.equal(explicit.config.apiKeyEnv, 'NEW_KEY');
    assert.deepEqual(explicit.config.options, { endpoint: 'new' });
    const same = await loadConfig({ cwd, configPath: 'profiles/config.json', env: {},
        overrides: { module: './profiles/provider.mjs' } });
    assert.equal(same.moduleBase, cwd);
    assert.equal(same.config.apiKeyEnv, 'OLD_KEY');
    assert.equal(same.config.model, 'old-model');
    assert.deepEqual(same.config.options, { endpoint: 'old' });
});

test('custom module requests obey model precedence independently of factory options', async t => {
    const cwd = await temporaryWorkspace(t);
    for (const kind of ['decision', 'generative']) {
        // A valid module may choose its own default and ignore factory options.model.
        await writeFile(join(cwd, kind + '.mjs'), `export function createProvider() {
            return { kind: '${kind}', name: 'fixture', defaultModel: 'module-default',
                async evaluate(request) { return { model: request.model,
                    answers: { yes: { type: 'noul', noul: 0.7 } },
                    usage: { input_tokens: null, output_tokens: null } }; } };
        }`);
        const config = { provider: 'custom-' + kind, module: './' + kind + '.mjs', model: 'file-model' };
        await writeFile(join(cwd, 'config.json'), JSON.stringify(config));
        for (const [input, env, flags, expected] of [
            [one, {}, [], 'file-model'],
            [one, { DECISION_MODEL: 'env-model' }, [], 'env-model'],
            [{ ...one, model: 'request-model' }, { DECISION_MODEL: 'env-model' }, [], 'request-model'],
            [{ ...one, model: 'request-model' }, { DECISION_MODEL: 'env-model' }, ['--model', 'flag-model'], 'flag-model'],
        ]) {
            const io = streams(); io.stdin.end(JSON.stringify(input));
            assert.equal(await runCli(['evaluate', '-', '--config', 'config.json', ...flags], { ...io, cwd, env }), 0, io.error());
            const result = JSON.parse(io.output());
            assert.equal(result.model, expected);
            assert.equal(result.meta.requestedModel, expected);
        }
        const batch = streams();
        batch.stdin.end(JSON.stringify(one) + '\n' + JSON.stringify({ ...one, model: 'record-model' }) + '\n');
        assert.equal(await runCli(['batch', '-', '--config', 'config.json'], { ...batch, cwd, env: {} }), 0, batch.error());
        assert.deepEqual(batch.output().trim().split('\n').map(line => JSON.parse(line).result.model), ['file-model', 'record-model']);
        delete config.model;
        await writeFile(join(cwd, 'config.json'), JSON.stringify(config));
        const fallback = streams(); fallback.stdin.end(JSON.stringify(one));
        assert.equal(await runCli(['evaluate', '-', '--config', 'config.json'], { ...fallback, cwd, env: {} }), 0, fallback.error());
        assert.equal(JSON.parse(fallback.output()).model, 'module-default');
    }
});

test('module execution checks kind while offline validation never imports it', async t => {
    const cwd = await temporaryWorkspace(t);
    const path = join(cwd, 'provider.mjs');
    await writeFile(path, `export function createProvider() { return { kind: 'generative', name: 'fixture', defaultModel: 'fixture',
        async evaluate(r) { return { model: r.model, answers: { yes: { type: 'noul', noul: 0.7 } },
            usage: { input_tokens: null, output_tokens: null } }; } }; }`);
    await assert.rejects(configuredProvider({ config: { provider: 'custom-decision', module: path }, env: {}, moduleBase: cwd }),
        { code: 'CONFIGURATION_ERROR' });
    const good = await configuredProvider({ config: { provider: 'custom-generative', module: path }, env: {}, moduleBase: cwd });
    assert.equal(good.kind, 'generative');
    const io = streams(); io.stdin.end(JSON.stringify(one));
    await writeFile(join(cwd, 'must-not-load.mjs'), 'throw Error("Offline validation imported executable code");\n');
    const code = await runCli(['validate', '-', '--provider', 'custom-decision', '--provider-module', './must-not-load.mjs'], { ...io, cwd, env: {} });
    assert.equal(code, 0, io.error());
    assert.equal(JSON.parse(io.output()).validationScope, 'structure');
});

test('initialization supplies schema, presets and honest module edit points without loading modules', async t => {
    const cwd = await temporaryWorkspace(t);
    for (const [index, config] of [...presets.map(preset => ({ provider: 'custom-generative', preset })),
        { provider: 'custom-decision' }, { provider: 'custom-generative' }].entries()) {
        const directory = 'project-' + index;
        const io = streams();
        const code = await runCli(['init', directory, '--provider', config.provider,
            ...(config.preset ? ['--preset', config.preset] : [])], { ...io, cwd, env: {} });
        assert.equal(code, 0, io.error());
        const initialized = JSON.parse(await readFile(join(cwd, directory, 'decision.config.json'), 'utf8'));
        assert(schemaValid(initialized), JSON.stringify(schemaValid.errors));
        assert.equal(initialized.$schema, './decision.config.schema.json');
        assert.deepEqual(JSON.parse(await readFile(join(cwd, directory, 'decision.config.schema.json'), 'utf8')), schema);
        if (!config.preset) {
            const source = await readFile(join(cwd, directory, 'provider.mjs'), 'utf8');
            assert(source.includes(config.provider === 'custom-decision' ? 'defineDecisionProvider' : 'defineGenerativeProvider'));
            assert(source.includes('Connect this provider to your service'));
        }
    }
    await writeFile(join(cwd, 'existing.mjs'), 'throw Error("Initialization must not execute this module");\n');
    const io = streams();
    assert.equal(await runCli(['init', 'external', '--provider', 'custom-decision', '--provider-module', './existing.mjs'],
        { ...io, cwd, env: {} }), 0, io.error());
    const config = JSON.parse(await readFile(join(cwd, 'external/decision.config.json'), 'utf8'));
    assert.equal(config.module, join(cwd, 'existing.mjs'));
    assert.equal(await readFile(join(cwd, 'existing.mjs'), 'utf8'), 'throw Error("Initialization must not execute this module");\n');
});
