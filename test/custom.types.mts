import { createBridge, createProvider, type Provider, type DecisionProvider, noul } from '../src/index.mjs';
import { defineDecisionProvider } from '../src/custom/decision.mjs';
import { defineGenerativeProvider, createGenerativeProvider, AnthropicProvider, type AnthropicOptions, type GenerativeProvider, buildPrompt, normalizeGenerated } from '../src/custom/generative/index.mjs';

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

const anthropic: AnthropicOptions = { apiKey: 'compile-only', responseFormat: 'json_schema', apiVersion: '2026-10-21',
    parameters: { output_config: { effort: 'medium' } } };
new AnthropicProvider(anthropic);
const modern = createBridge({ provider: createGenerativeProvider({ type: 'anthropic', ...anthropic }) });
async function anthropicChecks() {
    const answers = await modern.evaluate({ state: '', questions: { yes: noul('True?') } });
    const answer: number = answers.answers.yes.noul;
    return answer;
}
// @ts-expect-error Anthropic response formats are tool and json_schema.
new AnthropicProvider({ responseFormat: 'json_object' });
// @ts-expect-error API versions are explicit supported literals.
createGenerativeProvider({ type: 'anthropic', apiVersion: 'latest' });
// @ts-expect-error API version is scoped to Anthropic.
createGenerativeProvider({ type: 'openai-compatible', apiVersion: '2026-10-21' });
// @ts-expect-error Tool output mode is scoped to Anthropic.
createGenerativeProvider({ type: 'openrouter', responseFormat: 'tool' });
void anthropicChecks;
