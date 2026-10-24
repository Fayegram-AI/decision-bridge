// SDK arrays are completely prepared and preflighted before any router model call.
import { optionsObject } from '../options.mjs';
import { cloneJson } from '../validation.mjs';
import { requireCondition as check, publicError } from '../errors.mjs';
import { routerInternals } from './router.mjs';
import { clarificationGate } from './budget.mjs';

export async function routedBatch(router, inputs, options, operation) {
    const { concurrency = 4, stopOnError = false, ...routingCall } = optionsObject(options,
        ['concurrency', 'stopOnError', 'route', 'candidates', 'labels', 'routingDescription', 'onAmbiguity', 'clarify', 'signal', 'timeoutMs'], 'Routed batch options');
    const runtime = routerInternals.get(router);
    check(runtime?.operation === operation, 'A matching router is required.', 'CONFIGURATION_ERROR');
    check(Array.isArray(inputs) && inputs.length <= 10000, 'inputs must be an array of at most 10000 requests.');
    check(Number.isSafeInteger(concurrency) && concurrency > 0 && concurrency <= 64, 'Invalid batch concurrency.', 'CONFIGURATION_ERROR');
    check(typeof stopOnError === 'boolean', 'stopOnError must be boolean.', 'CONFIGURATION_ERROR');
    // Snapshot shared constraints before the first row can yield to preparation.
    const call = runtime.callOptions(routingCall);
    const requests = cloneJson(inputs, 'batch requests');
    const startedAt = performance.now();
    const gate = clarificationGate();
    const tickets = [];
    const records = new Array(requests.length);
    try {
        // Sequential preparation gives deterministic extension side effects. Model execution remains concurrent.
        for (let index = 0; index < requests.length; index++) tickets.push(await runtime.prepare(requests[index], call,
            { startedAt, wait: () => gate.wait(index), done: () => gate.done(index) }));
        let next = 0;
        let stopped = false;
        async function worker() {
            while (next < tickets.length) {
                const index = next++;
                if (call.signal?.aborted || stopped) {
                    gate.done(index);
                    records[index] = { index, ok: false, error: { code: call.signal?.aborted ? 'ABORTED' : 'BATCH_SKIPPED', message: 'Request skipped before dispatch.' } };
                    continue;
                }
                try { records[index] = { index, ok: true, result: await runtime.execute(tickets[index]) }; }
                catch (error) { records[index] = { index, ok: false, error: publicError(error) }; if (stopOnError) stopped = true; }
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, tickets.length) }, worker));
        return records;
    } finally { for (const ticket of tickets) ticket.budget.close(); }
}
