// Batch invariants across asynchronous preparation and per-request selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionRouter, evaluateRoutedBatch } from '../src/routing/index.mjs';
import { DecisionError } from '../src/errors.mjs';
import { registry, worker, selector, routingRequest as request } from './routing-fixtures.mjs';

test('routed batches snapshot candidate and label constraints before asynchronous preparation', async () => {
    const router = createDecisionRouter(registry({ priority: ['a'], rules: [
        { effect: 'require', when: { labels: ['restricted'] }, routes: ['b'] },
    ] }));
    const candidates = ['a'];
    const first = evaluateRoutedBatch(router, [request, request], { candidates });
    candidates[0] = 'b';
    assert.deepEqual((await first).map(row => row.result?.meta.routing.selectedRoute), ['a', 'a']);

    const labels = ['restricted'];
    const second = evaluateRoutedBatch(router, [request, request], { labels });
    labels.length = 0;
    assert.deepEqual((await second).map(row => row.result?.meta.routing.selectedRoute), ['b', 'b']);
});

test('queued batch rows select from current cooldown eligibility before local or model selection', async () => {
    for (const candidates of [['a'], ['a', 'b']]) for (const policy of ['deterministic', 'decision-assisted']) {
        let selectorCalls = 0;
        const calls = [];
        const router = createDecisionRouter(registry({ policy, candidates, priority: ['a'], cooldown: { durationMs: 60000 },
            ...(policy === 'decision-assisted' ? { selector: {
                route: 'judge', when: 'multiple', minProbability: 0.6, minMargin: 0.1,
            } } : {}),
        }, {
            a: { provider: worker('a', () => {
                calls.push('a'); throw new DecisionError('busy', { code: 'RATE_LIMITED' });
            }) },
            b: { provider: worker('b', input => { calls.push('b'); return worker('b').evaluate(input); }) },
            judge: { provider: selector(input => { selectorCalls++; return selector().evaluate(input); }) },
        }));
        const rows = await evaluateRoutedBatch(router, [request, request], { concurrency: 1 });
        assert.equal(rows[0].ok, false); assert.equal(rows[0].error.code, 'RATE_LIMITED');
        if (candidates.length === 1) {
            assert.equal(rows[1].ok, false); assert.equal(rows[1].error.code, 'ROUTE_UNAVAILABLE');
            assert(rows[1].error.retryAfterMs > 0);
            assert.deepEqual(rows[1].error.routing.attempts, []);
            assert.deepEqual(calls, ['a']); assert.equal(selectorCalls, 0);
            continue;
        }
        assert.equal(rows[1].ok, true);
        assert.equal(rows[1].result.meta.routing.selectedRoute, 'b');
        assert.equal(rows[1].result.meta.routing.method, 'single');
        assert.equal(rows[1].result.meta.routing.selector, undefined);
        assert.deepEqual(rows[1].result.meta.routing.candidates,
            [{ id: 'a', status: 'cooldown' }, { id: 'b', status: 'eligible' }]);
        assert.deepEqual(calls, ['a', 'b']);
        assert.equal(selectorCalls, policy === 'decision-assisted' ? 1 : 0);
    }
});

test('clarification admission reapplies local policy while preserving explicit multiple-candidate selection', async t => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    for (const scenario of [
        { policy: 'deterministic', method: 'priority' },
        { policy: 'deterministic', method: 'rule' },
        { policy: 'decision-assisted', when: 'ambiguous', method: 'priority' },
        { policy: 'decision-assisted', when: 'multiple', method: 'selector' },
    ]) {
        let firstA = true;
        let prompts = 0;
        let selectorCalls = 0;
        const calls = [];
        const router = createDecisionRouter({ ...registry({ policy: scenario.policy, candidates: ['a', 'b', 'c'],
            ...(scenario.method === 'rule' ? { rules: [{ effect: 'prefer', when: { operation: 'decision' }, routes: ['a'] }] }
                : { priority: ['a'] }),
            cooldown: { durationMs: 10 },
            ...(scenario.when ? { selector: { route: 'judge', when: scenario.when, minProbability: 0.6, minMargin: 0.1 } } : {}),
        }, {
            a: { provider: worker('a', input => {
                if (firstA) { firstA = false; throw new DecisionError('busy', { code: 'RATE_LIMITED' }); }
                calls.push('a'); return worker('a').evaluate(input);
            }) },
            b: { provider: worker('b', input => { calls.push('b'); return worker('b').evaluate(input); }) },
            c: { provider: worker('c') },
            judge: { provider: selector(input => { selectorCalls++; return selector().evaluate(input); }) },
        }), onAmbiguity: async () => {
            prompts++;
            if (prompts === 1) {
                // Let the other worker join admission before the preferred route recovers.
                await new Promise(resolve => setImmediate(resolve));
                now += 100;
                return { action: 'select', route: 'b' };
            }
            return scenario.when === 'multiple' ? { action: 'use-selector' } : { action: 'select', route: 'b' };
        } });
        await assert.rejects(router.evaluate(request, { candidates: ['a'] }), { code: 'RATE_LIMITED' });
        const rows = await evaluateRoutedBatch(router, [request, request], { concurrency: 2 });
        assert(rows.every(row => row.ok));
        assert.deepEqual(rows.map(row => row.result.meta.routing.selectedRoute), ['b', 'a']);
        assert.deepEqual(rows.map(row => row.result.meta.routing.method), ['clarification', scenario.method]);
        assert.deepEqual(calls.sort(), ['a', 'b']);
        assert.equal(prompts, scenario.when === 'multiple' ? 2 : 1);
        assert.equal(selectorCalls, scenario.when === 'multiple' ? 1 : 0);
    }
});
