// Installed native SDK and CLI protocol checks use local fixtures only.
export function decisionsScenario(name) {
    return `import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createBridge, createProvider, noul } from ${JSON.stringify(name)};
const usage = { input_tokens: 1, output_tokens: 0, total_tokens: 1,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
const response = request => ({ model: request.model, usage,
    answers: request.questions.map(q => ({ type: 'predicate', name: q.name ?? null, probability: 0.7 })) });
const provider = createProvider({ type: 'openai-decisions', apiKey: 'fixture', fetchImpl: async (_, init) =>
    new Response(JSON.stringify(response(JSON.parse(init.body)))) });
const bridge = createBridge({ provider });
const common = { input: [{ type: 'text', text: 'Installed package fixture' }], questions: { yes: noul('True?') } };
assert.equal((await bridge.evaluate(common)).answers.yes.noul, 0.7);
const native = { input: 'Installed package fixture', questions: [{ type: 'predicate', instructions: 'True?' }] };
assert.equal((await provider.createDecision(native)).decision.answers[0].probability, 0.7);
const server = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/decisions');
    assert.equal(req.headers.authorization, 'Bearer fixture');
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response(JSON.parse(body))));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
try {
    const flags = ['--provider', 'openai-decisions', '--base-url', 'http://127.0.0.1:' + server.address().port,
        '--api-key-env', 'PACKAGE_API_KEY'];
    async function cli(args, input) {
        const child = spawn(process.execPath, ['node_modules/' + ${JSON.stringify(name)} + '/bin/decision.mjs', ...args],
            { env: { ...process.env, PACKAGE_API_KEY: 'fixture' }, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = ''; let err = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
        child.stdin.end(input); const [code] = await once(child, 'close'); assert.equal(code, 0, err); return out;
    }
    assert.equal(JSON.parse(await cli(['evaluate', '-', ...flags], JSON.stringify(common))).answers.yes.noul, 0.7);
    assert.equal(JSON.parse(await cli(['evaluate', '-', ...flags, '--native'], JSON.stringify(native))).decision.answers[0].probability, 0.7);
    const rows = (await cli(['batch', '-', ...flags, '--native'], JSON.stringify(native) + '\\n' + JSON.stringify(native) + '\\n'))
        .trim().split('\\n').map(JSON.parse);
    assert.deepEqual(rows.map(row => row.ok), [true, true]);
} finally { server.closeAllConnections(); server.close(); }
console.log('Installed Decisions SDK and CLI common/native paths passed against a loopback fixture.');
`;
}

export function cloudflareScenario(name) {
    return `import assert from 'node:assert/strict';
import { CloudflareDecisionsProvider, createProvider, createBridge, noul } from ${JSON.stringify(name)};
const common = { state: 'Installed package protocol check', questions: { q: noul('True?') } };
const response = input => ({ model: input.model, answers: { q: { type: 'noul', noul: 0.7 } },
    usage: { input_tokens: 1, output_tokens: 0 } });
for (const model of ['clef', 'clef-flash', 'clef-omni']) {
    const provider = createProvider({ type: 'cloudflare-decisions', accountId: 'fixture-account', apiKey: 'fixture',
        model, fetchImpl: async (url, init) => {
            assert.equal(new URL(url).pathname, '/client/v4/accounts/fixture-account/ai/run/@cf/cloudflare/' + model);
            const input = JSON.parse(init.body);
            assert.equal(input.model, model);
            return Response.json({ success: true, result: response(input), errors: [], messages: [] });
        } });
    assert(provider instanceof CloudflareDecisionsProvider);
    assert.equal((await createBridge({ provider }).evaluate(common)).answers.q.noul, 0.7);
    assert.equal((await provider.createDecision(common)).decision.answers.q.noul, 0.7);
    if (model === 'clef-omni') {
        const wav = Buffer.alloc(46);
        wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
        wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
        const audio = 'data:audio/wav;base64,' + wav.toString('base64');
        const mediaResult = await createBridge({ provider }).evaluate({ input: [{ type: 'audio', dataUrl: audio }], questions: common.questions });
        assert.equal(mediaResult.meta.schemaVersion, 3);
        assert.equal((await provider.createDecision({ ...common, audio: [audio] })).decision.answers.q.noul, 0.7);
    }
}
const bound = new CloudflareDecisionsProvider({ transport: 'binding', rejectIfBusy: true,
    ai: { async run(model, input, options) {
        assert.equal(model, '@cf/cloudflare/clef');
        assert.equal(input.options, undefined);
        assert.equal(options.returnRawResponse, true);
        assert.equal(options.rejectIfBusy, true);
        return Response.json(response(input));
    } } });
assert.equal((await createBridge({ provider: bound }).evaluate(common)).answers.q.noul, 0.7);
console.log('Installed Cloudflare common/native REST and binding entry points passed.');\n`;
}
