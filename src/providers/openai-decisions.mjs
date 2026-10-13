import { optionsObject, TRANSPORT_FIELDS } from '../options.mjs';
import { requireCondition as check, withResponseMeta } from '../errors.mjs';
import { freezeJson } from '../validation.mjs';
import { builtInCapabilities } from '../capabilities.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../transport.mjs';
import { environmentValue } from '../runtime-env.mjs';
import { validateDecisionResponse } from './decisions-validation.mjs';
import { encodeCommonDecision, decodeCommonDecision } from './decisions-codec.mjs';
import { preflightCommonDecision, preflightDecision } from './decisions-preflight.mjs';

/** Native Decisions transport. Common and dedicated access share a single codec. */
export class OpenAIDecisionsProvider {
    name = 'openai-decisions';
    kind = 'decision';
    probabilitySource = 'native';
    #transport;
    #maxRequestBytes;

    constructor(options = {}) {
        const { apiKey, model = 'gpt-6-luna', baseURL = 'https://api.openai.com', maxRetries = 0, ...transportOptions } =
            optionsObject(options, ['apiKey', 'model', 'baseURL', ...TRANSPORT_FIELDS], 'OpenAI Decisions options');
        const endpoint = parseBaseURL(baseURL, { originOnly: true });
        const supplied = apiKey === undefined && endpoint.origin === 'https://api.openai.com'
            ? environmentValue('OPENAI_API_KEY') : apiKey;
        const key = validateApiKey(supplied, 'OPENAI_API_KEY');
        check(typeof model === 'string' && model.trim(), 'model must be nonempty.', 'CONFIGURATION_ERROR');
        this.defaultModel = model.trim();
        this.#transport = new JsonTransport({ ...transportOptions, maxRetries, baseURL: endpoint.baseURL,
            headers: { authorization: `Bearer ${key}` }, secrets: [key] });
        this.#maxRequestBytes = transportOptions.maxRequestBytes;
    }

    getCapabilities(model = this.defaultModel) { return builtInCapabilities(this.name, model); }

    validateRequest(request) {
        preflightCommonDecision(request, { model: this.defaultModel, maxRequestBytes: this.#maxRequestBytes });
    }

    async createDecision(input, options = {}) {
        const request = preflightDecision(input, { model: this.defaultModel, maxRequestBytes: this.#maxRequestBytes });
        const { data, meta } = await this.#transport.request('POST', '/v1/decisions', request, options);
        const decision = withResponseMeta(meta, () => validateDecisionResponse(data, request));
        return freezeJson({ decision, meta });
    }

    async evaluate(input, options = {}) {
        const request = preflightCommonDecision(input, { model: this.defaultModel, maxRequestBytes: this.#maxRequestBytes });
        const { decision, meta } = await this.createDecision(encodeCommonDecision(request), options);
        return freezeJson(withResponseMeta(meta, () => decodeCommonDecision(decision, request, meta)));
    }
}
