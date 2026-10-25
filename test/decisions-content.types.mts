import { createBridge, createProvider, choiceWithParts, noulWithParts, scoreWithParts, scoreLevelsWithParts,
    type QuestionInstructionParts, type QuestionWithParts, type ChoiceQuestion, type NoulQuestion,
    type NativeDecisionRequest, type NativeDecisionQuestionPart, type NativeDecisionToolOutputPart,
    type DecisionJsonData, type EvaluationRequest } from '../src/index.mjs';
import { validateLiveCommand, type LiveDecisionItem } from '../src/live/index.mjs';

const data: DecisionJsonData = [{ role: 'ordinary data', nested: [null, true, 42] }];
const parts: QuestionInstructionParts = [{ type: 'json', data }, { type: 'image', url: 'https://example.com/a.png' }];
const provider = createProvider({ type: 'openai-decisions', apiKey: 'compile-only' });
const bridge = createBridge({ provider });
const questions = {
    typed: choiceWithParts(parts, [{ value: true }, { value: 'true' }]),
    mapped: choiceWithParts(parts, { one: null, two: 'Second' }),
    predicate: noulWithParts(parts),
    boolean: noulWithParts(parts, { true: 'Matches', false: 'Different' }),
    score: scoreWithParts(parts, ['Low', 'High']),
    labeled: scoreLevelsWithParts(parts, [{ label: 'Low' }, { label: 'High' }]),
};
const explicit: QuestionWithParts<ChoiceQuestion<{ one: null; two: null }>> = {
    type: 'choice', instructionParts: parts, criteria: { one: null, two: null },
};
// Existing question interfaces remain extensible.
interface AppQuestion extends NoulQuestion { readonly appLabel: string; }
const app: AppQuestion = { type: 'noul', instructions: [], appLabel: 'legacy' };
async function checks() {
    const result = await bridge.evaluate({ input: [{ type: 'json', data }], questions });
    const typed: true | 'true' = result.answers.typed.choice;
    const mapped: 'one' | 'two' = result.answers.mapped.choice;
    const probability: number = result.answers.boolean.noul;
    const score: number = result.answers.score.score;
    const label: 'Low' | 'High' | undefined = result.answers.labeled.legend[0]?.label;
    const native: NativeDecisionRequest = { input: [{ role: 'user', content: [{ type: 'input_json', data }] }],
        questions: [{ type: 'predicate', instructions: [{ type: 'input_json', data }] }] };
    await provider.createDecision(native);
    const item: LiveDecisionItem = { role: 'user', content: [{ type: 'input_json', data },
        { type: 'input_image', image_url: 'https://example.com/a.png' }] };
    validateLiveCommand({ type: 'decision.item.create', item });
    // @ts-expect-error Literal choice inference excludes other options.
    const wrong: false = result.answers.typed.choice;
    return { typed, mapped, probability, score, label, wrong };
}
// @ts-expect-error Explicit question content excludes legacy instructions.
const both: EvaluationRequest = { state: '', questions: { q: { type: 'noul', instructions: 'Old', instructionParts: parts } } };
// @ts-expect-error Box content is outside this update.
const box: EvaluationRequest = { state: '', questions: { q: { type: 'box', instructionParts: parts } } };
// @ts-expect-error JSON roots cannot be primitive arrays.
const badData: DecisionJsonData = [1];
// @ts-expect-error Cache controls do not belong to question content.
const cached: QuestionInstructionParts = [{ type: 'text', text: '', promptCacheBreakpoint: null }];
// @ts-expect-error A source must use either url or dataUrl.
const ambiguous: QuestionInstructionParts = [{ type: 'image', url: 'https://example.com/a.png', dataUrl: 'data:image/png;base64,AAAA' }];
// @ts-expect-error Tool outputs do not accept JSON.
const tool: NativeDecisionToolOutputPart = { type: 'input_json', data };
const cachedNative = { type: 'input_text' as const, text: '', prompt_cache_breakpoint: null };
// @ts-expect-error Cache fields are rejected even through a pre-existing variable.
const questionPart: NativeDecisionQuestionPart = cachedNative;
// @ts-expect-error Live content has no cache fields.
const liveCached: LiveDecisionItem = { role: 'user', content: [cachedNative] };
// @ts-expect-error Developer messages remain text-only.
const developer: NativeDecisionRequest = { input: [{ role: 'developer', content: [{ type: 'input_json', data }] }], questions: [] };
// @ts-expect-error Builders preserve typed choice restrictions.
choiceWithParts(parts, [{ value: 1 }]);
// @ts-expect-error Labelled common scores require two levels.
scoreLevelsWithParts(parts, [{ label: 'Only' }]);
void [checks, explicit, app, both, box, badData, cached, ambiguous, tool, questionPart, liveCached, developer];
