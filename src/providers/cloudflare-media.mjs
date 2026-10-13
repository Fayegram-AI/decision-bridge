import { requireCondition as check } from '../errors.mjs';
import { embeddedDataUrl, base64ByteLength } from '../embedded.mjs';
import { isRecord } from '../validation.mjs';
import { mediaBytes, checkMediaDuration } from './media-binary.mjs';
import { inspectWav, inspectMp3 } from './cloudflare-audio.mjs';
import { inspectMp4, inspectWebm } from './cloudflare-video.mjs';

const INSPECTORS = { 'audio/wav': inspectWav, 'audio/x-wav': inspectWav, 'audio/mpeg': inspectMp3,
    'audio/mp3': inspectMp3, 'video/mp4': inspectMp4, 'video/webm': inspectWebm };
const MIB = 1024 * 1024;

/** Counts/decoded sizes are checked before container inspection; no runtime codec dependency. */
export function validateCloudflareMedia(request) {
    let total = 0;
    for (const [field, kind, count, bytes, seconds] of [['audio', 'audio', 4, 8 * MIB, 300], ['videos', 'video', 2, 16 * MIB, 60]]) {
        if (!Object.hasOwn(request, field)) continue;
        const items = request[field];
        check(Array.isArray(items) && items.length <= count, 'Cloudflare media count exceeds its limit.');
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
            check(media.size <= bytes, 'Cloudflare media exceeds its decoded byte limit.', 'REQUEST_TOO_LARGE');
            total += media.size;
            check(total <= 16 * MIB, 'Cloudflare audio/video exceeds 16 MiB combined.', 'REQUEST_TOO_LARGE');
            checkMediaDuration(INSPECTORS[media.format](mediaBytes(media.payload, media.size)), seconds);
        }
    }
}
