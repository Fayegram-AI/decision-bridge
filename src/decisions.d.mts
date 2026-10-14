/** Native OpenAI Decisions types, separate from the common bridge contract. */
export type NativeDecisionInputPart =
    | { readonly type: 'input_text'; readonly text: string }
    | { readonly type: 'input_image'; readonly image_url: string;
        readonly detail?: 'low' | 'high' | 'auto' | 'original' | null };
export interface NativeDecisionMessage {
    readonly role: 'user'; readonly type?: 'message';
    readonly content: string | readonly NativeDecisionInputPart[];
}
export type NativeDecisionQuestion =
    | { readonly type: 'predicate'; readonly name?: string; readonly instructions: string }
    | { readonly type: 'choice'; readonly name?: string; readonly instructions: string;
        readonly choices: readonly { readonly value: string | boolean; readonly description?: string }[] }
    | { readonly type: 'score'; readonly name?: string; readonly instructions: string;
        readonly levels: readonly { readonly label: string; readonly description?: string }[] };
export interface NativeDecisionRequest {
    readonly model?: string;
    readonly input: string | readonly NativeDecisionMessage[];
    readonly questions: readonly NativeDecisionQuestion[];
    readonly safety_identifier?: string | null;
}
export type NativeDecisionAnswer =
    | { readonly type: 'predicate'; readonly name: string | null; readonly probability: number }
    | { readonly type: 'choice'; readonly name: string | null; readonly choice: string | boolean;
        readonly confidence: number;
        readonly probabilities: readonly { readonly value: string | boolean; readonly probability: number }[] }
    | { readonly type: 'score'; readonly name: string | null; readonly score: number; readonly confidence: number;
        readonly probabilities: readonly { readonly value: number; readonly label: string; readonly probability: number }[] };
/** Refusals are represented by DecisionError, never by a successful response. */
export type OpenAIDecisionUsage = {
    readonly input_tokens: number; readonly output_tokens: number; readonly total_tokens: number;
    readonly input_tokens_details: { readonly cached_tokens: number; readonly cache_write_tokens: number };
    readonly output_tokens_details: { readonly reasoning_tokens: number };
};
export interface OpenAIDecisionResponse {
    readonly model: string; readonly answers: readonly NativeDecisionAnswer[];
    readonly usage: OpenAIDecisionUsage;
}
export interface TransportMetadata {
    readonly attempts: number; readonly durationMs: number; readonly requestId?: string;
}
/** Selected model, resolved outgoing ID, and transport diagnostics for native calls. */
export interface OpenAIDecisionsTransportMetadata extends TransportMetadata {
    readonly requestedModel: string;
    readonly resolvedModel: string;
}
export type OpenAIDecisionsMetadata = {
    readonly usage: OpenAIDecisionUsage;
    readonly answers: Readonly<Record<string, { readonly type: 'predicate' | 'choice' | 'score'; readonly confidence?: number }>>;
};
