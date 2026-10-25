import type { CallOptions, ErrorDetails, JsonValue } from '../index.mjs';
import type { NativeDecisionQuestion, NativeDecisionQuestionPart, NativeDecisionAnswer, OpenAIDecisionResponse } from '../decisions.mjs';

export type LiveTranscriptType = 'session.input_transcript.delta' | 'session.output_transcript.delta';
export interface LiveDecisionsConfiguration {
    readonly delegation?: { readonly type: 'decisions'; readonly decisions: {
        readonly model?: 'gpt-6-luna'; readonly questions?: readonly NativeDecisionQuestion[] } };
    readonly triggers?: readonly { readonly type: 'decisions'; readonly event_type: LiveTranscriptType;
        readonly decisions: { readonly questions: readonly NativeDecisionQuestion[] } }[];
}
export interface LiveDecisionItem {
    readonly id?: string | null; readonly role: 'user'; readonly type?: 'message';
    readonly content: string | readonly NativeDecisionQuestionPart[];
}
export type LiveCommand = (
    | { readonly type: 'session.update'; readonly session: LiveDecisionsConfiguration }
    | { readonly type: 'decision.item.create'; readonly item: LiveDecisionItem }
    | { readonly type: 'decision.item.delete'; readonly item_id: string }
    | { readonly type: 'session.commentary.append'; readonly delegation_id: string | null; readonly content: string }
) & { readonly event_id?: string | null }
    | { readonly type: 'decision.create'; readonly event_id: string };
export type LiveNativeDecision = Omit<OpenAIDecisionResponse, 'answers'> & {
    readonly answers: readonly (NativeDecisionAnswer | { readonly type: 'refusal'; readonly name: string | null })[];
};
export interface LiveDecisionEvent {
    readonly type: 'decision.event'; readonly event_id: string; readonly delegation_id: string | null;
    readonly trigger_id: string | null; readonly source_event_id: string | null; readonly source_event_type: LiveTranscriptType | null;
    readonly event: { readonly type: 'decision.completed'; readonly decision: LiveNativeDecision };
}
export type LiveServerEvent = LiveDecisionEvent | { readonly type: string; readonly event_id: string; readonly [key: string]: unknown };
export type LiveTransportNotification = { readonly kind: 'event'; readonly event: unknown }
    | { readonly kind: 'close' | 'error' };
export interface LiveTransport {
    send(event: LiveCommand): void | Promise<void>;
    subscribe(listener: (notification: LiveTransportNotification) => void): () => void;
}
interface EventMetadata { readonly eventId: string; readonly eventType: string; }
export interface LiveCorrelation {
    readonly matched: boolean; readonly stale: boolean; readonly sourceEventId: string | null;
    readonly sourceEventType: LiveTranscriptType | null; readonly delegationId: string | null; readonly triggerId: string | null;
    readonly generation?: number; readonly reason?: 'source_or_configuration_unavailable' | 'configuration_mismatch';
}
export type LiveConfigurationEvent = EventMetadata & { readonly type: 'configuration';
    readonly configuration: LiveDecisionsConfiguration; readonly generation: number };
export type LiveItemEvent = EventMetadata & { readonly type: 'item'; readonly item?: LiveDecisionItem; readonly itemId?: string };
export type LiveNotification =
    | LiveConfigurationEvent | LiveItemEvent
    | (EventMetadata & { readonly type: 'decision'; readonly decision: LiveNativeDecision; readonly correlation: LiveCorrelation })
    | (EventMetadata & { readonly type: 'transcript'; readonly direction: 'input' | 'output'; readonly delta: string; readonly sequence: number })
    | (EventMetadata & { readonly type: 'delegation'; readonly delegationId: string })
    | (EventMetadata & { readonly type: 'duplicate' })
    | { readonly type: 'error' | 'observer_error' | 'closed'; readonly error?: ErrorDetails;
        readonly eventId?: string; readonly eventType?: string; readonly clientEventId?: string };
export interface LiveSubmissionReceipt { readonly eventId: string; readonly type: string; readonly status: 'submitted'; }
export interface LiveDecisionsOptions {
    readonly transport: LiveTransport; readonly configuration?: LiveDecisionsConfiguration;
    readonly timeoutMs?: number; readonly maxPending?: number; readonly maxHistory?: number;
    readonly maxRequestBytes?: number; readonly maxResponseBytes?: number;
}
export interface LiveDecisionsController {
    configure(configuration: LiveDecisionsConfiguration, options?: CallOptions): Promise<LiveConfigurationEvent>;
    createItem(item: LiveDecisionItem, options?: CallOptions): Promise<LiveItemEvent>;
    deleteItem(itemId: string, options?: CallOptions): Promise<LiveItemEvent>;
    requestDecision(options?: CallOptions): Promise<LiveSubmissionReceipt>;
    appendCommentary(content: string, options?: CallOptions & { delegationId?: string | null }): Promise<LiveSubmissionReceipt>;
    subscribe(observer: (event: LiveNotification) => void | Promise<void>): () => void;
    dispose(): void;
}
export function createLiveDecisions(options: LiveDecisionsOptions): LiveDecisionsController;
export function validateLiveConfiguration(input: unknown): LiveDecisionsConfiguration;
export function validateLiveCommand(input: unknown): LiveCommand;
export function validateLiveEvent(input: unknown): LiveServerEvent;
