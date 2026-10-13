import { preflightCommonDecision, preflightDecision } from '../providers/decisions-preflight.mjs';
import { encodeCommonDecision } from '../providers/decisions-codec.mjs';
import { preflightCloudflareDecision, preflightCommonCloudflareDecision } from '../providers/cloudflare-preflight.mjs';
import { encodeCloudflareDecision } from '../providers/cloudflare-codec.mjs';
import { CLOUDFLARE_MAX_REQUEST_LIMIT } from '../providers/cloudflare-profile.mjs';

/** Provider-specific native dispatch is shared by validation, initialization and calls. */
export function decisionProfile(provider) {
    if (provider === 'openai-decisions') return {
        common: preflightCommonDecision, native: preflightDecision, encode: encodeCommonDecision,
        options: config => ({ model: config.model, maxRequestBytes: config.maxRequestBytes }),
    };
    if (provider === 'cloudflare-decisions') return {
        common: preflightCommonCloudflareDecision, native: preflightCloudflareDecision, encode: encodeCloudflareDecision,
        inputLimit: CLOUDFLARE_MAX_REQUEST_LIMIT,
        options: config => Object.fromEntries(['model', 'maxRequestBytes', 'maxRetries', 'rejectIfBusy', 'gateway']
            .filter(key => config[key] !== undefined).map(key => [key, config[key]])),
    };
}
