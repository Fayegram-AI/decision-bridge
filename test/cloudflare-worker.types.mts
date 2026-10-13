// Checked against the pinned official Workers declarations, without browser DOM globals.
import { CloudflareDecisionsProvider, createBridge, noul, type CloudflareAIBinding } from '../src/index.mjs';

declare const env: { AI: Ai };
const compatible: CloudflareAIBinding = env.AI;
const provider = new CloudflareDecisionsProvider({
    transport: 'binding', ai: env.AI, model: 'clef-flash', rejectIfBusy: true,
    gateway: { id: 'existing', requestTimeoutMs: 10000, retries: { maxAttempts: 1 }, metadata: { test: true } },
});
await createBridge({ provider }).evaluate({ state: { test: true }, questions: { q: noul('True?') } });
await provider.createDecision({ state: 'test', questions: { q: { type: 'noul', instructions: 'True?' } } });
void compatible;
const omni = new CloudflareDecisionsProvider({ transport: 'binding', ai: env.AI, model: 'clef-omni' });
await omni.createDecision({ state: { test: true }, questions: { q: { type: 'noul', instructions: 'True?' } },
    audio: ['data:audio/mpeg;base64,AAAA'], videos: ['data:video/mp4;base64,AAAA'] });
