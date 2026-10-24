import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionRouter, evaluateRoutedBatch } from '../src/routing/index.mjs';
import { OpenAIDecisionsProvider } from '../src/providers/openai-decisions.mjs';
import { DecisionError } from '../src/errors.mjs';
import { routingRequest as request, worker, registry, delay } from './routing-fixtures.mjs';
import { image, decisionResponse } from './decisions-fixtures.mjs';
import { jsonResponse } from './fixtures.mjs';

test('native eligibility uses actual media order, opt-ins and wire-size budgets without dispatch', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw Error('must not dispatch'); };
    const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['cf', 'jev', 'openai'] },
        cf: { config: { type: 'cloudflare-decisions', accountId: 'account', apiKey: 'test', fetchImpl } },
        jev: { config: { type: 'jev', apiKey: 'test', fetchImpl } },
        openai: { config: { type: 'openai-decisions', apiKey: 'test', fetchImpl } },
    } });
    const ordered = { input: [{ type: 'text', text: 'before image' }, { type: 'image', dataUrl: image }], questions: request.questions };
    assert.equal(router.inspect(ordered).selectedRoute, 'openai');
    assert.equal(router.inspect({ input: [{ type: 'image', url: 'https://example.com/image.png' }], questions: request.questions }).selectedRoute, 'openai');
    assert.equal(calls, 0);
    const tooLarge = createDecisionRouter({ defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['cf'] },
        cf: { config: { type: 'cloudflare-decisions', accountId: 'account', apiKey: 'test', maxRequestBytes: 10, fetchImpl } },
    } });
    await assert.rejects(tooLarge.evaluate(request), { code: 'NO_ELIGIBLE_ROUTE' }); assert.equal(calls, 0);
});

test('supplied native aliases and missing environment values match descriptor behavior', () => {
    const provider = new OpenAIDecisionsProvider({ apiKey: 'test', model: 'default' });
    const router = createDecisionRouter({ defaultRoute: 'native', routes: { native: { provider } } });
    assert.equal(router.inspect({ ...request, model: 'luna' }).outcome, 'selected');
    const unavailable = createDecisionRouter({ defaultRoute: 'native', routes: { native: { config: { type: 'jev', apiKey: undefined } } } });
    assert.equal(unavailable.inspect(request).outcome, 'impossible');
    const account = createDecisionRouter({ defaultRoute: 'native', routes: { native: { config: {
        type: 'cloudflare-decisions', apiKey: 'test', baseURL: 'https://example.com',
    } } } });
    assert.equal(account.inspect(request).routes[0].status, 'unavailable');
    assert.throws(() => createDecisionRouter({ routes: { native: { config: {
        type: 'openai-decisions', apiKey: 'test', baseURL: 'https://example.com/path',
    } } } }), { code: 'CONFIGURATION_ERROR' });
});

test('input is snapshotted synchronously and preparation can change hard-rule facts', async () => {
    const input = structuredClone(request);
    const seen = [];
    const router = createDecisionRouter({ ...registry({ priority: ['a'] }, {
        a: { provider: worker('a', value => { seen.push(value.state); return worker('a').evaluate(value); }) },
    }) });
    const pending = router.evaluate(input);
    input.state = 'changed'; await pending; assert.deepEqual(seen, ['test task']);
    const prepared = createDecisionRouter({ ...registry({ rules: [
        { effect: 'require', when: { modalities: ['text'] }, routes: ['b'] },
    ] }), prepare: value => value });
    assert.equal(prepared.inspect(request).outcome, 'unresolved');
    assert.deepEqual(prepared.inspect(request).provisional, ['a', 'b']);
    assert.equal((await prepared.evaluate(request)).meta.routing.selectedRoute, 'b');
});

test('modality rules inspect conversation payloads and do not invent text for image-only messages', async () => {
    const capabilities = { orderedInput: true, conversation: true, toolHistory: true, images: true, maxImages: null };
    const router = createDecisionRouter(registry({ priority: ['b'], rules: [
        { effect: 'require', when: { modalities: ['text'] }, routes: ['a'] },
    ] }, { a: { provider: worker('a', undefined, capabilities) }, b: { provider: worker('b', undefined, capabilities) } }));
    const imagePart = { type: 'input_image', image_url: image };
    for (const input of [{ input: [{ type: 'image', dataUrl: image }] },
        { conversation: [{ role: 'user', content: [imagePart] }] }]) {
        const value = { ...input, questions: request.questions };
        assert.equal(router.inspect(value).selectedRoute, 'b');
        assert.equal((await router.evaluate(value)).meta.routing.selectedRoute, 'b');
    }
    for (const conversation of [
        [{ role: 'user', content: 'task' }],
        [{ role: 'user', content: [imagePart, { type: 'input_text', text: 'task' }] }],
        [{ role: 'assistant', content: [{ type: 'output_text', text: 'response' }] }],
        [{ role: 'assistant', content: [{ type: 'refusal', refusal: 'declined' }] }],
        [{ type: 'function_call', call_id: '1', name: 'lookup', arguments: '{}' },
            { type: 'function_call_output', call_id: '1', output: [imagePart] }],
        [{ type: 'custom_tool_call', call_id: '1', name: 'lookup', input: 'query' },
            { type: 'custom_tool_call_output', call_id: '1', output: 'result' }],
    ]) {
        const value = { conversation, questions: request.questions };
        assert.equal(router.inspect(value).selectedRoute, 'a');
        assert.equal((await router.evaluate(value)).meta.routing.selectedRoute, 'a');
    }
});

test('concurrent cooldown invalidation is rechecked after clarification and can recover without a second prompt', async () => {
    let release; let started;
    const promptStarted = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let calls = 0;
    const router = createDecisionRouter(registry({ cooldown: { durationMs: 10000 }, failover: { routes: ['b'] } }, {
        a: { singleDispatch: true, provider: worker('a', () => { calls++; throw new DecisionError('busy', { code: 'RATE_LIMITED' }); }) },
        b: { singleDispatch: true, provider: worker('b') },
    }));
    const waiting = router.evaluate(request, { onAmbiguity: async () => { started(); await gate; return { action: 'select', route: 'a' }; } });
    await promptStarted;
    await assert.rejects(router.evaluate(request, { candidates: ['a'] }), { code: 'RATE_LIMITED' });
    release();
    const result = await waiting;
    assert.equal(calls, 1); assert.equal(result.meta.routing.selectedRoute, 'b');
    assert.deepEqual(result.meta.routing.attempts.map(attempt => attempt.route), ['b']);
});

test('all cooling targets fail promptly with retry hints, while direct routes remain explicit', async () => {
    let calls = 0;
    const router = createDecisionRouter(registry({ candidates: ['a'], cooldown: { durationMs: 10000 } }, {
        a: { provider: worker('a', () => { calls++; throw new DecisionError('busy', { code: 'CAPACITY_EXCEEDED' }); }) },
    }));
    await assert.rejects(router.evaluate(request), { code: 'CAPACITY_EXCEEDED' });
    await assert.rejects(router.evaluate(request), error => error.code === 'ROUTE_UNAVAILABLE' && error.retryAfterMs > 0);
    assert.equal(calls, 1);
    await assert.rejects(router.evaluate(request, { route: 'a' }), { code: 'CAPACITY_EXCEEDED' }); assert.equal(calls, 2);
});

test('array total timeout includes preflight queue and queued clarification aborts without dispatch', async () => {
    let calls = 0;
    const router = createDecisionRouter({ ...registry({ candidates: ['a'] }, {
        a: { provider: worker('a', () => { calls++; }) },
    }), prepare: async input => { await delay(30); return input; } });
    await assert.rejects(evaluateRoutedBatch(router, [request, request], { timeoutMs: 45 }), { code: 'TIMEOUT' });
    assert.equal(calls, 0);
    const abort = new AbortController(); let prompts = 0;
    const queued = createDecisionRouter({ ...registry(), onAmbiguity: async () => {
        prompts++; abort.abort(); return { action: 'select', route: 'a' };
    } });
    const records = await evaluateRoutedBatch(queued, [request, request], { signal: abort.signal });
    assert(records.every(row => !row.ok && row.error.code === 'ABORTED')); assert.equal(prompts, 1);
});

test('named cooldown groups share only with explicitly grouped routes, preserving unrelated fallbacks', async () => {
    const router = createDecisionRouter(registry({ candidates: ['a', 'b', 'c'], priority: ['a'],
        cooldown: { durationMs: 10000 }, failover: { routes: ['b', 'c'] } }, {
        a: { cooldownGroup: 'b', singleDispatch: true, provider: worker('a', () => {
            throw new DecisionError('busy', { code: 'RATE_LIMITED' });
        }) },
        b: { singleDispatch: true, provider: worker('b') },
        c: { cooldownGroup: 'b', singleDispatch: true, provider: worker('c') },
    }));
    const result = await router.evaluate(request);
    assert.equal(result.meta.routing.selectedRoute, 'b');
    assert.deepEqual(result.meta.routing.attempts.map(attempt => attempt.route), ['a', 'b']);
    assert.deepEqual(router.inspect(request).routes.map(({ id, status }) => [id, status]),
        [['a', 'cooldown'], ['b', 'eligible'], ['c', 'cooldown']]);
});

test('cooldowns cannot turn a model or capability mismatch into a temporary failure', async () => {
    let calls = 0;
    const router = createDecisionRouter(registry({ candidates: ['a'], cooldown: { durationMs: 10000 } }, {
        a: { provider: worker('a', () => { calls++; throw new DecisionError('busy', { code: 'RATE_LIMITED' }); }) },
    }));
    await assert.rejects(router.evaluate(request), { code: 'RATE_LIMITED' });
    const incompatible = [{ ...request, model: 'other' }, { state: 'task', questions: {
        choice: { type: 'choice', instructions: 'Choose', options: [{ value: true }, { value: false }] },
    } }];
    for (const input of incompatible) {
        assert.equal(router.inspect(input).routes[0].status, 'unsupported');
        await assert.rejects(router.evaluate(input), error => error.code === 'NO_ELIGIBLE_ROUTE' && error.retryAfterMs === undefined);
    }
    await assert.rejects(router.evaluate(request), error => error.code === 'ROUTE_UNAVAILABLE' && error.retryAfterMs > 0);
    assert.equal(calls, 1);
});

test('lazy native aliases remain provisional until initialization and match warm direct/auto behavior', async () => {
    for (const route of ['native', 'auto']) {
        let initialized = 0; let calls = 0;
        const router = createDecisionRouter({ defaultRoute: route, routes: {
            auto: { policy: 'deterministic', candidates: ['native', 'off'] },
            native: { kind: 'decision', model: 'default', factory: () => {
                initialized++;
                return new OpenAIDecisionsProvider({ apiKey: 'fixture', model: 'default', fetchImpl: async (_, init) => {
                    calls++; return jsonResponse(decisionResponse(JSON.parse(init.body)));
                } });
            } },
            off: { enabled: false, kind: 'decision', model: 'other', factory: () => { throw Error('Disabled factory must not initialize'); } },
        } });
        const input = { ...request, model: 'luna' };
        assert.equal(router.inspect(input).outcome, 'unresolved');
        assert.equal(initialized, 0);
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = await router.evaluate(input);
            assert.equal(result.meta.routing.selectedRoute, 'native');
            assert.equal(result.meta.requestedModel, 'luna');
        }
        assert.equal(initialized, 1); assert.equal(calls, 2);
        assert.equal(router.inspect(input).outcome, 'selected');
    }
    let initialized = 0; let calls = 0;
    const incompatible = createDecisionRouter({ defaultRoute: 'custom', routes: {
        custom: { kind: 'decision', model: 'a', factory: () => {
            initialized++; return worker('a', () => { calls++; });
        } },
    } });
    assert.equal(incompatible.inspect({ ...request, model: 'b' }).outcome, 'unresolved');
    await assert.rejects(incompatible.evaluate({ ...request, model: 'b' }), { code: 'NO_ELIGIBLE_ROUTE' });
    assert.equal(initialized, 1); assert.equal(calls, 0);
});

test('execution preflight consumes the work budget before any inference', async t => {
    let now = 0; let slowPreflight = false; let calls = 0;
    t.mock.method(performance, 'now', () => now);
    const router = createDecisionRouter({ ...registry({}, {
        a: { provider: { ...worker('a', () => { calls++; }), validateRequest() {
            if (slowPreflight) { slowPreflight = false; now += 100; }
        } } },
    }), workTimeoutMs: 50, onAmbiguity: () => {
        // Arm only after preparation/selection, when execution must recheck eligibility.
        slowPreflight = true; return { action: 'select', route: 'a' };
    } });
    await assert.rejects(router.evaluate(request), error => {
        assert.equal(error.code, 'TIMEOUT');
        assert.equal(error.routing.timings.workMs, 100);
        assert.deepEqual(error.routing.attempts, []);
        return true;
    });
    assert.equal(calls, 0);
});

test('recovery preflight uses the remaining work budget only when another attempt is permitted', async t => {
    let now = 0;
    t.mock.method(performance, 'now', () => now);
    for (const maxAttempts of [1, 2]) {
        now = 0;
        let slowPreflight = false;
        const calls = [];
        const router = createDecisionRouter({ ...registry({ priority: ['a'], failover: { routes: ['b'], maxAttempts } }, {
            a: { singleDispatch: true, provider: worker('a', () => {
                calls.push('a'); slowPreflight = true;
                throw new DecisionError('busy', { code: 'RATE_LIMITED' });
            }) },
            b: { singleDispatch: true, provider: { ...worker('b', () => { calls.push('b'); }), validateRequest() {
                if (slowPreflight) { slowPreflight = false; now += 100; }
            } } },
        }), workTimeoutMs: 50 });
        await assert.rejects(router.evaluate(request), error => {
            assert.equal(error.code, maxAttempts === 1 ? 'RATE_LIMITED' : 'TIMEOUT');
            assert.equal(error.routing.attempts.length, 1);
            assert.equal(error.routing.attempts[0].code, 'RATE_LIMITED');
            return true;
        });
        assert.deepEqual(calls, ['a']);
        assert.equal(now, maxAttempts === 1 ? 0 : 100);
    }
});
