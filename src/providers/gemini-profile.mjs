/** Documented Gemini Decisions selectors and media policy, independent of credentials. */
import { requireCondition as check } from '../errors.mjs';

export const GEMINI_MODEL = 'gemini-decision-1';
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
export const GEMINI_KEY_ENV = 'GEMINI_API_KEY';
// The serialized JSON budget includes base64 expansion and question overhead.
export const GEMINI_REQUEST_CEILING = 160 * 1024 * 1024;
export const GEMINI_JSON_NODES = 1000000;

export const GEMINI_MIME_TYPES = Object.freeze({
    image: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp', 'image/tiff']),
    audio: Object.freeze(['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac',
        'audio/m4a', 'audio/opus', 'audio/webm', 'audio/l16', 'audio/alaw', 'audio/mulaw']),
    video: Object.freeze(['video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/webm', 'video/wmv', 'video/x-flv', 'video/3gpp']),
    document: Object.freeze(['application/pdf']),
});

export function geminiModel(value = GEMINI_MODEL) {
    check(typeof value === 'string' && value.trim(), 'Gemini model must be nonempty.');
    check(value.trim() === GEMINI_MODEL, 'Unsupported Gemini Decisions model.', 'UNSUPPORTED_CAPABILITY');
    return value.trim();
}

export function geminiCapabilities(model) {
    return {
        supported: model === GEMINI_MODEL, orderedInput: true, images: true, remoteImages: true,
        audio: true, videos: true, documents: true, remoteAudio: true, remoteVideos: true, remoteDocuments: true,
        maxImages: null, maxAudioClips: null, maxVideos: null, maxDocuments: null,
        documentMimeTypes: GEMINI_MIME_TYPES.document,
        typedChoices: true, labeledScores: true, maxChoiceOptions: 255, maxScoreLevels: 255,
        jsonInput: true, questionContent: true, questionContentTypes: ['text', 'json'],
        imageResolutions: ['low', 'medium', 'high', 'ultra_high'], videoResolutions: ['low', 'medium', 'high'],
        maxJsonNodes: GEMINI_JSON_NODES,
    };
}

/** Locale-independent UTF-8 ordering matches native choice ordering. */
export function compareUtf8(left, right) {
    const encoder = new TextEncoder();
    const a = encoder.encode(left);
    const b = encoder.encode(right);
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
}
