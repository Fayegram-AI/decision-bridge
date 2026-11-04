/** Installed exports and declarations for native OpenRouter and opt-in Anthropic threads. */
export function providerRefreshScenario(name) {
    return `import assert from 'node:assert/strict';
import { createProvider, createBridge } from ${JSON.stringify(name)};
import { createExtractionProvider, extractBatch } from ${JSON.stringify(name + '/extraction')};
import { AnthropicProvider } from ${JSON.stringify(name + '/custom/generative')};
const usage = { input_tokens: 1, output_tokens: 0 };
const questions = { q: { type: 'noul', instructions: 'True?' } };
const provider = createProvider({ type: 'openrouter-decisions', model: 'vendor/model', apiKey: 'fixture', fetchImpl: async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(JSON.parse(init.body).provider.allow_fallbacks, false);
    return Response.json({ model: 'served', answers: { q: { type: 'noul', noul: 0.8 } }, usage });
} });
assert.equal((await createBridge({ provider }).evaluate({ state: 'Evidence', questions })).meta.probabilitySource, 'native');
const extraction = createExtractionProvider({ type: 'openrouter-extraction', model: 'vendor/extract', apiKey: 'fixture',
    fetchImpl: async () => Response.json({ model: 'served', answers: { name: { type: 'text', value: 'Ada' } }, usage, state_text: null }) });
const request = { model: ' vendor/extract ', state: 'Ada', fields: { name: { type: 'text' } } };
const validated = extraction.validate(request);
assert.deepEqual(validated, { ...request, model: 'vendor/extract' });
assert.deepEqual(extraction.validate(validated), validated);
const result = await extraction.extract(validated);
assert.deepEqual(extraction.validateResult(result, validated), result);
assert.equal((await extractBatch(extraction, [validated]))[0].ok, true);
let calls = 0;
const thread = new AnthropicProvider({ model: 'fixture', apiKey: 'fixture', workspaceId: 'workspace', responseFormat: 'json_schema',
    fetchImpl: async (_url, init) => {
        assert.equal(init.headers['anthropic-workspace-id'], 'workspace');
        assert.equal(init.headers['anthropic-beta'], 'message-threads-2026-08-12');
        assert.equal(JSON.parse(init.body).thread.type, calls++ ? 'continue' : 'create');
        return Response.json({ id: String(calls), model: 'fixture', stop_reason: 'end_turn',
            content: [{ type: 'text', text: '{"answers":{"q":{"noul":0.7}}}' }], usage });
    } }).createThread({ questions });
await thread.evaluate('first'); await thread.evaluate('second'); thread.dispose();
console.log('Installed native OpenRouter, extraction contracts and Anthropic threads passed.');
`;
}

export function providerRefreshTypes(name) {
    return `
import { OpenRouterDecisionsProvider as NativeRouter } from ${JSON.stringify(name)};
import { createExtractionProvider as nativeExtraction, extractBatch as nativeExtractBatch,
    type ExtractionProvider as GenericExtraction } from ${JSON.stringify(name + '/extraction')};
import { createGenerativeProvider as threadProvider } from ${JSON.stringify(name + '/custom/generative')};
const nativeAnswer = await new NativeRouter({ model: 'vendor/model' }).createDecision({ state: 'Text',
    questions: { pick: { type: 'choice', instructions: 'Choose', criteria: { a: null, b: ['B'] } } } });
const optionalDistribution: Readonly<Record<string, number>> | undefined = nativeAnswer.decision.answers.pick.probabilities;
const nativeExtractor = nativeExtraction({ type: 'openrouter-extraction', model: 'vendor/model' });
const extractionContract: GenericExtraction = nativeExtractor;
const validatedExtraction = nativeExtractor.validate({ state: 'Text', fields: { name: { type: 'text' } } });
const retainedImages: import(${JSON.stringify(name + '/extraction')}).CommonExtractionRequest['images'] = validatedExtraction.images;
await nativeExtractor.extract(validatedExtraction);
const extracted = await nativeExtractor.extract({ state: 'Text', fields: { name: { type: 'text' } } });
const optionalTruncated: boolean | undefined = extracted.extraction.truncated;
const nullableState: string | null | undefined = extracted.extraction.state_text;
const forecastResult = await nativeExtractor.extract({ state: 'Evidence',
    fields: { future: { type: 'forecast', min: 0, max: 10, horizon: 2, interval: 'day' } } });
const forecastValues: readonly (number | string)[] | null = forecastResult.extraction.answers.future.value;
// @ts-expect-error Native forecast values cannot be scalars.
const invalidForecast: typeof forecastResult.extraction.answers.future.value = 1;
await nativeExtractBatch(nativeExtractor, [{ state: 'Text', fields: { amount: { type: 'number' } } }]);
const thread = threadProvider({ type: 'anthropic', workspaceId: 'workspace', maxRequestBytes: 128000000 })
    .createThread({ questions: { ready: { type: 'noul', instructions: 'Ready?' } } });
const threaded = await thread.evaluate('Evidence');
const probability: number = threaded.answers.ready.noul;
thread.reset(); thread.dispose();
void [optionalDistribution, extractionContract, retainedImages, optionalTruncated, nullableState, probability, forecastValues, invalidForecast];
`;
}
