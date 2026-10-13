import { requireCondition as check } from '../errors.mjs';
import { validateImage } from '../input.mjs';
import { isRecord } from '../validation.mjs';

const FORMATS = ['image/png', 'image/jpeg', 'image/webp'];
const checkImage = condition => check(condition, 'Invalid embedded image header or dimensions.', 'VALIDATION_ERROR');
const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

function dimensions(bytes, format) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (format === 'image/png') {
        checkImage(bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value) &&
            view.getUint32(8) === 13 && ascii(bytes, 12, 4) === 'IHDR');
        return [view.getUint32(16), view.getUint32(20)];
    }
    if (format === 'image/jpeg') {
        checkImage(bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216);
        let offset = 2;
        while (offset < bytes.length) {
            checkImage(bytes[offset++] === 255);
            while (offset < bytes.length && bytes[offset] === 255) offset++;
            checkImage(offset < bytes.length);
            const marker = bytes[offset++];
            if (marker === 217 || marker === 218) break;
            if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
            checkImage(offset + 2 <= bytes.length);
            const length = view.getUint16(offset);
            checkImage(length >= 2 && offset + length <= bytes.length);
            if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
                checkImage(length >= 8 && bytes[offset + 7] > 0 && length >= 8 + 3 * bytes[offset + 7]);
                return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
            }
            offset += length;
        }
        checkImage(false);
    }
    checkImage(bytes.length >= 20 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' &&
        view.getUint32(4, true) + 8 === bytes.length);
    const little24 = offset => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const kind = ascii(bytes, offset, 4);
        const length = view.getUint32(offset + 4, true);
        const start = offset + 8;
        checkImage(start + length <= bytes.length);
        if (kind === 'VP8X') {
            checkImage(length === 10);
            return [little24(start + 4) + 1, little24(start + 7) + 1];
        }
        if (kind === 'VP8L') {
            checkImage(length >= 5 && bytes[start] === 47 && (bytes[start + 4] >> 5) === 0);
            return [1 + (bytes[start + 1] | (bytes[start + 2] & 63) << 8),
                1 + (bytes[start + 2] >> 6 | bytes[start + 3] << 2 | (bytes[start + 4] & 15) << 10)];
        }
        if (kind === 'VP8 ') {
            checkImage(length >= 10 && ascii(bytes, start + 3, 3) === '\x9d\x01\x2a');
            return [view.getUint16(start + 6, true) & 16383, view.getUint16(start + 8, true) & 16383];
        }
        offset = start + length + length % 2;
    }
    checkImage(false);
}

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
        const [width, height] = dimensions(bytes, format);
        check(width > 0 && height > 0 && width * height <= 16000000,
            'Cloudflare images must have positive dimensions within 16 million pixels.');
    }
}
