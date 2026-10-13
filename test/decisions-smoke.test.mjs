import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { runDecisionsSmoke } from '../scripts/decisions-smoke.mjs';
import { image, decisionResponse } from './decisions-fixtures.mjs';

test('Decisions image fixture has valid PNG checksums and decodable pixels', () => {
    const bytes = Buffer.from(image.split(',')[1], 'base64');
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const chunks = [];
    const compressed = [];
    let offset = 8;
    while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        assert(offset + 12 + length <= bytes.length);
        // Validate chunk checksums independently of the base64 shape validator.
        let checksum = 0xffffffff;
        for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
            checksum ^= byte;
            for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
        }
        assert.equal((checksum ^ 0xffffffff) >>> 0, bytes.readUInt32BE(offset + 8 + length), type);
        chunks.push(type);
        if (type === 'IHDR') {
            assert.equal(length, 13);
            assert.equal(bytes.readUInt32BE(offset + 8), 1);
            assert.equal(bytes.readUInt32BE(offset + 12), 1);
            assert.deepEqual([...bytes.subarray(offset + 16, offset + 21)], [8, 6, 0, 0, 0]);
        }
        if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
        offset += 12 + length;
    }
    assert.equal(offset, bytes.length);
    assert.deepEqual(chunks, ['IHDR', 'IDAT', 'IEND']);
    assert.deepEqual([...inflateSync(Buffer.concat(compressed))], [0, 0, 128, 255, 255]);
});

test('live Decisions helper requires opt-in and stays bounded against a local fixture', async t => {
    await assert.rejects(runDecisionsSmoke([], {}), { code: 'CONFIGURATION_ERROR' });
    let calls = 0;
    const images = [];
    const server = createServer(async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        calls++;
        const request = JSON.parse(body);
        if (Array.isArray(request.input)) for (const message of request.input) {
            if (Array.isArray(message.content)) for (const part of message.content) {
                if (part.type === 'input_image') images.push(part.image_url);
            }
        }
        const data = decisionResponse(request);
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const result = await runDecisionsSmoke(['--base-url', `http://127.0.0.1:${server.address().port}`, '--api-key-env', 'TEST_API_KEY'],
        { RUN_LIVE_TESTS: '1', TEST_API_KEY: 'fixture-only' });
    assert.equal(result.passed, true);
    assert.equal(calls, 4);
    assert.equal(result.requests, 4);
    assert.deepEqual(images, [image]);
    assert.deepEqual(result.checks.map(check => check.label), ['legacy', 'criteria', 'multimodal', 'native']);
    assert(!JSON.stringify(result).includes('answers'));
});

test('Decisions entry point and both APIs run without a Node process global', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        globalThis.process = undefined;
        const { createProvider, createBridge, noul } = await import('./src/index.mjs');
        const { decisionResponse } = await import('./test/decisions-fixtures.mjs');
        const provider = createProvider({ type: 'openai-decisions', apiKey: 'fixture', fetchImpl: async (_, init) =>
            new Response(JSON.stringify(decisionResponse(JSON.parse(init.body)))) });
        const common = await createBridge({ provider }).evaluate({ state: '', questions: { q: noul('True?') } });
        const native = await provider.createDecision({ input: '', questions: [{ type: 'predicate', instructions: '' }] });
        if (common.answers.q.noul !== 0.7 || native.decision.answers[0].probability !== 0.7) throw Error('Wrong result');
    `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
