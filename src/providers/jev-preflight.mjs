// Shared pure preflight keeps offline validation and inference on the same path.
import { requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord, validateRequest } from '../validation.mjs';
import { assertCapabilities, builtInCapabilities } from '../capabilities.mjs';
import { embeddedDataUrl } from '../embedded.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { jevDangerZone, jevRequestLimit } from './jev-profile.mjs';
import { validateJevAssets } from './jev-images.mjs';

/** Convert ordered parts to an ordered state array, without altering question text. */
export function encodeJevDecision(request) {
    if (!Object.hasOwn(request, 'input')) return request;
    const text = JSON.stringify(request);
    // Look ahead without consuming a token: two user tokens can share their
    // boundary underscores, and both must be reserved before choosing a key.
    const references = new Set(Array.from(text.matchAll(/(?=(__decision_bridge_image_\d+__))/g), match => match[1]));
    const assets = {};
    const state = request.input.map((part, index) => {
        if (part.type === 'text') return part.text;
        const image = embeddedDataUrl(part.dataUrl, 'image');
        check(['image/png', 'image/jpeg'].includes(image.format), 'Jev accepts only embedded PNG or JPEG images.');
        check(part.detail === undefined || part.detail === null || part.detail === 'auto',
            'Jev does not support image detail controls.', 'UNSUPPORTED_CAPABILITY');
        let suffix = index;
        let reference = `__decision_bridge_image_${suffix}__`;
        while (references.has(reference)) reference = `__decision_bridge_image_${++suffix}__`;
        references.add(reference);
        assets[reference] = { type: 'image', format: image.format === 'image/png' ? 'png' : 'jpg', data_base64: image.payload };
        return reference;
    });
    return { model: request.model, state, questions: request.questions,
        ...(Object.keys(assets).length ? { assets } : {}) };
}

export function prepareJevDecision(input, options = {}) {
    const snapshot = cloneJson(input, 'Jev request');
    check(isRecord(snapshot) && Object.keys(snapshot).every(key => ['model', 'state', 'questions', 'assets'].includes(key)),
        'Jev native requests require state, questions, optional model and assets.');
    const { assets, ...common } = snapshot;
    const request = validateRequest(common, options.model ?? 'jev-latest');
    const dangerZone = jevDangerZone(options.dangerZone);
    assertCapabilities(request, builtInCapabilities('jev', request.model, { dangerZone }));
    const native = { ...request, ...(assets === undefined ? {} : { assets }) };
    serializeRequestBody(native, jevRequestLimit(options.maxRequestBytes));
    const imageCount = validateJevAssets(native);
    if (imageCount) check(dangerZone.images, 'Enable Jev dangerZone.images to send images.', 'UNSUPPORTED_CAPABILITY');
    if (Object.values(request.questions).some(question => question.type === 'box')) {
        check(imageCount > 0, 'Jev box questions require at least one image asset.');
    }
    serializeRequestBody(native, jevRequestLimit(options.maxRequestBytes));
    return { request: freezeJson(request), native: freezeJson(native) };
}

export function prepareCommonJevDecision(input, options = {}) {
    const request = validateRequest(input, options.model ?? 'jev-latest');
    assertCapabilities(request, builtInCapabilities('jev', request.model, { dangerZone: jevDangerZone(options.dangerZone) }));
    const { native } = prepareJevDecision(encodeJevDecision(request), options);
    return { request: freezeJson(request), native };
}

export const preflightJevDecision = (input, options) => prepareJevDecision(input, options).native;
export const preflightCommonJevDecision = (input, options) => prepareCommonJevDecision(input, options).request;
