/** OpenRouter's native wire types preserve optional confidence and distributions. */
import type { JsonValue, State, Instructions, Entry, TransportOptions, DecisionProvider, Questions, EvaluationRequest,
    ProviderCallOptions, ProviderResult, Capabilities, ResultValidationOptions, ModelList, ResolvedRequest, BoxCoordinates } from './index.mjs';

export interface OpenRouterPreferences {
    readonly allow_fallbacks?: boolean | null; readonly require_parameters?: boolean | null;
    readonly order?: readonly string[] | null; readonly only?: readonly string[] | null; readonly ignore?: readonly string[] | null;
    readonly data_collection?: 'allow' | 'deny' | null; readonly zdr?: boolean | null;
    readonly [key: string]: JsonValue | undefined;
}
export interface OpenRouterNativeOptions extends TransportOptions {
    apiKey?: string; model?: string; baseURL?: string; providerPreferences?: OpenRouterPreferences;
}
export interface OpenRouterDecisionsOptions extends OpenRouterNativeOptions { api?: 'decisions' | 'systemone'; }
export interface OpenRouterImageAsset { readonly type?: 'image'; readonly format: 'png' | 'jpg' | 'jpeg'; readonly data_base64: string; }
export interface OpenRouterRequestMetadata {
    readonly provider?: OpenRouterPreferences | null; readonly session_id?: string; readonly user?: string;
    readonly trace?: Readonly<Record<string, JsonValue>>;
}
export type OpenRouterDecisionQuestion =
    | { readonly type: 'noul'; readonly instructions: Instructions; readonly criteria?: { readonly true?: Instructions; readonly false?: Instructions } }
    | { readonly type: 'choice'; readonly instructions: Instructions; readonly criteria: Readonly<Record<string, Entry>> }
    | { readonly type: 'score'; readonly instructions: Instructions; readonly criteria: readonly Instructions[] }
    | { readonly type: 'box'; readonly instructions: Instructions };
export type OpenRouterDecisionQuestions = Readonly<Record<string, OpenRouterDecisionQuestion>>;
export interface OpenRouterDecisionRequest<Q extends OpenRouterDecisionQuestions = OpenRouterDecisionQuestions> extends OpenRouterRequestMetadata {
    readonly model?: string; readonly state: State; readonly questions: Q;
    readonly assets?: Readonly<Record<string, OpenRouterImageAsset>>;
}
export type OpenRouterDecisionAnswer<Q extends OpenRouterDecisionQuestion> = Q extends { readonly type: 'noul' }
    ? { readonly type: 'noul'; readonly noul: number; readonly confidence?: number }
    : Q extends { readonly type: 'choice' } ? { readonly type: 'choice'; readonly choice: string;
        readonly probabilities?: Readonly<Record<string, number>>; readonly confidence?: number }
    : Q extends { readonly type: 'score' } ? { readonly type: 'score'; readonly score: number;
        readonly probabilities?: Readonly<Record<string, number>>; readonly legend?: Readonly<Record<string, Instructions>>; readonly confidence?: number }
    : { readonly type: 'box'; readonly box: BoxCoordinates; readonly confidence?: number };
export interface OpenRouterUsage { readonly input_tokens: number; readonly output_tokens: number; readonly cost?: number; }
export interface OpenRouterMetadata {
    readonly usage: OpenRouterUsage;
    readonly answers?: Readonly<Record<string, { readonly confidence: number }>>;
}
export interface OpenRouterDecisionResponse<Q extends OpenRouterDecisionQuestions = OpenRouterDecisionQuestions> {
    readonly model: string; readonly id?: string; readonly provider?: string;
    readonly answers: { readonly [K in keyof Q]: OpenRouterDecisionAnswer<Q[K]> }; readonly usage: OpenRouterUsage;
}
export interface OpenRouterTransportMetadata {
    readonly attempts: number; readonly durationMs: number; readonly requestId?: string;
    readonly requestedModel: string; readonly resolvedModel: string; readonly responseId?: string; readonly upstreamProvider?: string;
}
export class OpenRouterDecisionsProvider implements DecisionProvider {
    readonly name: 'openrouter-decisions'; readonly kind: 'decision'; readonly probabilitySource: 'native'; readonly defaultModel?: string;
    constructor(options?: OpenRouterDecisionsOptions);
    getCapabilities(model?: string): Capabilities;
    getResultValidationOptions(): ResultValidationOptions;
    validateRequest(request: ResolvedRequest): void;
    evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: ProviderCallOptions): Promise<ProviderResult<Q>>;
    createDecision<const Q extends OpenRouterDecisionQuestions>(request: OpenRouterDecisionRequest<Q>, options?: ProviderCallOptions):
        Promise<{ readonly decision: OpenRouterDecisionResponse<Q>; readonly meta: OpenRouterTransportMetadata & { readonly provider: 'openrouter-decisions' } }>;
    listModels(options?: ProviderCallOptions): Promise<ModelList>;
}
