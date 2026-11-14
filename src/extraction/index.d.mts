import type { OpenRouterRequestMetadata } from '../openrouter.mjs';
import type { JsonValue, TransportOptions, ProviderCallOptions, BatchOptions, ErrorDetails } from '../index.mjs';
import type { CloudflareGatewayOptions, CloudflareBindingGatewayOptions, CloudflareTransportMetadata } from '../cloudflare-decisions.mjs';

export type ExtractionFieldType = 'text' | 'number' | 'date' | 'time' | 'datetime' | 'duration' | 'list' | 'estimate' | 'forecast';
export interface ExtractionField {
    readonly type: ExtractionFieldType; readonly instructions?: string; readonly unit?: string;
    readonly integer?: boolean; readonly decimals?: number; readonly items?: 'text' | 'number' | 'date';
    readonly min?: number | string; readonly max?: number | string; readonly step?: number | 'month' | 'year';
    readonly scale?: 'linear' | 'log'; readonly null_threshold?: number; readonly horizon?: number;
    readonly interval?: 'step' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
}
export type ExtractionFields = Readonly<Record<string, ExtractionField>>;
export interface ExtractionRequest<F extends ExtractionFields = ExtractionFields> {
    readonly model?: 'clairic' | '@cf/cloudflare/clairic'; readonly state?: string; readonly fields: F;
    readonly images?: readonly (string | { readonly content_type: string; readonly base64: string })[];
    readonly reference_date?: string;
    readonly options?: { readonly include_quantiles?: boolean; readonly return_state_text?: boolean; readonly rejectIfBusy?: boolean };
}
export interface ExtractionAnswer<Span = readonly [number, number]> {
    readonly type: ExtractionFieldType; readonly value: JsonValue; readonly guess?: JsonValue;
    readonly confidence?: number; readonly p_null?: number; readonly span?: readonly [number, number];
    readonly spans?: readonly Span[]; readonly mean?: JsonValue; readonly median?: JsonValue;
    readonly p10?: JsonValue; readonly p90?: JsonValue; readonly p_below?: number; readonly p_above?: number;
    readonly quantiles?: readonly JsonValue[]; readonly steps?: readonly JsonValue[];
    readonly [key: string]: unknown;
}
// Distribute over field/item unions so unspecialized and batch values stay honest.
type ListItemValue<I> = I extends 'number' ? number : I extends 'text' | 'date' ? string : number | string;
type FieldValue<T extends ExtractionFieldType, I> = T extends 'number' | 'duration' ? number | null
    : T extends 'list' ? readonly ListItemValue<I>[] | null
    : T extends 'estimate' ? number | string | null
    : T extends 'forecast' ? JsonValue : string | null;
export type ExtractionValue<S extends ExtractionField> = FieldValue<S['type'], S['items']>;
export interface ExtractionResponse<F extends ExtractionFields = ExtractionFields> {
    readonly model: string;
    readonly answers: { readonly [K in keyof F]: ExtractionAnswer & { readonly type: F[K]['type']; readonly value: ExtractionValue<F[K]> } };
    readonly truncated: boolean; readonly state_text?: string;
    readonly usage: { readonly input_tokens: number; readonly output_tokens: number; readonly state_tokens?: number;
        readonly image_tokens?: number; readonly schema_tokens?: number; readonly passes?: number; readonly [key: string]: unknown };
    readonly [key: string]: unknown;
}
export interface ExtractionResult<F extends ExtractionFields = ExtractionFields> {
    readonly extraction: ExtractionResponse<F>;
    readonly meta: CloudflareTransportMetadata & { readonly provider: 'cloudflare-extraction'; readonly requestedModel: string; readonly resolvedModel: string };
}
export interface CloudflareExtractionBinding {
    run(model: '@cf/cloudflare/clairic', input: ExtractionRequest,
        options?: { readonly signal?: AbortSignal; readonly returnRawResponse?: boolean; readonly rejectIfBusy?: boolean;
            readonly gateway?: CloudflareBindingGatewayOptions }): Promise<unknown>;
}
type Settings = { model?: 'clairic' | '@cf/cloudflare/clairic'; rejectIfBusy?: boolean; gateway?: CloudflareGatewayOptions };
export type CloudflareExtractionOptions = Settings & (
    | (TransportOptions & { transport?: 'rest'; accountId?: string; apiKey?: string; baseURL?: string; ai?: never })
    | (Omit<TransportOptions, 'fetchImpl'> & { transport: 'binding'; ai: CloudflareExtractionBinding;
        accountId?: never; apiKey?: never; baseURL?: never; fetchImpl?: never }));
export type ExtractionValidationOptions = Settings & { transport?: 'rest' | 'binding'; maxRequestBytes?: number; maxRetries?: number };
export function validateExtractionRequest<const F extends ExtractionFields>(request: ExtractionRequest<F>, options?: ExtractionValidationOptions): ExtractionRequest<F> & { readonly model: 'clairic' };
export class CloudflareExtractionProvider {
    readonly name: 'cloudflare-extraction'; readonly kind: 'extraction'; readonly defaultModel: 'clairic';
    constructor(options?: CloudflareExtractionOptions);
    validate<const F extends ExtractionFields>(request: ExtractionRequest<F>): ExtractionRequest<F> & { readonly model: 'clairic' };
    extract<const F extends ExtractionFields>(request: ExtractionRequest<F>, options?: ProviderCallOptions): Promise<ExtractionResult<F>>;
    validateResult<const F extends ExtractionFields>(result: unknown, request: ExtractionRequest<F>): ExtractionResult<F>;
}
export type ExtractionBatchRecord = { readonly index: number; readonly ok: true; readonly result: ExtractionResult }
    | { readonly index: number; readonly ok: false; readonly error: ErrorDetails };
export function extractBatch(provider: CloudflareExtractionProvider, inputs: readonly ExtractionRequest[], options?: BatchOptions): Promise<readonly ExtractionBatchRecord[]>;

export type CommonExtractionRequest<F extends ExtractionFields = ExtractionFields> = Omit<ExtractionRequest<F>, 'model'> & { readonly model?: string };
export interface ExtractionProvider<R = CommonExtractionRequest, T = AnyExtractionResult> {
    readonly name: string; readonly kind: 'extraction'; readonly defaultModel?: string;
    validate(request: R): R & { readonly model: string };
    extract(request: R, options?: ProviderCallOptions): Promise<T>;
    validateResult(result: unknown, request: R): T;
}
export type OpenRouterExtractionOptions = import('../openrouter.mjs').OpenRouterNativeOptions;
export type OpenRouterExtractionAsset = { readonly type?: 'image'; readonly format: 'png' | 'jpg' | 'jpeg' | 'webp'; readonly data_base64: string }
    | { readonly type?: 'document'; readonly format: 'pdf'; readonly data_base64: string };
export interface OpenRouterExtractionRequest<F extends ExtractionFields = ExtractionFields> extends OpenRouterRequestMetadata {
    readonly model?: string; readonly state?: string; readonly fields: F; readonly reference_date?: string;
    readonly assets?: Readonly<Record<string, OpenRouterExtractionAsset>>;
}
type OpenRouterFieldValue<T extends ExtractionFieldType, I> = T extends 'forecast' ? readonly (number | string)[] | null : FieldValue<T, I>;
export type OpenRouterExtractionResponse<F extends ExtractionFields = ExtractionFields> = Pick<ExtractionResponse<F>, 'model' | 'usage'> & {
    readonly answers: { readonly [K in keyof F]: ExtractionAnswer<readonly [number, number] | null> & {
        readonly type: F[K]['type']; readonly value: OpenRouterFieldValue<F[K]['type'], F[K]['items']>;
    } };
    readonly truncated?: boolean; readonly state_text?: string | null; readonly id?: string; readonly provider?: string;
};
export interface OpenRouterExtractionResult<F extends ExtractionFields = ExtractionFields> {
    readonly extraction: OpenRouterExtractionResponse<F>;
    readonly meta: import('../openrouter.mjs').OpenRouterTransportMetadata & { readonly provider: 'openrouter-extraction' };
}
export type AnyExtractionResult<F extends ExtractionFields = ExtractionFields> = ExtractionResult<F> | OpenRouterExtractionResult<F>;
export class OpenRouterExtractionProvider implements ExtractionProvider {
    readonly name: 'openrouter-extraction'; readonly kind: 'extraction'; readonly defaultModel?: string;
    constructor(options?: OpenRouterExtractionOptions);
    validate<const F extends ExtractionFields>(request: CommonExtractionRequest<F>): CommonExtractionRequest<F> & { readonly model: string };
    extract<const F extends ExtractionFields>(request: CommonExtractionRequest<F>, options?: ProviderCallOptions): Promise<OpenRouterExtractionResult<F>>;
    validateResult<const F extends ExtractionFields>(result: unknown, request: CommonExtractionRequest<F>): OpenRouterExtractionResult<F>;
    createExtraction<const F extends ExtractionFields>(request: OpenRouterExtractionRequest<F>, options?: ProviderCallOptions): Promise<OpenRouterExtractionResult<F>>;
}
export type ExtractionProviderConfig = ({ type: 'cloudflare-extraction' } & CloudflareExtractionOptions)
    | ({ type: 'openrouter-extraction' } & OpenRouterExtractionOptions);
export function createExtractionProvider(options: { type: 'cloudflare-extraction' } & CloudflareExtractionOptions): CloudflareExtractionProvider;
export function createExtractionProvider(options: { type: 'openrouter-extraction' } & OpenRouterExtractionOptions): OpenRouterExtractionProvider;
export function createExtractionProvider(options: ExtractionProviderConfig): CloudflareExtractionProvider | OpenRouterExtractionProvider;
export function extractBatch<R, T>(provider: ExtractionProvider<R, T>, inputs: readonly R[], options?: BatchOptions):
    Promise<readonly ({ readonly index: number; readonly ok: true; readonly result: T } | { readonly index: number; readonly ok: false; readonly error: ErrorDetails })[]>;
