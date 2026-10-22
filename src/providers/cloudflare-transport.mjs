import { requireCondition as check } from '../errors.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../transport.mjs';
import { JsonResponseTransport } from '../response-transport.mjs';
import { environmentValue } from '../runtime-env.mjs';
import { cloudflareGatewayHeaders, cloudflareRequestLimit } from './cloudflare-profile.mjs';
import { cloudflareBindingBody } from './cloudflare-preflight.mjs';
import { cloudflareError } from './cloudflare-validation.mjs';

const responseMetadata = response => ({
    requestId: response.headers.get('cf-ai-req-id') ?? response.headers.get('x-request-id') ?? response.headers.get('request-id'),
    gatewayLogId: response.headers.get('cf-aig-log-id'),
});

/** The two dispatch mechanisms share bounded reads, cancellation, retries and errors. */
export class CloudflareTransport {
    #transports = new Map();
    #ceiling;
    #kind;
    #accountId;
    #ai;
    #gateway;
    #requestLimit;
    #bindingBody;

    constructor(options, { requestLimit = cloudflareRequestLimit, bindingBody = cloudflareBindingBody,
        models = ['clef', 'clef-omni'] } = {}) {
        const { transport = 'rest', accountId, apiKey, baseURL = 'https://api.cloudflare.com',
            ai, gateway, fetchImpl, model: _model, rejectIfBusy: _busy, ...limits } = options;
        this.#kind = transport;
        this.#gateway = gateway;
        this.#ceiling = limits.maxRequestBytes;
        this.#requestLimit = model => requestLimit(model, this.#ceiling);
        this.#bindingBody = bindingBody;
        const shared = { ...limits, errorDecoder: cloudflareError, responseMetadata };
        const byteLimits = new Set(models.map(model => this.#requestLimit(model)));
        if (transport === 'binding') {
            check(ai !== null && typeof ai === 'object' && typeof ai.run === 'function',
                'Binding transport requires an ai binding with run().', 'CONFIGURATION_ERROR');
            this.#ai = ai;
            for (const limit of byteLimits) this.#transports.set(limit,
                new JsonResponseTransport({ ...shared, maxRequestBytes: limit }));
        } else {
            const endpoint = parseBaseURL(baseURL, { originOnly: true });
            const official = endpoint.origin === 'https://api.cloudflare.com';
            const account = accountId === undefined && official ? environmentValue('CLOUDFLARE_ACCOUNT_ID') : accountId;
            check(typeof account === 'string' && /^[A-Za-z0-9_-]+$/.test(account.trim()) &&
                !/^(replace_with_|your_actual_|paste_)/i.test(account.trim()),
            'Set CLOUDFLARE_ACCOUNT_ID or supply a URL-safe accountId.', 'CONFIGURATION_ERROR');
            this.#accountId = account.trim();
            const key = validateApiKey(apiKey === undefined && official ? environmentValue('CLOUDFLARE_API_TOKEN') : apiKey,
                'CLOUDFLARE_API_TOKEN');
            for (const limit of byteLimits) this.#transports.set(limit, new JsonTransport({ ...shared,
                maxRequestBytes: limit, baseURL: endpoint.baseURL,
                ...(fetchImpl === undefined ? {} : { fetchImpl }), secrets: [key],
                headers: { authorization: 'Bearer ' + key, ...cloudflareGatewayHeaders(gateway) } }));
        }
    }

    request(request, options) {
        const transport = this.#transports.get(this.#requestLimit(request.model));
        if (this.#kind === 'rest') return transport.request('POST',
            '/client/v4/accounts/' + encodeURIComponent(this.#accountId) + '/ai/run/@cf/cloudflare/' + request.model,
            request, options);
        const body = this.#bindingBody(request, this.#gateway);
        return transport.request(body, (_serialized, signal) => this.#ai.run(
            '@cf/cloudflare/' + request.model, body.inputs, { ...body.options, signal }), options);
    }
}

export class CloudflareDecisionTransport extends CloudflareTransport {}
