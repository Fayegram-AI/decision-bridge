import { createDecisionRouter, createExtractionRouter, evaluateRoutedBatch, extractRoutedBatch,
    type RoutingMetadata, type RoutingInspection } from '../src/routing/index.mjs';
import { noul, choice, type DecisionError } from '../src/index.mjs';

const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
    auto: { policy: 'deterministic', candidates: ['native'] },
    native: { config: { type: 'openai-decisions', model: 'luna', apiKey: 'compile-only' } },
}, onAmbiguity: question => ({ action: 'select', route: question.candidates[0]!.id }) });
const request = { state: 'compile-only', questions: { valid: noul('True?'), route: choice('Choose', { a: null, b: null }) } };
const report: RoutingInspection = router.inspect(request);
const result = await router.evaluate(request, { route: 'auto', labels: ['priority'] });
const noun: number = result.answers.valid.noul;
const label: 'a' | 'b' = result.answers.route.choice;
const metadata: RoutingMetadata = result.meta.routing;
const batch = await evaluateRoutedBatch(router, [request]);
if (batch[0]?.ok) { const value: number = batch[0].result.answers.valid.noul; void value; }
const extraction = createExtractionRouter({ routes: { native: { config: { type: 'cloudflare-extraction', apiKey: 'compile-only', accountId: 'account' } } }, defaultRoute: 'native' });
const extracted = await extraction.extract({ state: 'total 12', fields: { total: { type: 'number' } } });
const amount: number | null = extracted.extraction.answers.total.value;
await extractRoutedBatch(extraction, [{ state: '12', fields: { total: { type: 'number' } } }]);
const error = null as unknown as DecisionError;
const details: RoutingMetadata | undefined = error.routing;
// @ts-expect-error Native extraction cannot be a custom decision factory.
createExtractionRouter({ routes: { bad: { operation: 'extraction', factory: () => ({}) } } });
// @ts-expect-error Router only exposes its operation.
router.extract({});
// @ts-expect-error Routing options stay separate from request schema.
router.evaluate({ ...request, route: 'auto' });
void [report, noun, label, metadata, amount, details];

// A full-request preparation hook can replace the output schema, even when its
// implementation currently returns the input. Do not promise the original keys.
const prepared = createDecisionRouter({ routes: { native: { config: { type: 'jev', apiKey: 'compile-only' } } },
    prepare: input => ({ ...input, questions: { changed: noul('Changed?') } }) });
const preparedResult = await prepared.evaluate(request);
// @ts-expect-error Prepared answers must be narrowed; original question types are not guaranteed.
const oldNoul: number = preparedResult.answers.valid!.noul;
const preparedRows = await evaluateRoutedBatch(prepared, [request]);
if (preparedRows[0]?.ok) {
    // @ts-expect-error Prepared batch results also cannot promise the original choice schema.
    const oldChoice: 'a' | 'b' = preparedRows[0].result.answers.route!.choice;
    void oldChoice;
}
const preparedExtraction = createExtractionRouter({ routes: { native: { config: {
    type: 'cloudflare-extraction', apiKey: 'compile-only', accountId: 'account',
} } }, prepare: input => ({ ...input, fields: { changed: { type: 'text' } } }) });
const originalExtraction = { state: '12', fields: { total: { type: 'number' as const } } };
const preparedFields = await preparedExtraction.extract(originalExtraction);
// @ts-expect-error Preparation can replace numeric fields with other field types.
const oldAmount: number | null = preparedFields.extraction.answers.total!.value;
const preparedFieldRows = await extractRoutedBatch(preparedExtraction, [originalExtraction]);
if (preparedFieldRows[0]?.ok) {
    // @ts-expect-error Prepared extraction batches require field-value narrowing too.
    const oldBatchAmount: number | null = preparedFieldRows[0].result.extraction.answers.total!.value;
    void oldBatchAmount;
}
void [oldNoul, oldAmount];
