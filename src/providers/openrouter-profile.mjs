// Release-owned protocol profiles. Discovery never mutates synchronous preflight policy.
import { freezeJson } from '../validation.mjs';

export const isOpenRouterJev = model => /^(?:~)?typesafe\/jev-/.test(model);
export const OPENROUTER_DOCUMENT_TYPES = freezeJson({
    pdf: 'application/pdf', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odp: 'application/vnd.oasis.opendocument.presentation',
});
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
const imageModels = new Set([
    'heygen/heygen-decision-1-turbo', 'heygen/heygen-decision-1',
    'perplexity/pplx-decider-flash-v1.3:free', 'perplexity/pplx-decider-v1.3:free',
    'perplexity/pplx-decider-flash-v1.2', 'perplexity/pplx-decider-v1.2',
    '~perplexity/pplx-decider-flash-latest', '~perplexity/pplx-decider-latest',
    'morph/reflex', 'baseten/joey-1', 'baseten/mammoth-1', 'baseten/elephant-1',
    'liquid/d1.1', 'liquid/d1-ultra', 'liquid/d1', '~liquid/d1-ultra-latest', '~liquid/d1-latest',
    'openai/gpt-6-luna-decisions', 'cloudflare/clef', 'cloudflare/clef-flash', 'cloudflare/clef-omni',
    'typesafe/jev-1.13', 'typesafe/jev-1.14', '~typesafe/jev-latest',
]);
// Catalog image flags alone do not establish an adapter's media contract.
const textModels = new Set(['nace-ai/drex-max', 'nace-ai/drex-max-finance', 'respan/span-02']);

export function openRouterProfile(model) {
    // Match the native selector without coercing malformed pre-snapshot input.
    model = typeof model === 'string' ? model.trim() : '';
    const google = model === 'google/gemini-decision-1';
    const scaledown = model === 'scaledown/classify-1';
    const jev = ['typesafe/jev-1.13', 'typesafe/jev-1.14', '~typesafe/jev-latest'].includes(model);
    const clef = /^cloudflare\/clef(?:-flash|-omni)?$/.test(model);
    const luna = model === 'openai/gpt-6-luna-decisions';
    const omni = model === 'cloudflare/clef-omni';
    const images = imageModels.has(model) || google || scaledown;
    return freezeJson({
        known: images || textModels.has(model), jev, google, scaledown,
        imageMimeTypes: google ? ['image/*'] : scaledown ? ['image/png', 'image/jpeg', 'image/tiff']
            : jev ? ['image/png', 'image/jpeg'] : imageTypes,
        capabilities: {
            orderedInput: true, images, maxImages: null, maxChoiceOptions: null, maxScoreLevels: null,
            boxes: jev && model !== 'typesafe/jev-1.13', typedChoices: clef || luna, labeledScores: clef || luna,
            audio: omni || google, videos: omni || google, maxAudioClips: null, maxVideos: null,
            remoteImages: google, remoteVideos: google, documents: google || scaledown,
            remoteDocuments: google, maxDocuments: null,
            documentMimeTypes: google ? Object.values(OPENROUTER_DOCUMENT_TYPES)
                : scaledown ? ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'] : [],
        },
    });
}
