import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionRouter } from '../src/routing/index.mjs';
import { DecisionError } from '../src/errors.mjs';
import { registry, worker, selector, routingRequest as request } from './routing-fixtures.mjs';
import { image } from './decisions-fixtures.mjs';
import { noulWithParts } from '../src/index.mjs';

function assisted(policy = {}, routes = {}) {
    return registry({ policy: 'decision-assisted', selector: { route: 'judge', minProbability: 0.6, minMargin: 0.1 }, ...policy },
        { judge: { provider: selector() }, ...routes });
}

test('question images are sanitized for selectors while JSON data remains opaque', async () => {
    const instructionParts = [{ type: 'text', text: 'Compare.' },
        { type: 'json', data: { image_url: 'ordinary data', type: 'image', dataUrl: 'opaque reference' } },
        { type: 'image', dataUrl: image }, { type: 'image', url: 'https://example.com/private-reference.png' }];
    const capabilities = { orderedInput: true, jsonInput: true, questionContent: true, images: true, remoteImages: true, maxImages: 2 };
    let context;
    let received;
    const judge = selector(input => { context = JSON.parse(input.state); return selector().evaluate(input); });
    const a = worker('a', input => { received = input; return worker('a').evaluate(input); }, capabilities);
    const router = createDecisionRouter(assisted({}, { a: { provider: a }, b: { provider: worker('b', undefined, capabilities) }, judge: { provider: judge } }));
    const result = await router.evaluate({ input: [{ type: 'json', data: { ticket: 42 } }],
        questions: { yes: noulWithParts(instructionParts) } }, { routingDescription: 'Summarized task' });
    assert.equal(result.meta.schemaVersion, 6);
    const serialized = JSON.stringify(context);
    assert(!serialized.includes('base64') && !serialized.includes('private-reference.png'));
    assert.deepEqual(context.task.schema.yes.instructionParts[1], instructionParts[1]);
    assert.equal(context.task.media.length, 2);
    assert.equal(context.task.media[1].remote, true);
    assert.deepEqual(received.questions.yes.instructionParts, instructionParts);
});

test('JSON-only input uses text routing rules and unsupported content routes are excluded', async () => {
    const capabilities = { orderedInput: true, jsonInput: true };
    const router = createDecisionRouter(registry({ rules: [{ effect: 'require', when: { modalities: ['text'] }, routes: ['a'] }] },
        { a: { provider: worker('a', undefined, capabilities) }, b: { provider: worker('b', undefined, capabilities) } }));
    const json = { input: [{ type: 'json', data: {} }], questions: request.questions };
    assert.equal((await router.evaluate(json)).meta.routing.selectedRoute, 'a');
    const filtered = createDecisionRouter(registry({}, { a: { provider: worker('a', undefined, capabilities) } }));
    const report = filtered.inspect(json);
    assert.equal(report.routes.find(route => route.id === 'b').status, 'unsupported');
    assert.equal((await filtered.evaluate(json)).meta.routing.selectedRoute, 'a');
});

test('unattended decision-assisted requires selector even with one target; ready selector bypasses inference for deterministic outcomes', async () => {
    let calls = 0;
    const judge = { provider: selector(() => { calls++; throw Error('Should not call'); }) };
    const router = createDecisionRouter(assisted({ candidates: ['a'] }, { judge }));
    assert.equal((await router.evaluate(request)).meta.routing.method, 'single'); assert.equal(calls, 0);
    const missing = createDecisionRouter(registry({ policy: 'decision-assisted', candidates: ['a'] }));
    await assert.rejects(missing.evaluate(request), { code: 'CONFIGURATION_ERROR' });
    assert.equal(missing.inspect(request).missingUnattendedPrerequisite, true);
    await missing.evaluate(request, { onAmbiguity: () => { throw Error('Should not ask'); } });
    const disabled = createDecisionRouter(assisted({ candidates: ['a'] }, { judge: { ...judge, enabled: false } }));
    await assert.rejects(disabled.evaluate(request), { code: 'CONFIGURATION_ERROR' });
    const thresholds = createDecisionRouter(assisted({ selector: { route: 'judge' }, candidates: ['a'] }));
    await assert.rejects(thresholds.evaluate(request), { code: 'CONFIGURATION_ERROR' });
    const configured = createDecisionRouter(assisted({ priority: ['b'] }, { judge }));
    assert.equal((await configured.evaluate(request)).meta.routing.selectedRoute, 'b'); assert.equal(calls, 0);
});

test('AI choices use internal IDs, eligible-only context and independent usage; callbacks precede AI', async () => {
    let calls = 0;
    const judge = selector(input => {
        calls++;
        const context = JSON.parse(input.state);
        assert.deepEqual(context.candidates.map(item => item.route), ['a', 'b']);
        assert.deepEqual(Object.keys(input.questions.route.criteria), ['r0', 'r1', 'abstain']);
        return selector().evaluate(input);
    });
    const router = createDecisionRouter(assisted({}, { judge: { provider: judge } }));
    const human = await router.evaluate(request, { onAmbiguity: () => ({ action: 'select', route: 'b' }) });
    assert.equal(human.meta.routing.method, 'clarification'); assert.equal(calls, 0);
    const ai = await router.evaluate(request, { onAmbiguity: () => ({ action: 'use-selector' }) });
    assert.equal(calls, 1); assert.equal(ai.meta.routing.method, 'selector');
    assert.equal(ai.meta.routing.selector.usage.input_tokens, 5);
    assert.equal(ai.meta.routing.attempts[0].usage.input_tokens, null);
    assert.equal(ai.meta.routing.selector.route, 'judge');
});

test('selector honors provider probability precision and explicit acceptance thresholds', async () => {
    const judge = selector(() => ({ model: 'rounded-selector', answers: { route: { type: 'choice', choice: 'r0',
        probabilities: { r0: 0.7, r1: 0.2, abstain: 0.0999 } } }, usage: { input_tokens: 2, output_tokens: 0 } }), 4);
    const config = assisted({}, { judge: { provider: judge } });
    assert.equal((await createDecisionRouter(config).evaluate(request)).meta.routing.selectedRoute, 'a');
    config.routes.auto.selector.minProbability = 0.9;
    await assert.rejects(createDecisionRouter(config).evaluate(request), { code: 'ROUTING_AMBIGUOUS' });
    const invalid = selector(() => ({ model: 'selector', answers: { route: { type: 'choice', choice: 'foreign',
        probabilities: { r0: 0, r1: 0, foreign: 1 } } }, usage: { input_tokens: 0, output_tokens: 0 } }));
    await assert.rejects(createDecisionRouter(assisted({}, { judge: { provider: invalid } })).evaluate(request), { code: 'INVALID_RESPONSE' });
});

test('selector context replaces recognized media with metadata and supports text replacement/size bounds', async () => {
    let content;
    const judge = selector(input => { content = input.state; return selector().evaluate(input); });
    const options = assisted({}, { a: { provider: worker('a', undefined, { orderedInput: true, images: true, maxImages: null }) },
        b: { provider: worker('b', undefined, { orderedInput: true, images: true, maxImages: null }) }, judge: { provider: judge } });
    const router = createDecisionRouter(options);
    await router.evaluate({ input: [{ type: 'image', dataUrl: image }, { type: 'text', text: 'sensitive task' }], questions: request.questions }, { routingDescription: 'Summarized task' });
    assert(!content.includes('base64') && !content.includes('sensitive task'));
    assert(content.includes('Summarized task') && content.includes('bytes'));
    options.routes.auto.selector.maxContextBytes = 1;
    await assert.rejects(createDecisionRouter(options).evaluate(request), { code: 'ROUTING_CONTEXT_TOO_LARGE' });
});

test('selector failure fallback is explicit, bounded, and cannot catch refusal or cancellation', async () => {
    let calls = 0;
    const judge = { provider: selector(() => { calls++; throw new DecisionError('Unavailable', { code: 'RATE_LIMITED' }); }) };
    const policy = { priority: ['b'], selector: { route: 'judge', when: 'multiple', minProbability: 0.6, minMargin: 0.1, fallbackOn: ['unavailable'] } };
    const result = await createDecisionRouter(assisted(policy, { judge })).evaluate(request);
    assert.equal(calls, 1); assert.equal(result.meta.routing.method, 'selector-fallback'); assert.equal(result.meta.routing.selectedRoute, 'b');
    for (const code of ['MODEL_REFUSAL', 'ABORTED']) {
        await assert.rejects(createDecisionRouter(assisted(policy, { judge: { provider: selector(() => { throw new DecisionError('terminal', { code }); }) } })).evaluate(request), { code });
    }
    await assert.rejects(createDecisionRouter(assisted({}, { judge })).evaluate(request), { code: 'RATE_LIMITED' });
    const timeout = assisted({ selector: { ...policy.selector, timeoutMs: 10, fallbackOn: ['timeout'] }, priority: ['b'] },
        { judge: { provider: selector(() => new Promise(() => {})) } });
    assert.equal((await createDecisionRouter(timeout).evaluate(request)).meta.routing.method, 'selector-fallback');
});

test('generative routes retain elicited provenance and cannot serve as selectors', async () => {
    const generative = { ...worker('g'), kind: 'generative' };
    assert.throws(() => createDecisionRouter(registry({}, { a: { provider: generative } })), { code: 'CONFIGURATION_ERROR' });
    const router = createDecisionRouter(registry({ candidates: ['a'] }, { a: { provider: generative, allowGenerative: true } }));
    const result = await router.evaluate(request);
    assert.equal(result.meta.probabilitySource, 'elicited');
    assert.equal(result.meta.confidenceSource, 'unavailable');
    await assert.rejects(createDecisionRouter(assisted({}, { judge: { provider: generative, allowGenerative: true } })).evaluate(request), { code: 'CONFIGURATION_ERROR' });
});

test('selector acceptance reuses the bridge validation snapshot even when provider policy changes during inference', async () => {
    let lookups = 0;
    const precision = { probabilityDecimalPlaces: 1 };
    const judge = selector(() => {
        precision.probabilityDecimalPlaces = 15;
        return { model: 'selector', answers: { route: { type: 'choice', choice: 'r0',
            probabilities: { r0: 0.7, r1: 0.2, abstain: 0.2 } } }, usage: { input_tokens: 4, output_tokens: 1 } };
    });
    judge.getResultValidationOptions = () => { lookups++; return precision; };
    const result = await createDecisionRouter(assisted({}, { judge: { provider: judge } })).evaluate(request);
    assert.equal(result.meta.routing.selectedRoute, 'a');
    assert.equal(lookups, 1);
});

test('failed selector usage survives terminal errors and deterministic fallback without copying arbitrary payloads', async () => {
    const usage = { input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 2, extra: 'not a usage counter' };
    for (const code of ['MODEL_REFUSAL', 'RATE_LIMITED']) {
        const judge = { provider: selector(() => { throw new DecisionError('failure', { code, usage }); }) };
        await assert.rejects(createDecisionRouter(assisted({}, { judge })).evaluate(request), error => {
            assert.equal(error.code, code);
            assert.deepEqual(error.routing.selector.usage, { input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 2 });
            assert.deepEqual(error.routing.attempts, []);
            return true;
        });
    }
    const policy = { priority: ['b'], selector: { route: 'judge', when: 'multiple', minProbability: 0.6,
        minMargin: 0.1, fallbackOn: ['unavailable'] } };
    const judge = { provider: selector(() => { throw new DecisionError('busy', { code: 'RATE_LIMITED', usage }); }) };
    const result = await createDecisionRouter(assisted(policy, { judge })).evaluate(request);
    assert.equal(result.meta.routing.method, 'selector-fallback');
    assert.deepEqual(result.meta.routing.selector.usage, { input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 2 });
    assert.deepEqual(result.meta.routing.attempts[0].usage, { input_tokens: null, output_tokens: null });
});
