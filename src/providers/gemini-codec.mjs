/** Common/native projection retains caller values separately from safe wire identifiers. */
import { requireCondition as check } from '../errors.mjs';
import { freezeJson, validateRequest, validateResult } from '../validation.mjs';
import { assertCapabilities, builtInCapabilities } from '../capabilities.mjs';
import { embeddedDataUrl } from '../embedded.mjs';
import { prepareGeminiDecision } from './gemini-input.mjs';
import { compareUtf8, GEMINI_MODEL, GEMINI_JSON_NODES } from './gemini-profile.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const encodeText = value => typeof value === 'string' ? value : JSON.stringify(value);
const identifier = (prefix, index) => prefix + String(index).padStart(3, '0');

function content(part) {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'json') return { type: 'text', text: JSON.stringify(part.data) };
    const remote = own(part, 'url');
    const embedded = remote ? undefined : embeddedDataUrl(part.dataUrl, part.type);
    const mime = part.type === 'document' ? 'application/pdf' : remote ? part.mimeType : embedded.format;
    check(typeof mime === 'string', 'Gemini remote media requires mimeType.');
    check(part.detail !== 'original', 'Use native resolution for Gemini ultra-high images.', 'UNSUPPORTED_CAPABILITY');
    return {
        type: part.type, mime_type: mime,
        ...(remote ? { uri: part.url } : { data: embedded.payload }),
        ...(['low', 'high'].includes(part.detail) ? { resolution: part.detail } : {}),
        ...(own(part, 'resolution') ? { resolution: part.resolution } : {}),
    };
}

export function prepareCommonGeminiDecision(input, settings = {}) {
    const request = validateRequest(input, settings.model ?? GEMINI_MODEL, { maxJsonNodes: GEMINI_JSON_NODES });
    assertCapabilities(request, builtInCapabilities('gemini-decisions', request.model));
    const mappings = Object.entries(request.questions).map(([id, question], index) => {
        const options = question.type !== 'choice' ? [] : question.options
            ? question.options.map(option => ({ value: option.value, description: option.description ?? null }))
            : Object.keys(question.criteria).sort(compareUtf8).map(value => ({ value, description: question.criteria[value] }));
        return { id, wireId: identifier('q', index), question,
            options: options.map((option, i) => ({ ...option, wireId: identifier('o', i) })) };
    });
    const questions = Object.fromEntries(mappings.map(({ wireId, question, options }) => {
        const instructions = own(question, 'instructionParts') ? question.instructionParts.map(content) : encodeText(question.instructions);
        let criteria;
        if (question.type === 'noul') {
            if (question.criteria !== undefined) criteria = Object.fromEntries(Object.entries(question.criteria).map(([key, value]) =>
                [key === 'true' ? 'true_description' : 'false_description', encodeText(value)]));
        } else if (question.type === 'choice') {
            criteria = Object.fromEntries(options.map(option => [option.wireId,
                JSON.stringify({ value: option.value, description: option.description })]));
        } else criteria = question.levels ? question.levels.map(level => JSON.stringify(level)) : question.criteria.map(encodeText);
        return [wireId, { type: question.type, instructions, ...(criteria === undefined ? {} : { criteria }) }];
    }));
    const native = prepareGeminiDecision({
        model: request.model,
        input: own(request, 'state') ? encodeText(request.state) : request.input.map(content),
        questions,
    }, settings);
    return freezeJson({ request, native, mappings });
}

export function decodeCommonGeminiDecision(decision, prepared, meta) {
    const details = [];
    const answers = Object.fromEntries(prepared.mappings.map(({ id, wireId, question, options }) => {
        const answer = decision.answers[wireId];
        details.push([id, { type: answer.type, confidence: answer.confidence }]);
        if (question.type === 'noul') return [id, { type: 'noul', noul: answer.noul }];
        if (question.type === 'choice') {
            const selected = options.find(option => option.wireId === answer.choice);
            return [id, { type: 'choice', choice: selected.value, confidence: answer.confidence,
                probabilities: question.options
                    ? options.map(option => ({ value: option.value, probability: answer.probabilities[option.wireId] }))
                    : Object.fromEntries(options.map(option => [option.value, answer.probabilities[option.wireId]])) }];
        }
        return [id, { type: 'score', score: answer.score, confidence: answer.confidence,
            probabilities: answer.probabilities,
            legend: Object.fromEntries((question.levels ?? question.criteria).map((level, index) => [String(index), level])) }];
    }));
    return freezeJson(validateResult({
        model: prepared.request.model, answers,
        usage: { input_tokens: decision.usage.total_input_tokens, output_tokens: decision.usage.total_output_tokens },
        meta: { ...meta, provider: 'gemini-decisions', probabilitySource: 'native', confidenceSource: 'native', modelSource: 'requested',
            geminiDecisions: { usage: decision.usage, answers: Object.fromEntries(details),
                ...(decision.prompt_feedback === undefined ? {} : { promptFeedback: decision.prompt_feedback }) } },
    }, prepared.request.questions, { native: true, maxJsonNodes: GEMINI_JSON_NODES }));
}
