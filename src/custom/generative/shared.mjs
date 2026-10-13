import { requireCondition as check } from '../../errors.mjs';
import { cloneJson, isRecord } from '../../validation.mjs';

const RESERVED = new Set(['model', 'messages', 'system', 'tools', 'tool_choice', 'toolChoice',
  'functions', 'function_call',
  'response_format', 'stream', 'stream_options', 'n', 'max_tokens', 'max_completion_tokens',
  'headers', 'apiKey', 'api_key', 'baseURL', 'authorization']);

export function generationOptions({ model, maxTokens = 4096, parameters = {} }) {
  check(model === undefined || (typeof model === 'string' && model.trim()),
    'model must be a nonempty string when provided.', 'CONFIGURATION_ERROR');
  check(Number.isSafeInteger(maxTokens) && maxTokens > 0 && maxTokens <= 1048576,
    'maxTokens must be an integer in [1, 1048576].', 'CONFIGURATION_ERROR');
  const params = cloneJson(parameters, 'parameters', 'CONFIGURATION_ERROR');
  check(isRecord(params), 'parameters must be an object.', 'CONFIGURATION_ERROR');
  check(!Object.keys(params).some(key => RESERVED.has(key)),
    'parameters contains a field controlled by the bridge.', 'CONFIGURATION_ERROR');
  return { model: model?.trim(), maxTokens, parameters: params };
}

export function chatUsage(usage) {
  if (usage === undefined || usage === null) return { input_tokens: null, output_tokens: null };
  check(isRecord(usage), 'Provider usage must be an object.', 'INVALID_RESPONSE');
  return { input_tokens: usage.prompt_tokens ?? null, output_tokens: usage.completion_tokens ?? null };
}

export function anthropicUsage(usage) {
  if (usage === undefined || usage === null) return { input_tokens: null, output_tokens: null };
  check(isRecord(usage), 'Provider usage must be an object.', 'INVALID_RESPONSE');
  // Preserve separately billed cache categories instead of guessing a total cost.
  const result = { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null };
  for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (usage[key] !== undefined) {
      check(Number.isSafeInteger(usage[key]) && usage[key] >= 0, 'Invalid cache token usage.', 'INVALID_RESPONSE');
      result[key] = usage[key];
    }
  }
  return result;
}
