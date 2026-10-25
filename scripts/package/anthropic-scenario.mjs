/** Exercise modern Anthropic options through installed SDK, CLI and declarations. */
export function anthropicScenario(name) {
    return `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createBridge, noul } from ${JSON.stringify(name)};
import { createGenerativeProvider } from ${JSON.stringify(name + '/custom/generative')};
writeFileSync('anthropic-fetch.mjs', \`export const bodies = [];
globalThis.fetch = async (_url, init) => {
    if (init.headers['anthropic-version'] !== '2026-10-21' || init.headers['x-api-key'] !== 'fixture') throw Error('Wrong fixture headers');
    const body = JSON.parse(init.body); bodies.push(body);
    return Response.json({ model: body.model, stop_reason: 'end_turn', content: [
        { type: 'thinking', thinking: '', signature: 'synthetic' },
        { type: 'text', text: JSON.stringify({ answers: { yes: { noul: 0.7 } } }) }],
        usage: { input_tokens: 4, output_tokens: 2 } });
};\`);
const { bodies } = await import('./anthropic-fetch.mjs');
const request = { state: 'fixture', questions: { yes: noul('True?') } };
const provider = createGenerativeProvider({ type: 'anthropic', apiKey: 'fixture', model: 'fixture',
    apiVersion: '2026-10-21', responseFormat: 'json_schema', parameters: { output_config: { effort: 'medium' } } });
const result = await createBridge({ provider }).evaluate(request);
assert.equal(result.answers.yes.noul, 0.7);
assert.equal(result.meta.responseFormat, 'json_schema');
assert.equal(result.meta.probabilitySource, 'elicited');
assert.equal(bodies[0].output_config.effort, 'medium');
assert.equal(bodies[0].output_config.format.type, 'json_schema');
assert(!bodies[0].tools && !bodies[0].tool_choice);
const flags = ['--provider', 'custom-generative', '--preset', 'anthropic', '--model', 'fixture',
    '--response-format', 'json_schema', '--anthropic-api-version', '2026-10-21', '--api-key-env', 'PACKAGE_ANTHROPIC_KEY'];
for (const command of ['evaluate', 'batch']) {
    const run = spawnSync(process.execPath, ['--import', './anthropic-fetch.mjs',
        'node_modules/' + ${JSON.stringify(name)} + '/bin/decision.mjs', command, '-', ...flags],
        { encoding: 'utf8', input: JSON.stringify(request), env: { ...process.env, PACKAGE_ANTHROPIC_KEY: 'fixture' } });
    assert.equal(run.status, 0, run.stderr);
    const value = JSON.parse(run.stdout);
    assert.equal((command === 'batch' ? value.result : value).answers.yes.noul, 0.7);
}
console.log('Installed Anthropic JSON SDK/CLI and version selection passed.');
`;
}

export function anthropicTypes(name) {
    return `
import { AnthropicProvider as InstalledAnthropic, type AnthropicOptions as InstalledAnthropicOptions } from ${JSON.stringify(name + '/custom/generative')};
const anthropicOptions: InstalledAnthropicOptions = { responseFormat: 'json_schema', apiVersion: '2026-10-21' };
new InstalledAnthropic(anthropicOptions);
// @ts-expect-error Installed declarations reject unsupported Anthropic output modes.
new InstalledAnthropic({ responseFormat: 'text' });
// @ts-expect-error Installed declarations reject unknown API versions.
new InstalledAnthropic({ apiVersion: 'latest' });
`;
}
