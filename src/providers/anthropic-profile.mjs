// Model policy shared by offline capabilities and the optional generative preset.
import { requireCondition as check } from '../errors.mjs';

// Match only documented families and dated snapshots; unknown models retain tool mode.
const JSON_ONLY_MODELS = /^claude-(?:opus-5-5|sonnet-5-5|(?:fable|mythos)-5-[12])(?:-\d{8})?$/;
export function anthropicResponseFormat(model, responseFormat) {
    const jsonOnly = typeof model === 'string' && JSON_ONLY_MODELS.test(model);
    check(!(jsonOnly && responseFormat === 'tool'),
        'This Anthropic model does not support forced tool output; use json_schema.', 'UNSUPPORTED_CAPABILITY');
    return responseFormat ?? (jsonOnly ? 'json_schema' : 'tool');
}
