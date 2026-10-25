import { optionsObject, TRANSPORT_FIELDS } from '../../options.mjs';
import { DecisionError, withResponseMeta, requireCondition as check } from '../../errors.mjs';
import { isRecord, validateRequest } from '../../validation.mjs';
import { assertCapabilities, LEGACY_CAPABILITIES } from '../../capabilities.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../../transport.mjs';
import { environmentValue } from '../../runtime-env.mjs';
import { buildPrompt, buildResponseSchema, normalizeGenerated, parseGeneratedJson } from './schema.mjs';
import { anthropicUsage } from './shared.mjs';
import { anthropicOptions } from './anthropic-options.mjs';

/** Explicit structured JSON or one synthetic, non-executed output tool. */
export class AnthropicProvider {
  getCapabilities() { return LEGACY_CAPABILITIES; }
  name = 'anthropic';
  kind = 'generative';
  probabilitySource = 'elicited';
  #transport;
  #options;

  constructor(options = {}) {
    const { apiKey, model, baseURL = 'https://api.anthropic.com',
    maxTokens = 4096, parameters = {}, responseFormat = 'tool', apiVersion = '2023-06-01', ...transportOptions } = optionsObject(options,
      ['apiKey', 'model', 'baseURL', 'maxTokens', 'parameters', 'responseFormat', 'apiVersion', ...TRANSPORT_FIELDS], 'Anthropic options');
    const endpoint = parseBaseURL(baseURL, { originOnly: true });
    const supplied = apiKey === undefined && endpoint.origin === 'https://api.anthropic.com'
      ? environmentValue('ANTHROPIC_API_KEY') : apiKey;
    const key = validateApiKey(supplied, 'ANTHROPIC_API_KEY');
    this.#options = anthropicOptions({ model, maxTokens, parameters, responseFormat, apiVersion });
    this.defaultModel = this.#options.model;
    this.#transport = new JsonTransport({ ...transportOptions, baseURL: endpoint.baseURL,
      headers: { 'x-api-key': key, 'anthropic-version': this.#options.apiVersion }, secrets: [key] });
  }

  async evaluate(input, options = {}) {
    const request = validateRequest(input, this.defaultModel ?? '');
    assertCapabilities(request, this.getCapabilities(request.model));
    const prompt = buildPrompt(request);
    const { parameters, maxTokens, responseFormat } = this.#options;
    const body = { ...parameters, model: request.model,
      max_tokens: maxTokens, stream: false, system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    };
    const schema = buildResponseSchema(request.questions);
    if (responseFormat === 'json_schema') {
      body.output_config = { ...parameters.output_config, format: { type: 'json_schema', schema } };
    } else {
      body.tools = [{ name: 'submit_decisions', description: 'Return only the requested decision probabilities.', input_schema: schema }];
      body.tool_choice = { type: 'tool', name: 'submit_decisions', disable_parallel_tool_use: true };
    }
    const { data, meta } = await this.#transport.request('POST', '/v1/messages', body, options);
    return withResponseMeta(meta, () => {
      check(isRecord(data) && !data.error && Array.isArray(data.content), 'Invalid Messages response.', 'INVALID_RESPONSE');
      if (data.stop_reason === 'refusal' || data.stop_details?.type === 'refusal') {
        throw new DecisionError('Model refused the evaluation.', { code: 'MODEL_REFUSAL', ...meta });
      }
      if (data.stop_reason === 'max_tokens' || data.stop_reason === 'model_context_window_exceeded') {
        throw new DecisionError('Model output was truncated; adjust input or maxTokens explicitly.', { code: 'TRUNCATED_OUTPUT', ...meta });
      }
      let payload;
      if (responseFormat === 'json_schema') {
        check(data.stop_reason === 'end_turn', 'Provider did not finish a JSON response normally.', 'INVALID_RESPONSE');
        check(data.content.every(block => isRecord(block) && ['text', 'thinking', 'redacted_thinking'].includes(block.type) &&
          (block.type !== 'text' || typeof block.text === 'string')), 'Unexpected content in JSON response.', 'INVALID_RESPONSE');
        // Preserve exact text order; thinking is never parsed or copied into result metadata.
        payload = parseGeneratedJson(data.content.filter(block => block.type === 'text').map(block => block.text).join(''));
      } else {
        check(data.stop_reason === 'tool_use', 'Provider did not return the required decision output.', 'INVALID_RESPONSE');
        const tools = data.content.filter(block => isRecord(block) && block.type === 'tool_use');
        check(tools.length === 1 && tools[0].name === 'submit_decisions',
          'Provider must return exactly one submit_decisions result.', 'INVALID_RESPONSE');
        payload = tools[0].input;
      }
      return normalizeGenerated(payload, request, { model: data.model,
        usage: anthropicUsage(data.usage), meta: { ...meta, provider: this.name, responseFormat } });
    });
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
