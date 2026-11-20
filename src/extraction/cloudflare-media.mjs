import { requireCondition as check } from '../errors.mjs';
import { embeddedDataUrl, base64ByteLength } from '../embedded.mjs';
import { validateCloudflareImages } from '../providers/cloudflare-images.mjs';
import { isRecord } from '../validation.mjs';

const MiB = 1024 * 1024;
const PDF_MIME = 'application/pdf';

export const DEFAULT_EXTRACTION_REQUEST_BYTES = 8 * MiB;

/** The hosted PDF body ceiling also applies to Workers AI binding requests. */
export function extractionRequestLimit(request, ceiling = DEFAULT_EXTRACTION_REQUEST_BYTES) {
    return request.documents?.length ? Math.min(ceiling, 16 * MiB) : ceiling;
}

/** Check embedded media structure and, for Workers AI, hosted attachment limits. */
export function validateExtractionMedia({ images = [], documents = [] }, { enforcePdfLimits = false } = {}) {
    if (documents.length === 0) {
        validateCloudflareImages(images);
        return;
    }
    if (enforcePdfLimits) check(images.length + documents.length <= 4, 'PDF extraction accepts up to four image and document entries.');
    let total = 0;
    const countBytes = enforcePdfLimits ? size => {
        check(size <= 4 * MiB, 'PDF extraction attachments must be at most 4 MiB each.', 'REQUEST_TOO_LARGE');
        total += size;
        check(total <= 8 * MiB, 'PDF extraction attachments must total at most 8 MiB.', 'REQUEST_TOO_LARGE');
    } : undefined;
    for (const document of documents) {
        let payload, size;
        if (typeof document === 'string') {
            const data = embeddedDataUrl(document, 'document');
            check(data.format === PDF_MIME, 'Cloudflare extraction documents must be PDFs.');
            ({ payload, size } = data);
        } else {
            check(isRecord(document) && Object.keys(document).length === 2 &&
                Object.hasOwn(document, 'content_type') && Object.hasOwn(document, 'base64') &&
                document.content_type === PDF_MIME && typeof document.base64 === 'string',
            'Cloudflare extraction document objects require application/pdf content_type and base64.');
            payload = document.base64;
            size = base64ByteLength(payload);
        }
        countBytes?.(size);
        check(atob(payload.slice(0, 8)).startsWith('%PDF-'), 'Cloudflare extraction documents require a PDF header.');
    }
    // Check PDF requests' image headers after the candidate applies its attachment budget.
    validateCloudflareImages(images, { checkBytes: countBytes, checkHeader: enforcePdfLimits });
}
