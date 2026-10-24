import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { runCli } from '../src/cli/main.mjs';
import { loadConfig, validateConfig } from '../src/cli/config.mjs';
import { streams, temporaryWorkspace } from './support.mjs';
import { routingRequest as request } from './routing-fixtures.mjs';

const schema = JSON.parse(await readFile(new URL('../schemas/decision.config.schema.json', import.meta.url), 'utf8'));
const schemaValid = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
function config(policy = {}) {
    return { schemaVersion: 2, defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['a', 'b'], ...policy },
        a: { config: { provider: 'custom-decision', module: './a.mjs', model: 'a' } },
        b: { config: { provider: 'custom-decision', module: './b.mjs', model: 'b' } },
    } };
}
async function setup(t, value) {
    const cwd = await temporaryWorkspace(t);
    await writeFile(join(cwd, 'config.json'), JSON.stringify(value));
    await writeFile(join(cwd, 'request.json'), JSON.stringify(request));
    for (const id of ['a', 'b']) await writeFile(join(cwd, id + '.mjs'), `export function createProvider() { return {
        kind: 'decision', name: '${id}', defaultModel: '${id}', async evaluate(request) { return { model: request.model,
            answers: { yes: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: null, output_tokens: null } }; }
    }; }`);
    return cwd;
}
async function invoke(args, context = {}) {
    const io = streams();
    const code = await runCli(args, { ...io, env: {}, ...context });
    return { code, output: io.output(), error: io.error() };
}

test('v2 schema/runtime shapes match; semantic references reject before execution', () => {
    const valid = [config(), config({ policy: 'decision-assisted', selector: { route: 'a', minProbability: 0.7, minMargin: 0.2 } }),
        config({ priority: ['a'], failover: { routes: ['b'], maxAttempts: 2 }, cooldown: { durationMs: 200 } }),
        { schemaVersion: 2, routes: { off: { enabled: false, config: { provider: 'custom-decision' } } } }];
    const invalid = [config({ policy: 'invalid' }), config({ candidates: ['auto'] }), config({ candidates: ['a', 'a'] }),
        config({ selector: { route: 'a' } }), config({ rules: [{ effect: 'prefer', when: { anything: true }, routes: ['a'] }] }),
        config({ policy: 'decision-assisted', selector: { route: 'a', minMargin: -1 } }),
        { ...config(), anything: true }];
    for (const value of valid) { assert(schemaValid(value), JSON.stringify(schemaValid.errors)); assert.doesNotThrow(() => validateConfig(value)); }
    for (const value of invalid) { assert.equal(schemaValid(value), false); assert.throws(() => validateConfig(value), { code: 'CONFIGURATION_ERROR' }); }
    assert.throws(() => validateConfig(config({ candidates: ['unknown'] })), { code: 'CONFIGURATION_ERROR' });
});

test('inspect/validate never import custom modules or require credentials, and report provisional validation', async t => {
    const cwd = await setup(t, config());
    await writeFile(join(cwd, 'a.mjs'), 'throw Error("must not execute");');
    for (const command of ['inspect', 'validate']) {
        const result = await invoke([command, 'request.json', '--config', 'config.json'], { cwd });
        assert.equal(result.code, 0, result.error);
        const report = JSON.parse(result.output);
        assert.equal(report.validationScope, 'structure'); assert.deepEqual(report.provisional, ['a', 'b']);
    }
});

test('v2 ignores legacy selection environment, rejects registry-rewriting flags and supports direct override', async t => {
    const cwd = await setup(t, config({ priority: ['b'] }));
    const loaded = await loadConfig({ cwd, configPath: 'config.json', env: { DECISION_PROVIDER: 'jev', DECISION_MODEL: 'other', DECISION_TIMEOUT_MS: 'invalid' } });
    assert.equal(loaded.config.schemaVersion, 2);
    const result = await invoke(['evaluate', 'request.json', '--config', 'config.json', '--route', 'a'], { cwd });
    assert.equal(result.code, 0, result.error); assert.equal(JSON.parse(result.output).meta.routing.selectedRoute, 'a');
    const wrong = await invoke(['evaluate', 'request.json', '--config', 'config.json', '--model', 'other'], { cwd });
    assert.equal(wrong.code, 2); assert.equal(JSON.parse(wrong.error).error.code, 'CONFIGURATION_ERROR');
});

test('terminal ambiguity, suppressed prompts, EOF, and ordered batch blanks/errors stay off stdout', async t => {
    const cwd = await setup(t, config());
    await writeFile(join(cwd, 'input.jsonl'), JSON.stringify(request) + '\n\ninvalid\n' + JSON.stringify(request) + '\n');
    const io = streams(); io.stdin.isTTY = true; io.stderr.isTTY = true;
    let prompts = 0;
    io.stderr.on('data', buffer => { if (buffer.toString().includes('Selection:')) { prompts++; setTimeout(() => io.stdin.write('2\n'), 5); } });
    const code = await runCli(['batch', 'input.jsonl', '--config', 'config.json', '--interactive'], { ...io, cwd, env: {} });
    assert.equal(code, 1, io.error()); assert.equal(prompts, 2);
    const rows = io.output().trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => row.line), [1, 3, 4]);
    assert.equal(rows[0].result.meta.routing.selectedRoute, 'b'); assert.equal(rows[2].result.meta.routing.selectedRoute, 'b');
    const suppressed = await invoke(['evaluate', 'request.json', '--config', 'config.json', '--no-routing-prompt'], { cwd });
    assert.equal(JSON.parse(suppressed.error).error.code, 'ROUTING_AMBIGUOUS');
    const eof = streams(); eof.stdin.isTTY = true; eof.stderr.isTTY = true;
    eof.stderr.on('data', () => eof.stdin.end());
    assert.equal(await runCli(['evaluate', 'request.json', '--config', 'config.json', '--interactive'], { ...eof, cwd, env: {} }), 130);
});

test('unattended assisted preconditions apply with one candidate and piped input; interactive mode permits local resolution', async t => {
    const cwd = await setup(t, config({ policy: 'decision-assisted', candidates: ['a'] }));
    const unattended = await invoke(['evaluate', 'request.json', '--config', 'config.json'], { cwd });
    assert.equal(JSON.parse(unattended.error).error.code, 'CONFIGURATION_ERROR');
    const io = streams(); io.stdin.isTTY = true; io.stderr.isTTY = true;
    assert.equal(await runCli(['evaluate', 'request.json', '--config', 'config.json'], { ...io, cwd, env: {} }), 0);
    assert.equal(io.error(), '');
    const invalid = await invoke(['evaluate', '-', '--config', 'config.json', '--interactive'], { cwd });
    assert.equal(JSON.parse(invalid.error).error.code, 'USAGE_ERROR');
});

test('terminal EOF cancels later batch clarifications without reopening an ended input stream', async t => {
    const cwd = await setup(t, { ...config(), clarificationTimeoutMs: 50 });
    await writeFile(join(cwd, 'input.jsonl'), (JSON.stringify(request) + '\n').repeat(3));
    for (const endedBeforeStart of [false, true]) {
        const io = streams(); io.stdin.isTTY = true; io.stderr.isTTY = true;
        let prompts = 0;
        io.stderr.on('data', buffer => {
            if (buffer.toString().includes('Selection:')) { prompts++; io.stdin.end(); }
        });
        if (endedBeforeStart) await new Promise(resolve => {
            io.stdin.once('end', resolve); io.stdin.end(); io.stdin.resume();
        });
        const code = await runCli(['batch', 'input.jsonl', '--config', 'config.json', '--interactive'], { ...io, cwd, env: {} });
        assert.equal(code, 1, io.error());
        const rows = io.output().trim().split('\n').map(JSON.parse);
        assert.deepEqual(rows.map(row => [row.line, row.ok, row.error?.code]),
            [[1, false, 'ABORTED'], [2, false, 'ABORTED'], [3, false, 'ABORTED']]);
        assert.equal(prompts, endedBeforeStart ? 0 : 1);
    }
});

test('routing initialization creates a schema-valid registry without overwrite', async t => {
    const cwd = await temporaryWorkspace(t);
    const result = await invoke(['init', 'project', '--route', 'auto'], { cwd });
    assert.equal(result.code, 0, result.error);
    const value = JSON.parse(await readFile(join(cwd, 'project/decision.config.json'), 'utf8'));
    assert(schemaValid(value), JSON.stringify(schemaValid.errors)); assert.equal(value.defaultRoute, 'auto');
    assert.equal((await invoke(['init', 'project', '--route', 'auto'], { cwd })).code, 2);
});

test('all explicitly named credential values are scrubbed, including nonstandard variable names', async t => {
    const value = config({ priority: ['a'] }); value.routes.a.config.apiKeyEnv = 'ODD_NAME';
    const cwd = await setup(t, value);
    await writeFile(join(cwd, 'a.mjs'), `export function createProvider(options) { return { kind:'decision',name:'a',defaultModel:'a',
        async evaluate() { const error = new Error(); error.code='unused'; throw error; } }; }`);
    const result = await invoke(['evaluate', 'request.json', '--config', 'config.json'], { cwd, env: { ODD_NAME: 'private-credential' } });
    assert(!result.error.includes('private-credential'));
    // The credential can also occur in an otherwise valid route diagnostic identifier.
    value.routes['private-credential'] = value.routes.a; delete value.routes.a;
    value.routes.auto.candidates = ['private-credential']; value.routes.auto.priority = ['private-credential'];
    await writeFile(join(cwd, 'config.json'), JSON.stringify(value));
    const again = await invoke(['evaluate', 'request.json', '--config', 'config.json'], { cwd, env: { ODD_NAME: 'private-credential' } });
    assert(!again.error.includes('private-credential'));
});
