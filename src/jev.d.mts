/** Native Jev JSON assets; file reading and image preparation remain caller-owned. */
import type { State, ChoiceQuestion, NoulQuestion, ScoreQuestion, BoxQuestion, ProviderResult } from './index.d.mts';

export interface JevDangerZone { readonly images?: boolean; readonly longContext?: boolean; }
export interface JevImageAsset {
    readonly type?: 'image'; readonly format: 'png' | 'jpg' | 'jpeg'; readonly data_base64: string;
}
export type JevQuestions = Readonly<Record<string, ChoiceQuestion | NoulQuestion | ScoreQuestion | BoxQuestion>>;
export interface JevDecisionRequest<Q extends JevQuestions = JevQuestions> {
    readonly state: State; readonly questions: Q; readonly model?: string;
    readonly assets?: Readonly<Record<string, JevImageAsset>>;
}
export type JevDecisionResponse<Q extends JevQuestions = JevQuestions> = Omit<ProviderResult<Q>, 'meta'>;
export interface JevTransportMetadata {
    readonly requestedModel: string; readonly durationMs: number; readonly attempts: number; readonly requestId?: string;
}
