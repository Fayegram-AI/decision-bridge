// Installed consumers exercise public subpaths, presets, modules and browser imports.
export function customScenario(name) {
    return `import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createBridge, createProvider, choice, noul, score, validateRequest } from ${JSON.stringify(name)};
import { defineDecisionProvider } from ${JSON.stringify(name + '/custom/decision')};
import * as generative from ${JSON.stringify(name + '/custom/generative')};
const { defineGenerativeProvider, createGenerativeProvider, buildResponseSchema, buildPrompt,
    parseGeneratedJson, normalizeGenerated } = generative;
assert.deepEqual(Object.keys(generative).sort(), ['defineGenerativeProvider', 'createGenerativeProvider',
    'OpenAICompatibleProvider', 'OpenRouterProvider', 'AnthropicProvider', 'buildResponseSchema',
    'buildPrompt', 'parseGeneratedJson', 'normalizeGenerated'].sort());
const input = { state: { log: 'local fixture' }, questions: {
    route: choice('Route?', { a: 'A', b: 'B' }), yes: noul('True?'), rating: score('Score?', ['Low', 'High']),
} };
const generated = { answers: { route: { probabilities: { a: 0.75, b: 0.25 } },
    yes: { noul: 0.8 }, rating: { probabilities: { '0': 0.25, '1': 0.75 } } } };
const fetchSource = \`const generated = \${JSON.stringify(generated)};
globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (new URL(url).hostname === 'api.anthropic.com') {
        if (init.headers['x-api-key'] !== 'fixture') throw Error('Missing Anthropic credential');
        return Response.json({ model: body.model, stop_reason: 'tool_use',
            content: [{ type: 'tool_use', name: 'submit_decisions', input: generated }],
            usage: { input_tokens: 4, output_tokens: 2 } });
    }
    if (init.headers.authorization !== 'Bearer fixture') throw Error('Missing compatible credential');
    return Response.json({ model: body.model, choices: [{ finish_reason: 'stop',
        message: { content: JSON.stringify(generated) } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
};\`;
writeFileSync('fixture-fetch.mjs', fetchSource);
const fixtureModule = await import('./fixture-fetch.mjs'); void fixtureModule;
for (const type of ['openai-compatible', 'openrouter', 'anthropic']) {
    assert.throws(() => createProvider({ type }), { code: 'CONFIGURATION_ERROR' });
    const provider = createGenerativeProvider({ type, model: 'fixture', apiKey: 'fixture', fetchImpl: globalThis.fetch });
    const bridge = createBridge({ provider });
    const result = await bridge.evaluate(input);
    assert.equal(bridge.providerKind, 'generative');
    assert.equal(result.meta.providerKind, 'generative');
    assert.equal(result.meta.probabilitySource, 'elicited');
    assert.equal(result.meta.confidenceSource, 'unavailable');
    assert.equal(result.answers.route.choice, 'a');
    assert.equal(result.answers.yes.noul, 0.8);
    assert.equal(result.answers.rating.score, 0.75);
    assert.equal(result.answers.route.confidence, undefined);
}
const resolved = validateRequest(input, 'fixture');
assert.equal(buildResponseSchema(input.questions).type, 'object');
assert.equal(typeof buildPrompt(resolved).system, 'string');
assert.equal(normalizeGenerated(parseGeneratedJson(JSON.stringify(generated)), resolved).answers.route.choice, 'a');
const canonical = normalizeGenerated(generated, resolved);
for (const [kind, define] of [['decision', defineDecisionProvider], ['generative', defineGenerativeProvider]]) {
    const provider = define({ name: 'fixture-' + kind, defaultModel: 'fixture', async evaluate() { return canonical; } });
    assert.equal((await createBridge({ provider }).evaluate(input)).meta.providerKind, kind);
}
const require = createRequire(import.meta.url);
const schema = JSON.parse(readFileSync(require.resolve(${JSON.stringify(name + '/config.schema.json')}), 'utf8'));
assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
async function cli(args, input, expected = 0) {
    const child = spawn(process.execPath, ['--import', './fixture-fetch.mjs',
        'node_modules/' + ${JSON.stringify(name)} + '/bin/decision.mjs', ...args], {
        env: { ...process.env, PACKAGE_PRESET_KEY: 'fixture' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
    child.stdin.end(input); const [code] = await once(child, 'close');
    assert.equal(code, expected, err); return expected === 0 ? out : err;
}
for (const preset of ['openai-compatible', 'openrouter', 'anthropic']) {
    const flags = ['--provider', 'custom-generative', '--preset', preset, '--model', 'fixture', '--api-key-env', 'PACKAGE_PRESET_KEY'];
    const result = JSON.parse(await cli(['evaluate', '-', ...flags], JSON.stringify(input)));
    assert.equal(result.meta.providerKind, 'generative');
    assert.equal(result.answers.route.choice, 'a');
    const directory = './preset-' + preset;
    await cli(['init', directory, ...flags]);
    const config = JSON.parse(readFileSync(directory + '/decision.config.json', 'utf8'));
    assert.equal(config.preset, preset);
    assert.equal(config.$schema, './decision.config.schema.json');
    assert.equal(JSON.parse(await cli(['validate', directory + '/request.json', '--config', directory + '/decision.config.json'])).validationScope, 'provider');
}
for (const kind of ['decision', 'generative']) {
    const providerType = 'custom-' + kind;
    const directory = './module-' + kind;
    await cli(['init', directory, '--provider', providerType]);
    const config = directory + '/decision.config.json';
    const templateError = JSON.parse(await cli(['evaluate', directory + '/request.json', '--config', config], undefined, 2));
    assert.equal(templateError.error.code, 'CONFIGURATION_ERROR');
    assert.match(templateError.error.message, /Connect this provider/);
    const helper = kind === 'decision' ? 'defineDecisionProvider' : 'defineGenerativeProvider';
    writeFileSync(directory + '/provider.mjs', 'import { ' + helper + ' } from ' +
        JSON.stringify(${JSON.stringify(name + '/custom/')} + kind) + ';\\n' +
        'export function createProvider(options) { return ' + helper + '({ name: "installed-module", defaultModel: options.model,' +
        ' async evaluate() { return ' + JSON.stringify(canonical) + '; }, async listModels() { return { models: [{ name: "fixture" }] }; } }); }\\n');
    const flags = ['--config', config];
    const result = JSON.parse(await cli(['evaluate', '-', ...flags], JSON.stringify(input)));
    assert.equal(result.meta.providerKind, kind);
    assert.equal(JSON.parse(await cli(['models', ...flags])).models[0].name, 'fixture');
    const rows = (await cli(['batch', '-', ...flags], JSON.stringify(input) + '\\n' + JSON.stringify(input) + '\\n'))
        .trim().split('\\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => [row.line, row.ok, row.result.meta.providerKind]), [[1, true, kind], [2, true, kind]]);
    assert.equal(JSON.parse(await cli(['validate', '-', ...flags], JSON.stringify(input))).validationScope, 'structure');
}
console.log('Installed custom SDK helpers, three presets, module CLI commands and initialization passed.');
`;
}

export function browserScenario(name) {
    return `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const entry = import.meta.resolve(${JSON.stringify(name)});
const seen = new Set();
function graph(url) {
    if (seen.has(url)) return;
    seen.add(url);
    const source = readFileSync(new URL(url), 'utf8');
    for (const match of source.matchAll(/(?:from\\s+|import\\s*)['"]([^'"]+)['"]/g)) {
        assert(!match[1].startsWith('node:'), 'Node-only import in SDK graph');
        if (match[1].startsWith('.')) graph(new URL(match[1], url).href);
    }
}
graph(entry);
assert(![...seen].some(url => url.includes('/custom/generative/')), 'Root SDK imports generative strategy');
// Construct Node's Web API fixture before removing globals; SDK import and execution stay below.
const openaiResponse = Response.json({ model: 'reported-model', answers: [{ type: 'predicate', name: 'q', probability: 0.7 }],
    usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
delete globalThis.process; delete globalThis.Buffer;
const sdk = await import(${JSON.stringify(name)});
const decision = await import(${JSON.stringify(name + '/custom/decision')});
const generative = await import(${JSON.stringify(name + '/custom/generative')});
graph(import.meta.resolve(${JSON.stringify(name + '/custom/decision')}));
graph(import.meta.resolve(${JSON.stringify(name + '/custom/generative')}));
for (const define of [decision.defineDecisionProvider, generative.defineGenerativeProvider]) {
    const provider = define({ name: 'browser-fixture', defaultModel: 'fixture', async evaluate(request) {
        return { model: request.model, answers: { q: { type: 'noul', noul: 0.7 } },
            usage: { input_tokens: null, output_tokens: null } };
    } });
    assert.equal((await sdk.createBridge({ provider }).evaluate({ state: '', questions: { q: sdk.noul('True?') } })).answers.q.noul, 0.7);
}
console.log('All SDK subpaths import and evaluate without Node globals; root excludes generative strategies.');
const openai = sdk.createProvider({ type: 'openai-decisions', model: 'luna', apiKey: 'fixture', fetchImpl: async (_, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.model, 'gpt-6-luna');
    return openaiResponse;
} });
const selected = await sdk.createBridge({ provider: openai }).evaluate({ state: '', questions: { q: sdk.noul('True?') } });
assert.equal(selected.meta.requestedModel, 'luna');
assert.equal(selected.meta.resolvedModel, 'gpt-6-luna');
assert.equal(selected.model, 'reported-model');
console.log('OpenAI selectors resolve and preserve metadata without Node globals.');
`;
}

export function consumerTypes(name) {
    return `import { createBridge, createProvider, JevProvider, box, noul, type Provider, type OpenAIDecisionsTransportMetadata } from ${JSON.stringify(name)};
import { defineDecisionProvider, type DecisionProviderDefinition } from ${JSON.stringify(name + '/custom/decision')};
import { defineGenerativeProvider, createGenerativeProvider, OpenAICompatibleProvider,
    type GenerativeProvider, type OpenAICompatibleOptions, buildResponseSchema } from ${JSON.stringify(name + '/custom/generative')};
const evaluate: Provider['evaluate'] = async request => ({ model: request.model, answers: {} as never,
    usage: { input_tokens: null, output_tokens: null } });
const definition: DecisionProviderDefinition = { name: 'typed', defaultModel: 'fixture', evaluate };
createBridge({ provider: defineDecisionProvider(definition) });
const generative: GenerativeProvider = defineGenerativeProvider({ name: 'typed', evaluate });
createBridge({ provider: generative });
const options: OpenAICompatibleOptions = { apiKey: 'fixture', model: 'fixture' };
createBridge({ provider: new OpenAICompatibleProvider(options) });
createGenerativeProvider({ type: 'anthropic', model: 'fixture', apiKey: 'fixture' });
buildResponseSchema({ q: noul('True?') });
async function nativeSelection() {
    const provider = createProvider({ type: 'openai-decisions', model: 'luna', apiKey: 'compile-only' });
    const native = await provider.createDecision({ input: '', questions: [{ type: 'predicate', instructions: 'True?' }] });
    const metadata: OpenAIDecisionsTransportMetadata = native.meta;
    const requested: string = metadata.requestedModel;
    const resolved: string = metadata.resolvedModel;
    const common = await createBridge({ provider }).evaluate({ state: '', questions: { q: noul('True?') } });
    const commonResolved: string | undefined = common.meta.resolvedModel;
    return { requested, resolved, commonResolved };
}
void nativeSelection;
async function jevSelection() {
    const provider = new JevProvider({ model: 'jev-preview', dangerZone: { images: true } });
    const result = await provider.createDecision({ state: 'photo-ref', questions: { q: box('The target') },
        assets: { 'photo-ref': { format: 'png', data_base64: 'compile-only' } } });
    const left: number = result.decision.answers.q.box.left;
    return left;
}
void jevSelection;
// @ts-expect-error General-purpose presets are not root providers.
createProvider({ type: 'openai-compatible', model: 'fixture' });
// @ts-expect-error Generative provenance cannot claim native probabilities.
defineGenerativeProvider({ ...definition, probabilitySource: 'native' });
// @ts-expect-error Root entry point excludes generative classes.
import { OpenRouterProvider } from ${JSON.stringify(name)};
// @ts-expect-error Custom providers require explicit classification.
createBridge({ provider: definition });
`;
}
