/** JSON values are read-only because the bridge snapshots/freezes its boundaries. */
import type { NativeDecisionRequest, OpenAIDecisionResponse, OpenAIDecisionUsage,
    OpenAIDecisionsMetadata, OpenAIDecisionsTransportMetadata } from './decisions.d.mts';
export type { NativeDecisionInputPart, NativeDecisionMessage, NativeDecisionQuestion, NativeDecisionRequest,
    NativeDecisionAnswer, OpenAIDecisionResponse, OpenAIDecisionUsage, OpenAIDecisionsMetadata,
    OpenAIDecisionsTransportMetadata, TransportMetadata } from './decisions.d.mts';
import type { CloudflareDecisionsOptions, CloudflareDecisionRequest, CloudflareDecisionResponse,
    CloudflareTransportMetadata, CloudflareDecisionsMetadata } from './cloudflare-decisions.d.mts';
export type { CloudflareDecisionModel, CloudflareDecisionImage, CloudflareDecisionAudio, CloudflareDecisionVideo,
    CloudflareDecisionQuestion, CloudflareDecisionRequest,
    CloudflareDecisionAnswer, CloudflareDecisionUsage, CloudflareDecisionResponse, CloudflareGatewayOptions,
    CloudflareAIBinding, CloudflareDecisionsOptions, CloudflareTransportMetadata,
    CloudflareDecisionsMetadata } from './cloudflare-decisions.d.mts';
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type Entry = string | { readonly [key: string]: JsonValue } | readonly JsonValue[] | null;
export type State = Exclude<Entry, null>;
export type Instructions = State;
export type ChoiceCriteria = Readonly<Record<string, Entry>>;
export type ScoreCriteria = readonly [Instructions, Instructions, ...Instructions[]];
export interface ChoiceQuestion<C extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: 'choice'; readonly instructions: Instructions; readonly criteria: C;
  readonly options?: never;
}
export interface NoulQuestion {
  readonly type: 'noul'; readonly instructions: Instructions;
  readonly criteria?: { readonly true?: Instructions; readonly false?: Instructions };
}
export interface ScoreQuestion<C extends ScoreCriteria = ScoreCriteria> {
  readonly type: 'score'; readonly instructions: Instructions; readonly criteria: C;
  readonly levels?: never;
}
export interface ChoiceOption<V extends string | boolean = string | boolean> {
    readonly value: V; readonly description?: Entry;
}
export interface TypedChoiceQuestion<O extends readonly ChoiceOption[] = readonly ChoiceOption[]> {
    readonly type: 'choice'; readonly instructions: Instructions; readonly options: O; readonly criteria?: never;
}
export interface ScoreLevel { readonly label: string; readonly description?: Instructions; }
export type ScoreLevels = readonly [ScoreLevel, ScoreLevel, ...ScoreLevel[]];
export interface LabeledScoreQuestion<L extends ScoreLevels = ScoreLevels> {
    readonly type: 'score'; readonly instructions: Instructions; readonly levels: L; readonly criteria?: never;
}
export type DecisionInputPart = { readonly type: 'text'; readonly text: string }
    | { readonly type: 'image'; readonly dataUrl: string; readonly detail?: 'low' | 'high' | 'auto' | 'original' | null }
    | { readonly type: 'audio'; readonly dataUrl: string }
    | { readonly type: 'video'; readonly dataUrl: string };
export type OrderedInput = readonly DecisionInputPart[];
export type Question = ChoiceQuestion | TypedChoiceQuestion | NoulQuestion | ScoreQuestion | LabeledScoreQuestion;
export type Questions = Readonly<Record<string, Question>>;
export interface ChoiceAnswer<K extends string = string> {
  readonly type: 'choice'; readonly choice: K;
  readonly probabilities: Readonly<Record<K, number>>;
  /** Reported by native decision providers; never invented for generative backends. */
  readonly confidence?: number;
}
export interface NoulAnswer { readonly type: 'noul'; readonly noul: number; }
export interface TypedChoiceAnswer<V extends string | boolean = string | boolean> {
    readonly type: 'choice'; readonly choice: V;
    readonly probabilities: readonly { readonly value: V; readonly probability: number }[];
    readonly confidence?: number;
}
export interface ScoreAnswer {
  readonly type: 'score'; readonly score: number; readonly confidence?: number;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly legend: Readonly<Record<string, Entry>>;
}
export interface LabeledScoreAnswer<L extends ScoreLevels = ScoreLevels> extends Omit<ScoreAnswer, 'legend'> {
    readonly legend: Readonly<Record<string, L[number]>>;
}
type ChoiceLabel<K> = K extends string ? K : K extends number ? `${K}` : never;
export type AnswerFor<Q extends Question> = Q extends TypedChoiceQuestion<infer O> ? TypedChoiceAnswer<O[number]['value']>
  : Q extends LabeledScoreQuestion<infer L> ? LabeledScoreAnswer<L>
  : Q extends ChoiceQuestion<infer C>
  ? ChoiceAnswer<ChoiceLabel<keyof C>> : Q extends NoulQuestion ? NoulAnswer : ScoreAnswer;
export type EvaluationRequest<Q extends Questions = Questions> = {
    readonly questions: Q; readonly model?: string; readonly safetyIdentifier?: string | null;
} & ({ readonly state: State; readonly input?: never } | { readonly input: OrderedInput; readonly state?: never });
export type ResolvedRequest<Q extends Questions = Questions> = EvaluationRequest<Q> & { readonly model: string };
export interface Usage {
  /** Null means not reported, not zero tokens. */
  readonly input_tokens: number | null; readonly output_tokens: number | null;
  readonly cache_creation_input_tokens?: number; readonly cache_read_input_tokens?: number;
}
export interface ProviderResult<Q extends Questions = Questions> {
  readonly model: string;
  readonly answers: { readonly [K in keyof Q]: AnswerFor<Q[K]> };
  readonly usage: Usage;
  readonly meta?: Readonly<Record<string, JsonValue>> & { readonly openaiDecisions?: OpenAIDecisionsMetadata; readonly cloudflareDecisions?: CloudflareDecisionsMetadata };
}
export interface Metadata {
  readonly provider: string; readonly providerKind: ProviderKind; readonly requestedModel: string;
  /** Upstream model ID sent after provider selection, when supplied by the provider. */
  readonly resolvedModel?: string;
  readonly probabilitySource: 'native' | 'elicited' | 'unspecified' | (string & {});
  readonly confidenceSource?: 'native' | 'unavailable' | (string & {});
  readonly modelSource?: 'reported' | 'requested';
  readonly bridgeVersion: string; readonly schemaVersion: number;
  readonly totalDurationMs: number; readonly observerDurationMs: number;
  readonly observerFailures: readonly string[];
  readonly durationMs?: number; readonly attempts?: number; readonly requestId?: string;
  readonly openaiDecisions?: OpenAIDecisionsMetadata;
  readonly cloudflareDecisions?: CloudflareDecisionsMetadata; readonly gatewayLogId?: string;
  readonly [key: string]: unknown;
}
export type EvaluationResult<Q extends Questions = Questions> = Omit<ProviderResult<Q>, 'meta'> & { readonly meta: Metadata };
export interface ProviderCallOptions { signal?: AbortSignal; }
export interface CallOptions extends ProviderCallOptions { timeoutMs?: number; }
export interface ModelList {
  readonly models: readonly { readonly name: string; readonly description?: string;
    readonly release_date?: string; readonly [key: string]: unknown }[];
  readonly has_more?: boolean; readonly last_id?: string;
}
export interface ResultValidationOptions { readonly native?: boolean; readonly probabilityDecimalPlaces?: number; }
export type ProviderKind = 'decision' | 'generative';
export interface Provider {
  readonly kind: ProviderKind;
  readonly name: string; readonly defaultModel?: string; readonly probabilitySource?: string;
  evaluate(request: ResolvedRequest, options?: ProviderCallOptions): Promise<ProviderResult>;
  listModels?(options?: ProviderCallOptions): Promise<ModelList>;
  getCapabilities?(model?: string): Partial<Capabilities>;
  /** Pure synchronous policy; response metadata cannot select validation tolerance. */
  getResultValidationOptions?(model?: string): ResultValidationOptions;
  /** Pure synchronous preflight on a frozen resolved request; throw to reject. */
  validateRequest?(request: ResolvedRequest): void;
}
export interface DecisionProvider extends Provider { readonly kind: 'decision'; }
export interface Capabilities {
    readonly audio?: boolean; readonly videos?: boolean;
    readonly maxAudioClips?: number | null; readonly maxVideos?: number | null;
    readonly supported: boolean; readonly orderedInput: boolean; readonly images: boolean;
    readonly typedChoices: boolean; readonly labeledScores: boolean; readonly safetyIdentifier: boolean;
    readonly maxImages: number | null; readonly maxChoiceOptions: number | null; readonly maxScoreLevels: number | null;
}
export interface ExtensionContext {
  readonly provider: string; readonly model: string; readonly questionIds: readonly string[];
  readonly signal: AbortSignal;
}
export interface Extension {
  name: string;
  prepareState?(state: State, context: ExtensionContext): State | undefined | Promise<State | undefined>;
  prepareInput?(input: OrderedInput, context: ExtensionContext): OrderedInput | undefined | Promise<OrderedInput | undefined>;
  /** Observer failure is isolated in meta.observerFailures; no inference is retried. */
  onResult?(result: EvaluationResult, context: ExtensionContext): void | Promise<void>;
}
export interface TransportOptions {
  timeoutMs?: number; maxRetries?: number; maxRequestBytes?: number; maxResponseBytes?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}
export interface JevOptions extends TransportOptions { apiKey?: string; model?: string; baseURL?: string; }
export interface OpenAIDecisionsOptions extends TransportOptions { apiKey?: string; model?: string; baseURL?: string; }
export interface Bridge {
  readonly provider: string; readonly providerKind: ProviderKind; readonly defaultModel?: string;
  evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: CallOptions): Promise<EvaluationResult<Q>>;
  listModels(options?: CallOptions): Promise<ModelList>;
  getCapabilities(model?: string): Capabilities;
  validate<const Q extends Questions>(request: EvaluationRequest<Q>): ResolvedRequest<Q>;
  validate(request: unknown): ResolvedRequest;
}
export type BridgeOptions = { extensions?: readonly Extension[]; timeoutMs?: number; observerTimeoutMs?: number } & (
  { provider: Provider; jev?: undefined } | { provider?: undefined; jev: JevOptions }
);
export function createBridge(options: BridgeOptions): Bridge;
export class JevProvider implements DecisionProvider {
  readonly kind: 'decision'; readonly name: string; readonly probabilitySource: 'native'; readonly defaultModel: string;
  constructor(options?: JevOptions);
  evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: ProviderCallOptions): Promise<ProviderResult<Q>>;
  listModels(options?: ProviderCallOptions): Promise<ModelList>;
  getCapabilities(model?: string): Capabilities;
}
export class OpenAIDecisionsProvider implements DecisionProvider {
    readonly kind: 'decision'; readonly name: 'openai-decisions'; readonly probabilitySource: 'native'; readonly defaultModel: string;
    constructor(options?: OpenAIDecisionsOptions);
    getCapabilities(model?: string): Capabilities;
    validateRequest(request: ResolvedRequest): void;
    evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: ProviderCallOptions): Promise<ProviderResult<Q>>;
    createDecision(request: NativeDecisionRequest, options?: ProviderCallOptions):
        Promise<{ readonly decision: OpenAIDecisionResponse; readonly meta: OpenAIDecisionsTransportMetadata }>;
}
export class CloudflareDecisionsProvider implements DecisionProvider {
    readonly kind: 'decision'; readonly name: 'cloudflare-decisions'; readonly probabilitySource: 'native'; readonly defaultModel: string;
    constructor(options?: CloudflareDecisionsOptions);
    getCapabilities(model?: string): Capabilities;
    getResultValidationOptions(model?: string): ResultValidationOptions;
    validateRequest(request: ResolvedRequest): void;
    evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: ProviderCallOptions): Promise<ProviderResult<Q>>;
    createDecision(request: CloudflareDecisionRequest, options?: ProviderCallOptions):
        Promise<{ readonly decision: CloudflareDecisionResponse; readonly meta: CloudflareTransportMetadata }>;
}
export type CloudflareDecisionsConfig = { type: 'cloudflare-decisions' } & CloudflareDecisionsOptions;
export type ProviderConfig = ({ type: 'jev' } & JevOptions)
  | ({ type: 'openai-decisions' } & OpenAIDecisionsOptions)
  | CloudflareDecisionsConfig;
export type OpenAIDecisionsConfig = { type: 'openai-decisions' } & OpenAIDecisionsOptions;
export function createProvider(options: OpenAIDecisionsConfig): OpenAIDecisionsProvider;
export function createProvider(options: CloudflareDecisionsConfig): CloudflareDecisionsProvider;
export function createProvider(options: ProviderConfig | OpenAIDecisionsConfig): DecisionProvider;
export function createProvider(options: ProviderConfig): DecisionProvider;
export function choice<const O extends readonly ChoiceOption[]>(instructions: Instructions, options: O): TypedChoiceQuestion<O>;
export function choice<const C extends ChoiceCriteria>(instructions: Instructions, criteria: C): ChoiceQuestion<C>;
export function noul(instructions: Instructions, criteria?: NoulQuestion['criteria']): NoulQuestion;
export function score<const C extends ScoreCriteria>(instructions: Instructions, criteria: C): ScoreQuestion<C>;
export function scoreLevels<const L extends ScoreLevels>(instructions: Instructions, levels: L): LabeledScoreQuestion<L>;
export interface ChoicePolicyOptions<K extends string | boolean = string> {
    minProbability: number; minMargin?: number; abstainOptions?: readonly K[];
    /** Provider-declared probability precision; omission retains the baseline tolerance. */
    probabilityDecimalPlaces?: number | undefined;
}
export interface ChoiceDecision<K extends string | boolean = string> {
  readonly status: 'selected' | 'review'; readonly choice: K;
  readonly selectedProbability: number; readonly margin: number;
  readonly reason: null | 'abstain_option' | 'probability_below_threshold' | 'margin_below_threshold';
}
export function decideChoice<K extends string>(answer: ChoiceAnswer<K>, options: ChoicePolicyOptions<K>): ChoiceDecision<K>;
export function decideChoice<V extends string | boolean>(answer: TypedChoiceAnswer<V>, options: ChoicePolicyOptions<V>): ChoiceDecision<V>;
export interface RefusedQuestion { readonly index: number; readonly name: string | null; }
export interface ErrorDetails { code: string; message: string; status?: number; requestId?: string; gatewayLogId?: string; attempts?: number; upstreamCode?: number;
    refusedQuestions?: readonly RefusedQuestion[]; usage?: OpenAIDecisionUsage; }
export class DecisionError extends Error {
  code: string; status?: number; requestId?: string; gatewayLogId?: string; attempts?: number; upstreamCode?: number;
  refusedQuestions?: readonly RefusedQuestion[]; usage?: OpenAIDecisionUsage;
  constructor(message: string, details?: Omit<ErrorDetails, 'code' | 'message'> & { code?: string });
  toJSON(): ErrorDetails;
}
export function publicError(error: unknown): ErrorDetails;
export function validateRequest<const Q extends Questions>(input: EvaluationRequest<Q>, defaultModel?: string): ResolvedRequest<Q>;
export function validateRequest(input: unknown, defaultModel?: string): ResolvedRequest;
export function validateResult<const Q extends Questions>(input: unknown, questions: Q, options?: ResultValidationOptions): ProviderResult<Q>;
export type BatchRecord<Q extends Questions = Questions> =
  | { index: number; ok: true; result: EvaluationResult<Q> }
  | { index: number; ok: false; error: ErrorDetails };
export interface BatchOptions { concurrency?: number; signal?: AbortSignal; stopOnError?: boolean; }
export function evaluateBatch<const Q extends Questions>(bridge: Bridge, inputs: readonly EvaluationRequest<Q>[], options?: BatchOptions): Promise<BatchRecord<Q>[]>;
