/** Hosted Clef contracts, separate from the common and OpenAI Decisions formats. */
import type { State, Instructions, ChoiceCriteria, ScoreCriteria, JsonValue, TransportOptions,
    TransportMetadata } from './index.mjs';

export type CloudflareDecisionModel = 'clef' | 'clef-flash' | 'clef-omni'
    | '@cf/cloudflare/clef' | '@cf/cloudflare/clef-flash' | '@cf/cloudflare/clef-omni';
export type CloudflareDecisionImage = string | {
    readonly content_type: 'image/png' | 'image/jpeg' | 'image/webp'; readonly base64: string;
};
export type CloudflareDecisionAudio = string | {
    readonly content_type: 'audio/wav' | 'audio/x-wav' | 'audio/mpeg' | 'audio/mp3'; readonly base64: string;
};
export type CloudflareDecisionVideo = string | {
    readonly content_type: 'video/mp4' | 'video/webm'; readonly base64: string;
};
export type CloudflareDecisionQuestion =
    | { readonly type: 'noul'; readonly instructions: Instructions;
        readonly criteria?: { readonly true?: Instructions; readonly false?: Instructions } }
    | { readonly type: 'choice'; readonly instructions: Instructions; readonly criteria: ChoiceCriteria }
    | { readonly type: 'score'; readonly instructions: Instructions; readonly criteria: ScoreCriteria };
export interface CloudflareDecisionRequest {
    readonly model?: CloudflareDecisionModel; readonly state: State;
    readonly questions: Readonly<Record<string, CloudflareDecisionQuestion>>;
    readonly images?: readonly CloudflareDecisionImage[];
    readonly audio?: readonly CloudflareDecisionAudio[];
    readonly videos?: readonly CloudflareDecisionVideo[];
    /** Enabling busy rejection requires binding transport; REST fails local preflight. */
    readonly options?: { readonly rejectIfBusy?: boolean };
}
export type CloudflareDecisionAnswer =
    | { readonly type: 'noul'; readonly noul: number }
    | { readonly type: 'choice'; readonly choice: string; readonly probabilities: Readonly<Record<string, number>>;
        readonly confidence: number }
    | { readonly type: 'score'; readonly score: number; readonly probabilities: Readonly<Record<string, number>>;
        readonly legend: Readonly<Record<string, Instructions>>; readonly confidence: number };
export interface CloudflareDecisionUsage {
    readonly input_tokens: number; readonly output_tokens: number;
}
export interface CloudflareDecisionResponse {
    readonly model: string; readonly answers: Readonly<Record<string, CloudflareDecisionAnswer>>;
    readonly usage: CloudflareDecisionUsage;
}
export interface CloudflareGatewayOptions {
    /** Nonblank printable ASCII Gateway name. */
    readonly id: string;
    readonly cacheKey?: string;
    /** Nonnegative integer seconds; the service validates its cache policy. */
    readonly cacheTtl?: number;
    readonly skipCache?: boolean;
    readonly collectLog?: boolean;
    /** JSON primitive entries; caller-supplied cf.* keys are reserved. */
    readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
    readonly requestTimeoutMs?: number;
    readonly retries?: { readonly maxAttempts?: number; readonly retryDelayMs?: number;
        readonly backoff?: 'constant' | 'linear' | 'exponential' };
}
export interface CloudflareAIBinding {
    run(model: '@cf/cloudflare/clef' | '@cf/cloudflare/clef-flash' | '@cf/cloudflare/clef-omni',
        input: Omit<CloudflareDecisionRequest, 'model' | 'options'> & { readonly model: 'clef' | 'clef-flash' | 'clef-omni' },
        options?: { readonly signal?: AbortSignal; readonly returnRawResponse?: boolean;
            readonly rejectIfBusy?: boolean; readonly gateway?: CloudflareBindingGatewayOptions }): Promise<unknown>;
}

/** Known Workers binding ABI. Provider configuration remains forwardable to the service. */
export type CloudflareBindingGatewayOptions = Omit<CloudflareGatewayOptions, 'retries'> & {
    readonly retries?: Omit<NonNullable<CloudflareGatewayOptions['retries']>, 'maxAttempts'> & {
        readonly maxAttempts?: 1 | 2 | 3 | 4 | 5;
    };
};
type CommonOptions = {
    model?: CloudflareDecisionModel;
    /** Defaults to false. Enabling it requires binding transport and no retries. */
    rejectIfBusy?: boolean;
    gateway?: CloudflareGatewayOptions;
};
export type CloudflareDecisionsOptions = CommonOptions & (
    | (TransportOptions & { transport?: 'rest'; accountId?: string; apiKey?: string; baseURL?: string; ai?: never })
    | (Omit<TransportOptions, 'fetchImpl'> & { transport: 'binding'; ai: CloudflareAIBinding;
        accountId?: never; apiKey?: never; baseURL?: never; fetchImpl?: never })
);
export interface CloudflareTransportMetadata extends TransportMetadata { readonly gatewayLogId?: string; }
export type CloudflareDecisionsMetadata = {
    readonly usage: CloudflareDecisionUsage;
    readonly answers: Readonly<Record<string, { readonly type: 'noul' | 'choice' | 'score'; readonly confidence?: number }>>;
};
