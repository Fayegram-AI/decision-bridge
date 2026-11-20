// Checked against the pinned official Workers declarations, without browser DOM globals.
import { CloudflareDecisionsProvider, createBridge, noul, type CloudflareAIBinding } from '../src/index.mjs';
import { CloudflareExtractionProvider, OpenRouterExtractionProvider, validateExtractionRequest,
    type CloudflareExtractionBinding, type CloudflareExtractionModel } from '../src/extraction/index.mjs';
import { createLiveDecisions } from '../src/live/index.mjs';

declare const env: { AI: Ai };
const compatible: CloudflareAIBinding = env.AI;
const provider = new CloudflareDecisionsProvider({
    transport: 'binding', ai: env.AI, model: 'clef-flash', rejectIfBusy: true,
    gateway: { id: 'existing', requestTimeoutMs: 10000, retries: { maxAttempts: 1 }, metadata: { test: true } },
});
await createBridge({ provider }).evaluate({ state: { test: true }, questions: { q: noul('True?') } });
await provider.createDecision({ state: 'test', questions: { q: { type: 'noul', instructions: 'True?' } } });
void compatible;
const extractionBinding: CloudflareExtractionBinding = env.AI;
const extractor = new CloudflareExtractionProvider({ transport: 'binding', ai: env.AI, model: '@cf/cloudflare/clairic-flash' });
const documentRequest = { documents: ['data:application/pdf;base64,JVBERi0xLjcK',
    { content_type: 'application/pdf', base64: 'JVBERi0xLjcK' }], fields: { amount: { type: 'number' } } } as const;
const model: CloudflareExtractionModel = validateExtractionRequest(documentRequest, { model: 'clairic-flash' }).model;
const answer = (await extractor.extract(documentRequest)).extraction.answers.amount;
const value: number | null = answer.value;
const span: readonly [number, number] | null | undefined = answer.span;
const openRouter = new OpenRouterExtractionProvider({ model: 'vendor/model' });
// @ts-expect-error OpenRouter accepts PDFs as assets on createExtraction().
openRouter.extract(documentRequest);
// @ts-expect-error The Cloudflare document object requires application/pdf.
extractor.validate({ ...documentRequest, documents: [{ content_type: 'text/plain', base64: 'AAAA' }] });
void [model, value, span];
const live = createLiveDecisions({ transport: { send() {}, subscribe() { return () => {}; } } });
live.dispose();
void extractionBinding;
const omni = new CloudflareDecisionsProvider({ transport: 'binding', ai: env.AI, model: 'clef-omni' });
await omni.createDecision({ state: { test: true }, questions: { q: { type: 'noul', instructions: 'True?' } },
    audio: ['data:audio/mpeg;base64,AAAA'], videos: ['data:video/mp4;base64,AAAA'] });
