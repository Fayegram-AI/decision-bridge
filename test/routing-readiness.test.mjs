// Cooldown expiry can expose factories that earlier preflight deliberately skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionRouter, evaluateRoutedBatch } from '../src/routing/index.mjs';
import { DecisionError } from '../src/errors.mjs';
import { worker, selector, routingRequest as request } from './routing-fixtures.mjs';

test('preparation initializes candidates exposed by cooldown expiry and verifies their capabilities', async t => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    for (const supported of [true, false]) {
        let initialized = 0;
        const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
            auto: { policy: 'deterministic', candidates: ['a', 'b', 'c'], priority: ['b', 'c'], cooldown: { durationMs: 10 } },
            a: { cooldownGroup: 'shared', provider: worker('a', () => {
                throw new DecisionError('busy', { code: 'RATE_LIMITED' });
            }) },
            b: { cooldownGroup: 'shared', kind: 'decision', model: 'b', factory: () => {
                initialized++; return worker('b', undefined, { supported });
            } },
            c: { kind: 'decision', model: 'c', factory: () => { now += 100; return worker('c'); } },
        } });
        await assert.rejects(router.evaluate(request, { candidates: ['a'] }), { code: 'RATE_LIMITED' });
        const result = await router.evaluate(request);
        assert.equal(initialized, 1);
        assert.equal(result.meta.routing.selectedRoute, supported ? 'b' : 'c');
        assert.equal(result.meta.routing.candidates.find(item => item.id === 'b').status, supported ? 'eligible' : 'unsupported');
        assert.equal(router.inspect(request).outcome, 'selected');
    }
});

test('batch selection initializes lazy candidates whose shared cooldown expired after preparation', async t => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    for (const policy of ['deterministic', 'decision-assisted']) {
        let initialized = 0;
        let selectorCalls = 0;
        const calls = [];
        const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
            auto: { policy, candidates: ['a', 'b', 'c'], priority: ['b', 'c'], cooldown: { durationMs: 10 },
                ...(policy === 'decision-assisted' ? { selector: {
                    route: 'judge', when: 'multiple', minProbability: 0.6, minMargin: 0.1,
                } } : {}) },
            a: { cooldownGroup: 'shared', provider: worker('a', () => {
                throw new DecisionError('busy', { code: 'RATE_LIMITED' });
            }) },
            b: { cooldownGroup: 'shared', kind: 'decision', model: 'b', factory: () => {
                initialized++; return worker('b', input => { calls.push('b'); return worker('b').evaluate(input); });
            } },
            c: { provider: worker('c', input => { calls.push('c'); return worker('c').evaluate(input); }) },
            judge: { provider: selector(input => {
                selectorCalls++;
                assert.deepEqual(JSON.parse(input.state).candidates.map(item => item.route), ['a', 'b', 'c']);
                return { model: 'selector', answers: { route: { type: 'choice', choice: 'r1',
                    probabilities: { r0: 0, r1: 1, r2: 0, abstain: 0 } } }, usage: { input_tokens: 5, output_tokens: 1 } };
            }) },
        }, onResult: result => { if (result.meta.routing.selectedRoute === 'c') now += 100; } });
        await assert.rejects(router.evaluate(request, { candidates: ['a'] }), { code: 'RATE_LIMITED' });
        const rows = await evaluateRoutedBatch(router, [request, request], { concurrency: 1 });
        assert(rows.every(row => row.ok));
        assert.deepEqual(rows.map(row => row.result.meta.routing.selectedRoute), ['c', 'b']);
        assert.deepEqual(calls, ['c', 'b']);
        assert.equal(initialized, 1);
        assert.equal(selectorCalls, policy === 'decision-assisted' ? 1 : 0);
    }
});

test('failover initializes a newly available lazy fallback without spending an execution attempt on preflight', async t => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    let initialized = 0;
    const calls = [];
    const router = createDecisionRouter({ defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['a', 'b', 'c'], priority: ['c'], cooldown: { durationMs: 10 },
            failover: { routes: ['b'], maxAttempts: 2 } },
        a: { cooldownGroup: 'shared', singleDispatch: true, provider: worker('a', () => {
            throw new DecisionError('busy', { code: 'RATE_LIMITED' });
        }) },
        b: { cooldownGroup: 'shared', singleDispatch: true, kind: 'decision', model: 'b', factory: () => {
            initialized++; return worker('b', input => { calls.push('b'); return worker('b').evaluate(input); });
        } },
        c: { singleDispatch: true, provider: worker('c', () => {
            calls.push('c'); now += 100; throw new DecisionError('busy', { code: 'CAPACITY_EXCEEDED' });
        }) },
    } });
    await assert.rejects(router.evaluate(request, { candidates: ['a'] }), { code: 'RATE_LIMITED' });
    const result = await router.evaluate(request);
    assert.equal(result.meta.routing.selectedRoute, 'b');
    assert.equal(result.meta.routing.method, 'failover');
    assert.deepEqual(result.meta.routing.attempts.map(attempt => [attempt.route, attempt.status]), [['c', 'failed'], ['b', 'succeeded']]);
    assert.deepEqual(calls, ['c', 'b']);
    assert.equal(initialized, 1);
});

test('initializing a newly eligible candidate is bounded by the remaining work budget', async t => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    let factorySignal;
    let calls = 0;
    const router = createDecisionRouter({ defaultRoute: 'auto', workTimeoutMs: 100, routes: {
        auto: { policy: 'deterministic', candidates: ['a', 'b', 'c'], priority: ['b', 'c'], cooldown: { durationMs: 10 } },
        a: { cooldownGroup: 'shared', provider: worker('a', () => {
            throw new DecisionError('busy', { code: 'RATE_LIMITED' });
        }) },
        b: { cooldownGroup: 'shared', kind: 'decision', model: 'b', factory: ({ signal }) => {
            factorySignal = signal; return new Promise(() => {});
        } },
        c: { provider: worker('c', input => { calls++; return worker('c').evaluate(input); }) },
    }, onResult: () => { now += 100; } });
    await assert.rejects(router.evaluate(request, { candidates: ['a'] }), { code: 'RATE_LIMITED' });
    const rows = await evaluateRoutedBatch(router, [request, request], { concurrency: 1 });
    assert.equal(rows[0].ok, true);
    assert.equal(rows[1].ok, false);
    assert.equal(rows[1].error.code, 'TIMEOUT');
    assert.deepEqual(rows[1].error.routing.attempts, []);
    assert.equal(calls, 1);
    assert.equal(factorySignal.aborted, true);
});
