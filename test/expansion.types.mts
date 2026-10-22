import { createBridge, OpenAIDecisionsProvider, noul, type NativeDecisionInputItem } from '../src/index.mjs';
import { CloudflareExtractionProvider, extractBatch, type ExtractionResult, type ExtractionValue, type ExtractionField } from '../src/extraction/index.mjs';
import { createLiveDecisions, type LiveCommand } from '../src/live/index.mjs';

const history: readonly NativeDecisionInputItem[] = [
    { role: 'developer', content: 'Use facts.' },
    { role: 'assistant', content: [{ type: 'output_text', text: 'Checking.' }], phase: 'commentary' },
    { type: 'function_call', call_id: '1', name: 'lookup', arguments: '{}' },
    { type: 'function_call_output', call_id: '1', output: 'Found.' },
];
const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture' });
const bridge = createBridge({ provider, extensions: [{ name: 'history', prepareConversation(items) { return items; } }] });
await bridge.evaluate({ conversation: history, questions: { q: noul('True?') }, promptCacheKey: null,
    promptCacheOptions: { mode: 'explicit', ttl: '30m' } });
await bridge.evaluate({ input: [{ type: 'image', url: 'https://example.com/a.png', promptCacheBreakpoint: { mode: 'explicit' } }], questions: { q: noul('True?') } });
// @ts-expect-error Input forms remain exclusive.
bridge.evaluate({ state: '', conversation: history, questions: { q: noul('True?') } });
const extractor = new CloudflareExtractionProvider({ accountId: 'fixture', apiKey: 'fixture' });
const extracted = await extractor.extract({ state: '4 USD', fields: { amount: { type: 'number' }, names: { type: 'list', items: 'text' } } });
const amount: number | null = extracted.extraction.answers.amount.value;
const names: readonly string[] | null = extracted.extraction.answers.names.value;
const confidence: number | undefined = extracted.extraction.answers.amount.confidence;
// @ts-expect-error Extracted number is not text.
const wrong: string = extracted.extraction.answers.amount.value;
const batch = await extractBatch(extractor, [{ state: '4', fields: { amount: { type: 'number' } } }]);
declare const generic: ExtractionResult;
// Default and batch contracts must admit every JSON value that extraction preserves.
const unknownNumber: typeof generic.extraction.answers[string]['value'] = 4;
const unknownList: typeof generic.extraction.answers[string]['value'] = [1, 'date'];
const unknownForecast: typeof generic.extraction.answers[string]['value'] = { steps: [] };
const unionValue: ExtractionValue<{ type: 'number' | 'date' }> = 4;
const unionDate: ExtractionValue<{ type: 'number' | 'date' }> = '2026-10-21';
const numberList: ExtractionValue<ExtractionField & { type: 'list' }> = [1];
if (batch[0]?.ok) {
    // @ts-expect-error Unknown field types cannot be assumed to be text.
    const assumedText: string | null = batch[0].result.extraction.answers.amount.value;
    void assumedText;
}
// @ts-expect-error Literal text lists still exclude numbers.
const wrongList: typeof names = [1];
const commands: LiveCommand[] = [];
const live = createLiveDecisions({ transport: { send(command) { commands.push(command); }, subscribe(_listener) { return () => {}; } } });
live.subscribe(event => { if (event.type === 'decision') { const matched: boolean = event.correlation.matched; void matched; } });
await live.requestDecision();
live.dispose();
void [amount, names, confidence, wrong, unknownNumber, unknownList, unknownForecast, unionValue, unionDate, numberList, wrongList];
