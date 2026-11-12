/** Offline size qualification; synthetic media bytes are never sent to Google. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { GeminiDecisionsProvider, createBridge } from '../src/index.mjs';
import { prepareGeminiDecision } from '../src/providers/gemini-input.mjs';
import { runCli } from '../src/cli/main.mjs';
import { streams } from './support.mjs';

const questions = { q: { type: 'noul', instructions: 'Present?' } };
const usage = { total_input_tokens: 1, total_output_tokens: 0 };
const answer = { type: 'noul', noul: 0.8, confidence: 0.8 };
let sdkCalls = 0;
let serializedBytes = 0;

async function sdkBoundary() {
    // Canonical base64 representing exactly 100 decimal MB without a decoded copy.
    const data = 'AAAA'.repeat(33333333) + 'AA==';
    const provider = new GeminiDecisionsProvider({ apiKey: 'fixture', maxRequestBytes: 167772160,
        fetchImpl: async (_url, init) => {
            sdkCalls++;
            serializedBytes = Math.max(serializedBytes, Buffer.byteLength(init.body));
            return Response.json({ answers: { [sdkCalls === 1 ? 'q' : 'q000']: answer }, usage });
        } });
    const native = { input: { type: 'image', data, mime_type: 'image/png' }, questions };
    await assert.rejects(new GeminiDecisionsProvider({ apiKey: 'fixture' }).createDecision(native), { code: 'REQUEST_TOO_LARGE' });
    await provider.createDecision(native);
    await createBridge({ provider, timeoutMs: 120000 }).evaluate({
        input: [{ type: 'image', dataUrl: 'data:image/png;base64,' + data }], questions,
    });
    const small = { input: 'é😀', questions };
    const bytes = Buffer.byteLength(JSON.stringify(prepareGeminiDecision(small)));
    prepareGeminiDecision(small, { maxRequestBytes: bytes });
    assert.throws(() => prepareGeminiDecision(small, { maxRequestBytes: bytes - 1 }), { code: 'REQUEST_TOO_LARGE' });
}

await sdkBoundary();
globalThis.gc();
const cwd = await mkdtemp(join(tmpdir(), 'decision-gemini-payload-'));
let cliChecks = 0;
const server = createServer(async (request, response) => {
    let bytes = 0;
    for await (const chunk of request) bytes += chunk.length;
    assert(bytes > 64 * 1024 * 1024);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ answers: { q000: answer }, usage }));
});

try {
    // Large-record preparation can outlast the default idle interval on Node 22.
    server.keepAliveTimeout = 120000;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const config = { provider: 'gemini-decisions', maxRequestBytes: 167772160,
        baseURL: 'http://127.0.0.1:' + server.address().port, apiKeyEnv: 'DECISION_BRIDGE_GEMINI_API_KEY' };
    await writeFile(join(cwd, 'config.json'), JSON.stringify(config));
    await writeFile(join(cwd, 'routes.json'), JSON.stringify({ schemaVersion: 2, defaultRoute: 'google',
        routes: { google: { config } } }));
    // A smaller (>64 MiB) record exercises file reads and JSONL without duplicating the full allowance.
    async function fixtures() {
        const data = 'AAAA'.repeat(18000000);
        const native = JSON.stringify({ input: { type: 'image', data, mime_type: 'image/png' }, questions });
        const common = JSON.stringify({ input: [{ type: 'image', dataUrl: 'data:image/png;base64,' + data, resolution: 'medium' }], questions });
        await writeFile(join(cwd, 'native.json'), native);
        await writeFile(join(cwd, 'common.json'), common);
        await writeFile(join(cwd, 'batch.jsonl'), common + '\n');
    }
    await fixtures();
    globalThis.gc();
    for (const args of [
        ['validate', 'native.json', '--native', '--config', 'config.json'],
        ['validate', 'common.json', '--config', 'config.json'],
        ['validate', 'common.json', '--config', 'routes.json'],
        ['inspect', 'common.json', '--config', 'routes.json'],
        ['evaluate', 'common.json', '--config', 'routes.json'],
        ['batch', 'batch.jsonl', '--concurrency', '1', '--config', 'routes.json'],
    ]) {
        const io = streams();
        const code = await runCli(args, { ...io, cwd, env: { DECISION_BRIDGE_GEMINI_API_KEY: 'fixture' } });
        assert.equal(code, 0, io.error());
        if (args[0] === 'evaluate') assert.equal(JSON.parse(io.output()).meta.schemaVersion, 8);
        cliChecks++;
        globalThis.gc();
    }
} finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
}
process.stdout.write(JSON.stringify({ decodedBytes: 100000000, serializedBytes, sdkCalls, cliChecks }) + '\n');
