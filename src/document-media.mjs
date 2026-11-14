// Common document syntax is provider-neutral; capabilities restrict accepted MIME types.
import { embeddedDataUrl } from './embedded.mjs';
import { requireCondition as check } from './errors.mjs';

export function documentMimeTypes(value) {
    check(Array.isArray(value) && value.every(mime => typeof mime === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/.test(mime)) &&
        new Set(value).size === value.length, 'Invalid document MIME capabilities.', 'CONFIGURATION_ERROR');
    return value;
}

export function assertDocumentMime(part, allowed = ['application/pdf']) {
    if (part.dataUrl !== undefined) check(allowed.includes(embeddedDataUrl(part.dataUrl, 'document').format),
        'Selected provider/model does not support this document MIME type.', 'UNSUPPORTED_CAPABILITY');
}
