/** Public native/common Gemini types and additive media boundaries. */
import { createBridge, createProvider, GeminiDecisionsProvider, choice, scoreLevels, validateRequest,
    type DecisionInputPart, type GeminiDecisionRequest, type GeminiDecisionResponse, type Capabilities, type ResolvedRequest } from '../src/index.mjs';
import { createDecisionRouter } from '../src/routing/index.mjs';

const provider = createProvider({ type: 'gemini-decisions', apiKey: 'fixture' });
const typedProvider: GeminiDecisionsProvider = provider;
const validationQuestions = { pick: choice('Select', { a: 'First', b: 'Second' }) };
const validated = validateRequest({ state: 'Text', questions: validationQuestions }, 'gemini-decision-1', { maxJsonNodes: 1000000 });
const validatedLiteralQuestions: ResolvedRequest<typeof validationQuestions> = validated;
void validatedLiteralQuestions;
const native: GeminiDecisionRequest = { input: { type: 'document', uri: 'https://example.com/a.pdf', mime_type: 'application/pdf' },
    questions: { yes: { type: 'noul', instructions: [{ type: 'text', text: 'Visible?' }] } } };
void typedProvider.createDecision(native);
const inferred = provider.createDecision({ input: 'Text', questions: {
    pick: { type: 'choice', instructions: 'Select', criteria: { a: '', b: '' } },
    numeric: { type: 'choice', instructions: 'Select', criteria: { 0: 'zero', 1: 'one' } },
    mixed: { type: 'choice', instructions: 'Select', criteria: { 0: 'zero', fallback: 'other' } },
    yes: { type: 'noul', instructions: 'Present?' },
    rate: { type: 'score', instructions: 'Rate', criteria: ['low', 'high'] },
} });
void inferred.then(({ decision }) => {
    const selected: 'a' | 'b' = decision.answers.pick.choice;
    const confidence: number = decision.answers.yes.confidence;
    const outputTokens: 0 = decision.usage.total_output_tokens;
    const numeric: '0' | '1' = decision.answers.numeric.choice;
    const zero: typeof decision.answers.numeric.choice = '0';
    const probability: number = decision.answers.numeric.probabilities['0'];
    const mixed: '0' | 'fallback' = decision.answers.mixed.choice;
    const mixedZero: typeof decision.answers.mixed.choice = '0';
    // @ts-expect-error Native JSON object keys are returned as strings.
    const numericValue: typeof decision.answers.numeric.choice = 0;
    void [selected, confidence, outputTokens, numeric, zero, probability, mixed, mixedZero, numericValue, decision.answers.rate.legend];
});
const input: readonly DecisionInputPart[] = [
    { type: 'document', dataUrl: 'data:application/pdf;base64,YQ==' },
    { type: 'audio', url: 'https://example.com/a.ogg', mimeType: 'audio/ogg' },
    { type: 'video', url: 'https://example.com/a.webm', mimeType: 'video/webm' },
    { type: 'image', url: 'https://example.com/a.png', mimeType: 'image/png' },
    { type: 'image', dataUrl: 'data:image/png;base64,YQ==', resolution: 'ultra_high' },
    { type: 'video', url: 'https://example.com/a.mp4', mimeType: 'video/mp4', resolution: 'medium' },
];
void createBridge({ provider }).evaluate({ input, questions: {
    pick: choice('Select', [{ value: true }, { value: 'true' }]),
    score: scoreLevels('Rate', [{ label: 'low' }, { label: 'high' }]),
} }).then(result => { const confidence: number | undefined = result.meta.geminiDecisions?.answers.pick?.confidence; void confidence; });
const capabilities: Partial<Capabilities> = { documents: true, remoteAudio: true, remoteVideos: true,
    remoteDocuments: true, maxDocuments: null, questionContentTypes: ['text', 'json'],
    maxJsonNodes: 1000000, imageResolutions: ['ultra_high'], videoResolutions: ['medium'] };
void capabilities;
void createDecisionRouter({ routes: { google: { config: { type: 'gemini-decisions', apiKey: 'fixture' } },
    auto: { candidates: ['google'], policy: 'deterministic', rules: [{ effect: 'require', when: { modalities: ['document'] }, routes: ['google'] }] } } });
// @ts-expect-error Remote audio requires a MIME declaration.
const missingMime: DecisionInputPart = { type: 'audio', url: 'https://example.com/a' };
// @ts-expect-error Document inputs require exactly one source.
const twoSources: DecisionInputPart = { type: 'document', url: 'https://example.com/a', dataUrl: 'data:application/pdf;base64,YQ==' };
// @ts-expect-error Question instructions are text-only in the native API.
const badNative: GeminiDecisionRequest = { input: 'x', questions: { q: { type: 'noul', instructions: { type: 'image', data: 'YQ==', mime_type: 'image/png' } } } };
void [missingMime, twoSources, badNative];
// @ts-expect-error Image detail and resolution are mutually exclusive.
const conflictingControls: DecisionInputPart = { type: 'image', dataUrl: 'data:image/png;base64,YQ==', detail: 'auto', resolution: 'high' };
// @ts-expect-error Ultra-high resolution applies only to images.
const badVideo: DecisionInputPart = { type: 'video', dataUrl: 'data:video/mp4;base64,YQ==', resolution: 'ultra_high' };
// @ts-expect-error Audio has no resolution control.
const badAudio: DecisionInputPart = { type: 'audio', dataUrl: 'data:audio/wav;base64,YQ==', resolution: 'low' };
void [conflictingControls, badVideo, badAudio];
const response = {} as GeminiDecisionResponse;
void response;
