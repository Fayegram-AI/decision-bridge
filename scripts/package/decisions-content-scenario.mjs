/** Qualify explicit content and its public types through an installed package. */
export function decisionsContentScenario(name) {
    return `import assert from 'node:assert/strict';
import { createBridge, createProvider, noulWithParts, choiceWithParts, scoreWithParts, scoreLevelsWithParts } from ${JSON.stringify(name)};
const parts = [{ type: 'text', text: 'Match?' }, { type: 'json', data: { amount: 42 } },
    { type: 'image', url: 'https://example.com/a.png' }];
let sent;
const provider = createProvider({ type: 'openai-decisions', apiKey: 'fixture', fetchImpl: async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ model: sent.model, answers: [{ type: 'predicate', name: 'yes', probability: 0.75 }],
        usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
} });
const result = await createBridge({ provider }).evaluate({ input: [{ type: 'json', data: [{ amount: 42 }] }],
    questions: { yes: noulWithParts(parts) } });
assert.equal(result.meta.schemaVersion, 6);
assert.equal(result.answers.yes.noul, 0.75);
assert.deepEqual(sent.input[0].content, [{ type: 'input_json', data: [{ amount: 42 }] }]);
assert.deepEqual(sent.questions[0].instructions, [{ type: 'input_text', text: 'Match?' },
    { type: 'input_json', data: { amount: 42 } }, { type: 'input_image', image_url: 'https://example.com/a.png' }]);
assert.equal(choiceWithParts(parts, [{ value: true }, { value: false }]).options[0].value, true);
assert.equal(scoreWithParts(parts, ['Low', 'High']).criteria.length, 2);
assert.equal(scoreLevelsWithParts(parts, [{ label: 'Low' }, { label: 'High' }]).levels[1].label, 'High');
console.log('Installed Decisions content encodes explicit JSON and question parts.');
`;
}

export function decisionsContentTypes(name) {
    return `
import { createBridge as contentBridge, createProvider as contentProvider, choiceWithParts as contentChoice,
    type QuestionInstructionParts as ContentParts, type NativeDecisionQuestionPart as NativeContentPart } from ${JSON.stringify(name)};
async function qualifyContentDeclarations() {
    const parts: ContentParts = [{ type: 'json', data: { count: 1 } }];
    const native: NativeContentPart = { type: 'input_json', data: [{}] };
    const bridge = contentBridge({ provider: contentProvider({ type: 'openai-decisions', apiKey: 'compile-only' }) });
    const result = await bridge.evaluate({ state: '', questions: { choice: contentChoice(parts, [{ value: true }, { value: 'other' }]) } });
    const chosen: true | 'other' = result.answers.choice.choice;
    // @ts-expect-error Installed types reject cache controls in question content.
    const invalid: ContentParts = [{ type: 'text', text: '', promptCacheBreakpoint: null }];
    return { native, chosen, invalid };
}
`;
}
