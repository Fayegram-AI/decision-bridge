import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveDecisions, validateLiveCommand, validateLiveConfiguration, validateLiveEvent } from '../src/live/index.mjs';
import { decisionResponse } from './decisions-fixtures.mjs';

const questions = [{ type: 'predicate', name: 'q', instructions: 'True?' }];
const config = { delegation: { type: 'decisions', decisions: { model: 'gpt-6-luna', questions } },
    triggers: ['session.input_transcript.delta', 'session.output_transcript.delta'].map(event_type =>
        ({ type: 'decisions', event_type, decisions: { questions } })) };
function fixture(options = {}) {
    let listener;
    let detached = false;
    const sent = [];
    const events = [];
    const controller = createLiveDecisions({ ...options, transport: {
        subscribe(fn) { listener = fn; return () => { detached = true; }; },
        send(command) { sent.push(command); },
    } });
    controller.subscribe(event => events.push(event));
    return { controller, sent, events, emit(event) { listener({ kind: 'event', event }); },
        close() { listener({ kind: 'close' }); }, get detached() { return detached; } };
}
const delta = (id, type = 'session.input_transcript.delta') => ({ type, event_id: id, delta: 'word', start_ms: 0, end_ms: 1 });
const completed = (id, source, type = 'session.input_transcript.delta', decision = decisionResponse({ model: 'gpt-6-luna', questions })) => ({
    type: 'decision.event', event_id: id, delegation_id: null, trigger_id: 'trigger', source_event_id: source,
    source_event_type: type, event: { type: 'decision.completed', decision },
});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Live configuration/items resolve only from matching acknowledgements; manual calls return receipts', async () => {
    const f = fixture();
    try {
        const configured = f.controller.configure(config); await tick();
        f.emit({ type: 'session.updated', event_id: 'ack', client_event_id: f.sent[0].event_id, session: config });
        assert.equal((await configured).type, 'configuration');
        const created = f.controller.createItem({ role: 'user', content: 'Evidence' }); await tick();
        f.emit({ type: 'decision.item.created', event_id: 'created', client_event_id: f.sent[1].event_id,
            item: { role: 'user', content: 'Evidence', id: 'item' } });
        assert.equal((await created).item.id, 'item');
        const deleted = f.controller.deleteItem('item'); await tick();
        f.emit({ type: 'decision.item.deleted', event_id: 'deleted', client_event_id: f.sent[2].event_id, item_id: 'item' });
        assert.equal((await deleted).itemId, 'item');
        assert.equal((await f.controller.requestDecision()).status, 'submitted');
        assert.equal((await f.controller.appendCommentary('Done.', { delegationId: 'delegation' })).status, 'submitted');
        assert.equal(new Set(f.sent.map(command => command.event_id)).size, 5);
    } finally { f.controller.dispose(); }
    assert.equal(f.detached, true);
});

test('Live results track both directions, stale/duplicate events and unmatched sources', () => {
    const f = fixture({ configuration: config });
    try {
        f.emit(delta('one')); f.emit(delta('two')); f.emit(delta('output', 'session.output_transcript.delta'));
        f.emit(completed('new', 'two')); f.emit(completed('old', 'one'));
        f.emit(completed('out', 'output', 'session.output_transcript.delta'));
        f.emit(completed('out', 'output', 'session.output_transcript.delta'));
        f.emit(completed('missing', 'unseen'));
        const decisions = f.events.filter(event => event.type === 'decision');
        assert.deepEqual(decisions.map(event => [event.correlation.matched, event.correlation.stale]),
            [[true, false], [true, true], [true, false], [false, false]]);
        assert(f.events.some(event => event.type === 'duplicate'));
    } finally { f.controller.dispose(); }
});

test('in-flight configuration and late results never acquire the wrong question snapshot', async () => {
    const f = fixture({ configuration: config, timeoutMs: 30 });
    try {
        const configuring = f.controller.configure({ triggers: [] });
        const rejected = assert.rejects(configuring, { code: 'TIMEOUT' });
        await tick(); f.emit(delta('during'));
        await rejected;
        f.emit(completed('late', 'during'));
        assert.equal(f.events.at(-1).correlation.matched, false);
        f.emit({ type: 'session.updated', event_id: 'late-ack', client_event_id: f.sent[0].event_id, session: { triggers: [] } });
        f.emit(delta('disabled')); f.emit(completed('after', 'disabled'));
        assert.equal(f.events.at(-1).correlation.matched, false);
    } finally { f.controller.dispose(); }
});

test('native refusals and delegation results remain observable without another inference', () => {
    const f = fixture({ configuration: config });
    try {
        f.emit({ type: 'session.delegation.created', event_id: 'delegated', delegation: { id: 'd', target: 'decisions', type: 'delegation' }, offset_ms: 0 });
        const decision = decisionResponse({ model: 'gpt-6-luna', questions });
        decision.answers = [{ type: 'refusal', name: 'q' }];
        f.emit({ ...completed('done', null, null, decision), delegation_id: 'd', trigger_id: null });
        assert.equal(f.events.at(-1).decision.answers[0].type, 'refusal');
        assert.equal(f.events.at(-1).correlation.matched, true);
        assert.equal(f.sent.length, 0);
    } finally { f.controller.dispose(); }
});

test('Live errors are safe, observers are isolated and connection closure rejects pending work', async () => {
    const f = fixture();
    f.controller.subscribe(() => { throw Error('private observer'); });
    const created = f.controller.createItem({ role: 'user', content: '' }); await tick();
    f.emit({ type: 'error', event_id: 'err', error: { code: 'unknown_parameter', type: 'invalid_request_error',
        message: 'private credentials', client_event_id: f.sent[0].event_id } });
    await assert.rejects(created, error => !JSON.stringify(error).includes('private'));
    assert.equal(f.events.find(event => event.type === 'error').error.status, undefined);
    assert(f.events.some(event => event.type === 'observer_error'));
    const pending = f.controller.configure(config); await tick(); f.close();
    await assert.rejects(pending, { code: 'CONNECTION_CLOSED' });
    assert.equal(f.detached, true);
    await assert.rejects(f.controller.requestDecision(), { code: 'CONNECTION_CLOSED' });
});

test('disposal interrupts a noncooperative send and commands keep Live-specific input rules', async () => {
    let subscribed;
    const controller = createLiveDecisions({ transport: { subscribe(fn) { subscribed = fn; return () => {}; }, send() { return new Promise(() => {}); } } });
    const receipt = controller.requestDecision(); await tick(); controller.dispose();
    await assert.rejects(receipt, { code: 'DISPOSED' });
    subscribed({ kind: 'close' });
    assert.throws(() => validateLiveCommand({ type: 'decision.item.create', item: {
        role: 'user', content: [{ type: 'input_image', image_url: 'https://example.com/a.png' }] } }), { code: 'VALIDATION_ERROR' });
});

test('pre-abort and immediate disposal cannot dispatch queued Live commands', async () => {
    const f = fixture({ configuration: config });
    const abort = new AbortController(); abort.abort();
    await assert.rejects(f.controller.configure(config, { signal: abort.signal }), { code: 'ABORTED' });
    assert.equal(f.sent.length, 0);
    f.emit(delta('known')); f.emit(completed('known-result', 'known'));
    assert.equal(f.events.at(-1).correlation.matched, true);
    const receipt = f.controller.requestDecision(); f.controller.dispose();
    await assert.rejects(receipt, { code: 'DISPOSED' });
    assert.equal(f.sent.length, 0);
});

test('evicted history is unmatched and pending operation budgets are local controls', async () => {
    const f = fixture({ configuration: config, maxHistory: 1, maxPending: 1 });
    try {
        f.emit(delta('evicted')); f.emit(delta('retained')); f.emit(completed('late-evicted', 'evicted'));
        assert.equal(f.events.at(-1).correlation.matched, false);
        const pending = f.controller.createItem({ role: 'user', content: 'waiting' }); await tick();
        await assert.rejects(f.controller.requestDecision(), { code: 'RESOURCE_LIMIT' });
        f.controller.dispose();
        await assert.rejects(pending, { code: 'DISPOSED' });
    } finally { f.controller.dispose(); }
});

test('a valid native result with a different question snapshot stays observable as unmatched', () => {
    const f = fixture({ configuration: config });
    try {
        f.emit(delta('source'));
        const decision = decisionResponse({ model: 'gpt-6-luna', questions: [{ type: 'predicate', name: 'other', instructions: '' }] });
        f.emit(completed('changed', 'source', 'session.input_transcript.delta', decision));
        assert.equal(f.events.at(-1).type, 'decision');
        assert.equal(f.events.at(-1).correlation.matched, false);
        assert.equal(f.events.at(-1).correlation.reason, 'configuration_mismatch');
        assert.equal(f.events.at(-1).decision.answers[0].name, 'other');
    } finally { f.controller.dispose(); }
});

test('incoming events reject accessors before serialization and report their client byte budget', () => {
    const f = fixture({ maxResponseBytes: 100 });
    let reads = 0;
    try {
        f.emit({ type: 'unknown', event_id: 'unsafe', get value() { reads++; return 'private'; } });
        assert.equal(reads, 0);
        assert.equal(f.events.at(-1).error.code, 'INVALID_RESPONSE');
        f.emit({ type: 'unknown', event_id: 'large', value: 'x'.repeat(200) });
        assert.equal(f.events.at(-1).error.code, 'RESPONSE_TOO_LARGE');
        assert.equal(f.events.at(-1).error.source, 'client');
    } finally { f.controller.dispose(); }
});

test('mixed trigger and delegation origins remain unmatched without consuming a valid delegation', () => {
    const f = fixture({ configuration: config });
    try {
        f.emit(delta('source'));
        f.emit({ type: 'session.delegation.created', event_id: 'delegated', delegation: { id: 'd', target: 'decisions' }, offset_ms: 0 });
        f.emit({ ...completed('mixed', 'source'), delegation_id: 'd' });
        assert.equal(f.events.at(-1).correlation.matched, false);
        f.emit({ ...completed('clear', null, null), delegation_id: 'd', trigger_id: null });
        assert.equal(f.events.at(-1).correlation.matched, true);
    } finally { f.controller.dispose(); }
});

test('a rejected configuration update preserves the last acknowledged question snapshot', async () => {
    const f = fixture({ configuration: config });
    try {
        const updating = f.controller.configure({ triggers: [] });
        const rejected = assert.rejects(updating, { code: 'INVALID_REQUEST' });
        await tick();
        f.emit({ type: 'error', event_id: 'rejected', error: { code: 'invalid_value', type: 'invalid_request_error',
            client_event_id: f.sent[0].event_id } });
        await rejected;
        f.emit(delta('after-rejection')); f.emit(completed('result', 'after-rejection'));
        assert.equal(f.events.at(-1).correlation.matched, true);
    } finally { f.controller.dispose(); }
});

test('evicting unresolved configuration history cannot make a source matched', async () => {
    const f = fixture({ configuration: config, maxHistory: 1 });
    const first = f.controller.configure({ triggers: [] });
    first.catch(() => {});
    try {
        const second = f.controller.configure(config); await tick();
        f.emit({ type: 'session.updated', event_id: 'ack-second', client_event_id: f.sent[1].event_id, session: config });
        await second;
        f.emit(delta('uncertain')); f.emit(completed('result', 'uncertain'));
        assert.equal(f.events.at(-1).correlation.matched, false);
        // The evicted command's late acknowledgement cannot restore missing history.
        f.emit({ type: 'session.updated', event_id: 'ack-first', client_event_id: f.sent[0].event_id, session: { triggers: [] } });
        await first;
        f.emit({ type: 'session.updated', event_id: 'later-snapshot', session: config });
        f.emit(delta('still-uncertain')); f.emit(completed('late-result', 'still-uncertain'));
        assert.equal(f.events.at(-1).correlation.matched, false);
    } finally { f.controller.dispose(); }
});

test('cancelling a queued configuration preserves the accepted snapshot without dispatch', async () => {
    const f = fixture({ configuration: config });
    const abort = new AbortController();
    try {
        const updating = f.controller.configure({ triggers: [] }, { signal: abort.signal });
        abort.abort();
        await assert.rejects(updating, { code: 'ABORTED' });
        assert.equal(f.sent.length, 0);
        f.emit(delta('after-cancellation')); f.emit(completed('result', 'after-cancellation'));
        assert.equal(f.events.at(-1).correlation.matched, true);
    } finally { f.controller.dispose(); }
});

test('observer subscription changes do not redeliver the current notification', () => {
    const f = fixture();
    let calls = 0;
    let unsubscribe;
    const observer = () => {
        calls++;
        // Bound the failing implementation so the regression cannot hang the suite.
        if (calls < 3) { unsubscribe(); unsubscribe = f.controller.subscribe(observer); }
    };
    unsubscribe = f.controller.subscribe(observer);
    try {
        f.emit(delta('first'));
        assert.equal(calls, 1);
        f.emit(delta('second'));
        assert.equal(calls, 2);
    } finally { unsubscribe(); f.controller.dispose(); }
});

test('mismatched item acknowledgements promptly reject the correlated operation', async () => {
    for (const create of [true, false]) {
        const f = fixture({ timeoutMs: 200 });
        try {
            const operation = create ? f.controller.createItem({ id: 'expected', role: 'user', content: '' })
                : f.controller.deleteItem('expected');
            const rejected = assert.rejects(operation, { code: 'INVALID_RESPONSE' });
            await tick();
            f.emit({ type: create ? 'decision.item.created' : 'decision.item.deleted', event_id: 'wrong-item',
                client_event_id: f.sent[0].event_id, ...(create
                    ? { item: { id: 'different', role: 'user', content: '' } } : { item_id: 'different' }) });
            await rejected;
            assert.equal(f.events.at(-1).error.code, 'INVALID_RESPONSE');
        } finally { f.controller.dispose(); }
    }
});

test('observed newer results advance transcript order even without a matching configuration', async () => {
    for (const configurationKnown of [false, true]) for (const type of ['session.input_transcript.delta', 'session.output_transcript.delta']) {
        const other = type === 'session.input_transcript.delta' ? 'session.output_transcript.delta' : 'session.input_transcript.delta';
        const f = fixture({ configuration: config });
        let stopped;
        try {
            f.emit(delta('older', type)); f.emit(delta('independent', other));
            if (!configurationKnown) {
                stopped = assert.rejects(f.controller.configure({ triggers: [] }), { code: 'DISPOSED' });
                await tick();
            }
            f.emit(delta('newer', type));
            const native = decisionResponse({ model: 'gpt-6-luna', questions: configurationKnown
                ? [{ type: 'predicate', name: 'different', instructions: '' }] : questions });
            f.emit(completed('newer-result', 'newer', type, native));
            assert.equal(f.events.at(-1).correlation.matched, false);
            assert.equal(f.events.at(-1).correlation.reason, configurationKnown
                ? 'configuration_mismatch' : 'source_or_configuration_unavailable');
            f.emit(completed('older-result', 'older', type));
            assert.equal(f.events.at(-1).correlation.matched, true);
            assert.equal(f.events.at(-1).correlation.stale, true);
            f.emit(completed('other-result', 'independent', other));
            assert.equal(f.events.at(-1).correlation.matched, true);
            assert.equal(f.events.at(-1).correlation.stale, false);
        } finally { f.controller.dispose(); await stopped; }
    }
});

test('a claimed transcript direction cannot advance another observed direction', () => {
    const f = fixture({ configuration: config });
    try {
        f.emit(delta('older')); f.emit(delta('newer'));
        f.emit(completed('incorrect-direction', 'newer', 'session.output_transcript.delta'));
        assert.equal(f.events.at(-1).correlation.matched, false);
        f.emit(completed('older-result', 'older'));
        assert.equal(f.events.at(-1).correlation.matched, true);
        assert.equal(f.events.at(-1).correlation.stale, false);
    } finally { f.controller.dispose(); }
});

test('invalid Live cancellation signals fail as structured configuration errors without dispatch', async () => {
    const f = fixture();
    const codes = [];
    try {
        for (const signal of [null, false, 0, '', {}, 'private signal']) {
            try { await f.controller.requestDecision({ signal }); codes.push('submitted'); }
            catch (error) { codes.push(error.code); }
        }
        assert.deepEqual(codes, Array(6).fill('CONFIGURATION_ERROR'));
        assert.equal(f.sent.length, 0);
    } finally { f.controller.dispose(); }
});

test('synchronous connection closure isolates cleanup failures and releases once', async () => {
    for (const kind of ['close', 'error']) {
        let cleanupCalls = 0;
        let controller;
        assert.doesNotThrow(() => { controller = createLiveDecisions({ transport: {
            subscribe(listener) {
                listener({ kind });
                return () => { cleanupCalls++; throw Error('private cleanup failure'); };
            },
            send() { assert.fail('A closed controller cannot dispatch.'); },
        } }); });
        await assert.rejects(controller.requestDecision(), { code: 'CONNECTION_CLOSED' });
        controller.dispose();
        assert.equal(cleanupCalls, 1);
    }
});

test('nested malformed Live server content always reports safe response errors', () => {
    const malformed = [
        { type: 'decision.item.created', event_id: 'bad-item', item: { id: 'item', role: 'assistant', content: 'private input' } },
        { type: 'session.updated', event_id: 'bad-config', session: { triggers: [
            { type: 'decisions', event_type: 'session.input_transcript.delta', decisions: { questions: [] } },
        ] } },
        { type: 'session.updated', event_id: 'bad-trigger', session: { triggers: [null] } },
    ];
    const f = fixture();
    const codes = [];
    try {
        for (const event of malformed) {
            try { validateLiveEvent(event); codes.push('accepted'); }
            catch (error) { codes.push(error.code ?? error.name); assert(!error.message.includes('private input')); }
            f.emit(event);
        }
        assert.deepEqual(codes, Array(3).fill('INVALID_RESPONSE'));
        assert.deepEqual(f.events.map(event => event.error.code), Array(3).fill('INVALID_RESPONSE'));
        f.emit(delta('still-open'));
        assert.equal(f.events.at(-1).type, 'transcript');
        assert.throws(() => validateLiveCommand({ type: 'decision.item.create', item: malformed[0].item }), { code: 'VALIDATION_ERROR' });
        assert.throws(() => validateLiveConfiguration(malformed[1].session), { code: 'VALIDATION_ERROR' });
    } finally { f.controller.dispose(); }
});
