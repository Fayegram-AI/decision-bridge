// Validation boundaries shared by common and native Decisions entry points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, OpenAIDecisionsProvider, decideChoice, noul } from '../src/index.mjs';
import { decisionResponse } from './decisions-fixtures.mjs';
import { jsonResponse } from './fixtures.mjs';

function fixture() {
    const requests = [];
    const provider = new OpenAIDecisionsProvider({ apiKey: 'fixture-key', fetchImpl: async (_, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        return jsonResponse(decisionResponse(request));
    } });
    return { provider, bridge: createBridge({ provider }), requests };
}

const common = { state: '', questions: { q: noul('True?') } };
const native = { input: '', questions: [{ type: 'predicate', instructions: 'True?' }] };
const commonImage = dataUrl => ({ input: [{ type: 'image', dataUrl }], questions: common.questions });
const nativeImage = image_url => ({ ...native, input: [{ role: 'user', content: [{ type: 'input_image', image_url }] }] });

test('multi-megabyte base64 payloads reach both transports without regex stack overflow', async () => {
    const { bridge, provider, requests } = fixture();
    const dataUrl = 'data:image/png;base64,' + 'AAAA'.repeat(1500000);
    assert.equal((await bridge.evaluate(commonImage(dataUrl))).answers.q.noul, 0.7);
    assert.equal((await provider.createDecision(nativeImage(dataUrl))).decision.answers[0].probability, 0.7);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].input[0].content[0].image_url, dataUrl);
    assert.equal(requests[1].input[0].content[0].image_url, dataUrl);
});

test('base64 validation retains padding rules and rejects malformed images before dispatch', async () => {
    const { bridge, provider, requests } = fixture();
    for (const payload of ['', 'A', 'AAA', 'A===', 'AAAA=', 'AA=A', 'AAAA\n', 'AAAA!AAA']) {
        const dataUrl = 'data:image/png;base64,' + payload;
        assert.throws(() => bridge.validate(commonImage(dataUrl)), { code: 'VALIDATION_ERROR' });
        await assert.rejects(provider.createDecision(nativeImage(dataUrl)), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(requests.length, 0);
    for (const payload of ['AAAA', 'AAA=', 'AA==', 'a+/0']) {
        const dataUrl = 'data:image/png;base64,' + payload;
        bridge.validate(commonImage(dataUrl));
        await provider.createDecision(nativeImage(dataUrl));
    }
    assert.equal(requests.length, 4);
});

test('choice policy rejects malformed typed entries and accessors without invoking them', () => {
    for (const item of [null, false, [], 'true']) {
        assert.throws(() => decideChoice({ type: 'choice', choice: true, probabilities: [item] },
            { minProbability: 0.5 }), { code: 'INVALID_RESPONSE' });
    }
    let called = 0;
    for (const typed of [false, true]) {
        const probabilities = typed ? [{ get value() { called++; return true; }, probability: 1 }]
            : { get true() { called++; return 1; } };
        assert.throws(() => decideChoice({ type: 'choice', choice: typed ? true : 'true', probabilities },
            { minProbability: 0.5 }), { code: 'INVALID_RESPONSE' });
    }
    assert.equal(called, 0);
    assert.equal(decideChoice({ type: 'choice', choice: true, probabilities: [
        { value: true, probability: 0.8 }, { value: 'true', probability: 0.2 },
    ] }, { minProbability: 0.5, abstainOptions: ['true'] }).status, 'selected');
});

test('safety identifiers preserve Unicode while admission lengths remain upstream', async () => {
    const { bridge, provider, requests } = fixture();
    const identifier = '\u{1F600}'.repeat(129);
    await bridge.evaluate({ ...common, safetyIdentifier: identifier });
    await provider.createDecision({ ...native, safety_identifier: identifier });
    assert.equal(requests[0].safety_identifier, identifier);
    assert.equal(requests[1].safety_identifier, identifier);
    assert.throws(() => bridge.validate({ ...common, safetyIdentifier: 1 }), { code: 'VALIDATION_ERROR' });
});
test('large native instructions preserve Unicode within the configured wire budget', async () => {
    const { provider, requests } = fixture();
    const instructions = '\u{1F600}'.repeat(1048577);
    await provider.createDecision({ ...native, questions: [{ type: 'predicate', instructions }] });
    assert.equal(requests[0].questions[0].instructions, instructions);
    assert.equal(requests.length, 1);
});
