// Pure extraction profiles keep offline CLI validation identical to provider dispatch.
import { validateExtractionRequest } from '../extraction/validation.mjs';
import { prepareCommonOpenRouterExtraction, prepareOpenRouterExtraction } from '../extraction/openrouter.mjs';

export function extractionProfile(provider) {
    if (provider === 'openrouter-extraction') return {
        common: prepareCommonOpenRouterExtraction, native: prepareOpenRouterExtraction, inputLimit: 8 * 1024 * 1024,
        options: config => ({ model: config.model, maxRequestBytes: config.maxRequestBytes, providerPreferences: config.providerPreferences }),
    };
    return { common: validateExtractionRequest, inputLimit: 64 * 1024 * 1024,
        options: config => Object.fromEntries(['model', 'maxRequestBytes', 'maxRetries', 'rejectIfBusy', 'gateway']
            .filter(key => config[key] !== undefined).map(key => [key, config[key]])) };
}
