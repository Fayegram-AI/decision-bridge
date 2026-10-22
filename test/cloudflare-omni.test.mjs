import { createGenerativeProvider } from '../src/custom/generative/index.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, createProvider, choice, scoreLevels, noul, validateRequest } from '../src/index.mjs';
import { providerCapabilities } from '../src/capabilities.mjs';
import { preflightCloudflareDecision, preflightCommonCloudflareDecision } from '../src/providers/cloudflare-preflight.mjs';
import { cloudflareRequestLimit } from '../src/providers/cloudflare-profile.mjs';
import { base64ByteLength } from '../src/embedded.mjs';
import { inspectMp3 } from '../src/providers/cloudflare-audio.mjs';
import { mediaBytes } from '../src/providers/media-binary.mjs';
import { fixture, image, native, cloudflareResponse } from './cloudflare-fixtures.mjs';
import { media, dataUrl, wav, mp3, mp4, webm } from './media-fixtures.mjs';

const omni = { ...native, model: 'clef-omni' };
const MIB = 1024 * 1024;

test('Omni common/native media mapping preserves decisions, grouping and schema versions', async () => {
    const { bridge, provider, requests } = fixture(); // Per-call Omni overrides the ordinary Clef default.
    const questions = { yes: noul('True?'), route: choice('Choose.', [{ value: true }, { value: 'true' }]),
        rating: scoreLevels('Rate.', [{ label: 'Low' }, { label: 'High' }]) };
    const result = await bridge.evaluate({ model: '@cf/cloudflare/clef-omni', questions, input: [
        { type: 'image', dataUrl: image }, { type: 'audio', dataUrl: media.wav }, { type: 'audio', dataUrl: media.mp3 },
        { type: 'video', dataUrl: media.mp4 }, { type: 'video', dataUrl: media.webm },
        { type: 'text', text: 'one' }, { type: 'text', text: 'two' },
    ] });
    assert.equal(requests[0].request.model, 'clef-omni'); assert.equal(requests[0].request.state, 'onetwo');
    assert.deepEqual(requests[0].request.audio, [media.wav, media.mp3]);
    assert.deepEqual(requests[0].request.videos, [media.mp4, media.webm]);
    assert.equal(result.answers.route.choice, true); assert.equal(result.meta.schemaVersion, 3);
    assert.equal(result.meta.confidenceSource, 'native'); assert.deepEqual(result.usage, { input_tokens: 42, output_tokens: 0 });
    const direct = await provider.createDecision({ ...requests[0].request, state: { evidence: true } });
    assert.equal(direct.decision.model, 'clef-omni'); assert.deepEqual(requests[1].request.state, { evidence: true });
    assert(Object.isFrozen(direct.decision));
    assert.equal((await bridge.evaluate(omni)).meta.schemaVersion, 1);
    assert.equal((await bridge.evaluate({ model: 'clef-omni', input: [{ type: 'image', dataUrl: image }], questions: native.questions })).meta.schemaVersion, 2);
    assert.equal((await bridge.evaluate({ model: 'clef-omni', input: [{ type: 'audio', dataUrl: media.wav }], questions: native.questions })).meta.schemaVersion, 3);
});

test('Omni validates each native embedded representation and MIME aliases', () => {
    for (const [field, format, bytes] of [['audio', 'audio/wav', wav()], ['audio', 'audio/x-wav', wav()],
        ['audio', 'audio/mpeg', mp3()], ['audio', 'audio/mp3', mp3()], ['videos', 'video/mp4', mp4()], ['videos', 'video/webm', webm()]]) {
        for (const item of [dataUrl(format, bytes), { content_type: format, base64: bytes.toString('base64') }])
            preflightCloudflareDecision({ ...omni, [field]: [item] });
    }
});

test('unsupported providers and malformed common parts fail before inference', async () => {
    const input = [{ type: 'audio', dataUrl: media.wav }];
    const fetchImpl = () => { assert.fail('Must not dispatch'); };
    for (const options of [{ type: 'cloudflare-decisions', accountId: 'fixture', apiKey: 'fixture' },
        { type: 'openai-decisions', apiKey: 'fixture' }, { type: 'jev', apiKey: 'fixture' },
        { type: 'openai-compatible', apiKey: 'fixture', model: 'fixture' }]) {
        const bridge = createBridge({ provider: (options.type === 'openai-compatible' ? createGenerativeProvider : createProvider)({ ...options, fetchImpl }) });
        await assert.rejects(bridge.evaluate({ input, questions: native.questions }), { code: 'UNSUPPORTED_CAPABILITY' });
    }
    for (const extra of [{ detail: 'auto' }, { duration: 1 }]) assert.throws(() => validateRequest({
        model: 'clef-omni', input: [{ ...input[0], ...extra }], questions: native.questions }), { code: 'VALIDATION_ERROR' });
    for (const model of ['clef', 'clef-flash']) for (const field of ['audio', 'videos'])
        assert.throws(() => preflightCloudflareDecision({ ...native, model, [field]: [] }), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.throws(() => preflightCloudflareDecision({ ...omni, audio: [dataUrl('audio/ogg', mp3())] }), { code: 'UNSUPPORTED_CAPABILITY' });
});

test('media layout and malformed containers are rejected while counts remain upstream', () => {
    const parts = [{ type: 'image', dataUrl: image }, { type: 'audio', dataUrl: media.wav },
        { type: 'video', dataUrl: media.mp4 }, { type: 'text', text: 'state' }];
    for (let i = 0; i < 3; i++) assert.throws(() => preflightCommonCloudflareDecision({ model: 'clef-omni',
        input: [parts[i + 1], parts[i]], questions: native.questions }), { code: 'UNSUPPORTED_CAPABILITY' });
    for (const [field, item, count] of [['audio', media.wav, 4], ['videos', media.mp4, 2]]) {
        preflightCloudflareDecision({ ...omni, [field]: Array(count).fill(item) });
        preflightCloudflareDecision({ ...omni, [field]: Array(count + 1).fill(item) });
        for (const bad of ['https://example.com/clip', item.slice(0, -1), item.replace(';base64,', ','),
            { content_type: field === 'audio' ? 'audio/wav' : 'video/mp4', base64: 'AAAA' }])
            assert.throws(() => preflightCloudflareDecision({ ...omni, [field]: [bad] }));
    }
    for (const item of [dataUrl('audio/mpeg', wav()), dataUrl('audio/wav', mp3()),
        dataUrl('video/mp4', webm()), dataUrl('video/webm', mp4())])
        assert.throws(() => preflightCloudflareDecision({ ...omni, [item.startsWith('data:audio') ? 'audio' : 'videos']: [item] }));
    for (const [format, bytes] of [['audio/wav', wav()], ['audio/mpeg', mp3()], ['video/mp4', mp4()], ['video/webm', webm()]])
        assert.throws(() => preflightCloudflareDecision({ ...omni,
            [format.startsWith('audio') ? 'audio' : 'videos']: [dataUrl(format, bytes.subarray(0, bytes.length - 1))] }));
    for (const base64 of ['AAA=', 'AA==']) assert(base64ByteLength(base64) > 0);
    for (const base64 of ['A===', 'AA=A', 'AB==', 'AAB=']) assert.throws(() => base64ByteLength(base64));
});

test('media duration is preserved for server admission with valid containers', () => {
    preflightCloudflareDecision({ ...omni, audio: [dataUrl('audio/wav', wav(300, 1))],
        videos: [dataUrl('video/mp4', mp4(60)), dataUrl('video/webm', webm(60))] });
    for (const [field, format, bytes] of [['audio', 'audio/wav', wav(301, 1)], ['audio', 'audio/mpeg', mp3(11500)],
        ['videos', 'video/mp4', mp4(61)], ['videos', 'video/webm', webm(61)]])
        preflightCloudflareDecision({ ...omni, [field]: [dataUrl(format, bytes)] });
    preflightCloudflareDecision({ ...omni, videos: [dataUrl('video/mp4', mp4(1, 0, true)), dataUrl('video/webm', webm(1, true))] });
    const vbr = Buffer.concat([mp3(1, 9), mp3(1, 14)]), payload = vbr.toString('base64');
    assert.equal(inspectMp3(mediaBytes(payload, vbr.length)), 2 * 1152 / 44100);
});

test('configured client budgets override defaults without enforcing decoded media ceilings', async () => {
    const video = dataUrl('video/mp4', mp4(1, 9 * MIB));
    preflightCloudflareDecision({ ...omni, videos: [video, video] });
    assert.equal(cloudflareRequestLimit('clef', 64 * MIB), 64 * MIB);
    assert.equal(cloudflareRequestLimit('clef-omni'), 36 * MIB);
    assert.equal(cloudflareRequestLimit('clef-omni', 100), 100);
    const large = { ...omni, state: 'x'.repeat(13 * MIB) };
    const { provider, requests } = fixture({ maxRequestBytes: 64 * MIB });
    await provider.createDecision({ ...large, model: 'clef' });
    assert.equal(requests.length, 1);
    await assert.rejects(fixture({ maxRequestBytes: 100 }).provider.createDecision(large), { code: 'REQUEST_TOO_LARGE' });
    assert.throws(() => preflightCloudflareDecision(omni, { maxRequestBytes: 64 * MIB + 1 }), { code: 'CONFIGURATION_ERROR' });
    const exact = Buffer.byteLength(JSON.stringify(preflightCloudflareDecision({ ...omni, audio: [media.wav] })));
    preflightCloudflareDecision({ ...omni, audio: [media.wav] }, { maxRequestBytes: exact });
    assert.throws(() => preflightCloudflareDecision({ ...omni, audio: [media.wav] }, { transport: 'binding', maxRequestBytes: exact }), { code: 'REQUEST_TOO_LARGE' });
});
test('legacy capability profiles default to no media and Omni binding IDs remain per-response', async () => {
    const old = { supported: true, orderedInput: true, images: false, typedChoices: false, labeledScores: false,
        safetyIdentifier: false, maxImages: 0, maxChoiceOptions: 255, maxScoreLevels: 10 };
    assert.equal(providerCapabilities({ getCapabilities: () => old }, 'fixture').audio, false);
    const calls = [];
    const provider = createProvider({ type: 'cloudflare-decisions', transport: 'binding', model: 'clef-omni',
        rejectIfBusy: true, gateway: { id: 'fixture', skipCache: true }, ai: { async run(model, input, options) {
            calls.push({ model, input, options });
            await new Promise(resolve => setTimeout(resolve, input.state === 'first' ? 15 : 1));
            return Response.json(cloudflareResponse(input), { headers: { 'cf-ai-req-id': input.state, 'cf-aig-log-id': 'log-' + input.state } });
        } } });
    const answers = await Promise.all(['first', 'second'].map(state => provider.createDecision({ ...native, state, audio: [media.wav] })));
    assert.deepEqual(answers.map(item => item.meta.gatewayLogId), ['log-first', 'log-second']);
    assert(calls.every(call => call.model === '@cf/cloudflare/clef-omni' && call.input.model === 'clef-omni' &&
        call.options.signal instanceof AbortSignal && call.options.returnRawResponse && call.options.rejectIfBusy && call.options.gateway.skipCache));
});

test('Omni retains rounded 255-option distributions and rejects malformed native sums', async () => {
    const options = Array.from({ length: 255 }, (_, i) => ({ value: i === 0 ? true : 'route-' + i }));
    const request = { model: 'clef-omni', input: [{ type: 'audio', dataUrl: media.wav }],
        questions: { route: choice('Choose.', options) } };
    const { provider, bridge, requests } = fixture();
    const result = await bridge.evaluate(request);
    assert.equal(result.answers.route.choice, true);
    assert.deepEqual(result.answers.route.probabilities.at(-1), { value: 'route-254', probability: 0.0039 });
    const direct = await provider.createDecision(requests[0].request);
    assert.equal(Object.keys(direct.decision.answers.route.probabilities).length, 255);
    const invalid = fixture({ mutate(response) {
        const probabilities = response.answers.route.probabilities;
        const first = Object.keys(probabilities)[0];
        probabilities[first] += 0.03;
        response.answers.route.confidence = probabilities[first];
    } }).bridge;
    await assert.rejects(invalid.evaluate(request), { code: 'INVALID_RESPONSE' });
});

test('Omni media calls retain cancellation and transport deadlines without a second dispatch', async () => {
    let calls = 0;
    const provider = createProvider({ type: 'cloudflare-decisions', transport: 'binding', model: 'clef-omni',
        timeoutMs: 15, ai: { run() { calls++; return new Promise(() => {}); } } });
    const request = { ...omni, audio: [media.wav], videos: [media.mp4] };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(provider.createDecision(request, { signal: controller.signal }), { code: 'ABORTED' });
    assert.equal(calls, 0);
    await assert.rejects(provider.createDecision(request), { code: 'TIMEOUT' });
    assert.equal(calls, 1);
});

test('Omni REST busy-option rejection happens locally with or without Gateway', async () => {
    for (const gateway of [undefined, { id: 'fixture', skipCache: true, collectLog: false }]) {
        let calls = 0;
        const provider = createProvider({ type: 'cloudflare-decisions', model: 'clef-omni',
            accountId: 'fixture', apiKey: 'fixture-key', rejectIfBusy: true, gateway,
            fetchImpl: async () => {
                calls++;
                throw new Error('Unsupported busy requests must not reach REST.');
            } });
        await assert.rejects(provider.createDecision({ ...omni, audio: [media.wav] }), error => {
            assert.equal(error.code, 'UNSUPPORTED_CAPABILITY');
            assert.equal(error.status, undefined); assert.equal(error.upstreamCode, undefined);
            assert.match(error.message, /binding transport/); return true;
        });
        assert.equal(calls, 0);
    }
});
