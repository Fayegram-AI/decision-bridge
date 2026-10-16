import { requireCondition as check } from '../errors.mjs';
import { validateImage } from '../input.mjs';
import { isRecord } from '../validation.mjs';
import { imageDimensions } from './image-header.mjs';

const FORMATS = ['image/png', 'image/jpeg', 'image/webp'];
/** Inspect bounded embedded bytes; this is header validation, not full image decoding. */
export function validateCloudflareImages(images) {
    check(Array.isArray(images) && images.length <= 4, 'Cloudflare accepts at most four images.');
    let total = 0;
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
        validateImage('data:' + format + ';base64,' + payload);
        const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
        const size = payload.length / 4 * 3 - padding;
        check(size <= 4 * 1024 * 1024, 'Cloudflare images must be within 4 MiB each.', 'REQUEST_TOO_LARGE');
        total += size;
        check(total <= 8 * 1024 * 1024, 'Cloudflare images exceed 8 MiB total.', 'REQUEST_TOO_LARGE');
        const decoded = atob(payload);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        const [width, height] = imageDimensions(bytes, format);
        check(width > 0 && height > 0 && width * height <= 16000000,
            'Cloudflare images must have positive dimensions within 16 million pixels.');
    }
}
