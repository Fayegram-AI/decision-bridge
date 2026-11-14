import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../src/custom/generative/index.mjs';
import { validateConfig } from '../src/cli/config-validation.mjs';

const questions = { q: { type: 'noul', instructions: 'Approved?' } };
const reply = (id, mode = 'json_schema') => ({ id, model: 'served', stop_reason: mode === 'tool' ? 'tool_use' : 'end_turn',
    content: mode === 'tool' ? [{ type: 'tool_use', id: 'tool-' + id, name: 'submit_decisions', input: { answers: { q: { noul: 0.7 } } } }]
        : [{ type: 'text', text: JSON.stringify({ answers: { q: { noul: 0.7 } } }) }], usage: { input_tokens: 2, output_tokens: 1 } });
const provider = extra => new AnthropicProvider({ model: 'selected', apiKey: 'fixture', responseFormat: 'json_schema', ...extra });

test('thread defaults apply only to omitted options and explicit null values fail before HTTP', async () => {
    for (const mode of ['json_schema', 'tool']) {
        let calls = 0;
        const client = provider({ responseFormat: mode, fetchImpl: async () => {
            calls++; return Response.json(reply(String(calls), mode));
        } });
        for (const [options, code] of [[{ model: null }, 'VALIDATION_ERROR'],
            [{ maxTurns: null }, 'CONFIGURATION_ERROR'], [{ maxHistoryBytes: null }, 'CONFIGURATION_ERROR']]) {
            assert.throws(() => client.createThread({ questions, ...options }), { code });
        }
        assert.equal(calls, 0);
        for (const options of [{}, { model: undefined, maxTurns: undefined, maxHistoryBytes: undefined }]) {
            const thread = client.createThread({ questions, ...options });
            assert.equal((await thread.evaluate('accepted')).meta.responseFormat, mode);
            thread.dispose();
        }
        assert.equal(calls, 2);
    }
});

test('omitted thread format follows fixed model override across continuation and recovery', async () => {
    const bodies = [];
    const client = new AnthropicProvider({ apiKey: 'fixture', model: 'legacy', fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); bodies.push(body);
        assert.equal(body.model, 'claude-sonnet-5-5');
        assert.equal(body.output_config.format.type, 'json_schema');
        assert.equal(body.tool_choice, undefined);
        if (bodies.length === 2) return Response.json({ error: { type: 'not_found_error', details: { error_code: 'thread_not_found' } } }, { status: 404 });
        return Response.json(reply(String(bodies.length)));
    } });
    const thread = client.createThread({ model: 'claude-sonnet-5-5', questions });
    assert.equal((await thread.evaluate('first')).meta.responseFormat, 'json_schema');
    assert.equal((await thread.evaluate('second')).meta.responseFormat, 'json_schema');
    assert.equal(bodies[2].messages.length, 3);
    thread.dispose();
});

for (const mode of ['json_schema', 'tool']) test(`explicit ${mode} threads preserve cumulative history and independent evaluations`, async () => {
    const bodies = [];
    const client = provider({ responseFormat: mode, workspaceId: 'workspace', fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); bodies.push(body);
        assert.equal(init.headers['anthropic-workspace-id'], 'workspace');
        if (body.thread) assert.equal(init.headers['anthropic-beta'], 'message-threads-2026-08-12');
        else assert.equal(init.headers['anthropic-beta'], undefined);
        return Response.json(reply(String(bodies.length), mode));
    } });
    const thread = client.createThread({ questions });
    await thread.evaluate('first'); await thread.evaluate('second');
    assert.equal(bodies[0].thread.type, 'create');
    assert.deepEqual(bodies[1].thread, { type: 'continue', previous_message_id: '1' });
    assert.equal(bodies[1].system, undefined); assert.equal(bodies[1].tools, undefined);
    assert.equal(bodies[1].messages.length, 1);
    if (mode === 'tool') assert.equal(bodies[1].messages[0].content[0].tool_use_id, 'tool-1');
    await client.evaluate({ state: 'independent', questions });
    assert.equal(bodies[2].thread, undefined); assert.equal(bodies[2].messages.length, 1);
    thread.reset(); await thread.evaluate('reset'); assert.equal(bodies[3].thread.type, 'create');
    thread.dispose(); await assert.rejects(thread.evaluate('disposed'), { code: 'DISPOSED' });
});

for (const code of ['thread_not_found', 'thread_already_continued', 'thread_continue_in_flight']) test(`threads recreate once for ${code}`, async () => {
    const bodies = [];
    const thread = provider({ fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); bodies.push(body);
        return body.thread.type === 'continue' ? Response.json({ error: { type: 'not_found_error', details: { error_code: code }, message: 'private marker' } },
            { status: code === 'thread_not_found' ? 404 : 400 }) : Response.json(reply(String(bodies.length)));
    } }).createThread({ questions });
    await thread.evaluate('first'); const result = await thread.evaluate('second');
    assert.equal(bodies.length, 3); assert.equal(bodies[2].thread.type, 'create');
    assert.equal(bodies[2].messages.length, 3); assert(bodies[2].system);
    assert.equal(result.meta.attempts, 2); thread.dispose();
});

test('refusals and unknown HTTP errors roll back failed turns without automatic replay', async () => {
    const bodies = [];
    let fail = 'refusal';
    const thread = provider({ fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); bodies.push(body);
        if (bodies.length === 2) return Response.json({ ...reply('refused'), stop_reason: fail });
        if (fail === '404') return Response.json({ error: { type: 'not_found_error', message: 'private marker' } }, { status: 404 });
        return Response.json(reply(String(bodies.length)));
    } }).createThread({ questions });
    await thread.evaluate('accepted'); await assert.rejects(thread.evaluate('refused'), { code: 'MODEL_REFUSAL' });
    await thread.evaluate('rephrased'); assert.equal(bodies[2].thread.type, 'create');
    assert(!JSON.stringify(bodies[2]).includes('refused'));
    fail = '404'; await assert.rejects(thread.evaluate('unknown'), error => error.status === 404 && !JSON.stringify(error).includes('private marker'));
    assert.equal(bodies.length, 4); thread.dispose();
});

test('threads reject concurrent work and reset, dispose noncooperative I/O and enforce history bounds', async () => {
    let dispatches = 0;
    const thread = provider({ fetchImpl: async () => { dispatches++; return new Promise(() => {}); } }).createThread({ questions });
    const pending = thread.evaluate('pending');
    await assert.rejects(thread.evaluate('concurrent'), { code: 'THREAD_BUSY' });
    assert.throws(() => thread.reset(), { code: 'THREAD_BUSY' });
    thread.dispose(); await assert.rejects(pending, { code: 'DISPOSED' }); assert.equal(dispatches, 1);
    const bounded = provider({ fetchImpl: async () => Response.json(reply('one')) }).createThread({ questions, maxTurns: 1 });
    await bounded.evaluate('accepted'); await assert.rejects(bounded.evaluate('excess'), { code: 'HISTORY_LIMIT' }); bounded.dispose();
    const bytes = provider({ fetchImpl: async () => { throw Error('Unexpected dispatch'); } }).createThread({ questions, maxHistoryBytes: 10 });
    await assert.rejects(bytes.evaluate('too large'), { code: 'HISTORY_LIMIT' }); bytes.dispose();
});

test('Anthropic request ceiling is opt-in, endpoint-specific, and separate from responses', () => {
    provider({ maxRequestBytes: 128000000 });
    validateConfig({ provider: 'custom-generative', preset: 'anthropic', maxRequestBytes: 128000000 });
    assert.throws(() => provider({ maxRequestBytes: 128000001 }), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => provider({ maxResponseBytes: 128000000 }), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => provider({ baseURL: 'http://localhost', maxRequestBytes: 128000000 }), { code: 'CONFIGURATION_ERROR' });
    assert.throws(() => provider({ parameters: { thread: { type: 'create' } } }), { code: 'CONFIGURATION_ERROR' });
});

test('threads share a finite deadline across replay and discard invalid output before the next create', async () => {
    const bodies = [];
    const thread = provider({ timeoutMs: 30, fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); bodies.push(body);
        if (bodies.length === 2) return Response.json({ error: { details: { error_code: 'thread_not_found' } } }, { status: 404 });
        if (bodies.length === 3) return new Promise(() => {});
        if (bodies.length === 4) return Response.json({ ...reply('invalid'), content: [{ type: 'text', text: '{}' }] });
        return Response.json(reply(String(bodies.length)));
    } }).createThread({ questions });
    await thread.evaluate('accepted');
    await assert.rejects(thread.evaluate('expired'), { code: 'TIMEOUT' });
    await assert.rejects(thread.evaluate('invalid'), { code: 'INVALID_RESPONSE' });
    await thread.evaluate('recovered');
    assert.equal(bodies[4].thread.type, 'create');
    assert.equal(bodies[4].messages.length, 3);
    assert(!JSON.stringify(bodies[4].messages).includes('expired'));
    thread.dispose();
});

test('thread iteration validation rolls back malformed replies before committing history or turn limits', async () => {
    for (const iterations of [{}, [null], [{ type: 1 }]]) {
        const bodies = [];
        const thread = provider({ fetchImpl: async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            const data = reply(String(bodies.length));
            if (bodies.length === 2) data.usage.iterations = iterations;
            return Response.json(data);
        } }).createThread({ questions, maxTurns: 2 });
        await thread.evaluate('accepted');
        await assert.rejects(thread.evaluate('failed state'), { code: 'INVALID_RESPONSE' });
        await thread.evaluate('recovered');
        assert.equal(bodies[2].thread.type, 'create');
        assert.equal(bodies[2].messages.length, 3);
        assert(!JSON.stringify(bodies[2].messages).includes('failed state'));
        thread.dispose();
    }
});

test('thread fallback iterations retain the valid turn and recreate on the next evaluation', async () => {
    const bodies = [];
    const thread = provider({ fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        const data = reply(String(bodies.length));
        data.usage.iterations = bodies.length === 2 ? [{ type: 'fallback_message' }] : null;
        return Response.json(data);
    } }).createThread({ questions });
    await thread.evaluate('first'); await thread.evaluate('fallback accepted'); await thread.evaluate('next');
    assert.equal(bodies[1].thread.type, 'continue');
    assert.equal(bodies[2].thread.type, 'create');
    assert.equal(bodies[2].messages.length, 5);
    assert(JSON.stringify(bodies[2].messages).includes('fallback accepted'));
    thread.dispose();
});

test('failed thread recovery reports both dispatches and rolls back the pending turn', async () => {
    const bodies = [];
    const thread = provider({ fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        if (bodies.length === 2) return Response.json({ error: { details: { error_code: 'thread_not_found' } } }, { status: 404 });
        if (bodies.length === 3) return Response.json({ error: { type: 'authentication_error', message: 'private input' } }, { status: 401 });
        return Response.json(reply(String(bodies.length)));
    } }).createThread({ questions });
    await thread.evaluate('accepted');
    await assert.rejects(thread.evaluate('failed recovery'), error =>
        error.status === 401 && error.attempts === 2 && !JSON.stringify(error).includes('private input'));
    await thread.evaluate('recovered');
    assert.equal(bodies[3].thread.type, 'create');
    assert.equal(bodies[3].messages.length, 3);
    assert(!JSON.stringify(bodies[3].messages).includes('failed recovery'));
    thread.dispose();
});

test('threads reject malformed replay blocks before retaining a turn in either output mode', async () => {
    for (const mode of ['json_schema', 'tool']) for (const block of [
        { type: 'thinking', thinking: 123, signature: 'opaque' },
        { type: 'thinking', thinking: 'private', signature: null },
        { type: 'redacted_thinking', data: {} }, { type: 'text', text: 1 }, null,
    ]) {
        const bodies = [];
        const thread = provider({ responseFormat: mode, fetchImpl: async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            const data = reply(String(bodies.length), mode);
            if (bodies.length === 2) data.content.unshift(block);
            return Response.json(data);
        } }).createThread({ questions, maxTurns: 2 });
        await thread.evaluate('accepted');
        await assert.rejects(thread.evaluate('invalid replay state'), { code: 'INVALID_RESPONSE' });
        await thread.evaluate('recovered');
        assert.equal(bodies[2].thread.type, 'create');
        assert.equal(bodies[2].messages.length, 3);
        assert(!JSON.stringify(bodies[2].messages).includes('invalid replay state'));
        thread.dispose();
    }
});

test('thread recovery preserves valid thinking signatures and redacted blocks exactly', async () => {
    for (const mode of ['json_schema', 'tool']) {
        const bodies = [];
        const first = reply('first', mode);
        first.content.unshift({ type: 'thinking', thinking: '', signature: 'opaque-signature' },
            { type: 'redacted_thinking', data: 'opaque-data' });
        const thread = provider({ responseFormat: mode, fetchImpl: async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            if (bodies.length === 1) return Response.json(first);
            if (bodies.length === 2) return Response.json({ error: { details: { error_code: 'thread_not_found' } } }, { status: 404 });
            return Response.json(reply('next', mode));
        } }).createThread({ questions });
        const result = await thread.evaluate('first');
        assert(!JSON.stringify(result).includes('opaque'));
        await thread.evaluate('next');
        assert.deepEqual(bodies[2].messages[1].content, first.content);
        thread.dispose();
    }
});
