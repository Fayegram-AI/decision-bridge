import { optionsObject, TRANSPORT_FIELDS } from '../options.mjs';
import { DecisionError, requireCondition as check, withResponseMeta } from '../errors.mjs';
import { freezeJson } from '../validation.mjs';
import { deadline } from '../async.mjs';
import { builtInCapabilities } from '../capabilities.mjs';
import { cloudflareModel, cloudflareGateway, validateCloudflareLimits, CLOUDFLARE_RESULT_OPTIONS } from './cloudflare-profile.mjs';
import { CloudflareDecisionTransport } from './cloudflare-transport.mjs';
import { preflightCloudflareDecision, preflightCommonCloudflareDecision, prepareCommonCloudflareDecision } from './cloudflare-preflight.mjs';
import { validateCloudflareResponse, unwrapCloudflareResponse } from './cloudflare-validation.mjs';
import { decodeCloudflareDecision } from './cloudflare-codec.mjs';

/** Dedicated hosted Clef inference, with common and native access sharing one codec. */
export class CloudflareDecisionsProvider {
    name = 'cloudflare-decisions';
    kind = 'decision';
    probabilitySource = 'native';
    #transport;
    #settings;
    #timeoutMs;

    constructor(options = {}) {
        const supplied = optionsObject(options, ['transport', 'accountId', 'apiKey', 'baseURL', 'ai', 'model',
            'rejectIfBusy', 'gateway', ...TRANSPORT_FIELDS], 'Cloudflare Decisions options');
        const kind = supplied.transport === undefined ? 'rest' : supplied.transport;
        check(['rest', 'binding'].includes(kind), 'Unknown Cloudflare transport.', 'CONFIGURATION_ERROR');
        check(kind !== 'binding' || ['accountId', 'apiKey', 'baseURL', 'fetchImpl'].every(key => supplied[key] === undefined),
            'Binding transport does not accept REST credentials or HTTP options.', 'CONFIGURATION_ERROR');
        check(kind !== 'rest' || supplied.ai === undefined, 'REST transport does not accept an ai binding.', 'CONFIGURATION_ERROR');
        const gateway = cloudflareGateway(supplied.gateway);
        const limits = validateCloudflareLimits({ ...supplied, gateway });
        this.defaultModel = cloudflareModel(supplied.model);
        this.#settings = { model: this.defaultModel, transport: kind, gateway, ...limits };
        this.#timeoutMs = supplied.timeoutMs ?? 30000;
        this.#transport = new CloudflareDecisionTransport({ ...supplied, ...this.#settings });
    }

    getCapabilities(model = this.defaultModel) { return builtInCapabilities(this.name, model); }
    getResultValidationOptions() { return CLOUDFLARE_RESULT_OPTIONS; }
    validateRequest(request) { preflightCommonCloudflareDecision(request, this.#settings); }

    async #perform(request, options) {
        const { data, meta } = await this.#transport.request(request, options);
        const decision = withResponseMeta(meta, () => validateCloudflareResponse(
            unwrapCloudflareResponse(data, this.#settings.transport, meta), request));
        return freezeJson({ decision, meta });
    }

    async #call(options, operation) {
        const { signal } = optionsObject(options, ['signal'], 'Provider call options');
        const budget = deadline(this.#timeoutMs, signal);
        try {
            budget.throwIfAborted();
            const result = await operation({ signal: budget.signal }, budget);
            budget.throwIfAborted();
            return result;
        } catch (error) {
            const diagnostics = error instanceof DecisionError ? error.toJSON() : {};
            if (signal?.aborted) throw new DecisionError('Request cancelled by caller.', { ...diagnostics, code: 'ABORTED' });
            if (budget.timedOut) throw new DecisionError('Cloudflare inference deadline exceeded.', { ...diagnostics, code: 'TIMEOUT' });
            throw error;
        } finally { budget.close(); }
    }

    createDecision(input, options = {}) {
        return this.#call(options, (call, budget) => {
            const request = preflightCloudflareDecision(input, this.#settings);
            budget.throwIfAborted();
            return this.#perform(request, call);
        });
    }

    evaluate(input, options = {}) {
        return this.#call(options, async (call, budget) => {
            const { request, native } = prepareCommonCloudflareDecision(input, this.#settings);
            budget.throwIfAborted();
            const { decision, meta } = await this.#perform(native, call);
            budget.throwIfAborted();
            return freezeJson(withResponseMeta(meta, () => decodeCloudflareDecision(decision, request, meta)));
        });
    }
}
