import { choice, noul, scoreLevels, createBridge, createProvider, decideChoice, type NativeDecisionRequest, type ProviderConfig, type Extension, type DecisionProvider, type ProviderResult, type OpenAIDecisionUsage, type OpenAIDecisionsMetadata, type OpenAIDecisionsTransportMetadata, type JsonValue } from '../src/index.mjs';

const configuration: ProviderConfig = { type: 'openai-decisions', apiKey: 'compile-only', model: 'luna' };
const provider = createProvider({ type: 'openai-decisions', apiKey: 'compile-only' });
const bridge = createBridge({ provider });
const extensions: readonly Extension[] = [{ name: 'prepare', prepareInput(parts) {
    return [...parts, { type: 'text', text: 'More context' }];
} }];
createBridge({ provider, extensions });
const custom: DecisionProvider = { kind: 'decision', name: 'custom', getCapabilities() { return { typedChoices: true }; },
    validateRequest(request) { if (request.model === 'unsupported') throw Error('Unsupported model'); },
    async evaluate() { throw Error('Compile-only'); } };
createBridge({ provider: custom });

async function checks() {
    const result = await bridge.evaluate({ input: [{ type: 'text', text: 'Sample' }], safetyIdentifier: null, questions: {
        typed: choice('Pick.', [{ value: true }, { value: 'true' }, { value: false }]),
        score: scoreLevels('Rate.', [{ label: 'Low' }, { label: 'High', description: { context: 'High' } }]),
        predicate: noul('True?'),
    } });
    const value: true | 'true' | false = result.answers.typed.choice;
    const score: number = result.answers.score.score;
    const label: 'Low' | 'High' | undefined = result.answers.score.legend[0]?.label;
    const decision = decideChoice(result.answers.typed, { minProbability: 0.8, abstainOptions: [true] });
    const typed: true | 'true' | false = decision.choice;
    const cache: number | undefined = result.meta.openaiDecisions?.usage.input_tokens_details.cached_tokens;
    const request: NativeDecisionRequest = { input: [{ role: 'user', content: [
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'original' },
    ] }], questions: [{ type: 'choice', instructions: 'Pick.', choices: [{ value: true }, { value: 'true' }] }] };
    const native = await provider.createDecision(request);
    const tokens: number = native.decision.usage.total_tokens;
    const attempts: number = native.meta.attempts;
    const selection: OpenAIDecisionsTransportMetadata = native.meta;
    const requested: string = selection.requestedModel;
    const resolved: string = selection.resolvedModel;
    const commonResolved: string | undefined = result.meta.resolvedModel;
    // @ts-expect-error Selection metadata is immutable.
    selection.resolvedModel = 'other';
    bridge.validate({ state: '', questions: { q: noul('True?') } });
    bridge.getCapabilities().images;
    // @ts-expect-error Ordered input and state are mutually exclusive.
    bridge.evaluate({ state: '', input: [{ type: 'text', text: '' }], questions: { q: noul('True?') } });
    // @ts-expect-error Native input accepts user roles only.
    provider.createDecision({ input: [{ role: 'system', content: '' }], questions: [] });
    // @ts-expect-error Unsupported native generation setting.
    createProvider({ type: 'openai-decisions', maxTokens: 10 });
    // @ts-expect-error Typed choice values cannot be numbers.
    choice('Pick.', [{ value: 1 }]);
    // @ts-expect-error The inferred union does not include arbitrary options.
    const wrong: 'other' = result.answers.typed.choice;
    // @ts-expect-error Results are immutable.
    result.answers.typed.probabilities.push({ value: true, probability: 1 });
    // @ts-expect-error Common labelled scores need two levels.
    scoreLevels('Rate.', [{ label: 'Only' }]);
    return { value, score, label, typed, cache, tokens, attempts, requested, resolved, commonResolved, wrong };
}
void checks;
void configuration;

function metadataChecks(usage: OpenAIDecisionUsage, nativeMetadata: OpenAIDecisionsMetadata) {
    const json: JsonValue = usage;
    const meta: ProviderResult['meta'] = { openaiDecisions: nativeMetadata };
    // @ts-expect-error Usage remains immutable after being represented as a JSON type.
    usage.input_tokens_details.cached_tokens = 0;
    return { json, meta };
}
void metadataChecks;
