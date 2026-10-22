// Checked against the pinned official Workers declarations, without browser DOM globals.
import { CloudflareDecisionsProvider, createBridge, noul, type CloudflareAIBinding } from '../src/index.mjs';
import { CloudflareExtractionProvider, type CloudflareExtractionBinding } from '../src/extraction/index.mjs';
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
const extractor = new CloudflareExtractionProvider({ transport: 'binding', ai: env.AI });
await extractor.extract({ state: '4', fields: { amount: { type: 'number' } } });
const live = createLiveDecisions({ transport: { send() {}, subscribe() { return () => {}; } } });
live.dispose();
void extractionBinding;
const omni = new CloudflareDecisionsProvider({ transport: 'binding', ai: env.AI, model: 'clef-omni' });
await omni.createDecision({ state: { test: true }, questions: { q: { type: 'noul', instructions: 'True?' } },
    audio: ['data:audio/mpeg;base64,AAAA'], videos: ['data:video/mp4;base64,AAAA'] });
