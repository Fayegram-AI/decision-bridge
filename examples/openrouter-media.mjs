// Google Decisions through OpenRouter: an inline CSV uses the common document part.
// Set OPENROUTER_API_KEY or DECISION_BRIDGE_OPENROUTER_API_KEY before running.
import { createBridge, createProvider, noul } from '@fayegram-ai/decision-bridge';

const provider = createProvider({ type: 'openrouter-decisions', model: 'google/gemini-decision-1' });
const result = await createBridge({ provider }).evaluate({
    input: [{ type: 'document', dataUrl: 'data:text/csv;base64,' + btoa('item,count\nwidgets,3\n') }],
    questions: { stocked: noul('Does the table report at least one widget in stock?') },
});
console.log(result.answers.stocked.noul);
