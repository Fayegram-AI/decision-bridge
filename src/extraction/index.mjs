import { optionsObject, TRANSPORT_FIELDS } from '../options.mjs';
import { DecisionError, requireCondition as check, withResponseMeta } from '../errors.mjs';
import { deadline } from '../async.mjs';
import { cloneJson, freezeJson } from '../validation.mjs';
import { CloudflareTransport } from '../providers/cloudflare-transport.mjs';
import { cloudflareGateway, validateCloudflareLimits } from '../providers/cloudflare-profile.mjs';
import { unwrapCloudflareResponse } from '../providers/cloudflare-validation.mjs';
import { validateExtractionRequest, validateExtractionResponse, extractionModel } from './validation.mjs';
import { evaluateBatch } from '../batch.mjs';

export { validateExtractionRequest } from './validation.mjs';

/** Typed extraction remains independent of the decision bridge's answer contract. */
export class CloudflareExtractionProvider {
    name = 'cloudflare-extraction';
    kind = 'extraction';
    #settings;
    #transport;
    #timeoutMs;

    constructor(options = {}) {
        const supplied = optionsObject(options, ['transport', 'accountId', 'apiKey', 'baseURL', 'ai', 'model',
            'rejectIfBusy', 'gateway', ...TRANSPORT_FIELDS], 'Cloudflare extraction options');
        const transport = supplied.transport === undefined ? 'rest' : supplied.transport;
        check(['rest', 'binding'].includes(transport), 'Unknown Cloudflare transport.', 'CONFIGURATION_ERROR');
        check(transport !== 'binding' || ['accountId', 'apiKey', 'baseURL', 'fetchImpl'].every(key => supplied[key] === undefined),
            'Binding transport does not accept REST credentials or HTTP options.', 'CONFIGURATION_ERROR');
        check(transport !== 'rest' || supplied.ai === undefined, 'REST transport does not accept an ai binding.', 'CONFIGURATION_ERROR');
        this.defaultModel = extractionModel(supplied.model);
        this.#timeoutMs = supplied.timeoutMs ?? 30000;
        const gateway = cloudflareGateway(supplied.gateway);
        this.#settings = { model: this.defaultModel, transport, gateway, ...validateCloudflareLimits({ ...supplied, gateway }) };
        this.#transport = new CloudflareTransport({ ...supplied, ...this.#settings }, {
            models: ['clairic'], requestLimit: (_model, ceiling) => ceiling ?? 8 * 1024 * 1024,
        });
    }

    validate(request) { return validateExtractionRequest(request, this.#settings); }

    async extract(input, options = {}) {
        const { signal } = optionsObject(options, ['signal'], 'Extraction call options');
        const budget = deadline(this.#timeoutMs, signal);
        try {
            budget.throwIfAborted();
            const snapshot = cloneJson(input, 'extraction request');
            const request = this.validate(snapshot);
            const requestedModel = snapshot.model ?? this.#settings.model;
            budget.throwIfAborted();
            const { data, meta } = await this.#transport.request(request, { signal: budget.signal });
            const extraction = withResponseMeta(meta, () => validateExtractionResponse(
                unwrapCloudflareResponse(data, this.#settings.transport, meta), request));
            budget.throwIfAborted();
            return freezeJson({ extraction, meta: { ...meta, provider: 'cloudflare-extraction',
                requestedModel, resolvedModel: request.model } });
        } catch (error) {
            const details = error instanceof DecisionError ? error.toJSON() : {};
            if (signal?.aborted) throw new DecisionError('Extraction cancelled.', { ...details, code: 'ABORTED', source: 'client' });
            if (budget.timedOut) throw new DecisionError('Extraction deadline exceeded.', { ...details, code: 'TIMEOUT', source: 'client' });
            throw error;
        } finally { budget.close(); }
    }
}

/** Reuse the existing ordered, preflighted, caller-controlled batch implementation. */
export function extractBatch(provider, inputs, options = {}) {
    check(provider && typeof provider.validate === 'function' && typeof provider.extract === 'function',
        'An extraction provider is required.', 'CONFIGURATION_ERROR');
    return evaluateBatch({
        validate(input) {
            // Preflight resolves the wire model, but dispatch must retain the caller's
            // selection for diagnostics. Snapshot before validation and async work.
            const request = cloneJson(input, 'extraction request');
            provider.validate(request);
            return freezeJson(request);
        },
        evaluate: (input, call) => provider.extract(input, call),
    }, inputs, options);
}
