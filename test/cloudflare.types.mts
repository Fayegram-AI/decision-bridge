import { DecisionError, publicError, CloudflareDecisionsProvider, createBridge, createProvider, choice, scoreLevels, validateResult, decideChoice, type CloudflareDecisionRequest, type CloudflareGatewayOptions, type CloudflareAIBinding, type CloudflareDecisionsOptions } from '../src/index.mjs';

const binding: CloudflareAIBinding = { async run() { return new Response('{}'); } };
const gateway: CloudflareGatewayOptions = { id: 'existing', retries: { maxAttempts: 1 }, metadata: { tag: 'test' } };
const configured: CloudflareDecisionsOptions = { transport: 'binding', ai: binding, gateway, rejectIfBusy: true };
const provider = new CloudflareDecisionsProvider(configured);
const fromFactory: CloudflareDecisionsProvider = createProvider({ type: 'cloudflare-decisions', accountId: 'account', apiKey: 'key' });
const native: CloudflareDecisionRequest = { state: { test: true }, questions: {
    q: { type: 'choice', instructions: 'Choose.', criteria: { a: null, b: 'Other' } },
}, images: [{ content_type: 'image/png', base64: 'AAAA' }], options: { rejectIfBusy: true } };
const response = await provider.createDecision(native);
const count: number = response.decision.usage.input_tokens;
const logId: string | undefined = response.meta.gatewayLogId;
const result = await createBridge({ provider }).evaluate({ state: 'test', questions: {
    q: choice('Pick.', [{ value: true }, { value: 'true' }]),
    rating: scoreLevels('Rate.', [{ label: 'Low' }, { label: 'High' }]),
} });
const typed: true | 'true' = result.answers.q.choice;
const policyChoice: true | 'true' = decideChoice(result.answers.q, { minProbability: 0.8,
    probabilityDecimalPlaces: provider.getResultValidationOptions(result.model).probabilityDecimalPlaces }).choice;
const label: 'Low' | 'High' = result.answers.rating.legend['0']!.label;
validateResult({}, { q: choice('Pick.', { a: null, b: null }) }, { probabilityDecimalPlaces: 4 });
// @ts-expect-error Binding configuration cannot contain REST credentials.
new CloudflareDecisionsProvider({ transport: 'binding', ai: binding, apiKey: 'key' });
// @ts-expect-error REST configuration cannot contain a binding.
new CloudflareDecisionsProvider({ accountId: 'account', apiKey: 'key', ai: binding });
// @ts-expect-error Unsupported model selector.
new CloudflareDecisionsProvider({ model: 'unsupported', accountId: 'account', apiKey: 'key' });
// @ts-expect-error Native questions use criteria, not typed common options.
const invalid: CloudflareDecisionRequest = { state: 'test', questions: { q: { type: 'choice', instructions: 'Pick.', options: [] } } };
void [count, logId, typed, policyChoice, label, fromFactory, invalid];

const failure = new DecisionError('Safe fixture failure.', { gatewayLogId: 'fixture-log' });
const failureLogId: string | undefined = publicError(failure).gatewayLogId;
const serializedLogId: string | undefined = failure.toJSON().gatewayLogId;
// @ts-expect-error Explicit null is not an omitted native model selector.
const nullModel: CloudflareDecisionRequest = { ...native, model: null };
// @ts-expect-error Native execution options require an object when supplied.
const nullOptions: CloudflareDecisionRequest = { ...native, options: null };
void [failureLogId, serializedLogId, nullModel, nullOptions];

const omniProvider = new CloudflareDecisionsProvider({ transport: 'binding', ai: binding, model: '@cf/cloudflare/clef-omni' });
const omniRequest: CloudflareDecisionRequest = { model: 'clef-omni', state: { task: true }, questions: native.questions,
    audio: [{ content_type: 'audio/wav', base64: 'AAAA' }], videos: [{ content_type: 'video/webm', base64: 'AAAA' }] };
await omniProvider.createDecision(omniRequest);
await createBridge({ provider: omniProvider }).evaluate({ input: [
    { type: 'audio', dataUrl: 'data:audio/wav;base64,AAAA' },
    { type: 'video', dataUrl: 'data:video/mp4;base64,AAAA' },
    { type: 'text', text: 'Review.' },
], questions: native.questions });
// @ts-expect-error Audio input does not accept image detail.
const invalidAudio: import('../src/index.mjs').DecisionInputPart = { type: 'audio', dataUrl: '', detail: 'auto' };
// @ts-expect-error Native video objects use one of the supported MIME types.
const invalidVideo: import('../src/index.mjs').CloudflareDecisionVideo = { content_type: 'video/avi', base64: '' };
const legacyCapabilities: import('../src/index.mjs').Capabilities = {
    supported: true, orderedInput: false, images: false, typedChoices: false, labeledScores: false,
    safetyIdentifier: false, maxImages: 0, maxChoiceOptions: 255, maxScoreLevels: 10,
};
const audioPart: Extract<import('../src/index.mjs').DecisionInputPart, { type: 'audio' }> = { type: 'audio', dataUrl: '' };
const videoPart: Extract<import('../src/index.mjs').DecisionInputPart, { type: 'video' }> = { type: 'video', dataUrl: '' };
void [invalidAudio, invalidVideo, legacyCapabilities, audioPart, videoPart];
