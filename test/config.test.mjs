import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig, validateConfig, configuredProvider } from '../src/cli/config.mjs';
import { temporaryWorkspace } from './support.mjs';

const workspace = temporaryWorkspace;

test('config precedence and switching provider do not inherit old credentials', async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'jev', model: 'file-model', apiKeyEnv: 'OLD_KEY', baseURL: 'https://example.com' }));
  const loaded = await loadConfig({ cwd, configPath: 'config.json', env: { DECISION_MODEL: 'env-model' }, overrides: { model: 'flag-model' } });
  assert.equal(loaded.config.model, 'flag-model');
  const switched = await loadConfig({ cwd, configPath: 'config.json', env: {}, overrides: { provider: 'custom-generative', preset: 'openrouter' } });
  assert.equal(switched.config.apiKeyEnv, undefined); assert.equal(switched.config.baseURL, undefined); assert.equal(switched.config.model, undefined);
});

test('environment-file values do not override existing environment', async t => {
  const cwd = await workspace(t); await writeFile(join(cwd, '.env'), 'TEST_KEY=file\nDECISION_MODEL=file-model\n');
  const loaded = await loadConfig({ cwd, envFile: '.env', env: { TEST_KEY: 'shell', DECISION_MODEL: 'shell-model' } });
  assert.equal(loaded.env.TEST_KEY, 'shell'); assert.equal(loaded.config.model, 'shell-model');
});

for (const config of [{ apiKey: 'inline-secret' }, { provider: 'unknown' }, { schemaVersion: 2 },
  { apiKeyEnv: 'key with spaces' }, { maxRetries: 11 }, { timeoutMs: 0 }, { noAuth: 'true' },
  { parameters: [] }, { responseFormat: 'magic' }, { model: '' }]) {
  test(`configuration rejects ${JSON.stringify(config)}`, () => assert.throws(() => validateConfig(config), { code: 'CONFIGURATION_ERROR' }));
}

test('missing and malformed configuration files produce stable errors', async t => {
  const cwd = await workspace(t); await writeFile(join(cwd, 'bad.json'), 'not-json');
  for (const path of ['missing.json', 'bad.json']) {
    await assert.rejects(loadConfig({ cwd, configPath: path, env: {} }), { code: 'CONFIGURATION_ERROR' });
  }
});

for (const provider of ['jev', 'anthropic', 'openai-compatible']) {
  test(`CLI custom ${provider} origin requires explicit credential selection`, async () => {
    await assert.rejects(configuredProvider({ config: { ...(provider === 'jev' ? { provider } : { provider: 'custom-generative', preset: provider }), baseURL: 'https://unrelated.example' },
      env: { TYPESAFE_API_KEY: 'key', ANTHROPIC_API_KEY: 'key', OPENAI_API_KEY: 'key' }, moduleBase: '.' }),
    { code: 'CONFIGURATION_ERROR' });
  });
}

test('flag provider switch discards provider-scoped environment settings', async () => {
  const { config } = await loadConfig({ env: {
    DECISION_PROVIDER: 'custom-generative', DECISION_PRESET: 'anthropic', DECISION_MODEL: 'old-model',
    DECISION_API_KEY_ENV: 'OLD_KEY', DECISION_BASE_URL: 'https://old-provider.example',
    DECISION_RESPONSE_FORMAT: 'text', DECISION_TIMEOUT_MS: '9000',
  }, overrides: { provider: 'custom-generative', preset: 'openai-compatible', model: 'new-model' } });
  assert.equal(config.provider, 'custom-generative');
  assert.equal(config.model, 'new-model');
  assert.equal(config.apiKeyEnv, undefined);
  assert.equal(config.baseURL, undefined);
  assert.equal(config.responseFormat, undefined);
  assert.equal(config.timeoutMs, 9000);
});

test('every provider transition resets incompatible settings, including maxTokens', async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'custom-generative', preset: 'openrouter', maxTokens: 500,
    model: 'old', apiKeyEnv: 'ROUTER_KEY', parameters: { temperature: 0 }, maxRetries: 1 }));
  const { config } = await loadConfig({ cwd, configPath: 'config.json', env: {}, overrides: { provider: 'jev' } });
  assert.equal(config.maxTokens, undefined);
  assert.equal(config.parameters, undefined);
  assert.equal(config.maxRetries, undefined);
});

test('intermediate provider transition cannot restore a stale file-profile credential', async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'jev', apiKeyEnv: 'FILE_KEY' }));
  const { config } = await loadConfig({ cwd, configPath: 'config.json', env: {
    DECISION_PROVIDER: 'custom-generative', DECISION_PRESET: 'openai-compatible', DECISION_API_KEY_ENV: 'ENV_KEY',
  }, overrides: { provider: 'jev' } });
  assert.equal(config.apiKeyEnv, undefined);
});

test('same-provider layered overrides preserve endpoint and credential selection', async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'custom-generative', preset: 'openai-compatible',
    apiKeyEnv: 'CUSTOM_KEY', baseURL: 'https://custom.example/v1', model: 'file-model' }));
  const { config } = await loadConfig({ cwd, configPath: 'config.json', env: {
    DECISION_PROVIDER: 'custom-generative', DECISION_PRESET: 'openai-compatible', DECISION_MODEL: 'env-model',
  }, overrides: { provider: 'custom-generative', preset: 'openai-compatible', model: 'flag-model' } });
  assert.equal(config.apiKeyEnv, 'CUSTOM_KEY');
  assert.equal(config.baseURL, 'https://custom.example/v1');
  assert.equal(config.model, 'flag-model');
});

test('changing to a custom provider does not inherit built-in transport settings', async t => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'config.json'), JSON.stringify({ provider: 'jev', maxRetries: 2,
    maxRequestBytes: 5000, timeoutMs: 6000 }));
  const { config } = await loadConfig({ cwd, configPath: 'config.json', env: {},
    overrides: { provider: 'custom-decision', module: 'provider.mjs' } });
  assert.equal(config.maxRetries, undefined);
  assert.equal(config.maxRequestBytes, undefined);
  assert.equal(config.timeoutMs, 6000);
});
