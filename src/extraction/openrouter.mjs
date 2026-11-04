// OpenRouter Extractions keeps native optional fields and explicit model IDs.
import { requireCondition as check, withResponseMeta } from '../errors.mjs';
import { freezeJson, isRecord } from '../validation.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { embeddedDataUrl } from '../embedded.mjs';
import { openRouterSettings, openRouterTransport, openRouterRequest, openRouterResponse, openRouterMeta } from '../providers/openrouter-shared.mjs';
import { validateOpenRouterAssets } from '../providers/openrouter-assets.mjs';
import { validateExtractionStructure, validateExtractionField, validateExtractionResponse } from './validation.mjs';
import { extractionResult } from './result.mjs';

const common = ['type', 'instructions', 'null_threshold'];
const predictive = ['min', 'max', 'step', 'scale', 'unit'];
const keys = { text: [], date: [], datetime: [], time: [], number: ['unit', 'integer', 'decimals'],
    duration: ['unit', 'integer', 'decimals'], list: ['items', 'decimals'], estimate: predictive,
    forecast: [...predictive, 'horizon', 'interval'] };

export function prepareOpenRouterExtraction(input, settings = {}) {
    const request = openRouterRequest(input, settings, ['state', 'fields', 'assets', 'reference_date']);
    check(typeof request.state === 'string' && (request.state.length > 0 || Object.keys(request.assets ?? {}).length > 0),
        'Extraction requires state text or assets.');
    check(isRecord(request.fields) && Object.keys(request.fields).length > 0, 'Extraction requires named fields.');
    for (const [name, spec] of Object.entries(request.fields)) {
        check(name.trim() && isRecord(spec) && Object.hasOwn(keys, spec.type) && Object.keys(spec).every(k => [...common, ...keys[spec.type]].includes(k)),
            'Invalid extraction field.');
        validateExtractionField(spec, { allowZeroThreshold: true });
        check(spec.decimals === undefined || spec.decimals <= 6, 'OpenRouter decimals must be between 0 and 6.');
        if (spec.type === 'forecast') check(spec.horizon !== undefined && spec.horizon <= 64 && spec.interval !== undefined,
            'OpenRouter forecast requires a horizon from 1 to 64 and an interval.');
    }
    check(request.reference_date === undefined || typeof request.reference_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(request.reference_date),
        'reference_date must be an ISO date.');
    serializeRequestBody(request, settings.maxRequestBytes);
    validateOpenRouterAssets(request, { extraction: true });
    return freezeJson(request);
}

/** Keep the reusable common snapshot separate from its provider-specific wire form. */
function prepareCommonExtraction(input, settings) {
    const request = validateExtractionStructure(input);
    check(request.options === undefined || Object.keys(request.options).length === 0,
        'Cloudflare extraction options are not portable; configure OpenRouter providerPreferences.options explicitly.', 'UNSUPPORTED_CAPABILITY');
    const assets = {};
    const occupied = JSON.stringify(request);
    const refs = (request.images ?? []).map((image, index) => {
        const data = typeof image === 'string' ? embeddedDataUrl(image, 'image')
            : { format: image.content_type, payload: image.base64 };
        check(['image/png', 'image/jpeg', 'image/jpg'].includes(data.format), 'OpenRouter extraction assets require PNG/JPEG.');
        let reference = `__decision_bridge_image_${index}__`;
        while (occupied.includes(reference) || Object.hasOwn(assets, reference)) reference += '_';
        assets[reference] = { type: 'image', format: data.format === 'image/png' ? 'png' : 'jpg', data_base64: data.payload };
        return reference;
    });
    const native = prepareOpenRouterExtraction({ ...(request.model === undefined ? {} : { model: request.model }),
        state: [request.state ?? '', ...refs].filter(Boolean).join('\n'), fields: request.fields,
        ...(request.reference_date === undefined ? {} : { reference_date: request.reference_date }),
        ...(refs.length ? { assets } : {}),
    }, settings);
    return { request: freezeJson({ ...request, model: native.model }), native };
}

export function prepareCommonOpenRouterExtraction(input, settings = {}) {
    return prepareCommonExtraction(input, settings).native;
}

function response(data, request) {
    const result = validateExtractionResponse(openRouterResponse(data), request, { openRouter: true });
    for (const answer of Object.values(result.answers)) if (answer.type === 'forecast') validateForecast(answer);
    return result;
}

/** OpenRouter specifies predictive arrays explicitly; preserve unknown extension fields. */
function validateForecast(answer) {
    const valid = (condition, message) => check(condition, message, 'INVALID_RESPONSE');
    const scalar = value => typeof value === 'number' || typeof value === 'string';
    const values = value => Array.isArray(value) && value.every(scalar);
    valid(answer.value === null || values(answer.value), 'Invalid OpenRouter forecast value.');
    for (const key of ['guess', 'mean', 'median', 'p10', 'p90']) if (Object.hasOwn(answer, key)) {
        valid(values(answer[key]), 'Invalid OpenRouter forecast array.');
    }
    if (Object.hasOwn(answer, 'steps')) {
        valid(Array.isArray(answer.steps), 'Invalid OpenRouter forecast steps.');
        for (const step of answer.steps) {
            valid(isRecord(step) && Object.hasOwn(step, 'value') && (step.value === null || scalar(step.value)),
                'Invalid OpenRouter forecast step.');
            for (const key of ['mean', 'median', 'p10', 'p90']) if (Object.hasOwn(step, key)) {
                valid(scalar(step[key]), 'Invalid OpenRouter forecast statistic.');
            }
            if (Object.hasOwn(step, 'quantiles')) valid(values(step.quantiles), 'Invalid OpenRouter forecast quantiles.');
            for (const key of ['p_below', 'p_above']) if (Object.hasOwn(step, key)) {
                valid(typeof step[key] === 'number' && step[key] >= 0 && step[key] <= 1, 'Invalid OpenRouter forecast probability.');
            }
        }
    }
}

export class OpenRouterExtractionProvider {
    name = 'openrouter-extraction';
    kind = 'extraction';
    #settings;
    #transport;
    constructor(options = {}) {
        this.#settings = openRouterSettings(options, { extraction: true });
        this.defaultModel = this.#settings.model;
        this.#transport = openRouterTransport(this.#settings);
    }
    validate(input) { return prepareCommonExtraction(input, this.#settings).request; }
    validateResult(result, input) {
        const request = this.validate(input);
        return extractionResult(result, request, { provider: this.name, requestedModel: request.model, validateResponse: response });
    }
    async extract(input, options = {}) {
        return this.#perform(prepareCommonOpenRouterExtraction(input, this.#settings), options);
    }
    async createExtraction(input, options = {}) {
        return this.#perform(prepareOpenRouterExtraction(input, this.#settings), options);
    }
    async #perform(request, options) {
        const { data, meta } = await this.#transport.request('POST', '/api/alpha/extractions', request, options);
        const extraction = withResponseMeta(meta, () => response(data, request));
        return freezeJson({ extraction, meta: { ...openRouterMeta(extraction, meta, request.model), provider: this.name } });
    }
}
