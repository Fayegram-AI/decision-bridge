/** Credential aliases across every built-in SDK, CLI and generated profile. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProvider, createBridge } from '../src/index.mjs';
import { createExtractionProvider } from '../src/extraction/index.mjs';
import { createGenerativeProvider } from '../src/custom/generative/index.mjs';
import { configuredProvider } from '../src/cli/provider-loader.mjs';
import { loadConfig } from '../src/cli/config.mjs';
import { configuredApiKey, KEY_ENVS } from '../src/cli/credentials.mjs';
import { routingOptions } from '../src/cli/routing-config.mjs';
import { initialize } from '../src/cli/initialize.mjs';
import { initializeRouting } from '../src/cli/routing-init.mjs';
import { temporaryWorkspace } from './support.mjs';

const configs = [
    { provider: 'jev', model: 'jev-latest' },
    { provider: 'openai-decisions', model: 'default' },
    { provider: 'gemini-decisions', model: 'gemini-decision-1' },
    { provider: 'openrouter-decisions', model: 'vendor/model' },
    { provider: 'openrouter-extraction', model: 'vendor/model' },
    { provider: 'cloudflare-decisions', model: 'clef' },
    { provider: 'cloudflare-extraction', model: 'clairic' },
    ...['openai-compatible', 'openrouter', 'anthropic'].map(preset =>
        ({ provider: 'custom-generative', preset, model: 'fixture-model' })),
];
const envNames = [...new Set([...Object.values(KEY_ENVS), 'CLOUDFLARE_ACCOUNT_ID'])];
const credentialNames = envNames.flatMap(name => [name, 'DECISION_BRIDGE_' + name]);
const decision = { state: 'Evidence', questions: { q: { type: 'noul', instructions: 'True?' } } };
const extraction = { state: 'Evidence', fields: { value: { type: 'text' } } };
const configName = config => config.preset ?? config.provider;
const extracting = config => config.provider.endsWith('-extraction');

function preserveEnvironment(t) {
    const previous = new Map(credentialNames.map(name => [name, process.env[name]]));
    t.after(() => {
        for (const [name, value] of previous) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
    });
}

function setEnvironment(values) {
    for (const name of credentialNames) delete process.env[name];
    Object.assign(process.env, values);
}

function sdkProvider(config, options) {
    const { provider, preset, ...settings } = config;
    return preset ? createGenerativeProvider({ type: preset, ...settings, ...options })
        : extracting(config) ? createExtractionProvider({ type: provider, ...settings, ...options })
            : createProvider({ type: provider, ...settings, ...options });
}

async function dispatch(config, backend) {
    // A synthetic 401 stops after dispatch, independently of provider response codecs.
    await assert.rejects(extracting(config) ? backend.extract(extraction)
        : createBridge({ provider: backend }).evaluate(decision));
}

function capture(calls) {
    return async (url, init) => {
        calls.push({ url, headers: init.headers });
        return Response.json({}, { status: 401 });
    };
}

function checkCall(config, calls, key, account = 'preferred-account') {
    assert.equal(calls.length, 1, configName(config));
    const headers = calls[0].headers;
    assert.equal(headers.authorization ?? headers['x-api-key'] ?? headers['x-goog-api-key'],
        headers.authorization ? 'Bearer ' + key : key, configName(config));
    if (config.provider.startsWith('cloudflare-')) assert(calls[0].url.includes('/accounts/' + account + '/'));
}

test('all SDK providers accept either alias, prefer scoped values and honor explicit options', async t => {
    preserveEnvironment(t);
    for (const config of configs) {
        const name = KEY_ENVS[configName(config)];
        const scoped = 'DECISION_BRIDGE_' + name;
        for (const aliases of [{ [name]: 'selected-key' }, { [scoped]: 'selected-key' },
            { [name]: 'other-key', [scoped]: 'selected-key' }]) {
            setEnvironment({ CLOUDFLARE_ACCOUNT_ID: 'other-account', DECISION_BRIDGE_CLOUDFLARE_ACCOUNT_ID: 'preferred-account', ...aliases });
            const calls = [];
            await dispatch(config, sdkProvider(config, { fetchImpl: capture(calls) }));
            checkCall(config, calls, 'selected-key');
        }
        setEnvironment({ [name]: 'other-key', [scoped]: 'preferred-key', CLOUDFLARE_ACCOUNT_ID: 'plain-account',
            DECISION_BRIDGE_CLOUDFLARE_ACCOUNT_ID: 'preferred-account' });
        const calls = [];
        const explicit = { apiKey: 'explicit-key', fetchImpl: capture(calls),
            ...(config.provider.startsWith('cloudflare-') ? { accountId: 'explicit-account' } : {}) };
        await dispatch(config, sdkProvider(config, explicit));
        checkCall(config, calls, 'explicit-key', 'explicit-account');
        process.env[scoped] = '';
        assert.throws(() => sdkProvider(config, {}), { code: 'CONFIGURATION_ERROR' }, configName(config));
        assert.throws(() => sdkProvider(config, { apiKey: null }), { code: 'CONFIGURATION_ERROR' }, configName(config));
        if (config.provider.startsWith('cloudflare-')) {
            process.env.DECISION_BRIDGE_CLOUDFLARE_ACCOUNT_ID = '';
            assert.throws(() => sdkProvider(config, { apiKey: 'explicit-key' }), { code: 'CONFIGURATION_ERROR' });
            assert.doesNotThrow(() => sdkProvider(config, { apiKey: 'explicit-key', accountId: 'explicit-account' }));
        }
    }
});

test('CLI providers and routes use loaded aliases while explicit selectors remain exact', async t => {
    preserveEnvironment(t);
    const calls = [];
    t.mock.method(globalThis, 'fetch', capture(calls));
    for (const config of configs) {
        const name = KEY_ENVS[configName(config)];
        const scoped = 'DECISION_BRIDGE_' + name;
        setEnvironment({ [name]: 'ambient-key', [scoped]: 'ambient-scoped-key' });
        for (const env of [{ [name]: 'selected-key', CLOUDFLARE_ACCOUNT_ID: 'preferred-account' },
            { [name]: 'other-key', [scoped]: 'selected-key', CLOUDFLARE_ACCOUNT_ID: 'other-account',
                DECISION_BRIDGE_CLOUDFLARE_ACCOUNT_ID: 'preferred-account' }]) {
            calls.length = 0;
            const backend = await configuredProvider({ config, env });
            await dispatch(config, backend);
            checkCall(config, calls, 'selected-key');
            const routed = routingOptions({ config: { schemaVersion: 2, defaultRoute: 'p',
                routes: { p: { config, ...(config.preset ? { allowGenerative: true } : {}) } } }, env });
            if (config.preset) assert.equal(routed.routes.p.ready, true);
            else {
                assert.equal(routed.routes.p.config.apiKey, 'selected-key');
                if (config.provider.startsWith('cloudflare-')) assert.equal(routed.routes.p.config.accountId, 'preferred-account');
            }
        }
        const explicit = { ...config, apiKeyEnv: name };
        assert.equal(configuredApiKey(explicit, { [name]: 'exact-key', [scoped]: 'other-key' }), 'exact-key');
        assert.equal(configuredApiKey(explicit, { [scoped]: 'other-key' }), undefined);
        await assert.rejects(configuredProvider({ config, env: {} }), { code: 'CONFIGURATION_ERROR' });
        await assert.rejects(configuredProvider({ config, env: { [name]: 'fallback-key', [scoped]: '',
            CLOUDFLARE_ACCOUNT_ID: 'valid-account' } }), { code: 'CONFIGURATION_ERROR' });
    }
});

test('environment files merge each name before scoped credential precedence is applied', async t => {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, '.env'), 'GEMINI_API_KEY=file-key\nDECISION_BRIDGE_GEMINI_API_KEY=file-scoped-key\n');
    const options = { cwd, envFile: '.env', overrides: { provider: 'gemini-decisions' } };
    const loaded = await loadConfig({ ...options, env: { GEMINI_API_KEY: 'shell-key' } });
    assert.equal(configuredApiKey(loaded.config, loaded.env), 'file-scoped-key');
    const scoped = await loadConfig({ ...options, env: { GEMINI_API_KEY: 'shell-key', DECISION_BRIDGE_GEMINI_API_KEY: 'shell-scoped-key' } });
    assert.equal(configuredApiKey(scoped.config, scoped.env), 'shell-scoped-key');
});

test('generated built-in single and routing profiles accept both names without pinning a selector', async t => {
    const cwd = await temporaryWorkspace(t);
    for (const config of configs) {
        const name = KEY_ENVS[configName(config)];
        for (const routed of [false, true]) {
            const directory = join(cwd, configName(config) + routed);
            if (routed) await initializeRouting(directory, { schemaVersion: 2, defaultRoute: 'p',
                routes: { p: { config, ...(config.preset ? { allowGenerative: true } : {}) } } }, extracting(config), cwd);
            else await initialize(directory, config, false, cwd);
            const generated = JSON.parse(await readFile(join(directory, 'decision.config.json'), 'utf8'));
            assert.equal((routed ? generated.routes.p.config : generated).apiKeyEnv, undefined);
            const env = await readFile(join(directory, '.env.example'), 'utf8');
            assert(env.includes(name + '=replace_with_your_api_key'));
            assert(env.includes('# DECISION_BRIDGE_' + name + '=replace_with_your_api_key'));
            if (config.provider.startsWith('cloudflare-')) assert(env.includes('# DECISION_BRIDGE_CLOUDFLARE_ACCOUNT_ID='));
        }
    }
    const directory = join(cwd, 'explicit');
    await initialize(directory, { provider: 'jev', apiKeyEnv: 'PROJECT_EXACT_KEY' }, false, cwd);
    assert.equal(await readFile(join(directory, '.env.example'), 'utf8'), 'PROJECT_EXACT_KEY=replace_with_your_api_key\n');
    for (const selector of [undefined, 'DECISION_BRIDGE_TYPESAFE_API_KEY']) {
        const customDirectory = join(cwd, selector ?? 'custom-endpoint');
        await initialize(customDirectory, { provider: 'jev', baseURL: 'http://127.0.0.1',
            ...(selector ? { apiKeyEnv: selector } : {}) }, false, cwd);
        const profile = JSON.parse(await readFile(join(customDirectory, 'decision.config.json'), 'utf8'));
        const selected = selector ?? 'TYPESAFE_API_KEY';
        assert.equal(profile.apiKeyEnv, selected);
        assert.equal((await configuredProvider({ config: profile, env: { [selected]: 'fixture-key' } })).defaultModel, 'jev-latest');
        assert.equal(await readFile(join(customDirectory, '.env.example'), 'utf8'), selected + '=replace_with_your_api_key\n');
    }
});
