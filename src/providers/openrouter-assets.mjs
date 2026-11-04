// Assets retain their native reference semantics; no network fetch or file conversion.
import { requireCondition as check } from '../errors.mjs';
import { isRecord } from '../validation.mjs';
import { base64ByteLength, embeddedDataUrl } from '../embedded.mjs';
import { validateJevAssets } from './jev-images.mjs';

export const isOpenRouterJev = model => /^(?:~)?typesafe\/jev-/.test(model);

/** Inspect recognized media only; unrelated structured state remains ordinary JSON. */
export function validateOpenRouterMedia(request) {
    const jev = isOpenRouterJev(request.model);
    function visit(value, allowed) {
        if (!value || typeof value !== 'object') return;
        // Only Omni interprets audio/video objects as media. Other native models
        // may receive these same keys as ordinary structured application state.
        if (value.type === 'image_url' || request.model === 'cloudflare/clef-omni' && ['input_audio', 'video_url'].includes(value.type)) {
            check(allowed, 'Media must occur in a supported state position.');
            if (value.type === 'image_url') {
                check(isRecord(value.image_url), 'Invalid image part.');
                openRouterInputPart({ type: 'image', dataUrl: value.image_url.url, detail: value.image_url.detail }, request.model);
            } else if (value.type === 'input_audio') {
                check(isRecord(value.input_audio) && ['wav', 'mp3', 'mpeg', 'm4a', 'mp4', 'aac', 'aiff', 'aif', 'flac', 'ogg', 'opus', 'webm']
                    .includes(value.input_audio.format), 'Invalid audio format.');
                base64ByteLength(value.input_audio.data);
            } else {
                check(isRecord(value.video_url), 'Invalid video part.');
                embeddedDataUrl(value.video_url.url, 'video');
            }
            return;
        }
        Object.values(value).forEach(child => visit(child, jev));
    }
    if (Array.isArray(request.state)) request.state.forEach(v => visit(v, true));
    else visit(request.state, jev);
    Object.values(request.questions).forEach(q => visit([q.instructions, q.criteria], jev));
}

export function validateOpenRouterAssets(request, { extraction = false } = {}) {
    if (request.assets === undefined) return;
    check(isRecord(request.assets), 'assets must be an object.');
    const images = Object.create(null);
    const texts = [];
    const visit = value => {
        if (typeof value === 'string') texts.push(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(request.state); visit(extraction ? Object.values(request.fields).map(f => f.instructions ?? '')
        : Object.values(request.questions).map(q => [q.instructions, q.criteria ?? null]));
    let referenceBytes = 0;
    for (const [reference, asset] of Object.entries(request.assets)) {
        const size = new TextEncoder().encode(reference).length;
        check(reference.trim() && size <= 1024 && (referenceBytes += size) <= 65536, 'Invalid or oversized asset references.');
        check(isRecord(asset) && Object.keys(asset).every(k => ['type', 'format', 'data_base64'].includes(k)), 'Invalid asset fields.');
        if (asset.format === 'pdf') {
            check(extraction && (asset.type === undefined || asset.type === 'document'), 'PDF assets require extraction.');
            base64ByteLength(asset.data_base64);
            check(atob(asset.data_base64.slice(0, 8)).startsWith('%PDF-'), 'PDF assets require a PDF file.');
        } else images[reference] = asset;
        if (!extraction && !isOpenRouterJev(request.model)) {
            check(Array.isArray(request.state) && request.state.includes(reference), 'Image references must be top-level state items.');
            check(texts.every(text => !text.includes(reference) || text === reference), 'This model does not accept embedded references.');
            const nested = [];
            const scan = value => {
                if (typeof value === 'string') nested.push(value);
                else if (value && typeof value === 'object') Object.values(value).forEach(scan);
            };
            request.state.filter(v => typeof v !== 'string').forEach(scan);
            Object.values(request.questions).forEach(q => scan([q.instructions, q.criteria]));
            check(!nested.includes(reference), 'This model accepts image references only in the top-level state array.');
        } else check(texts.some(text => text.includes(reference)), 'Every asset must be referenced.');
    }
    // Reuse bounded PNG/JPEG inspection and Jev substitution validation.
    if (Object.keys(images).length) validateJevAssets({ state: extraction ? texts : request.state,
        questions: extraction ? {} : request.questions, assets: images });
}

export function openRouterInputPart(part, model) {
    if (part.type === 'text') return part.text;
    if (part.type === 'image') {
        const image = embeddedDataUrl(part.dataUrl, 'image');
        check(['image/png', 'image/jpeg', ...(isOpenRouterJev(model) ? [] : ['image/webp'])].includes(image.format), 'Unsupported image format.');
        check(part.detail == null || ['auto', 'low', 'high'].includes(part.detail), 'Unsupported image detail.');
        return { type: 'image_url', image_url: { url: part.dataUrl, ...(part.detail == null ? {} : { detail: part.detail }) } };
    }
    if (part.type === 'audio') {
        const audio = embeddedDataUrl(part.dataUrl, 'audio');
        const format = audio.format.slice('audio/'.length).replace('x-wav', 'wav').replace('x-aiff', 'aiff');
        return { type: 'input_audio', input_audio: { data: audio.payload, format } };
    }
    check(part.type === 'video', 'Unsupported OpenRouter input part.');
    embeddedDataUrl(part.dataUrl, 'video');
    return { type: 'video_url', video_url: { url: part.dataUrl } };
}
