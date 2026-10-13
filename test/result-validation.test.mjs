import { test } from 'node:test';
import assert from 'node:assert/strict';
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
