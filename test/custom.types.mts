import { createBridge, createProvider, type Provider, type DecisionProvider, noul } from '../src/index.mjs';
import { defineDecisionProvider } from '../src/custom/decision.mjs';
import { defineGenerativeProvider, createGenerativeProvider, type GenerativeProvider, buildPrompt, normalizeGenerated } from '../src/custom/generative/index.mjs';

const evaluate: Provider['evaluate'] = async request => ({ model: request.model,
    answers: { q: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: null, output_tokens: null } });
const decision: DecisionProvider = defineDecisionProvider({ name: 'fixture', evaluate });
const generative: GenerativeProvider = defineGenerativeProvider({ name: 'fixture', evaluate });
createBridge({ provider: decision });
createBridge({ provider: generative });
createBridge({ provider: createGenerativeProvider({ type: 'anthropic', model: 'fixture' }) });
// @ts-expect-error General-purpose presets are absent from the native registry.
createProvider({ type: 'openai-compatible', model: 'fixture' });
// @ts-expect-error Custom generative providers cannot declare native provenance.
defineGenerativeProvider({ name: 'fixture', evaluate, probabilitySource: 'native' });
// @ts-expect-error A raw provider must explicitly declare its kind.
createBridge({ provider: { name: 'fixture', evaluate } });
const request = { model: 'fixture', state: '', questions: { q: noul('True?') } } as const;
buildPrompt(request);
const result = normalizeGenerated({ answers: { q: { noul: 0.7 } } }, request);
const probability: number = result.answers.q.noul;
void probability;
