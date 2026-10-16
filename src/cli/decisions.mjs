import { preflightCommonDecision, preflightDecision } from '../providers/decisions-preflight.mjs';
import { encodeCommonDecision } from '../providers/decisions-codec.mjs';
import { preflightCloudflareDecision, preflightCommonCloudflareDecision } from '../providers/cloudflare-preflight.mjs';
import { encodeCloudflareDecision } from '../providers/cloudflare-codec.mjs';
import { CLOUDFLARE_MAX_REQUEST_LIMIT } from '../providers/cloudflare-profile.mjs';
import { resolveOpenAIModel } from '../providers/openai-profile.mjs';
import { preflightCommonJevDecision, preflightJevDecision, encodeJevDecision } from '../providers/jev-preflight.mjs';
import { JEV_REQUEST_LIMIT } from '../providers/jev-profile.mjs';

/** Provider-specific native dispatch is shared by validation, initialization and calls. */
export function decisionProfile(provider) {
    if (provider === 'jev') return {
        common: preflightCommonJevDecision, native: preflightJevDecision, encode: encodeJevDecision,
        models: true, inputLimit: JEV_REQUEST_LIMIT,
        options: config => ({ model: config.model, maxRequestBytes: config.maxRequestBytes,
            dangerZone: Object.hasOwn(config, 'dangerZone') ? config.dangerZone : undefined }),
    };
    if (provider === 'openai-decisions') return {
        common: preflightCommonDecision, native: preflightDecision, encode: encodeCommonDecision,
        resolveModel: resolveOpenAIModel,
        options: config => ({ model: config.model, maxRequestBytes: config.maxRequestBytes }),
    };
    if (provider === 'cloudflare-decisions') return {
        common: preflightCommonCloudflareDecision, native: preflightCloudflareDecision, encode: encodeCloudflareDecision,
        inputLimit: CLOUDFLARE_MAX_REQUEST_LIMIT,
        options: config => Object.fromEntries(['model', 'maxRequestBytes', 'maxRetries', 'rejectIfBusy', 'gateway']
            .filter(key => config[key] !== undefined).map(key => [key, config[key]])),
    };
}
