import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateRequest, validateResult } from '../src/index.mjs';

// Standalone validation accepts the same lossless JSON objects as requests.
for (const field of ['criteria', 'levels']) {
    test(`standalone result validation snapshots null-prototype score ${field}`, () => {
        const description = Object.assign(Object.create(null), { meaning: 'Low severity' });
        const low = field === 'levels'
            ? Object.assign(Object.create(null), { label: 'Low', description })
            : description;
        const high = field === 'levels' ? { label: 'High' } : 'High severity';
        const questions = Object.assign(Object.create(null), {
            rating: { type: 'score', instructions: 'Rate.', [field]: [low, high] },
        });
        const result = {
            model: 'fixture',
            answers: { rating: {
                type: 'score', score: 0.5, probabilities: { 0: 0.5, 1: 0.5 },
                legend: { 0: low, 1: high },
            } },
            usage: { input_tokens: 0, output_tokens: 0 },
        };
        const request = validateRequest({ model: 'fixture', state: '', questions });
        const validated = validateResult(result, questions);
        assert.deepEqual(validated, validateResult(result, request.questions));
        assert.notEqual(validated.answers.rating.legend[0], low);
        assert.equal(Object.getPrototypeOf(questions), null);
        assert.equal(Object.getPrototypeOf(low), null);
        assert.equal(Object.isFrozen(description), false);

        const legend = validated.answers.rating.legend[0];
        const returnedDescription = field === 'levels' ? legend.description : legend;
        returnedDescription.meaning = 'Changed';
        assert.equal(description.meaning, 'Low severity');
        assert.throws(() => validateResult(validated, questions), { code: 'INVALID_RESPONSE' });
    });
}

for (const type of ['choice', 'score']) {
    test(`standalone result validation rejects ${type} question accessors without invocation`, () => {
        let reads = 0;
        const item = {};
        Object.defineProperty(item, type === 'choice' ? 'value' : 'label', {
            enumerable: true,
            get() { reads++; return type === 'choice' ? true : 'Low'; },
        });
        const question = type === 'choice'
            ? { type, options: [item] }
            : { type, levels: [item, { label: 'High' }] };
        const answer = type === 'choice'
            ? { type, choice: true, probabilities: [{ value: true, probability: 1 }] }
            : { type, score: 0.5, probabilities: { 0: 0.5, 1: 0.5 },
                legend: { 0: { label: 'Low' }, 1: { label: 'High' } } };
        const result = {
            model: 'fixture', answers: { q: answer },
            usage: { input_tokens: 0, output_tokens: 0 },
        };
        assert.throws(() => validateResult(result, { q: question }), {
            code: 'VALIDATION_ERROR', message: /accessors/,
        });
        assert.equal(reads, 0);
    });
}

test('result policies ignore inherited values and getters without weakening native validation', () => {
    // Keep prototype changes outside the test runner and concurrent suites.
    const entry = new URL('../src/index.mjs', import.meta.url).href;
    const cloudflare = new URL('../src/providers/cloudflare-profile.mjs', import.meta.url).href;
    const jev = new URL('../src/providers/jev-profile.mjs', import.meta.url).href;
    const code = `import assert from 'node:assert/strict';
import { createBridge, validateResult } from ${JSON.stringify(entry)};
import { CLOUDFLARE_RESULT_OPTIONS } from ${JSON.stringify(cloudflare)};
import { JEV_RESULT_OPTIONS } from ${JSON.stringify(jev)};
const questions = { q: { type: 'noul', instructions: 'True?' } };
const result = { model: 'fixture', answers: { q: { type: 'noul', noul: 0.8 } },
    usage: { input_tokens: null, output_tokens: null } };
const labels = Array.from({ length: 255 }, (_, i) => String(i));
const choice = { q: { type: 'choice', instructions: 'Pick.',
    criteria: Object.fromEntries(labels.map(label => [label, null])) } };
const rounded = { model: 'fixture', answers: { q: { type: 'choice', choice: '0', confidence: 0.8,
    probabilities: Object.fromEntries(labels.map(label => [label, 0.0039])) } },
    usage: { input_tokens: 1, output_tokens: 0 } };
for (const field of ['native', 'nullableUsage', 'probabilityDecimalPlaces']) {
    for (const mode of ['value', 'getter']) {
        let reads = 0;
        const value = field === 'probabilityDecimalPlaces' ? 4 : true;
        try {
            Object.defineProperty(Object.prototype, field, { configurable: true,
                ...(mode === 'value' ? { value } : { get() { reads++; return value; } }) });
            if (field === 'native') {
                assert.equal(validateResult(result, questions).usage.input_tokens, null);
            } else if (field === 'nullableUsage') {
                assert.throws(() => validateResult(result, questions, CLOUDFLARE_RESULT_OPTIONS), { code: 'INVALID_RESPONSE' });
                const provider = { kind: 'decision', name: 'fixture', defaultModel: 'fixture',
                    getResultValidationOptions() { return { native: true }; }, async evaluate() { return result; } };
                await assert.rejects(createBridge({ provider }).evaluate({ state: '', questions }), { code: 'INVALID_RESPONSE' });
                assert.equal(validateResult(result, questions, JEV_RESULT_OPTIONS).usage.input_tokens, null);
            } else {
                assert.throws(() => validateResult(rounded, choice, { native: true }), { code: 'INVALID_RESPONSE' });
                assert.equal(validateResult(rounded, choice, CLOUDFLARE_RESULT_OPTIONS).answers.q.choice, '0');
            }
        } finally { delete Object.prototype[field]; }
        assert.equal(reads, 0);
    }
}
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
});
