import { DecisionError, requireCondition as check } from './errors.mjs';
import { cloneJson, freezeJson, isRecord } from './validation.mjs';
import { CLOUDFLARE_MODELS } from './providers/cloudflare-profile.mjs';

/** Conservative defaults preserve the pre-existing custom-provider contract. */
export const LEGACY_CAPABILITIES = freezeJson({
    supported: true, orderedInput: false, images: false, typedChoices: false,
    labeledScores: false, safetyIdentifier: false,
    maxImages: 0, maxChoiceOptions: 255, maxScoreLevels: 10,
    audio: false, videos: false, maxAudioClips: 0, maxVideos: 0,
});
const OPENAI_CAPABILITIES = freezeJson({
    supported: true, orderedInput: true, images: true, typedChoices: true,
    labeledScores: true, safetyIdentifier: true,
    maxImages: 128, maxChoiceOptions: 255, maxScoreLevels: null,
});

const CLOUDFLARE_CAPABILITIES = freezeJson({
    supported: true, orderedInput: true, images: true, typedChoices: true,
    labeledScores: true, safetyIdentifier: false, maxImages: 4, maxChoiceOptions: 255, maxScoreLevels: 10,
});

export function builtInCapabilities(type, model) {
    if (type === 'cloudflare-decisions') {
        const key = typeof model === 'string' ? model.trim().replace(/^@cf\/cloudflare\//, '') : '';
        const profile = Object.hasOwn(CLOUDFLARE_MODELS, key) ? CLOUDFLARE_MODELS[key] : undefined;
        return freezeJson({ ...LEGACY_CAPABILITIES, ...CLOUDFLARE_CAPABILITIES, supported: !!profile,
            audio: profile?.omni ?? false, videos: profile?.omni ?? false,
            maxAudioClips: profile?.omni ? 4 : 0, maxVideos: profile?.omni ? 2 : 0 });
    }
    if (type !== 'openai-decisions') return LEGACY_CAPABILITIES;
    return freezeJson({ ...LEGACY_CAPABILITIES, ...OPENAI_CAPABILITIES, supported: model === 'gpt-6-luna' });
}

export function providerCapabilities(provider, model) {
    let supplied;
    try { supplied = provider.getCapabilities?.(model) ?? LEGACY_CAPABILITIES; }
    catch (error) {
        if (error instanceof DecisionError) throw error;
        throw new DecisionError('Provider capability lookup failed.', { code: 'PROVIDER_ERROR' });
    }
    if (!isRecord(supplied)) {
        // Observe invalid async hooks while preserving the synchronous profile contract.
        try { Promise.prototype.then.call(supplied, () => {}, () => {}); }
        catch { /* Non-Promise profiles are rejected by JSON validation below. */ }
    }
    const profile = cloneJson(supplied, 'capabilities', 'CONFIGURATION_ERROR');
    check(isRecord(profile) && Object.keys(profile).every(key => Object.hasOwn(LEGACY_CAPABILITIES, key)),
        'Invalid capability profile.', 'CONFIGURATION_ERROR');
    const result = { ...LEGACY_CAPABILITIES, ...profile };
    for (const key of ['supported', 'orderedInput', 'images', 'typedChoices', 'labeledScores', 'safetyIdentifier', 'audio', 'videos']) {
        check(typeof result[key] === 'boolean', 'Capability flags must be boolean.', 'CONFIGURATION_ERROR');
    }
    for (const key of ['maxImages', 'maxChoiceOptions', 'maxScoreLevels', 'maxAudioClips', 'maxVideos']) {
        check(result[key] === null || (Number.isSafeInteger(result[key]) && result[key] >= 0),
            'Capability limits must be nonnegative integers or null.', 'CONFIGURATION_ERROR');
    }
    return freezeJson(result);
}

/** Run before dispatch, including when a provider is used without a bridge. */
export function assertCapabilities(request, capabilities) {
    const requireFeature = (condition, feature) => check(condition,
        `Selected provider/model does not support ${feature}.`, 'UNSUPPORTED_CAPABILITY');
    requireFeature(capabilities.supported, 'this model');
    if (Object.hasOwn(request, 'input')) {
        requireFeature(capabilities.orderedInput, 'ordered input');
        const images = request.input.filter(part => part.type === 'image').length;
        if (images) requireFeature(capabilities.images, 'image input');
        requireFeature(capabilities.maxImages === null || images <= capabilities.maxImages, 'this image count');
        for (const [kind, flag, limit] of [['audio', 'audio', 'maxAudioClips'], ['video', 'videos', 'maxVideos']]) {
            const count = request.input.filter(part => part.type === kind).length;
            if (count) {
                requireFeature(capabilities[flag], kind + ' input');
                requireFeature(capabilities[limit] === null || count <= (capabilities[limit] ?? 0), 'this ' + kind + ' count');
            }
        }
    }
    if (Object.hasOwn(request, 'safetyIdentifier')) requireFeature(capabilities.safetyIdentifier, 'safetyIdentifier');
    for (const q of Object.values(request.questions)) {
        if (q.options) requireFeature(capabilities.typedChoices, 'typed choices');
        if (q.levels) requireFeature(capabilities.labeledScores, 'labelled scores');
        const choices = q.options?.length ?? (q.type === 'choice' ? Object.keys(q.criteria).length : 0);
        const levels = q.levels?.length ?? (q.type === 'score' ? q.criteria.length : 0);
        requireFeature(capabilities.maxChoiceOptions === null || choices <= capabilities.maxChoiceOptions, 'this choice count');
        requireFeature(capabilities.maxScoreLevels === null || levels <= capabilities.maxScoreLevels, 'this score level count');
    }
    return request;
}

export function commonSchemaVersion(request) {
    if (request.input?.some(part => ['audio', 'video'].includes(part.type))) return 3;
    return Object.hasOwn(request, 'input') || Object.hasOwn(request, 'safetyIdentifier') ||
        Object.values(request.questions).some(q => q.options || q.levels) ? 2 : 1;
}
