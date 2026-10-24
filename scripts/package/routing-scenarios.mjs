// Installed routing consumers verify the exported API, browser graph and CLI registry.
export function routingScenario(name) {
    return `import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as routing from ${JSON.stringify(name + '/routing')};
assert.deepEqual(Object.keys(routing).sort(), ['createDecisionRouter', 'createExtractionRouter', 'evaluateRoutedBatch', 'extractRoutedBatch'].sort());
const provider = { kind: 'decision', name: 'installed', defaultModel: 'fixture', async evaluate(request) {
    return { model: request.model, answers: { yes: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: null, output_tokens: null } };
} };
const request = { state: 'installed routing fixture', questions: { yes: { type: 'noul', instructions: 'True?' } } };
const router = routing.createDecisionRouter({ defaultRoute: 'auto', routes: {
    auto: { policy: 'deterministic', candidates: ['primary'] }, primary: { provider },
} });
assert.equal(router.inspect(request).selectedRoute, 'primary');
assert.equal((await router.evaluate(request)).meta.routing.method, 'single');
assert((await routing.evaluateRoutedBatch(router, [request]))[0].ok);
writeFileSync('routing-provider.mjs', 'export function createProvider() { return ' +
    '{ kind: "decision", name: "installed", defaultModel: "fixture", evaluate: ' + provider.evaluate.toString().replace('async evaluate(', 'async function(') + ' }; }');
writeFileSync('routing-config.json', JSON.stringify({ schemaVersion: 2, defaultRoute: 'auto', routes: {
    auto: { policy: 'deterministic', candidates: ['primary'] },
    primary: { config: { provider: 'custom-decision', module: './routing-provider.mjs', model: 'fixture' } },
} }));
writeFileSync('routing-request.json', JSON.stringify(request));
const cli = command => JSON.parse(execFileSync(process.execPath, ['node_modules/' + ${JSON.stringify(name)} + '/bin/decision.mjs',
    command, 'routing-request.json', '--config', 'routing-config.json'], { encoding: 'utf8' }));
assert.equal(cli('inspect').validationScope, 'structure');
assert.equal(cli('evaluate').meta.routing.selectedRoute, 'primary');
console.log('Installed routing SDK, batches and version-2 CLI registry passed.');
`;
}

export function routingTypes(name) {
    return `import { createDecisionRouter, createExtractionRouter, evaluateRoutedBatch, type RoutingMetadata } from ${JSON.stringify(name + '/routing')};
const routeConsumer = createDecisionRouter({ defaultRoute: 'auto', routes: {
    auto: { policy: 'deterministic', candidates: ['primary'] },
    primary: { config: { type: 'jev', apiKey: 'compile-only' } },
} });
async function checkRoutingTypes() {
    const result = await routeConsumer.evaluate({ state: 'typed', questions: { q: { type: 'noul', instructions: 'True?' } } });
    const answer: number = result.answers.q.noul;
    const meta: RoutingMetadata = result.meta.routing;
    const extractor = createExtractionRouter({ routes: { primary: { config: { type: 'cloudflare-extraction', apiKey: 'compile-only', accountId: 'id' } } } });
    const data = await extractor.extract({ state: '12', fields: { total: { type: 'number' } } }, { route: 'primary' });
    const total: number | null = data.extraction.answers.total.value;
    await evaluateRoutedBatch(routeConsumer, []);
    return { answer, meta, total };
}
void checkRoutingTypes;
`;
}
