import { requireCondition as check } from '../errors.mjs';
import { optionsObject } from '../options.mjs';
import { cloneJson, freezeJson, isRecord, validateRequest } from '../validation.mjs';
import { assertCapabilities, builtInCapabilities } from '../capabilities.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { cloudflareModel, cloudflareGateway, validateCloudflareLimits, cloudflareRequestLimit } from './cloudflare-profile.mjs';
import { validateCloudflareImages } from './cloudflare-images.mjs';
import { validateCloudflareMedia } from './cloudflare-media.mjs';
import { encodeCloudflareDecision } from './cloudflare-codec.mjs';

/** Pure context validation is also usable by offline CLI validation. */
function settingsFor(options) {
    const settings = optionsObject(options, ['model', 'transport', 'gateway', 'maxRequestBytes', 'maxRetries', 'rejectIfBusy'],
        'Cloudflare preflight options');
    const transport = settings.transport === undefined ? 'rest' : settings.transport;
    check(['rest', 'binding'].includes(transport), 'Unknown Cloudflare transport.', 'CONFIGURATION_ERROR');
    const gateway = cloudflareGateway(settings.gateway);
    return { ...settings, ...validateCloudflareLimits({ ...settings, gateway }), transport, gateway };
}

export function cloudflareBindingBody(request, gateway) {
    const { options, ...inputs } = request;
    const { rejectIfBusy = false, ...inference } = options ?? {};
    return { inputs: { ...inputs, ...(Object.keys(inference).length ? { options: inference } : {}) },
        options: { returnRawResponse: true, rejectIfBusy,
        ...(gateway ? { gateway } : {}) } };
}

export function preflightCloudflareDecision(input, options = {}) {
    const settings = settingsFor(options);
    const request = cloneJson(input, 'Cloudflare request');
    check(isRecord(request) && Object.keys(request).every(key => ['model', 'state', 'questions', 'images', 'audio', 'videos', 'options'].includes(key)),
        'Cloudflare native request contains an unknown field.');
    check(!Object.hasOwn(request, 'model') || (typeof request.model === 'string' && request.model.trim()),
        'Cloudflare native model must be a nonempty string when provided.');
    const model = cloudflareModel(request.model ?? settings.model);
    check(model === 'clef-omni' || !['audio', 'videos'].some(key => Object.hasOwn(request, key)),
        'Audio and video require clef-omni.', 'UNSUPPORTED_CAPABILITY');
    const common = validateRequest({ model, state: request.state, questions: request.questions }, model);
    for (const [id, question] of Object.entries(common.questions)) {
        check(/^[A-Za-z0-9_.-]+$/.test(id), 'Cloudflare question IDs must use letters, digits, _, ., or -.');
        check(!Object.hasOwn(question, 'options') && !Object.hasOwn(question, 'levels'),
            'Cloudflare native questions use criteria; typed choices and levels belong to the common API.');
        if (question.type === 'choice') check(Object.keys(question.criteria).length >= 2,
            'Cloudflare choice questions require at least two options.');
    }
    const execution = Object.hasOwn(request, 'options') ? request.options : {};
    check(isRecord(execution) && Object.keys(execution).every(key => key === 'rejectIfBusy') &&
        (execution.rejectIfBusy === undefined || typeof execution.rejectIfBusy === 'boolean'), 'Invalid Cloudflare execution options.');
    const rejectIfBusy = execution.rejectIfBusy ?? settings.rejectIfBusy;
    validateCloudflareLimits({ ...settings, rejectIfBusy });
    // Hosted Clef REST rejects this execution field. Resolve per-call overrides first;
    // never spend an inference request on the known failure or silently drop an enabled flag.
    check(settings.transport !== 'rest' || !rejectIfBusy,
        'rejectIfBusy is unavailable for Cloudflare Clef REST; use binding transport.', 'UNSUPPORTED_CAPABILITY');
    const result = { model, state: common.state, questions: common.questions,
        ...(Object.hasOwn(request, 'images') ? { images: request.images } : {}),
        ...(Object.hasOwn(request, 'audio') ? { audio: request.audio } : {}),
        ...(Object.hasOwn(request, 'videos') ? { videos: request.videos } : {}),
        ...(rejectIfBusy ? { options: { rejectIfBusy } } : {}) };
    serializeRequestBody(settings.transport === 'binding' ? cloudflareBindingBody(result, settings.gateway) : result,
        cloudflareRequestLimit(model, settings.maxRequestBytes));
    if (Object.hasOwn(request, 'images')) validateCloudflareImages(request.images);
    validateCloudflareMedia(request);
    return freezeJson(result);
}

/** Prepare once for common runtime calls; validation and CLI reuse this same path. */
export function prepareCommonCloudflareDecision(input, options = {}) {
    const settings = settingsFor(options);
    const common = validateRequest(input, settings.model ?? 'clef');
    const request = { ...common, model: cloudflareModel(common.model) };
    assertCapabilities(request, builtInCapabilities('cloudflare-decisions', request.model));
    if (request.input) {
        let previous = -1;
        const rank = { image: 0, audio: 1, video: 2, text: 3 };
        for (const part of request.input) {
            check(rank[part.type] >= previous,
                'Cloudflare input requires images, then audio, then videos, then text.', 'UNSUPPORTED_CAPABILITY');
            previous = rank[part.type];
            if (part.type === 'image') {
                check(part.detail === undefined || part.detail === null || part.detail === 'auto',
                    'Cloudflare images support automatic detail only.', 'UNSUPPORTED_CAPABILITY');
            }
        }
    }
    const native = preflightCloudflareDecision(encodeCloudflareDecision(request), settings);
    return { request: freezeJson(request), native };
}

export function preflightCommonCloudflareDecision(input, options = {}) {
    return prepareCommonCloudflareDecision(input, options).request;
}
