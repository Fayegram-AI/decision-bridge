import { requireCondition as check } from '../errors.mjs';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUES = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET.charCodeAt(i)] = i;
VALUES[61] = 0;
export const mediaCheck = condition => check(condition, 'Invalid embedded media header or container.');

/** Random-access inspection of validated base64, without decoding a multi-MiB clip. */
export function mediaBytes(payload, size) {
    let cachedOffset = -1, cachedValue = 0;
    const bounds = (offset, length) => mediaCheck(Number.isSafeInteger(offset) && offset >= 0 && offset + length <= size);
    const byte = offset => {
        bounds(offset, 1);
        const quartet = Math.floor(offset / 3) * 4;
        if (quartet !== cachedOffset) {
            cachedOffset = quartet;
            cachedValue = VALUES[payload.charCodeAt(quartet)] << 18 | VALUES[payload.charCodeAt(quartet + 1)] << 12 |
                VALUES[payload.charCodeAt(quartet + 2)] << 6 | VALUES[payload.charCodeAt(quartet + 3)];
        }
        return cachedValue >>> (16 - offset % 3 * 8) & 255;
    };
    const integer = (offset, length, little = false) => {
        bounds(offset, length);
        let value = 0;
        for (let i = 0; i < length; i++) value = value * 256 + byte(offset + (little ? length - 1 - i : i));
        mediaCheck(Number.isSafeInteger(value));
        return value;
    };
    return { length: size, byte, integer,
        ascii(offset, length) { bounds(offset, length); return Array.from({ length }, (_, i) => String.fromCharCode(byte(offset + i))).join(''); },
        wide(offset) {
            bounds(offset, 8);
            let value = 0n;
            for (let i = 0; i < 8; i++) value = value * 256n + BigInt(byte(offset + i));
            return value;
        },
        float(offset, length) {
            mediaCheck(length === 4 || length === 8); bounds(offset, length);
            const view = new DataView(Uint8Array.from({ length }, (_, i) => byte(offset + i)).buffer);
            return length === 4 ? view.getFloat32(0) : view.getFloat64(0);
        },
    };
}

/** Container metadata can reject an overlong clip; full decoding remains upstream. */
export function checkMediaDuration(duration, limit) {
    if (duration === undefined) return;
    mediaCheck(Number.isFinite(duration) && duration >= 0);
    check(duration <= limit + 1e-9, 'Embedded media exceeds the duration limit.');
}
