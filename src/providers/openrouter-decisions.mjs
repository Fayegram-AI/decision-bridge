// Native Decisions protocol, with a separate projection into the common probability contract.
import { requireCondition as check, withResponseMeta } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord, validateRequest, validateResult } from '../validation.mjs';
import { LEGACY_CAPABILITIES, assertCapabilities } from '../capabilities.mjs';
import { validateProbabilitySum } from '../probabilities.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { fields } from './decisions-input.mjs';
import { openRouterSettings, openRouterTransport, openRouterRequest, openRouterResponse, openRouterMeta, openRouterModels } from './openrouter-shared.mjs';
import { validateOpenRouterAssets, validateOpenRouterMedia, openRouterInputPart } from './openrouter-assets.mjs';
import { openRouterProfile } from './openrouter-profile.mjs';

export function openRouterCapabilities(model) {
    return freezeJson({ ...LEGACY_CAPABILITIES, ...openRouterProfile(model).capabilities });
}

const entry = value => typeof value === 'string' || Array.isArray(value) || isRecord(value);

export function prepareOpenRouterDecision(input, settings = {}) {
    const request = openRouterRequest(input, settings, ['state', 'questions', 'assets']);
    check(entry(request.state), 'Decisions state must be text, an object or an array.');
    check(isRecord(request.questions) && Object.keys(request.questions).length > 0, 'Decisions require named questions.');
    for (const [name, question] of Object.entries(request.questions)) {
        check(name.trim() && isRecord(question) && ['noul', 'choice', 'score', 'box'].includes(question.type), 'Invalid decision question.');
        fields(question, ['type', 'instructions', ...(question.type === 'box' ? [] : ['criteria'])], ['type', 'instructions'], 'question');
        check(entry(question.instructions), 'Invalid instructions.');
        if (question.type === 'choice') {
            check(isRecord(question.criteria) && Object.keys(question.criteria).length > 0 &&
                Object.values(question.criteria).every(v => v === null || entry(v)), 'Invalid choice criteria.');
        } else if (question.type === 'score') check(Array.isArray(question.criteria) && question.criteria.length > 0 &&
            question.criteria.every(entry), 'Invalid score criteria.');
        else if (question.criteria !== undefined) check(isRecord(question.criteria) &&
            Object.keys(question.criteria).every(k => ['true', 'false'].includes(k)) && Object.values(question.criteria).every(entry), 'Invalid noul criteria.');
    }
    serializeRequestBody(request, settings.maxRequestBytes);
    validateOpenRouterAssets(request);
    validateOpenRouterMedia(request);
    return freezeJson(request);
}

export function prepareCommonOpenRouterDecision(input, settings = {}) {
    const request = validateRequest(input, settings.model ?? '');
    assertCapabilities(request, openRouterCapabilities(request.model));
    const questions = Object.fromEntries(Object.entries(request.questions).map(([id, q]) => [id, {
        type: q.type, instructions: q.instructions,
        ...(q.options ? { criteria: Object.fromEntries(q.options.map((o, i) => ['option_' + i, o.description ?? String(o.value)])) }
            : q.levels ? { criteria: q.levels } : q.criteria === undefined ? {} : { criteria: q.criteria }),
    }]));
    const state = request.input ? request.input.map(p => openRouterInputPart(p, request.model)) : request.state;
    const native = prepareOpenRouterDecision({ model: request.model, state, questions }, settings);
    return { request, native };
}

export function validateOpenRouterDecision(input, request) {
    const data = openRouterResponse(input);
    const valid = (condition, message) => check(condition, message, 'INVALID_RESPONSE');
    const probability = value => typeof value === 'number' && value >= 0 && value <= 1;
    valid(Object.keys(data.answers).length === Object.keys(request.questions).length, 'Decision answer count mismatch.');
    for (const [id, q] of Object.entries(request.questions)) {
        const a = data.answers[id];
        valid(Object.hasOwn(data.answers, id) && isRecord(a) && a.type === q.type, 'Decision answer type mismatch.');
        if (a.confidence !== undefined) valid(probability(a.confidence), 'Invalid confidence.');
        if (q.type === 'noul') valid(probability(a.noul), 'Invalid noul probability.');
        else if (q.type === 'box') valid(isRecord(a.box) && ['top', 'bottom', 'left', 'right'].every(k => probability(a.box[k])) &&
            a.box.left < a.box.right && a.box.top < a.box.bottom, 'Invalid box.');
        else {
            const labels = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
            if (q.type === 'choice') valid(typeof a.choice === 'string' && labels.includes(a.choice), 'Invalid selected choice.');
            else valid(typeof a.score === 'number' && a.score >= 0 && a.score <= q.criteria.length - 1, 'Invalid score.');
            if (a.probabilities !== undefined) {
                valid(isRecord(a.probabilities) && Object.keys(a.probabilities).length === labels.length &&
                    labels.every(k => Object.hasOwn(a.probabilities, k) && probability(a.probabilities[k])), 'Invalid probabilities.');
                validateProbabilitySum(Object.values(a.probabilities), 4);
            }
            if (q.type === 'score' && a.legend !== undefined) valid(isRecord(a.legend) && Object.values(a.legend).every(entry), 'Invalid score legend.');
        }
    }
    return freezeJson(data);
}

export class OpenRouterDecisionsProvider {
    name = 'openrouter-decisions';
    kind = 'decision';
    probabilitySource = 'native';
    #settings;
    #transport;
    constructor(options = {}) {
        this.#settings = openRouterSettings(options);
        this.defaultModel = this.#settings.model;
        this.#transport = openRouterTransport(this.#settings);
    }
    getCapabilities(model = this.defaultModel) { return openRouterCapabilities(model); }
    // Native optional confidence is independent of native probability provenance.
    getResultValidationOptions() { return { probabilityDecimalPlaces: 4 }; }
    validateRequest(input) { prepareCommonOpenRouterDecision(input, this.#settings); }
    async createDecision(input, options = {}) {
        return this.#perform(prepareOpenRouterDecision(input, this.#settings), options);
    }
    async #perform(request, options) {
        const path = this.#settings.api === 'systemone' ? '/api/v1/systemone' : '/api/alpha/decisions';
        const { data, meta } = await this.#transport.request('POST', path, request, options);
        const decision = withResponseMeta(meta, () => validateOpenRouterDecision(data, request));
        return freezeJson({ decision, meta: { ...openRouterMeta(decision, meta, request.model), provider: this.name } });
    }
    async evaluate(input, options = {}) {
        const { request, native } = prepareCommonOpenRouterDecision(input, this.#settings);
        const { decision, meta } = await this.#perform(native, options);
        return withResponseMeta(meta, () => {
            const answers = cloneJson(decision.answers);
            const nativeDetails = Object.create(null);
            for (const [id, q] of Object.entries(request.questions)) {
                const a = answers[id];
                // Common Noul answers carry only the probability; retain extra native confidence in metadata.
                if (q.type === 'noul' && a.confidence !== undefined) {
                    nativeDetails[id] = { confidence: a.confidence };
                    delete a.confidence;
                }
                if (['choice', 'score'].includes(q.type)) check(a.probabilities !== undefined,
                    'This response lacks probabilities required by evaluate(); use createDecision() for native answers.', 'UNSUPPORTED_CAPABILITY');
                if (q.options) {
                    a.choice = q.options[Number(a.choice.slice('option_'.length))].value;
                    a.probabilities = q.options.map((o, i) => ({ value: o.value, probability: a.probabilities['option_' + i] }));
                }
                if (q.type === 'score' && a.legend === undefined) a.legend = Object.fromEntries((q.levels ?? q.criteria).map((v, i) => [i, v]));
            }
            return freezeJson(validateResult({ model: decision.model, answers,
                usage: { input_tokens: decision.usage.input_tokens, output_tokens: decision.usage.output_tokens },
                meta: { ...meta, probabilitySource: 'native', modelSource: 'reported', openRouter: { usage: decision.usage,
                    ...(Object.keys(nativeDetails).length ? { answers: nativeDetails } : {}) } },
            }, request.questions, this.getResultValidationOptions()));
        });
    }
    listModels(options = {}) { return openRouterModels(this.#transport, options, this.#settings.api); }
}
