import { DecisionError, requireCondition as check } from './errors.mjs';
import { cloneJson, freezeJson, isRecord } from './validation.mjs';
import { CLOUDFLARE_MODELS } from './providers/cloudflare-profile.mjs';
import { openaiModelProfile } from './providers/openai-profile.mjs';
import { jevFeatures } from './providers/jev-profile.mjs';

/** Conservative defaults preserve the pre-existing custom-provider contract. */
export const LEGACY_CAPABILITIES = freezeJson({
    supported: true, orderedInput: false, images: false, typedChoices: false,
    labeledScores: false, safetyIdentifier: false,
    maxImages: 0, maxChoiceOptions: 255, maxScoreLevels: 10,
    audio: false, videos: false, maxAudioClips: 0, maxVideos: 0,
    boxes: false,
    conversation: false, toolHistory: false, remoteImages: false, promptCaching: false,
});

const CLOUDFLARE_CAPABILITIES = freezeJson({
    supported: true, orderedInput: true, images: true, typedChoices: true,
    labeledScores: true, safetyIdentifier: false, maxImages: null, maxChoiceOptions: null, maxScoreLevels: null,
});

export function builtInCapabilities(type, model, options = {}) {
    if (type === 'jev') return freezeJson({ ...LEGACY_CAPABILITIES,
        ...jevFeatures(model, Object.hasOwn(options, 'dangerZone') ? options.dangerZone : undefined),
        maxChoiceOptions: null, maxScoreLevels: null });
    if (type === 'cloudflare-decisions') {
        const key = typeof model === 'string' ? model.trim().replace(/^@cf\/cloudflare\//, '') : '';
        const profile = Object.hasOwn(CLOUDFLARE_MODELS, key) ? CLOUDFLARE_MODELS[key] : undefined;
        return freezeJson({ ...LEGACY_CAPABILITIES, ...CLOUDFLARE_CAPABILITIES, supported: !!profile,
            audio: profile?.omni ?? false, videos: profile?.omni ?? false,
            maxAudioClips: profile?.omni ? null : 0, maxVideos: profile?.omni ? null : 0 });
    }
    if (type !== 'openai-decisions') return LEGACY_CAPABILITIES;
    const profile = openaiModelProfile(model);
    return freezeJson({ ...LEGACY_CAPABILITIES, ...profile, supported: !!profile });
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
    for (const key of ['supported', 'orderedInput', 'images', 'typedChoices', 'labeledScores', 'safetyIdentifier', 'audio', 'videos', 'boxes',
        'conversation', 'toolHistory', 'remoteImages', 'promptCaching']) {
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
    if (Object.hasOwn(request, 'conversation')) {
        requireFeature(capabilities.conversation, 'conversation input');
        if (request.conversation.some(item => !Object.hasOwn(item, 'role'))) requireFeature(capabilities.toolHistory, 'tool history');
        const parts = request.conversation.flatMap(item => Array.isArray(item.content) ? item.content
            : Array.isArray(item.output) ? item.output : []);
        const images = parts.filter(part => part.type === 'input_image');
        if (images.length) requireFeature(capabilities.images, 'image input');
        requireFeature(capabilities.maxImages === null || images.length <= capabilities.maxImages, 'this image count');
        if (parts.some(part => part.type === 'input_image' && /^https?:/i.test(part.image_url))) {
            requireFeature(capabilities.remoteImages, 'remote images');
        }
        if (parts.some(part => Object.hasOwn(part, 'prompt_cache_breakpoint'))) requireFeature(capabilities.promptCaching, 'prompt caching');
    }
    if (Object.hasOwn(request, 'promptCacheKey') || Object.hasOwn(request, 'promptCacheOptions') ||
        request.input?.some(part => Object.hasOwn(part, 'promptCacheBreakpoint'))) requireFeature(capabilities.promptCaching, 'prompt caching');
    if (Object.hasOwn(request, 'input')) {
        requireFeature(capabilities.orderedInput, 'ordered input');
        const images = request.input.filter(part => part.type === 'image').length;
        if (request.input.some(part => part.type === 'image' && Object.hasOwn(part, 'url'))) {
            requireFeature(capabilities.remoteImages, 'remote images');
        }
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
        if (q.type === 'box') requireFeature(capabilities.boxes, 'box questions');
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
    if (Object.hasOwn(request, 'conversation') || Object.hasOwn(request, 'promptCacheKey') ||
        Object.hasOwn(request, 'promptCacheOptions') || request.input?.some(part =>
        Object.hasOwn(part, 'url') || Object.hasOwn(part, 'promptCacheBreakpoint'))) return 5;
    if (Object.values(request.questions).some(q => q.type === 'box')) return 4;
    if (request.input?.some(part => ['audio', 'video'].includes(part.type))) return 3;
    return Object.hasOwn(request, 'input') || Object.hasOwn(request, 'safetyIdentifier') ||
        Object.values(request.questions).some(q => q.options || q.levels) ? 2 : 1;
}
