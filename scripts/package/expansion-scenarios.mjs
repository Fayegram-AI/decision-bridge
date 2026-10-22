/** Installed-package verification for the dedicated operation boundaries. */
export function expansionScenario(name) {
    return `import assert from 'node:assert/strict';
import { CloudflareExtractionProvider, validateExtractionRequest, extractBatch } from ${JSON.stringify(name + '/extraction')};
import { createLiveDecisions, validateLiveCommand } from ${JSON.stringify(name + '/live')};
const request = { state: '4 USD', fields: { amount: { type: 'number' } }, options: { return_state_text: true } };
assert.equal(validateExtractionRequest(request).model, 'clairic');
const extraction = new CloudflareExtractionProvider({ transport: 'binding', ai: { async run(model, input) {
    assert.equal(model, '@cf/cloudflare/clairic');
    assert.equal(input.options.return_state_text, true);
    return Response.json({ model: 'clairic', answers: { amount: { type: 'number', value: 4 } },
        truncated: false, usage: { input_tokens: 1, output_tokens: 0 } });
} } });
assert.equal((await extraction.extract(request)).extraction.answers.amount.value, 4);
assert((await extractBatch(extraction, [request])).every(row => row.ok));
let listener;
const sent = [];
const live = createLiveDecisions({ transport: { send(command) { sent.push(command); },
    subscribe(fn) { listener = fn; return () => {}; } } });
const ready = live.createItem({ role: 'user', content: 'Evidence' });
await new Promise(resolve => setImmediate(resolve));
listener({ kind: 'event', event: { type: 'decision.item.created', event_id: 'ack',
    client_event_id: sent[0].event_id, item: { role: 'user', id: 'item', content: 'Evidence' } } });
assert.equal((await ready).item.id, 'item');
assert.equal((await live.requestDecision()).status, 'submitted');
validateLiveCommand(sent[1]);
live.dispose();
console.log('Installed extraction and Live APIs execute their dedicated contracts.');
`;
}

export function expansionTypes(name) {
    return `
import { CloudflareExtractionProvider as QualifiedExtraction } from ${JSON.stringify(name + '/extraction')};
import { createLiveDecisions as qualifiedLive, type LiveCommand as QualifiedCommand } from ${JSON.stringify(name + '/live')};
async function qualifyExpandedDeclarations() {
    const provider = new QualifiedExtraction({ accountId: 'fixture', apiKey: 'fixture' });
    const result = await provider.extract({ state: '4', fields: { amount: { type: 'number' } } });
    const amount: number | null = result.extraction.answers.amount.value;
    const sent: QualifiedCommand[] = [];
    const live = qualifiedLive({ transport: { send(command) { sent.push(command); }, subscribe() { return () => {}; } } });
    live.subscribe(event => { if (event.type === 'decision') { const matched: boolean = event.correlation.matched; void matched; } });
    live.dispose();
    return amount;
}
`;
}
