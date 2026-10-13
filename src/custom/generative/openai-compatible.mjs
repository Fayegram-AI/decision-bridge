import { optionsObject, TRANSPORT_FIELDS } from '../../options.mjs';
import { DecisionError, withResponseMeta, requireCondition as check } from '../../errors.mjs';
import { cloneJson, isRecord, validateRequest } from '../../validation.mjs';
import { assertCapabilities, LEGACY_CAPABILITIES } from '../../capabilities.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../../transport.mjs';
import { environmentValue } from '../../runtime-env.mjs';
import { buildPrompt, buildResponseSchema, normalizeGenerated, parseGeneratedJson } from './schema.mjs';
import { generationOptions, chatUsage } from './shared.mjs';

/** Chat Completions compatibility, with explicit schema/JSON/text modes. */
export class OpenAICompatibleProvider {
  getCapabilities() { return LEGACY_CAPABILITIES; }
  name = 'openai-compatible';
  kind = 'generative';
  probabilitySource = 'elicited';
  #transport;
  #options;

  constructor(options = {}) {
    const { apiKey, model, baseURL = 'https://api.openai.com/v1',
    responseFormat = 'json_schema', tokenParameter = 'max_completion_tokens',
    maxTokens = 4096, parameters = {}, ...transportOptions } = optionsObject(options,
      ['apiKey', 'model', 'baseURL', 'responseFormat', 'tokenParameter', 'maxTokens', 'parameters', ...TRANSPORT_FIELDS], 'OpenAI-compatible options');
    const endpoint = parseBaseURL(baseURL);
    // Never send an ambient OpenAI key to a caller-specified third-party endpoint.
    const supplied = apiKey === undefined && endpoint.origin === 'https://api.openai.com'
      ? environmentValue('OPENAI_API_KEY') : apiKey;
    check(supplied !== null || endpoint.loopback,
      'Unauthenticated connections require an explicitly configured loopback endpoint.', 'CONFIGURATION_ERROR');
    const key = supplied === null ? null : validateApiKey(supplied, 'the selected provider API key');
    check(['json_schema', 'json_object', 'text'].includes(responseFormat),
      'responseFormat must be json_schema, json_object, or text.', 'CONFIGURATION_ERROR');
    check(['max_completion_tokens', 'max_tokens'].includes(tokenParameter),
      'tokenParameter must be max_completion_tokens or max_tokens.', 'CONFIGURATION_ERROR');
    const generation = generationOptions({ model, maxTokens, parameters });
    this.defaultModel = generation.model;
    this.#options = { ...generation, responseFormat, tokenParameter };
    this.#transport = new JsonTransport({ ...transportOptions, baseURL: endpoint.baseURL,
      headers: key === null ? {} : { authorization: `Bearer ${key}` }, secrets: key === null ? [] : [key] });
  }

  async evaluate(input, options = {}) {
    const request = validateRequest(input, this.defaultModel ?? '');
    assertCapabilities(request, this.getCapabilities(request.model));
    const prompt = buildPrompt(request);
    const { responseFormat, tokenParameter, maxTokens, parameters } = this.#options;
    const body = { ...parameters, model: request.model, messages: [
      { role: 'system', content: prompt.system }, { role: 'user', content: prompt.user },
    ], stream: false, [tokenParameter]: maxTokens };
    if (responseFormat !== 'text') body.response_format = responseFormat === 'json_schema'
      ? { type: 'json_schema', json_schema: { name: 'decision_answers', strict: true,
        schema: buildResponseSchema(request.questions) } }
      : { type: 'json_object' };
    const { data, meta } = await this.#transport.request('POST', '/chat/completions', body, options);
    return withResponseMeta(meta, () => {
      check(isRecord(data) && !data.error, 'Provider returned an error envelope.', 'INVALID_RESPONSE');
      check(Array.isArray(data.choices) && data.choices.length === 1 && isRecord(data.choices[0]),
        'Provider must return exactly one completion.', 'INVALID_RESPONSE');
      const completion = data.choices[0];
      const message = completion.message;
      check(isRecord(message), 'Provider completion has no message.', 'INVALID_RESPONSE');
      if (message.refusal || completion.finish_reason === 'content_filter') {
        throw new DecisionError('Model refused the evaluation.', { code: 'MODEL_REFUSAL', ...meta });
      }
      if (completion.finish_reason === 'length') {
        throw new DecisionError('Model output was truncated; adjust maxTokens explicitly.', { code: 'TRUNCATED_OUTPUT', ...meta });
      }
      check(completion.finish_reason === undefined || completion.finish_reason === null || completion.finish_reason === 'stop',
        'Provider did not finish a JSON response normally.', 'INVALID_RESPONSE');
      check(!message.tool_calls && !message.function_call, 'Unexpected tool call in completion.', 'INVALID_RESPONSE');
      const payload = parseGeneratedJson(message.content);
      return normalizeGenerated(payload, request, { model: data.model, usage: chatUsage(data.usage),
        meta: { ...meta, provider: this.name, responseFormat } });
    });
  }

  async listModels(options = {}) {
    const { data, meta } = await this.#transport.request('GET', '/models', undefined, options);
    return withResponseMeta(meta, () => {
      check(isRecord(data) && Array.isArray(data.data) && data.data.every(m => isRecord(m) && typeof m.id === 'string' && m.id.trim()),
        'Model-list response must contain data with model IDs.', 'INVALID_RESPONSE');
      return { models: data.data.map(m => ({ ...m, name: m.id })),
        ...(data.has_more === undefined ? {} : { has_more: data.has_more }),
        ...(data.last_id === undefined ? {} : { last_id: data.last_id }) };
    });
  }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  name = 'openrouter';
  constructor(configuration = {}) {
    const { apiKey = environmentValue('OPENROUTER_API_KEY'), parameters = {}, ...options } = optionsObject(configuration,
      ['apiKey', 'model', 'responseFormat', 'tokenParameter', 'maxTokens', 'parameters', ...TRANSPORT_FIELDS], 'OpenRouter options');
    const safeParameters = cloneJson(parameters, 'parameters', 'CONFIGURATION_ERROR');
    check(isRecord(safeParameters), 'parameters must be an object.', 'CONFIGURATION_ERROR');
    check(safeParameters.provider === undefined || isRecord(safeParameters.provider),
      'OpenRouter provider routing settings must be an object.', 'CONFIGURATION_ERROR');
    super({ ...options, apiKey, baseURL: 'https://openrouter.ai/api/v1', tokenParameter: options.tokenParameter ?? 'max_tokens',
      parameters: { ...safeParameters, provider: { ...safeParameters.provider, require_parameters: true } } });
  }
}
