// OpenRouter media codecs validate references without fetching or rewriting signed URLs.
import { requireCondition as check } from '../errors.mjs';
import { isRecord } from '../validation.mjs';
import { base64ByteLength, embeddedDataUrl } from '../embedded.mjs';
import { validateMediaReference } from '../input.mjs';
import { openRouterProfile, OPENROUTER_DOCUMENT_TYPES, isOpenRouterJev } from './openrouter-profile.mjs';

const AUDIO_FORMATS = ['wav', 'mp3', 'mpeg', 'm4a', 'mp4', 'aac', 'aiff', 'aif', 'flac', 'ogg', 'opus', 'webm'];
const supported = (condition, feature) => check(condition, 'Selected OpenRouter model does not support ' + feature + '.', 'UNSUPPORTED_CAPABILITY');

function mediaUrl(url, kind, remote) {
    if (typeof url === 'string' && /^https?:/i.test(url)) {
        supported(remote, 'remote ' + kind);
        validateMediaReference(url);
        return;
    }
    return embeddedDataUrl(url, kind);
}

function fileData(url, profile) {
    supported(profile.capabilities.documents, 'documents');
    const data = mediaUrl(url, 'document', profile.capabilities.remoteDocuments);
    const mime = data?.format ?? OPENROUTER_DOCUMENT_TYPES[new URL(url).pathname.split('.').at(-1).toLowerCase()];
    supported(profile.capabilities.documentMimeTypes.includes(mime), 'this document MIME type or URL extension');
}

export function openRouterInputPart(part, model) {
    const profile = openRouterProfile(model);
    const caps = profile.capabilities;
    // Direct Gemini resolution controls have no matching OpenRouter wire field.
    supported(!Object.hasOwn(part, 'resolution'), 'resolution controls');
    if (part.type === 'text') return part.text;
    if (part.type === 'image') {
        supported(caps.images, 'images');
        const url = part.url ?? part.dataUrl;
        const data = mediaUrl(url, 'image', caps.remoteImages);
        check(!data || profile.imageMimeTypes.includes(data.format) || profile.imageMimeTypes.includes('image/*'), 'Unsupported image format.');
        check(part.detail == null || ['auto', 'low', 'high'].includes(part.detail), 'Unsupported image detail.');
        return { type: 'image_url', image_url: { url, ...(part.detail == null ? {} : { detail: part.detail }) } };
    }
    if (part.type === 'audio') {
        supported(caps.audio, 'audio');
        supported(part.url === undefined, 'remote audio');
        const audio = embeddedDataUrl(part.dataUrl, 'audio');
        const format = audio.format.slice('audio/'.length).replace('x-wav', 'wav').replace('x-aiff', 'aiff');
        check(AUDIO_FORMATS.includes(format), 'Invalid audio format.');
        return { type: 'input_audio', input_audio: { data: audio.payload, format } };
    }
    if (part.type === 'document') {
        const url = part.url ?? part.dataUrl;
        fileData(url, profile);
        return { type: 'file', file: { file_data: url } };
    }
    check(part.type === 'video', 'Unsupported OpenRouter input part.');
    supported(caps.videos, 'video');
    const url = part.url ?? part.dataUrl;
    mediaUrl(url, 'video', caps.remoteVideos);
    return { type: 'video_url', video_url: { url } };
}

/** Only images on Jev may be nested; file parts also accept the whole state. */
export function validateOpenRouterMedia(request) {
    const profile = openRouterProfile(request.model);
    function visit(value, top = false, wholeState = false) {
        if (!value || typeof value !== 'object') return;
        // Unknown models may use these keys as ordinary structured application data.
        if (value.type === 'image_url' || profile.known && ['input_audio', 'video_url', 'file'].includes(value.type)) {
            const image = value.type === 'image_url';
            check(top || image && isOpenRouterJev(request.model) || value.type === 'file' && wholeState,
                'Media must occur in a supported state position.');
            if (image) {
                check(isRecord(value.image_url) && Object.keys(value.image_url).every(k => ['url', 'detail'].includes(k)), 'Invalid image part.');
                openRouterInputPart({ type: 'image', dataUrl: value.image_url.url, detail: value.image_url.detail }, request.model);
            } else if (value.type === 'input_audio') {
                supported(profile.capabilities.audio, 'audio');
                check(isRecord(value.input_audio) && Object.keys(value.input_audio).every(k => ['data', 'format'].includes(k)) &&
                    AUDIO_FORMATS.includes(value.input_audio.format), 'Invalid audio format.');
                base64ByteLength(value.input_audio.data);
            } else if (value.type === 'video_url') {
                supported(profile.capabilities.videos, 'video');
                check(isRecord(value.video_url) && Object.keys(value.video_url).every(k => ['url', 'processing'].includes(k)), 'Invalid video part.');
                mediaUrl(value.video_url.url, 'video', profile.capabilities.remoteVideos);
            } else {
                check(isRecord(value.file) && Object.keys(value.file).every(k => ['file_data', 'filename'].includes(k)) &&
                    (value.file.filename === undefined || typeof value.file.filename === 'string'), 'Invalid file part.');
                fileData(value.file.file_data, profile);
            }
            check(Object.keys(value).every(k => ['type', value.type].includes(k)), 'Invalid media part fields.');
            return;
        }
        Object.values(value).forEach(child => visit(child));
    }
    if (Array.isArray(request.state)) request.state.forEach(v => visit(v, true));
    else visit(request.state, false, true);
    Object.values(request.questions).forEach(q => visit([q.instructions, q.criteria]));
}
