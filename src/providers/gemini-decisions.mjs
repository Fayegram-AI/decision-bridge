/** Native Gemini Decisions provider with dedicated wire and common entry points. */
import { optionsObject, TRANSPORT_FIELDS } from '../options.mjs';
import { requireCondition as check, withResponseMeta } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { builtInCapabilities } from '../capabilities.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../transport.mjs';
import { providerEnvironmentValue } from '../runtime-env.mjs';
import { GEMINI_MODEL, GEMINI_ORIGIN, GEMINI_KEY_ENV, GEMINI_REQUEST_CEILING, GEMINI_JSON_NODES, geminiModel } from './gemini-profile.mjs';
import { prepareGeminiDecision } from './gemini-input.mjs';
import { prepareCommonGeminiDecision, decodeCommonGeminiDecision } from './gemini-codec.mjs';
import { geminiError, validateGeminiDecision } from './gemini-response.mjs';

export class GeminiDecisionsProvider {
    name = 'gemini-decisions';
    kind = 'decision';
    probabilitySource = 'native';
    #transport;
    #settings;

    constructor(options = {}) {
        const { apiKey, model = GEMINI_MODEL, baseURL = GEMINI_ORIGIN, maxRetries = 0, ...transport } =
            optionsObject(options, ['apiKey', 'model', 'baseURL', ...TRANSPORT_FIELDS], 'Gemini Decisions options');
        const endpoint = parseBaseURL(baseURL, { originOnly: true });
        const key = validateApiKey(apiKey === undefined && endpoint.origin === GEMINI_ORIGIN
            ? providerEnvironmentValue(GEMINI_KEY_ENV) : apiKey, GEMINI_KEY_ENV);
        this.defaultModel = geminiModel(model);
        this.#settings = { model: this.defaultModel, maxRequestBytes: transport.maxRequestBytes };
        this.#transport = new JsonTransport({ ...transport, maxRetries, baseURL: endpoint.baseURL,
            requestByteCeiling: GEMINI_REQUEST_CEILING,
            headers: { 'x-goog-api-key': key }, secrets: [key], errorDecoder: geminiError });
    }

    getCapabilities(model = this.defaultModel) { return builtInCapabilities(this.name, model); }
    getResultValidationOptions() { return { native: true, maxJsonNodes: GEMINI_JSON_NODES }; }
    validateRequest(request) { prepareCommonGeminiDecision(request, this.#settings); }

    async #perform(request, options) {
        const { data, meta } = await this.#transport.request('POST', '/v1beta/decisions', request, options);
        const transport = { ...meta, requestedModel: request.model };
        const decision = withResponseMeta(transport, () => validateGeminiDecision(data, request));
        return freezeJson({ decision, meta: transport });
    }

    async createDecision(input, options = {}) {
        return this.#perform(prepareGeminiDecision(input, this.#settings), options);
    }

    async evaluate(input, options = {}) {
        const prepared = prepareCommonGeminiDecision(input, this.#settings);
        const { decision, meta } = await this.#perform(prepared.native, options);
        return withResponseMeta(meta, () => decodeCommonGeminiDecision(decision, prepared, meta));
    }

    async listModels(options = {}) {
        const { data, meta } = await this.#transport.request('GET', '/v1beta/models/' + GEMINI_MODEL, undefined, options);
        return withResponseMeta(meta, () => {
            const model = cloneJson(data, 'Gemini model', 'INVALID_RESPONSE');
            check(isRecord(model) && model.name === 'models/' + GEMINI_MODEL, 'Invalid Gemini model response.', 'INVALID_RESPONSE');
            return freezeJson({ models: [{ ...model, name: GEMINI_MODEL, resourceName: model.name }] });
        });
    }
}
