// Provider contracts across offline configuration, CLI dispatch and routing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { runCli } from '../src/cli/main.mjs';
import { validateConfig } from '../src/cli/config-validation.mjs';
import { createDecisionRouter, createExtractionRouter } from '../src/routing/index.mjs';
import { AnthropicProvider } from '../src/custom/generative/index.mjs';
import { streams, temporaryWorkspace } from './support.mjs';

const questions = { q: { type: 'noul', instructions: 'True?' } };
const request = { state: 'Evidence', questions };
const fields = { name: { type: 'text' } };
const usage = { input_tokens: 1, output_tokens: 0 };
const config = type => ({ provider: type, model: 'vendor/model', providerPreferences: { only: ['chosen'], allow_fallbacks: false } });
async function invoke(args, input, context = {}) {
    const io = streams(); io.stdin.end(input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input));
    const code = await runCli(args, { ...io, env: {}, ...context });
    return { code, stdout: io.output(), stderr: io.error() };
}

test('OpenRouter CLI profiles initialize, validate, dispatch and batch both native protocols', async t => {
    const cwd = await temporaryWorkspace(t);
    const schema = new Ajv2020({ strict: false }).compile(JSON.parse(await readFile(new URL('../schemas/decision.config.schema.json', import.meta.url))));
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        const body = JSON.parse(init.body); calls.push({ url, body });
        assert.equal(body.provider.allow_fallbacks, false);
        assert.deepEqual(body.provider.only, ['chosen']);
        return Response.json(body.fields ? { model: body.model, answers: { name: { type: 'text', value: 'Ada' } }, usage }
            : { model: body.model, answers: { q: { type: 'noul', noul: 0.8 } }, usage });
    });
    for (const type of ['openrouter-decisions', 'openrouter-extraction']) {
        assert(schema(config(type)), JSON.stringify(schema.errors));
        assert.doesNotThrow(() => validateConfig(config(type), { complete: true }));
        const extracting = type.endsWith('extraction');
        const prefix = extracting ? ['extraction'] : [];
        const flags = ['--config', type + '.json'];
        await writeFile(join(cwd, type + '.json'), JSON.stringify(config(type)));
        const input = extracting ? { state: 'Ada', fields } : request;
        for (const native of [false, true]) {
            const mode = native ? ['--native'] : [];
            const valid = await invoke([...prefix, 'validate', '-', ...flags, ...mode], input, { cwd });
            assert.equal(valid.code, 0, valid.stderr);
            const initialized = await invoke([...prefix, 'init', type + native, ...flags, ...mode], undefined, { cwd });
            assert.equal(initialized.code, 0, initialized.stderr);
            const result = await invoke([...prefix, 'evaluate', '-', ...flags, ...mode], input, { cwd, env: { OPENROUTER_API_KEY: 'fixture' } });
            assert.equal(result.code, 0, result.stderr);
            const batch = await invoke([...prefix, 'batch', '-', ...flags, ...mode], [input, input].map(JSON.stringify).join('\n'),
                { cwd, env: { OPENROUTER_API_KEY: 'fixture' } });
            assert.equal(batch.code, 0, batch.stderr);
            assert(batch.stdout.trim().split('\n').map(JSON.parse).every(row => row.ok));
        }
    }
    assert.equal(calls.length, 12);
    assert(calls.every(({ url, body }) => url === 'https://openrouter.ai/api/alpha/' + (body.fields ? 'extractions' : 'decisions')));
});

test('native OpenRouter routes preflight offline, enforce one fallback owner and preserve extraction metadata', async () => {
    let calls = 0;
    const configured = { type: 'openrouter-decisions', apiKey: 'fixture', model: 'vendor/model', fetchImpl: async () => {
        calls++; return Response.json({ model: 'served', answers: { q: { type: 'noul', noul: 0.8 } }, usage });
    } };
    const routes = { auto: { policy: 'deterministic', candidates: ['a', 'b'], priority: ['a'], failover: { routes: ['b'], maxAttempts: 2 } },
        a: { config: configured }, b: { config: { ...configured, model: 'vendor/second' } } };
    const router = createDecisionRouter({ defaultRoute: 'auto', routes });
    assert.equal(router.inspect(request).outcome, 'selected'); assert.equal(calls, 0);
    assert.equal((await router.evaluate(request)).meta.probabilitySource, 'native');
    assert.throws(() => createDecisionRouter({ defaultRoute: 'auto', routes: { ...routes,
        a: { config: { ...configured, providerPreferences: { allow_fallbacks: true } } } } }), { code: 'CONFIGURATION_ERROR' });
    const extraction = createExtractionRouter({ defaultRoute: 'extract', routes: { extract: { config: {
        ...configured, type: 'openrouter-extraction', fetchImpl: async () => Response.json({ model: 'served',
            answers: { name: { type: 'text', value: 'Ada' } }, usage, state_text: null }),
    } } } });
    const result = await extraction.extract({ state: 'Ada', fields });
    assert.equal(result.meta.provider, 'openrouter-extraction');
    assert.equal(result.extraction.state_text, null); assert.equal(result.extraction.truncated, undefined);
});

test('Anthropic opt-in request budgets above 64 MiB reach the SDK and JSONL CLI transport', async t => {
    const state = 'a'.repeat(64 * 1024 * 1024 + 1);
    let calls = 0;
    const fetchImpl = async (_url, init) => {
        calls++; assert(Buffer.byteLength(init.body) > 64 * 1024 * 1024);
        return Response.json({ model: 'fixture', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answers":{"q":{"noul":0.8}}}' }],
            usage: { input_tokens: 1, output_tokens: 1 } });
    };
    const options = { model: 'fixture', apiKey: 'fixture', responseFormat: 'json_schema', fetchImpl };
    await assert.rejects(new AnthropicProvider(options).evaluate({ state, questions }), { code: 'REQUEST_TOO_LARGE' });
    assert.equal(calls, 0);
    await new AnthropicProvider({ ...options, maxRequestBytes: 128000000 }).evaluate({ state, questions });
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'large.json'), JSON.stringify({ provider: 'custom-generative', preset: 'anthropic', model: 'fixture',
        responseFormat: 'json_schema', maxRequestBytes: 128000000 }));
    t.mock.method(globalThis, 'fetch', fetchImpl);
    const result = await invoke(['batch', '-', '--config', 'large.json'], JSON.stringify({ state, questions }) + '\n',
        { cwd, env: { ANTHROPIC_API_KEY: 'fixture' } });
    assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).ok, true); assert.equal(calls, 2);
});
