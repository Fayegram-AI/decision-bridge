import type { EvaluationRequest, EvaluationResult, Questions, Provider, ProviderConfig, Usage, ErrorDetails, JsonValue } from '../index.mjs';
import type { CloudflareExtractionProvider, CloudflareExtractionOptions, ExtractionRequest, ExtractionResult, ExtractionFields } from '../extraction/index.mjs';

export type RoutingOperation = 'decision' | 'extraction';
export type RoutingMethod = 'direct' | 'single' | 'rule' | 'priority' | 'clarification' | 'selector' | 'selector-fallback' | 'failover';
export interface RouteDescription {
    readonly id: string;
    readonly operation: RoutingOperation;
    readonly kind: 'decision' | 'generative' | 'extraction';
    readonly model?: string;
    readonly description: string;
}
export interface RouteInspection extends RouteDescription {
    readonly status: 'eligible' | 'provisional' | 'preparation-required' | 'disabled' | 'wrong-operation' | 'unavailable' | 'constrained' | 'cooldown' | 'unsupported';
    readonly code?: string;
    readonly retryAt?: number;
}
export interface RoutingInspection {
    readonly operation: RoutingOperation;
    readonly requestedRoute: string;
    readonly validationScope: 'structure' | 'provider';
    readonly requiresPreparation: boolean;
    readonly routes: readonly RouteInspection[];
    readonly eligible: readonly string[];
    readonly provisional: readonly string[];
    readonly outcome: 'unresolved' | 'impossible' | 'selected' | 'ambiguous';
    readonly selectedRoute?: string;
    readonly method?: RoutingMethod;
    readonly selector?: { readonly ready: boolean; readonly reason?: string };
    readonly missingUnattendedPrerequisite?: boolean;
    readonly clarificationAvailable?: boolean;
}
export interface RoutingContext {
    readonly operation: RoutingOperation;
    readonly requestedRoute: string;
    readonly signal: AbortSignal;
}
export interface Ambiguity {
    readonly operation: RoutingOperation;
    readonly requestedRoute: 'auto';
    readonly candidates: readonly RouteDescription[];
    readonly selectorAvailable: boolean;
}
export type ClarificationAnswer = { readonly action: 'select'; readonly route: string }
    | { readonly action: 'use-selector' | 'cancel'; readonly route?: never };
export type AmbiguityHandler = (question: Ambiguity, context: { readonly signal: AbortSignal }) => ClarificationAnswer | Promise<ClarificationAnswer>;
export interface RoutingCallOptions {
    route?: string;
    /** Only narrows the configured automatic candidate set. */
    candidates?: readonly string[];
    labels?: readonly string[];
    /** Replaces task content in selector context; schema and media metadata remain. */
    routingDescription?: string;
    onAmbiguity?: AmbiguityHandler;
    clarify?: boolean;
    signal?: AbortSignal;
    /** Optional total wall time, including queueing and human interaction. */
    timeoutMs?: number;
}
export interface RoutingRule {
    effect: 'require' | 'prefer';
    when: {
        operation?: RoutingOperation;
        modalities?: readonly ('text' | 'image' | 'audio' | 'video')[];
        questionTypes?: readonly ('choice' | 'noul' | 'score' | 'box')[];
        fieldTypes?: readonly import('../extraction/index.mjs').ExtractionFieldType[];
        labels?: readonly string[];
    };
    routes: readonly string[];
}
export interface AutoRoute {
    policy: 'deterministic' | 'decision-assisted';
    candidates: readonly string[];
    rules?: readonly RoutingRule[];
    priority?: readonly string[];
    selector?: {
        route: string;
        when?: 'ambiguous' | 'multiple';
        /** Both thresholds are required for unattended decision-assisted execution. */
        minProbability?: number;
        minMargin?: number;
        timeoutMs?: number;
        maxContextBytes?: number;
        fallbackOn?: readonly ('abstain' | 'invalid-response' | 'timeout' | 'unavailable' | 'context-too-large')[];
    };
    clarification?: { enabled?: boolean; timeoutMs?: number };
    failover?: { routes: readonly string[]; maxAttempts?: number };
    cooldown?: { durationMs?: number };
}
export interface ConcreteRouteSettings {
    enabled?: boolean;
    required?: boolean;
    description?: string;
    model?: string;
    ready?: boolean;
    singleDispatch?: boolean;
    allowGenerative?: boolean;
    cooldownGroup?: string;
}
export type NativeRouteConfig = ProviderConfig | ({ type: 'cloudflare-extraction' } & CloudflareExtractionOptions);
export type ConcreteRoute = ConcreteRouteSettings & (
    | { operation?: 'decision'; provider: Provider; config?: never; factory?: never; kind?: 'decision' | 'generative' }
    | { operation: 'extraction'; provider: CloudflareExtractionProvider; config?: never; factory?: never; kind?: never }
    | { operation?: RoutingOperation; config: NativeRouteConfig; provider?: never; factory?: never; kind?: never }
    | { operation?: 'decision'; factory: (context: { readonly signal: AbortSignal }) => Provider | Promise<Provider>;
        kind: 'decision' | 'generative'; provider?: never; config?: never }
);
export interface RoutingMetadata {
    readonly requestedRoute: string;
    readonly selectedRoute?: string;
    readonly method?: RoutingMethod;
    readonly policyRevision?: string;
    readonly candidates?: readonly { readonly id: string; readonly status: RouteInspection['status']; readonly code?: string }[];
    readonly selector?: { readonly route: string; readonly provider?: string; readonly model?: string;
        readonly usage: Usage | null; readonly failureCode?: string };
    readonly attempts: readonly { readonly route: string; readonly status?: 'succeeded' | 'failed'; readonly code?: string;
        readonly usage: Usage | Readonly<Record<string, JsonValue>> | null }[];
    readonly timings: { readonly workMs: number; readonly clarificationMs: number; readonly wallMs: number };
    readonly observerFailed?: boolean;
}
export type RoutedDecisionResult<Q extends Questions = Questions> = EvaluationResult<Q> & { readonly meta: { readonly routing: RoutingMetadata } };
export type RoutedExtractionResult<F extends ExtractionFields = ExtractionFields> = ExtractionResult<F> & { readonly meta: { readonly routing: RoutingMetadata } };
interface RouterSettings<Request, Result> {
    routes: Readonly<Record<string, ConcreteRoute | AutoRoute>>;
    defaultRoute?: string;
    policyRevision?: string;
    /** Runs once before final eligibility; returning undefined preserves the snapshot. */
    prepare?: (request: Request, context: RoutingContext) => Request | undefined | Promise<Request | undefined>;
    onAmbiguity?: AmbiguityHandler;
    onResult?: (result: Result, context: RoutingContext) => void | Promise<void>;
    workTimeoutMs?: number;
    clarificationTimeoutMs?: number;
    observerTimeoutMs?: number;
}
export type DecisionRouterOptions = RouterSettings<EvaluationRequest, RoutedDecisionResult>;
export type ExtractionRouterOptions = RouterSettings<ExtractionRequest, RoutedExtractionResult>;
/** Preparation may replace the output schema; callers must narrow returned answers. */
export interface PreparedDecisionRouter {
    readonly operation: 'decision';
    inspect(request: EvaluationRequest, options?: RoutingCallOptions): RoutingInspection;
    evaluate(request: EvaluationRequest, options?: RoutingCallOptions): Promise<RoutedDecisionResult>;
}
export interface DecisionRouter extends PreparedDecisionRouter {
    evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: RoutingCallOptions): Promise<RoutedDecisionResult<Q>>;
}
export interface PreparedExtractionRouter {
    readonly operation: 'extraction';
    inspect(request: ExtractionRequest, options?: RoutingCallOptions): RoutingInspection;
    extract(request: ExtractionRequest, options?: RoutingCallOptions): Promise<RoutedExtractionResult>;
}
export interface ExtractionRouter extends PreparedExtractionRouter {
    extract<const F extends ExtractionFields>(request: ExtractionRequest<F>, options?: RoutingCallOptions): Promise<RoutedExtractionResult<F>>;
}
export function createDecisionRouter(options: DecisionRouterOptions & { prepare?: undefined }): DecisionRouter;
export function createDecisionRouter(options: DecisionRouterOptions): PreparedDecisionRouter;
export function createExtractionRouter(options: ExtractionRouterOptions & { prepare?: undefined }): ExtractionRouter;
export function createExtractionRouter(options: ExtractionRouterOptions): PreparedExtractionRouter;
export interface RoutedBatchOptions extends RoutingCallOptions { concurrency?: number; stopOnError?: boolean; }
export type RoutedBatchRecord<Result> = { readonly index: number; readonly ok: true; readonly result: Result }
    | { readonly index: number; readonly ok: false; readonly error: ErrorDetails };
export function evaluateRoutedBatch<const Q extends Questions>(router: DecisionRouter, requests: readonly EvaluationRequest<Q>[], options?: RoutedBatchOptions): Promise<RoutedBatchRecord<RoutedDecisionResult<Q>>[]>;
export function evaluateRoutedBatch(router: PreparedDecisionRouter, requests: readonly EvaluationRequest[], options?: RoutedBatchOptions): Promise<RoutedBatchRecord<RoutedDecisionResult>[]>;
export function extractRoutedBatch<const F extends ExtractionFields>(router: ExtractionRouter, requests: readonly ExtractionRequest<F>[], options?: RoutedBatchOptions): Promise<RoutedBatchRecord<RoutedExtractionResult<F>>[]>;
export function extractRoutedBatch(router: PreparedExtractionRouter, requests: readonly ExtractionRequest[], options?: RoutedBatchOptions): Promise<RoutedBatchRecord<RoutedExtractionResult>[]>;
