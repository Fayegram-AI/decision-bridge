import { optionsObject, TRANSPORT_FIELDS } from '../../options.mjs';
import { withResponseMeta, requireCondition as check } from '../../errors.mjs';
import { isRecord, validateRequest } from '../../validation.mjs';
import { LEGACY_CAPABILITIES } from '../../capabilities.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../../transport.mjs';
import { environmentValue } from '../../runtime-env.mjs';
import { anthropicOptions, anthropicRequestCeiling } from './anthropic-options.mjs';
import { buildAnthropicBody, parseAnthropicMessage } from './anthropic-protocol.mjs';
import { createAnthropicThread, anthropicError } from './anthropic-thread.mjs';

/** Explicit structured output; cumulative sessions are created separately. */
export class AnthropicProvider {
    getCapabilities() { return LEGACY_CAPABILITIES; }
    name = 'anthropic';
    kind = 'generative';
    probabilitySource = 'elicited';
    #transport;
    #threadTransport;
    #options;
    #maxRequestBytes;
    #timeoutMs;

    constructor(options = {}) {
        const { apiKey, model, baseURL = 'https://api.anthropic.com', workspaceId,
            maxTokens = 4096, parameters = {}, responseFormat = 'tool', apiVersion = '2023-06-01', ...transportOptions } = optionsObject(options,
            ['apiKey', 'model', 'baseURL', 'workspaceId', 'maxTokens', 'parameters', 'responseFormat', 'apiVersion', ...TRANSPORT_FIELDS], 'Anthropic options');
        const endpoint = parseBaseURL(baseURL, { originOnly: true });
        const supplied = apiKey === undefined && endpoint.origin === 'https://api.anthropic.com' ? environmentValue('ANTHROPIC_API_KEY') : apiKey;
        const key = validateApiKey(supplied, 'ANTHROPIC_API_KEY');
        this.#options = anthropicOptions({ model, maxTokens, parameters, responseFormat, apiVersion, workspaceId });
        this.defaultModel = this.#options.model;
        this.#maxRequestBytes = transportOptions.maxRequestBytes ?? 8 * 1024 * 1024;
        this.#timeoutMs = transportOptions.timeoutMs ?? 30000;
        const transport = { ...transportOptions, baseURL: endpoint.baseURL, requestByteCeiling: anthropicRequestCeiling(baseURL),
            headers: { 'x-api-key': key, 'anthropic-version': apiVersion,
                ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}) }, secrets: [key], errorDecoder: anthropicError };
        this.#transport = new JsonTransport(transport);
        this.#threadTransport = new JsonTransport({ ...transport, maxRetries: 0,
            headers: { ...transport.headers, 'anthropic-beta': 'message-threads-2026-08-12' } });
    }

    async evaluate(input, options = {}) {
        const request = validateRequest(input, this.defaultModel ?? '');
        const body = buildAnthropicBody(request, this.#options);
        const { data, meta } = await this.#transport.request('POST', '/v1/messages', body, options);
        return parseAnthropicMessage(data, request, meta, this.#options.responseFormat);
    }

    createThread(options) {
        return createAnthropicThread(options, { model: this.defaultModel, maxRequestBytes: this.#maxRequestBytes, timeoutMs: this.#timeoutMs,
            build: request => buildAnthropicBody(request, this.#options),
            send: (body, call) => this.#threadTransport.request('POST', '/v1/messages', body, call),
            parse: (data, request, meta) => parseAnthropicMessage(data, request, meta, this.#options.responseFormat) });
    }

    async listModels(options = {}) {
      const { data, meta } = await this.#transport.request('GET', '/v1/models', undefined, options);
      return withResponseMeta(meta, () => {
        check(isRecord(data) && Array.isArray(data.data) && data.data.every(m => isRecord(m) && typeof m.id === 'string' && m.id.trim()),
          'Model-list response must contain data with model IDs.', 'INVALID_RESPONSE');
        // Preserve pagination explicitly; never label the first page as a complete list.
        return { models: data.data.map(m => ({ ...m, name: m.id })),
          ...(data.has_more === undefined ? {} : { has_more: data.has_more }),
          ...(data.last_id === undefined ? {} : { last_id: data.last_id }) };
      });
    }
}
