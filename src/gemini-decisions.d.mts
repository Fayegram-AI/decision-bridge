/** Native Gemini Decisions and provider-specific metadata contracts. */
import type { TransportOptions, ProviderCallOptions, DecisionProvider, ResolvedRequest, ProviderResult,
    Questions, EvaluationRequest, Capabilities, ModelList, JsonValue, ResultValidationOptions } from './index.mjs';

export type GeminiDecisionModel = 'gemini-decision-1';
export interface GeminiDecisionsOptions extends TransportOptions {
    apiKey?: string;
    model?: string;
    baseURL?: string;
}
export interface GeminiTextContent { readonly type: 'text'; readonly text: string; }
export type GeminiMediaSource = { readonly data: string; readonly uri?: never } | { readonly uri: string; readonly data?: never };
export type GeminiImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/heic' | 'image/heif'
    | 'image/gif' | 'image/bmp' | 'image/tiff';
export type GeminiAudioMime = 'audio/wav' | 'audio/mp3' | 'audio/mpeg' | 'audio/aiff' | 'audio/aac' | 'audio/ogg'
    | 'audio/flac' | 'audio/m4a' | 'audio/opus' | 'audio/webm' | 'audio/l16' | 'audio/alaw' | 'audio/mulaw';
export type GeminiVideoMime = 'video/mp4' | 'video/mpeg' | 'video/mov' | 'video/avi' | 'video/webm'
    | 'video/wmv' | 'video/x-flv' | 'video/3gpp';
export type GeminiContent = GeminiTextContent
    | ({ readonly type: 'image'; readonly mime_type: GeminiImageMime;
        readonly resolution?: 'low' | 'medium' | 'high' | 'ultra_high' } & GeminiMediaSource)
    | ({ readonly type: 'audio'; readonly mime_type: GeminiAudioMime } & GeminiMediaSource)
    | ({ readonly type: 'video'; readonly mime_type: GeminiVideoMime;
        readonly resolution?: 'low' | 'medium' | 'high' } & GeminiMediaSource)
    | ({ readonly type: 'document'; readonly mime_type: 'application/pdf' } & GeminiMediaSource);
export type GeminiInstructions = string | GeminiTextContent | readonly GeminiTextContent[];
export type GeminiDecisionQuestion =
    | { readonly type: 'noul'; readonly instructions: GeminiInstructions;
        readonly criteria?: { readonly true_description?: string; readonly false_description?: string } }
    | { readonly type: 'choice'; readonly instructions: GeminiInstructions; readonly criteria: Readonly<Record<string, string>> }
    | { readonly type: 'score'; readonly instructions: GeminiInstructions; readonly criteria: readonly [string, string, ...string[]] };
export type GeminiDecisionQuestions = Readonly<Record<string, GeminiDecisionQuestion>>;
export interface GeminiDecisionRequest<Q extends GeminiDecisionQuestions = GeminiDecisionQuestions> {
    readonly model?: string;
    readonly input: string | GeminiContent | readonly GeminiContent[];
    readonly questions: Q;
}
export interface GeminiNoulAnswer { readonly type: 'noul'; readonly noul: number; readonly confidence: number; }
export interface GeminiChoiceAnswer<K extends string = string> {
    readonly type: 'choice'; readonly choice: K;
    readonly probabilities: Readonly<Record<K, number>>; readonly confidence: number;
}
export interface GeminiScoreAnswer {
    readonly type: 'score'; readonly score: number; readonly confidence: number;
    readonly probabilities: Readonly<Record<string, number>>; readonly legend: Readonly<Record<string, string>>;
}
export type GeminiAnswerFor<Q extends GeminiDecisionQuestion> = Q extends { type: 'noul' } ? GeminiNoulAnswer
    // JSON stringifies numeric property names before they become native option IDs.
    : Q extends { type: 'choice'; criteria: infer C } ? GeminiChoiceAnswer<`${Extract<keyof C, string | number>}`> : GeminiScoreAnswer;
export interface GeminiDecisionUsage {
    readonly total_input_tokens: number;
    readonly total_output_tokens: 0;
    readonly total_tokens?: number;
    readonly input_tokens_by_modality?: readonly { readonly modality: string; readonly tokens: number }[];
    readonly output_tokens_by_modality?: readonly { readonly modality: string; readonly tokens: number }[];
}
export interface GeminiDecisionResponse<Q extends GeminiDecisionQuestions = GeminiDecisionQuestions> {
    readonly answers: { readonly [K in keyof Q]: GeminiAnswerFor<Q[K]> };
    readonly usage: GeminiDecisionUsage;
    readonly prompt_feedback?: JsonValue;
}
export interface GeminiTransportMetadata {
    readonly requestedModel: string; readonly attempts: number; readonly durationMs: number; readonly requestId?: string;
}
export interface GeminiDecisionsMetadata {
    readonly usage: GeminiDecisionUsage;
    readonly answers: Readonly<Record<string, { readonly type: 'noul' | 'choice' | 'score'; readonly confidence: number }>>;
    readonly promptFeedback?: JsonValue;
}
export class GeminiDecisionsProvider implements DecisionProvider {
    readonly kind: 'decision'; readonly name: 'gemini-decisions'; readonly probabilitySource: 'native'; readonly defaultModel: string;
    constructor(options?: GeminiDecisionsOptions);
    getCapabilities(model?: string): Capabilities;
    getResultValidationOptions(model?: string): ResultValidationOptions;
    validateRequest(request: ResolvedRequest): void;
    createDecision<const Q extends GeminiDecisionQuestions>(request: GeminiDecisionRequest<Q>, options?: ProviderCallOptions):
        Promise<{ readonly decision: GeminiDecisionResponse<Q>; readonly meta: GeminiTransportMetadata }>;
    evaluate<const Q extends Questions>(request: EvaluationRequest<Q>, options?: ProviderCallOptions): Promise<ProviderResult<Q>>;
    listModels(options?: ProviderCallOptions): Promise<ModelList>;
}
