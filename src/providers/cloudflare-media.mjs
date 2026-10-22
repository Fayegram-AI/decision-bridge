import { requireCondition as check } from '../errors.mjs';
import { embeddedDataUrl, base64ByteLength } from '../embedded.mjs';
import { isRecord } from '../validation.mjs';
import { mediaBytes } from './media-binary.mjs';
import { inspectWav, inspectMp3 } from './cloudflare-audio.mjs';
import { inspectMp4, inspectWebm } from './cloudflare-video.mjs';

const INSPECTORS = { 'audio/wav': inspectWav, 'audio/x-wav': inspectWav, 'audio/mpeg': inspectMp3,
    'audio/mp3': inspectMp3, 'video/mp4': inspectMp4, 'video/webm': inspectWebm };

/** Inspect supported containers; admission counts, sizes and duration are server-owned. */
export function validateCloudflareMedia(request) {
    for (const [field, kind] of [['audio', 'audio'], ['videos', 'video']]) {
        if (!Object.hasOwn(request, field)) continue;
        const items = request[field];
        check(Array.isArray(items), 'Cloudflare media must be an array.');
        for (const item of items) {
            let media;
            if (typeof item === 'string') media = embeddedDataUrl(item, kind);
            else {
                check(isRecord(item) && Object.keys(item).length === 2 && typeof item.content_type === 'string' &&
                    typeof item.base64 === 'string' && Object.hasOwn(item, 'content_type') && Object.hasOwn(item, 'base64'),
                'Media objects require content_type and base64.');
                media = { format: item.content_type, payload: item.base64, size: base64ByteLength(item.base64) };
            }
            check(media.format.startsWith(kind + '/') && Object.hasOwn(INSPECTORS, media.format),
                'Cloudflare audio/video format is unsupported.', 'UNSUPPORTED_CAPABILITY');
            INSPECTORS[media.format](mediaBytes(media.payload, media.size));
        }
    }
}
