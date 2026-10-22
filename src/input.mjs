import { requireCondition as check } from './errors.mjs';
import { embeddedDataUrl } from './embedded.mjs';

/** JSON Schema string limits count Unicode code points, not UTF-16 code units. */
export function isTextWithinLimit(value, max) {
    if (typeof value !== 'string') return false;
    if (value.length <= max) return true;
    if (value.length > max * 2) return false;
    let length = 0;
    for (const character of value) {
        if (++length > max) return false;
    }
    return true;
}

/** Shared inline-image contract; never fetch external URLs or infer image bytes. */
export function validateImage(dataUrl, detail, code = 'VALIDATION_ERROR') {
    embeddedDataUrl(dataUrl, 'image', code);
    check(detail === undefined || detail === null || ['low', 'high', 'auto', 'original'].includes(detail),
        'Unsupported image detail.', code);
}

/** A public reference is forwarded to the provider; the SDK never fetches it. */
export function validateImageSource(value, detail, code = 'VALIDATION_ERROR') {
    if (typeof value === 'string' && /^https?:/i.test(value)) {
        let url;
        try { url = new URL(value); } catch { /* Validated below. */ }
        check(url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
            'Images require a public HTTP(S) URL.', code);
        check(detail === undefined || detail === null || ['low', 'high', 'auto', 'original'].includes(detail),
            'Unsupported image detail.', code);
    } else validateImage(value, detail, code);
}

export function validateOrderedInput(input) {
    check(Array.isArray(input) && input.length > 0, 'input must be a nonempty ordered array.');
    for (const part of input) {
        check(part !== null && typeof part === 'object' && !Array.isArray(part), 'Input parts must be objects.');
        const fields = part.type === 'text' ? ['type', 'text', 'promptCacheBreakpoint'] : part.type === 'image'
            ? ['type', 'dataUrl', 'url', 'detail', 'promptCacheBreakpoint'] : ['type', 'dataUrl'];
        check(Object.keys(part).every(key => fields.includes(key)), 'Unknown input part field.');
        if (part.type === 'text') check(typeof part.text === 'string', 'Text parts require text.');
        else {
            check(['image', 'audio', 'video'].includes(part.type), 'Input parts must be text, image, audio, or video.');
            if (part.type === 'image') {
                check(Object.hasOwn(part, 'dataUrl') !== Object.hasOwn(part, 'url'), 'Image requires exactly one of dataUrl or url.');
                if (Object.hasOwn(part, 'url')) {
                    check(typeof part.url === 'string' && /^https?:/i.test(part.url), 'url must use HTTP(S).');
                    validateImageSource(part.url, part.detail);
                } else validateImage(part.dataUrl, part.detail);
            }
            else embeddedDataUrl(part.dataUrl, part.type);
        }
    }
}
