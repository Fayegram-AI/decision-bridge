import { createGenerativeProvider } from '../src/custom/generative/index.mjs';
import { createBridge, createProvider, evaluateBatch, choice, noul, validateRequest, validateResult, type DecisionProvider, type JsonValue } from '../src/index.mjs';
import { OpenAICompatibleProvider, OpenRouterProvider, AnthropicProvider, buildResponseSchema } from '../src/custom/generative/index.mjs';

const options = { type: 'openai-compatible', apiKey: null, model: 'local', baseURL: 'http://127.0.0.1:8000/v1' } as const;
const provider = createGenerativeProvider(options);
const bridge = createBridge({ provider, timeoutMs: 1000, observerTimeoutMs: 100 });
const template = { route: choice('Pick.', { go: null, stop: { rule: 'Stop safely.' } }), yes: noul('True?') } as const;
const input = { state: { labels: ['x', 'y'] }, questions: template } as const;
async function checks() {
  const result = await bridge.evaluate(input, { timeoutMs: 100 });
  const label: 'go' | 'stop' = result.answers.route.choice;
  const confidence: number | undefined = result.answers.route.confidence;
  const usage: number | null = result.usage.input_tokens;
  // @ts-expect-error Confidence may not have been supplied by the backend.
  const assumedConfidence: number = result.answers.route.confidence;
  // @ts-expect-error Usage can be unreported.
  const assumedUsage: number = result.usage.output_tokens;
  // @ts-expect-error Read-only result.
  result.answers.route.choice = 'go';
  const batch = await evaluateBatch(bridge, [input], { concurrency: 2 });
  for (const row of batch) {
    if (row.ok) { const p: number = row.result.answers.yes.noul; void p; }
    else { const message: string = row.error.message; void message; }
  }
  const schema: Readonly<Record<string, JsonValue>> = buildResponseSchema(template);
  const validated = validateRequest(input, 'local');
  const normalized = validateResult({}, template);
  return { label, confidence, usage, schema, validated, normalized };
}
void checks;

new OpenAICompatibleProvider({ apiKey: 'test', responseFormat: 'json_object', tokenParameter: 'max_tokens' });
new AnthropicProvider({ apiKey: 'test', model: 'explicit', parameters: { temperature: 0.2 } });
new OpenRouterProvider({ apiKey: 'test', model: 'vendor/model' });
// @ts-expect-error Router preset cannot be redirected to a custom origin.
new OpenRouterProvider({ baseURL: 'https://example.com' });
// @ts-expect-error Unknown transport mode.
new OpenAICompatibleProvider({ responseFormat: 'auto' });
// @ts-expect-error Native Jev does not accept generative output budgets.
createProvider({ type: 'jev', maxTokens: 100 });
// @ts-expect-error Instructions are required, not null.
noul(null);
// @ts-expect-error Instructions cannot be omitted from a question.
bridge.evaluate({ state: '', questions: { q: { type: 'noul' } } });
const dynamic: unknown = JSON.parse('{}');
validateRequest(dynamic, 'explicit-model');
const custom: DecisionProvider = { kind: 'decision', name: 'custom-with-request-model', async evaluate() {
  throw new Error('Compile-only contract test; never executed.');
} };
createBridge({ provider: custom });

// @ts-expect-error Noul criteria must be omitted or an object, not null.
noul('True?', null);
// @ts-expect-error Only choice descriptions permit raw null.
noul('True?', { true: null });
