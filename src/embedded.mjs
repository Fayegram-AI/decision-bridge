import { requireCondition as check } from './errors.mjs';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Validate canonical base64 without decoding or allocating a second large payload. */
export function base64ByteLength(payload, code = 'VALIDATION_ERROR', message = 'Invalid embedded base64 payload.') {
    check(typeof payload === 'string' && payload.length > 0 && payload.length % 4 === 0, message, code);
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const firstPadding = payload.indexOf('=');
    check(!/[^A-Za-z0-9+/=]/.test(payload) &&
        (firstPadding === -1 || firstPadding === payload.length - padding), message, code);
    if (padding) check((ALPHABET.indexOf(payload[payload.length - padding - 1]) & (padding === 2 ? 15 : 3)) === 0,
        message, code);
    return payload.length / 4 * 3 - padding;
}

/** Embedded media only: URLs, parameters and non-base64 data are not fetched or coerced. */
export function embeddedDataUrl(dataUrl, kind, code = 'VALIDATION_ERROR') {
    const prefix = typeof dataUrl === 'string' ? /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(dataUrl) : null;
    check(prefix && prefix[1].toLowerCase().startsWith(kind + '/'),
        'Media must be nonempty inline base64 ' + kind + ' data URLs.', code);
    const payload = dataUrl.slice(prefix[0].length);
    return { format: prefix[1].toLowerCase(), payload, size: base64ByteLength(payload, code) };
}
