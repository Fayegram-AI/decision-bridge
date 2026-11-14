// Stateless request construction and response decoding shared by independent and threaded calls.
import { DecisionError, withResponseMeta, requireCondition as check } from '../../errors.mjs';
import { isRecord } from '../../validation.mjs';
import { buildPrompt, buildResponseSchema, normalizeGenerated, parseGeneratedJson } from './schema.mjs';
import { anthropicUsage } from './shared.mjs';
import { anthropicResponseFormat } from './anthropic-options.mjs';

export function buildAnthropicBody(request, settings) {
    const prompt = buildPrompt(request);
    const { parameters, maxTokens } = settings;
    const responseFormat = anthropicResponseFormat(request.model, settings.responseFormat);
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
    return body;
}

export function parseAnthropicMessage(data, request, meta, responseFormat) {
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
        usage: anthropicUsage(data.usage), meta: { ...meta, provider: 'anthropic', responseFormat } });
    });
}
