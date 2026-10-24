import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionRouter, createExtractionRouter, evaluateRoutedBatch, extractRoutedBatch } from '../src/routing/index.mjs';
import { DecisionError } from '../src/errors.mjs';
import { createBridge } from '../src/bridge.mjs';
import { routingRequest as request, worker, registry, delay } from './routing-fixtures.mjs';
import { jsonResponse } from './fixtures.mjs';

test('explicit route/default selection, immutable policy and direct calls bypass auto prerequisites', async () => {
    assert.throws(() => createDecisionRouter(registry({ candidates: ['auto'] })), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => createDecisionRouter(registry({ priority: ['unknown'] })), { code: 'CONFIGURATION_ERROR' });
    const options = registry({ policy: 'decision-assisted' });
    const router = createDecisionRouter(options);
    options.routes.a.enabled = false;
    options.routes.auto.candidates.pop();
    assert.equal((await router.evaluate(request, { route: 'a' })).meta.routing.method, 'direct');
    await assert.rejects(router.evaluate(request), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => router.inspect(request, { route: 'missing' }), { code: 'CONFIGURATION_ERROR' });
    const direct = createDecisionRouter({ routes: { a: { provider: worker('a') } } });
    await assert.rejects(direct.evaluate(request), { code: 'CONFIGURATION_ERROR' });
    await assert.rejects(direct.evaluate({ ...request, model: 'b' }, { route: 'a' }), { code: 'NO_ELIGIBLE_ROUTE' });
    assert.throws(() => createDecisionRouter({ routes: { a: { provider: createBridge({ provider: worker('a') }) } } }), { code: 'CONFIGURATION_ERROR' });
});

test('zero, one enabled, one eligible, disabled readiness and optional/required configuration', async () => {
    const one = createDecisionRouter(registry({}, { b: { enabled: false, config: { type: 'jev' } } }));
    assert.equal((await one.evaluate(request)).meta.routing.selectedRoute, 'a');
    const none = createDecisionRouter(registry({}, { a: { enabled: false, provider: worker('a') }, b: { enabled: false, config: { type: 'jev' } } }));
    await assert.rejects(none.evaluate(request), { code: 'NO_ELIGIBLE_ROUTE' });
    const missing = { config: { type: 'jev' } };
    assert.equal((await createDecisionRouter(registry({}, { b: missing })).evaluate(request)).meta.routing.method, 'single');
    await assert.rejects(createDecisionRouter(registry({}, { b: { ...missing, required: true } })).evaluate(request), { code: 'CONFIGURATION_ERROR' });
    const typed = { state: 'x', questions: { yes: { type: 'choice', instructions: 'Choose', options: [{ value: 'yes' }] } } };
    const eligible = createDecisionRouter(registry({}, { b: { provider: worker('b', input => ({ model: 'b', answers: {
        yes: { type: 'choice', choice: 'yes', probabilities: [{ value: 'yes', probability: 1 }] },
    }, usage: { input_tokens: 1, output_tokens: 0 } }), { typedChoices: true }) } }));
    assert.equal(eligible.inspect(typed).selectedRoute, 'b');
    assert.equal((await eligible.evaluate(typed)).meta.routing.selectedRoute, 'b');
    await assert.rejects(one.evaluate(typed), { code: 'NO_ELIGIBLE_ROUTE' });
});

test('require intersections, preference order, explicit priority, and call narrowing have stable semantics', async () => {
    const rules = [{ effect: 'require', when: { labels: ['restricted'] }, routes: ['b'] },
        { effect: 'prefer', when: { operation: 'decision', questionTypes: ['noul'] }, routes: ['a'] }];
    const router = createDecisionRouter(registry({ rules, priority: ['b'] }));
    assert.equal((await router.evaluate(request)).meta.routing.selectedRoute, 'a');
    assert.equal((await router.evaluate(request, { labels: ['restricted'] })).meta.routing.selectedRoute, 'b');
    await assert.rejects(router.evaluate(request, { labels: ['restricted'], candidates: ['a'] }), { code: 'NO_ELIGIBLE_ROUTE' });
    await assert.rejects(router.evaluate(request, { candidates: ['missing'] }), { code: 'CONFIGURATION_ERROR' });
    await assert.rejects(createDecisionRouter(registry()).evaluate(request), { code: 'ROUTING_AMBIGUOUS' });
    assert.equal((await createDecisionRouter(registry({ priority: ['b'] })).evaluate(request)).meta.routing.method, 'priority');
    const conflicting = createDecisionRouter(registry({ rules: [...rules, { effect: 'require', when: { labels: ['restricted'] }, routes: ['a'] }] }));
    await assert.rejects(conflicting.evaluate(request, { labels: ['restricted'] }), { code: 'NO_ELIGIBLE_ROUTE' });
});

test('inspection is offline and provisional; execution initializes custom targets and prepares once', async () => {
    let initialized = 0; let prepared = 0;
    const router = createDecisionRouter({ ...registry({ priority: ['b'] }, {
        b: { factory: () => { initialized++; return worker('b'); }, kind: 'decision', model: 'b' },
    }), prepare: input => { prepared++; return { ...input, state: 'prepared' }; } });
    const report = router.inspect(request);
    assert.equal(report.outcome, 'unresolved'); assert.equal(report.requiresPreparation, true);
    assert.equal(prepared + initialized, 0);
    assert.equal((await router.evaluate(request)).meta.routing.selectedRoute, 'b');
    await router.evaluate(request);
    assert.equal(prepared, 2); assert.equal(initialized, 1);
    const broken = createDecisionRouter(registry({}, { b: { kind: 'decision', factory: () => { throw Error('secret'); } } }));
    await assert.rejects(broken.evaluate(request), error => error.code === 'CONFIGURATION_ERROR' && !JSON.stringify(error).includes('secret'));
});

test('clarification precedes selection, validates membership, and cannot widen deterministic policy', async () => {
    let prompts = 0;
    const router = createDecisionRouter({ ...registry(), onAmbiguity: question => {
        prompts++; assert(Object.isFrozen(question.candidates)); return { action: 'select', route: 'b' };
    } });
    assert.equal((await router.evaluate(request)).meta.routing.method, 'clarification');
    assert.equal(prompts, 1);
    await assert.rejects(router.evaluate(request, { clarify: false }), { code: 'ROUTING_AMBIGUOUS' });
    await assert.rejects(router.evaluate(request, { onAmbiguity: () => ({ action: 'select', route: 'unknown' }) }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(router.evaluate(request, { onAmbiguity: () => ({ action: 'use-selector' }) }), { code: 'CONFIGURATION_ERROR' });
    await assert.rejects(router.evaluate(request, { onAmbiguity: () => ({ action: 'cancel' }) }), { code: 'ABORTED' });
    await router.evaluate(request, { candidates: ['a'] }); assert.equal(prompts, 1);
});

test('separate budgets exclude human waiting, enforce clarification/overall deadlines and cancellation', async () => {
    const router = createDecisionRouter({ ...registry(), workTimeoutMs: 100, clarificationTimeoutMs: 300,
        onAmbiguity: async () => { await delay(130); return { action: 'select', route: 'a' }; } });
    const result = await router.evaluate(request);
    assert(result.meta.routing.timings.clarificationMs >= 100);
    assert(result.meta.routing.timings.workMs < 100);
    const hanging = createDecisionRouter({ ...registry(), clarificationTimeoutMs: 15, onAmbiguity: () => new Promise(() => {}) });
    await assert.rejects(hanging.evaluate(request), { code: 'CLARIFICATION_TIMEOUT' });
    await assert.rejects(router.evaluate(request, { timeoutMs: 15 }), { code: 'TIMEOUT' });
    const abort = new AbortController(); abort.abort();
    await assert.rejects(router.evaluate(request, { signal: abort.signal }), { code: 'ABORTED' });
    await assert.rejects(createDecisionRouter({ ...registry(), workTimeoutMs: 15, prepare: () => new Promise(() => {}) }).evaluate(request), { code: 'TIMEOUT' });
});

test('array batches prepare every request before inference and serialize per-request clarification', async () => {
    const events = [];
    const router = createDecisionRouter({ ...registry({}, { a: { provider: worker('a', async input => {
        events.push('execute-' + input.state); return worker('a').evaluate(input);
    }) } }), prepare: input => { events.push('prepare-' + input.state); return input; },
    onAmbiguity: async () => { const i = events.filter(x => x === 'prompt').length; events.push('prompt'); await delay(10); events.push('answer-' + i); return { action: 'select', route: 'a' }; } });
    const results = await evaluateRoutedBatch(router, [{ ...request, state: '0' }, { ...request, state: '1' }]);
    assert(results.every(row => row.ok));
    assert.deepEqual(events.slice(0, 2), ['prepare-0', 'prepare-1']);
    assert(events.indexOf('answer-0') < events.lastIndexOf('prompt'));
    events.length = 0;
    await assert.rejects(evaluateRoutedBatch(router, [request, { state: 'bad' }]), { code: 'VALIDATION_ERROR' });
    assert(!events.some(x => x.startsWith('execute')));
});

test('failover only replays typed capacity/rate failures, retains prepared input and bounds distinct attempts', async () => {
    const seen = []; let prepares = 0;
    const router = createDecisionRouter({ ...registry({ priority: ['a'], failover: { routes: ['b'], maxAttempts: 2 }, cooldown: { durationMs: 1000 } }, {
        a: { singleDispatch: true, provider: worker('a', () => { seen.push('a'); throw new DecisionError('Busy', { code: 'CAPACITY_EXCEEDED', retryAfterMs: 1000 }); }) },
        b: { singleDispatch: true, provider: worker('b', input => { seen.push(input.state); return worker('b').evaluate(input); }) },
    }), prepare: input => { prepares++; return { ...input, state: 'prepared' }; } });
    const result = await router.evaluate(request);
    assert.deepEqual(seen, ['a', 'prepared']); assert.equal(prepares, 1);
    assert.equal(result.meta.routing.method, 'failover'); assert.equal(result.meta.routing.attempts.length, 2);
    assert.equal(router.inspect(request).routes[0].status, 'cooldown');
    await assert.rejects(router.evaluate(request, { route: 'a' }), { code: 'CAPACITY_EXCEEDED' });
    for (const code of ['TIMEOUT', 'NETWORK_ERROR', 'HTTP_ERROR', 'MODEL_REFUSAL', 'INVALID_RESPONSE', 'ALLOCATION_EXCEEDED', 'ABORTED']) {
        let fallback = 0;
        const r = createDecisionRouter(registry({ priority: ['a'], failover: { routes: ['b'] } }, {
            a: { singleDispatch: true, provider: worker('a', () => { throw new DecisionError('failure', { code }); }) },
            b: { singleDispatch: true, provider: worker('b', () => { fallback++; }) },
        }));
        await assert.rejects(r.evaluate(request), { code }); assert.equal(fallback, 0);
    }
    assert.throws(() => createDecisionRouter(registry({ failover: { routes: ['b'] } })), { code: 'CONFIGURATION_ERROR' });
});

test('canonical aliases, duplicate native targets, extraction operation and observer isolation', async () => {
    const alias = createDecisionRouter({ routes: { native: { config: { type: 'openai-decisions', apiKey: 'test', model: 'default' } } }, defaultRoute: 'native' });
    assert.equal(alias.inspect({ ...request, model: 'gpt-6-luna' }).outcome, 'selected');
    assert.throws(() => createDecisionRouter({ routes: { a: { config: { type: 'openai-decisions', apiKey: 'test', model: 'default' } },
        b: { config: { type: 'openai-decisions', apiKey: 'test', model: 'luna' } } } }), { code: 'CONFIGURATION_ERROR' });
    const extraction = createExtractionRouter({ defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['text', 'decision'] }, decision: { provider: worker('d') },
        text: { config: { type: 'cloudflare-extraction', apiKey: 'test', accountId: 'account', fetchImpl: async () => jsonResponse({ success: true, result: {
            model: 'clairic', answers: { total: { type: 'number', value: 12 } }, truncated: false, usage: { input_tokens: 3, output_tokens: 1 },
        } }) } },
    }, onResult: () => { throw Error('observer'); } });
    const input = { state: 'total 12', fields: { total: { type: 'number' } } };
    const result = await extraction.extract(input);
    assert.equal(result.extraction.answers.total.value, 12); assert.equal(result.meta.routing.observerFailed, true);
    assert.equal(result.meta.routing.selectedRoute, 'text');
    assert((await extractRoutedBatch(extraction, [input]))[0].ok);
});
