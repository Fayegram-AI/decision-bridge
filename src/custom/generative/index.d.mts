import type { Provider, TransportOptions, JsonValue, Questions, EvaluationRequest, ProviderCallOptions, ProviderResult, Capabilities, ModelList, ResolvedRequest, Usage } from '../../index.mjs';

export interface GenerativeProvider extends Provider { readonly kind: 'generative'; }
export type GenerativeProviderDefinition = Omit<Provider, 'kind' | 'probabilitySource'> & { readonly probabilitySource?: 'elicited' };
export function defineGenerativeProvider(definition: GenerativeProviderDefinition): GenerativeProvider;
export interface OpenAICompatibleOptions extends TransportOptions {
  /** Null explicitly disables authentication for loopback endpoints only. */
  apiKey?: string | null; model?: string; baseURL?: string;
  responseFormat?: 'json_schema' | 'json_object' | 'text';
  tokenParameter?: 'max_completion_tokens' | 'max_tokens';
  maxTokens?: number; parameters?: Readonly<Record<string, JsonValue>>;
}
export interface OpenRouterOptions extends Omit<OpenAICompatibleOptions, 'baseURL' | 'apiKey'> { apiKey?: string; }
export interface AnthropicOptions extends TransportOptions {
  apiKey?: string; model?: string; baseURL?: string; maxTokens?: number;
  /** Independent opt-ins; omitted settings preserve the legacy tool protocol. */
  responseFormat?: 'tool' | 'json_schema'; apiVersion?: '2023-06-01' | '2026-10-21';
  parameters?: Readonly<Record<string, JsonValue>>;
}
export class OpenAICompatibleProvider implements GenerativeProvider {
  readonly kind: 'generative'; readonly name: string; readonly probabilitySource: 'elicited'; readonly defaultModel?: string;
  constructor(options?: OpenAICompatibleOptions);
  evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: ProviderCallOptions): Promise<ProviderResult<Q>>;
  listModels(options?: ProviderCallOptions): Promise<ModelList>;
  getCapabilities(model?: string): Capabilities;
}
export class OpenRouterProvider extends OpenAICompatibleProvider { constructor(options?: OpenRouterOptions); }
export class AnthropicProvider implements GenerativeProvider {
  readonly kind: 'generative'; readonly name: string; readonly probabilitySource: 'elicited'; readonly defaultModel?: string;
  constructor(options?: AnthropicOptions);
  evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: ProviderCallOptions): Promise<ProviderResult<Q>>;
  listModels(options?: ProviderCallOptions): Promise<ModelList>;
  getCapabilities(model?: string): Capabilities;
}

export type GenerativeProviderConfig = ({ type: 'openai-compatible' } & OpenAICompatibleOptions)
    | ({ type: 'openrouter' } & OpenRouterOptions) | ({ type: 'anthropic' } & AnthropicOptions);
export function createGenerativeProvider(options: GenerativeProviderConfig): GenerativeProvider;
export function buildResponseSchema(questions: Questions): Readonly<Record<string, JsonValue>>;
/** Validates shared state and legacy questions; richer input/capabilities are rejected. */
export function buildPrompt(request: ResolvedRequest): { system: string; user: string };
export function parseGeneratedJson(text: string): unknown;
/** Validates the same request profile as buildPrompt before mapping generated answers. */
export function normalizeGenerated<const Q extends Questions>(payload: unknown, request: ResolvedRequest<Q>, options?: { model?: string | null; usage?: Usage; meta?: Readonly<Record<string, JsonValue>> }): ProviderResult<Q>;
