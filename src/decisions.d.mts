/** Native OpenAI Decisions types, separate from the common bridge contract. */
export type NativeDecisionInputPart =
    | { readonly type: 'input_text'; readonly text: string; readonly prompt_cache_breakpoint?: DecisionCacheBreakpoint | null }
    | { readonly type: 'input_image'; readonly image_url: string;
        readonly detail?: 'low' | 'high' | 'auto' | 'original' | null;
        readonly prompt_cache_breakpoint?: DecisionCacheBreakpoint | null };
export interface DecisionCacheBreakpoint { readonly mode: 'explicit'; }
export interface DecisionCacheOptions { readonly mode?: 'implicit' | 'explicit' | null; readonly ttl?: '30m'; }
export type NativeDecisionMessage = {
    readonly role: 'user'; readonly type?: 'message';
    readonly content: string | readonly NativeDecisionInputPart[];
    readonly phase?: 'commentary' | 'final_answer' | null;
} | {
    readonly role: 'developer' | 'system'; readonly type?: 'message';
    readonly content: string | readonly Extract<NativeDecisionInputPart, { readonly type: 'input_text' }>[];
    readonly phase?: 'commentary' | 'final_answer' | null;
} | {
    readonly role: 'assistant'; readonly type?: 'message';
    readonly content: string | readonly ({ readonly type: 'output_text'; readonly text: string }
        | { readonly type: 'refusal'; readonly refusal: string })[];
    readonly phase?: 'commentary' | 'final_answer' | null;
};
interface ToolItem {
    readonly call_id: string; readonly id?: string | null;
    readonly status?: 'in_progress' | 'completed' | 'incomplete' | null;
}
export type NativeDecisionInputItem = NativeDecisionMessage
    | (ToolItem & { readonly type: 'function_call'; readonly name: string; readonly arguments: string; readonly namespace?: string | null })
    | (ToolItem & { readonly type: 'custom_tool_call'; readonly name: string; readonly input: string; readonly namespace?: string | null })
    | (ToolItem & { readonly type: 'function_call_output' | 'custom_tool_call_output';
        readonly output: string | readonly NativeDecisionInputPart[] });
export type NativeDecisionQuestion =
    | { readonly type: 'predicate'; readonly name?: string; readonly instructions: string }
    | { readonly type: 'choice'; readonly name?: string; readonly instructions: string;
        readonly choices: readonly { readonly value: string | boolean; readonly description?: string }[] }
    | { readonly type: 'score'; readonly name?: string; readonly instructions: string;
        readonly levels: readonly { readonly label: string; readonly description?: string }[] };
export interface NativeDecisionRequest {
    readonly model?: string;
    readonly input: string | readonly NativeDecisionInputItem[];
    readonly questions: readonly NativeDecisionQuestion[];
    readonly safety_identifier?: string | null;
    readonly prompt_cache_key?: string | null;
    readonly prompt_cache_options?: DecisionCacheOptions | null;
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
