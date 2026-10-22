import { optionsObject, TRANSPORT_FIELDS } from '../options.mjs';
import { requireCondition as check, withResponseMeta } from '../errors.mjs';
import { freezeJson } from '../validation.mjs';
import { builtInCapabilities } from '../capabilities.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../transport.mjs';
import { environmentValue } from '../runtime-env.mjs';
import { validateDecisionResponse } from './decisions-validation.mjs';
import { decodeCommonDecision } from './decisions-codec.mjs';
import { preflightCommonDecision, prepareCommonDecision, prepareDecision } from './decisions-preflight.mjs';
import { OPENAI_DEFAULT_MODEL } from './openai-profile.mjs';
import { openaiError } from './openai-errors.mjs';

/** Native Decisions transport. Common and dedicated access share a single codec. */
export class OpenAIDecisionsProvider {
    name = 'openai-decisions';
    kind = 'decision';
    probabilitySource = 'native';
    #transport;
    #maxRequestBytes;

    constructor(options = {}) {
        const { apiKey, model = OPENAI_DEFAULT_MODEL, baseURL = 'https://api.openai.com', maxRetries = 0, ...transportOptions } =
            optionsObject(options, ['apiKey', 'model', 'baseURL', ...TRANSPORT_FIELDS], 'OpenAI Decisions options');
        const endpoint = parseBaseURL(baseURL, { originOnly: true });
        const supplied = apiKey === undefined && endpoint.origin === 'https://api.openai.com'
            ? environmentValue('OPENAI_API_KEY') : apiKey;
        const key = validateApiKey(supplied, 'OPENAI_API_KEY');
        check(typeof model === 'string' && model.trim(), 'model must be nonempty.', 'CONFIGURATION_ERROR');
        this.defaultModel = model.trim();
        this.#transport = new JsonTransport({ ...transportOptions, maxRetries, errorDecoder: openaiError, baseURL: endpoint.baseURL,
            headers: { authorization: `Bearer ${key}` }, secrets: [key] });
        this.#maxRequestBytes = transportOptions.maxRequestBytes;
    }

    getCapabilities(model = this.defaultModel) { return builtInCapabilities(this.name, model); }

    validateRequest(request) {
        preflightCommonDecision(request, { model: this.defaultModel, maxRequestBytes: this.#maxRequestBytes });
    }

    /** Dispatch only prepared wire input; keep selection and reported identity independent. */
    async #perform({ request, native }, options) {
        const { data, meta: transport } = await this.#transport.request('POST', '/v1/decisions', native, options);
        const meta = { ...transport, requestedModel: request.model, resolvedModel: native.model };
        const decision = withResponseMeta(meta, () => validateDecisionResponse(data, native));
        return freezeJson({ decision, meta });
    }

    async createDecision(input, options = {}) {
        const prepared = prepareDecision(input, { model: this.defaultModel, maxRequestBytes: this.#maxRequestBytes });
        return this.#perform(prepared, options);
    }

    async evaluate(input, options = {}) {
        const prepared = prepareCommonDecision(input, { model: this.defaultModel, maxRequestBytes: this.#maxRequestBytes });
        const { decision, meta } = await this.#perform(prepared, options);
        return freezeJson(withResponseMeta(meta, () => decodeCommonDecision(decision, prepared.request, meta)));
    }
}
