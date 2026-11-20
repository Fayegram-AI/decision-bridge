import { requireCondition as check } from '../errors.mjs';
import { base64ByteLength } from '../embedded.mjs';
import { isRecord } from '../validation.mjs';
import { imageDimensions } from './image-header.mjs';

const FORMATS = ['image/png', 'image/jpeg', 'image/webp'];
/** Validate embedded encoding and, when requested, inspect the image header. */
export function validateCloudflareImages(images, { checkBytes, checkHeader = true } = {}) {
    check(Array.isArray(images), 'Cloudflare images must be an array.');
    for (const image of images) {
        let format, payload;
        if (typeof image === 'string') {
            const prefix = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(image);
            check(prefix, 'Cloudflare requires embedded PNG, JPEG, or WebP images.');
            format = prefix[1].toLowerCase();
            payload = image.slice(prefix[0].length);
        } else {
            check(isRecord(image) && Object.keys(image).length === 2 &&
                Object.hasOwn(image, 'content_type') && Object.hasOwn(image, 'base64') &&
                FORMATS.includes(image.content_type) && typeof image.base64 === 'string',
            'Cloudflare image objects require content_type and base64.');
            format = image.content_type;
            payload = image.base64;
        }
        const size = base64ByteLength(payload);
        checkBytes?.(size);
        if (!checkHeader) continue;
        const decoded = atob(payload);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        const [width, height] = imageDimensions(bytes, format);
        check(width > 0 && height > 0,
            'Cloudflare images must have positive dimensions.');
    }
}
