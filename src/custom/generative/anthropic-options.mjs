// Anthropic protocol settings shared by SDK construction and offline CLI validation.
import { requireCondition as check } from '../../errors.mjs';
import { isRecord } from '../../validation.mjs';
import { generationOptions } from './shared.mjs';

export const ANTHROPIC_API_VERSIONS = ['2023-06-01', '2026-10-21'];
export const ANTHROPIC_RESPONSE_FORMATS = ['tool', 'json_schema'];

/** Defaults stay independent so selecting a new output mode never changes the API version. */
export function anthropicOptions({ model, maxTokens = 4096, parameters = {},
    responseFormat = 'tool', apiVersion = '2023-06-01' } = {}) {
    check(ANTHROPIC_RESPONSE_FORMATS.includes(responseFormat), 'Anthropic responseFormat must be tool or json_schema.', 'CONFIGURATION_ERROR');
    check(ANTHROPIC_API_VERSIONS.includes(apiVersion), 'Unsupported Anthropic API version.', 'CONFIGURATION_ERROR');
    const generation = generationOptions({ model, maxTokens, parameters });
    const params = generation.parameters;
    check(!Object.hasOwn(params, 'thinking'), 'Explicit thinking settings are not supported by the Anthropic preset.', 'CONFIGURATION_ERROR');
    check(!Object.hasOwn(params, 'output_format'), 'Anthropic output format is controlled by responseFormat.', 'CONFIGURATION_ERROR');
    if (Object.hasOwn(params, 'output_config')) {
        check(isRecord(params.output_config) && !Object.hasOwn(params.output_config, 'format'),
            'output_config must be an object without the adapter-controlled format field.', 'CONFIGURATION_ERROR');
    }
    if (apiVersion === '2026-10-21') {
        check(!['temperature', 'top_p', 'top_k'].some(key => Object.hasOwn(params, key)),
            'Anthropic API 2026-10-21 does not accept temperature, top_p, or top_k.', 'CONFIGURATION_ERROR');
    }
    return { ...generation, responseFormat, apiVersion };
}
