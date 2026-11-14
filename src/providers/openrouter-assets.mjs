// Assets retain their native reference semantics; no network fetch or file conversion.
import { requireCondition as check } from '../errors.mjs';
import { isRecord } from '../validation.mjs';
import { base64ByteLength } from '../embedded.mjs';
import { validateJevAssets } from './jev-images.mjs';
import { validateCloudflareImages } from './cloudflare-images.mjs';
import { isOpenRouterJev, openRouterProfile } from './openrouter-profile.mjs';
import { openRouterExtractionProfile } from '../extraction/openrouter-profile.mjs';
export { openRouterInputPart, validateOpenRouterMedia } from './openrouter-media.mjs';

export function validateOpenRouterAssets(request, { extraction = false } = {}) {
    if (request.assets === undefined) return;
    check(isRecord(request.assets), 'assets must be an object.');
    if (!extraction && Object.keys(request.assets).length) check(openRouterProfile(request.model).capabilities.images,
        'Selected OpenRouter model does not support image assets.', 'UNSUPPORTED_CAPABILITY');
    const profile = extraction ? openRouterExtractionProfile(request.model) : undefined;
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
        if (profile) check(profile.assets.includes(asset.format), 'This extraction model does not support this asset format.', 'UNSUPPORTED_CAPABILITY');
        if (asset.format === 'pdf') {
            check(extraction && (asset.type === undefined || asset.type === 'document'), 'PDF assets require extraction.');
            base64ByteLength(asset.data_base64);
            check(atob(asset.data_base64.slice(0, 8)).startsWith('%PDF-'), 'PDF assets require a PDF file.');
        } else {
            check((asset.type === undefined || asset.type === 'image') &&
                ['png', 'jpg', 'jpeg', ...(extraction ? ['webp'] : [])].includes(asset.format), 'Invalid image asset.');
            images[reference] = asset;
        }
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
        } else if (!extraction || request.state) check(texts.some(text => text.includes(reference)), 'Every asset must be referenced.');
    }
    if (!extraction && isOpenRouterJev(request.model)) validateJevAssets(request);
    else validateCloudflareImages(Object.values(images).map(asset => ({
        content_type: 'image/' + (asset.format === 'jpg' ? 'jpeg' : asset.format), base64: asset.data_base64,
    })));
    if (profile?.clairic && Object.keys(images).length > 1) check(!texts.some(text => Object.hasOwn(images, text)),
        'Clairic cannot select one of several images using a bare reference.');
    if (profile?.scaledown && Object.keys(request.assets).length) {
        const refs = Object.keys(request.assets);
        check(refs.length === 1 && (!request.state || request.state === refs[0]), 'ScaleDown reads one asset or text, not both.');
    }
}
