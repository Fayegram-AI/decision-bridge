import { optionsObject } from '../options.mjs';
import { requireCondition as check } from '../errors.mjs';

export const JEV_REQUEST_LIMIT = 32 * 1024 * 1024;
export const JEV_RESULT_OPTIONS = Object.freeze({ native: true, nullableUsage: true });

/** Experimental features are explicit provider policy, never inferred from input. */
export function jevDangerZone(value = {}) {
    const options = optionsObject(value, ['images', 'longContext'], 'Jev dangerZone');
    const images = Object.hasOwn(options, 'images') ? options.images : false;
    const longContext = Object.hasOwn(options, 'longContext') ? options.longContext : false;
    check([images, longContext].every(value => value === undefined || typeof value === 'boolean'),
        'Jev dangerZone flags must be boolean.', 'CONFIGURATION_ERROR');
    return Object.freeze({ images: images ?? false, longContext: longContext ?? false });
}

/** Moving stable aliases stay conservative; pin a supported version for boxes. */
export function jevFeatures(model, dangerZone = {}) {
    const version = /^jev-(\d+)\.(\d+)\.(\d+)$/.exec(model ?? '');
    const boxes = model === 'jev-preview' || (version !== null &&
        (Number(version[1]) > 1 || (Number(version[1]) === 1 && Number(version[2]) >= 14)));
    const images = Object.hasOwn(dangerZone, 'images') && dangerZone.images === true;
    return { orderedInput: true, images, boxes: images && boxes, maxImages: null };
}

export function jevHeaders(dangerZone) {
    return {
        ...(dangerZone.images ? { 'TypeSafe-Danger-Zone-Images': 'true' } : {}),
        ...(dangerZone.longContext ? { 'TypeSafe-Danger-Zone-Long-Context': 'true' } : {}),
    };
}

export function jevRequestLimit(value = JEV_REQUEST_LIMIT) {
    check(Number.isSafeInteger(value) && value > 0 && value <= 64 * 1024 * 1024,
        'Jev maxRequestBytes must be within the client budget of 1 to 64 MiB.', 'CONFIGURATION_ERROR');
    return value;
}
