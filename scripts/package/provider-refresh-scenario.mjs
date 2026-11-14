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
const media = createProvider({ type: 'openrouter-decisions', model: 'google/gemini-decision-1', apiKey: 'fixture', fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, 'google/gemini-decision-1');
    assert.deepEqual(JSON.parse(init.body).state, [{ type: 'file', file: { file_data: 'data:text/csv;base64,YQ==' } }]);
    return Response.json({ model: 'served', answers: { q: { type: 'noul', noul: 0.812345, confidence: 0.712345 } }, usage });
} });
const mediaResult = await createBridge({ provider: media }).evaluate({ model: ' google/gemini-decision-1 ',
    input: [{ type: 'document', dataUrl: 'data:text/csv;base64,YQ==' }], questions });
assert.equal(mediaResult.meta.schemaVersion, 7);
assert.equal(mediaResult.meta.openRouter.answers.q.confidence, 0.712345);
const extraction = createExtractionProvider({ type: 'openrouter-extraction', model: 'vendor/extract', apiKey: 'fixture',
    fetchImpl: async () => Response.json({ model: 'served', answers: { name: { type: 'text', value: 'Ada' } }, usage, state_text: null }) });
const request = { model: ' vendor/extract ', state: 'Ada', fields: { name: { type: 'text' } } };
const validated = extraction.validate(request);
assert.deepEqual(validated, { ...request, model: 'vendor/extract' });
assert.deepEqual(extraction.validate(validated), validated);
const result = await extraction.extract(validated);
assert.deepEqual(extraction.validateResult(result, validated), result);
assert.equal((await extractBatch(extraction, [validated]))[0].ok, true);
await extraction.createExtraction({ fields: { name: { type: 'text', unit: 'label' } },
    assets: { file: { format: 'pdf', data_base64: btoa('%PDF-1.7\\nfixture') } } });
let calls = 0;
const threadClient = new AnthropicProvider({ model: 'claude-sonnet-5-5', apiKey: 'fixture', workspaceId: 'workspace',
    fetchImpl: async (_url, init) => {
        assert.equal(init.headers['anthropic-workspace-id'], 'workspace');
        assert.equal(init.headers['anthropic-beta'], 'message-threads-2026-08-12');
        assert.equal(JSON.parse(init.body).thread.type, calls++ ? 'continue' : 'create');
        assert.equal(JSON.parse(init.body).output_config.format.type, 'json_schema');
        return Response.json({ id: String(calls), model: 'fixture', stop_reason: 'end_turn',
            content: [{ type: 'text', text: '{"answers":{"q":{"noul":0.7}}}' }], usage });
    } });
for (const [options, code] of [[{ model: null }, 'VALIDATION_ERROR'],
    [{ maxTurns: null }, 'CONFIGURATION_ERROR'], [{ maxHistoryBytes: null }, 'CONFIGURATION_ERROR']]) {
    assert.throws(() => threadClient.createThread({ questions, ...options }), { code });
}
const thread = threadClient.createThread({ questions });
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
await nativeExtractor.createExtraction({ fields: { name: { type: 'text', unit: 'label' } },
    assets: { photo: { format: 'webp', data_base64: 'fixture' } } });
const documentTypes: readonly string[] | undefined = new NativeRouter({ model: 'google/gemini-decision-1' }).getCapabilities().documentMimeTypes;
const metadata = await new NativeRouter({ model: 'google/gemini-decision-1' }).evaluate({ input: [{ type: 'document', dataUrl: 'data:text/csv;base64,YQ==' }],
    questions: { ready: { type: 'noul', instructions: 'Ready?' } } });
const optionalNoulConfidence: number | undefined = metadata.meta?.openRouter?.answers?.ready?.confidence;
const listResult = await nativeExtractor.extract({ images: ['fixture'], fields: { names: { type: 'list', items: 'text' } } });
const optionalSpans: readonly (readonly [number, number] | null)[] | undefined = listResult.extraction.answers.names.spans;
const optionalNullProbability: number | undefined = listResult.extraction.answers.names.p_null;
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
void [optionalDistribution, extractionContract, retainedImages, optionalTruncated, nullableState, probability, forecastValues, invalidForecast,
    documentTypes, optionalNoulConfidence, optionalSpans, optionalNullProbability];
`;
}
