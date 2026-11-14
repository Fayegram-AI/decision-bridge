// Endpoint field contracts restrict known models without becoming an availability allowlist.
import { requireCondition as check } from '../errors.mjs';

const ALL_FIELDS = ['text', 'number', 'date', 'time', 'datetime', 'duration', 'list', 'estimate', 'forecast'];
export function openRouterExtractionProfile(model) {
    if (model === 'cloudflare/clairic') return { clairic: true, fields: ALL_FIELDS,
        assets: ['png', 'jpg', 'jpeg', 'webp'], noThreshold: ['list', 'estimate', 'forecast'] };
    if (model === 'scaledown/extract') return { scaledown: true, fields: ['text', 'list'], items: ['text'],
        assets: ['pdf', 'png', 'jpg', 'jpeg'], noThreshold: ALL_FIELDS, noDate: true };
    if (model === 'inception/mercury-decide') return { fields: ['text', 'list'], items: ['text'], assets: [], noDate: true };
    if (/^perplexity\/pplx-decider(?:-flash)?-v1\.3(?::free)?$/.test(model)) return {
        fields: ['text', 'list'], items: ['text'], assets: [], noThreshold: ALL_FIELDS, noDate: true };
    if (/^inference-net\/schematron-v2-(?:small|turbo)$/.test(model)) return {
        fields: ['text', 'number', 'date', 'time', 'datetime', 'list'], assets: [], noThreshold: ALL_FIELDS, noDate: true, noNumberUnit: true };
    if (model === 'levanto/sage-2') return {
        fields: ['text', 'number', 'date', 'time', 'datetime', 'duration', 'list'], assets: [], noThreshold: ['list'], noDate: true, noNumberUnit: true };
}

export function validateOpenRouterFields(request) {
    const profile = openRouterExtractionProfile(request.model);
    if (!profile) return;
    check(!(profile.noDate && request.reference_date !== undefined), 'This extraction model does not support reference_date.', 'UNSUPPORTED_CAPABILITY');
    for (const spec of Object.values(request.fields)) {
        check(profile.fields.includes(spec.type) && (spec.type !== 'list' || !profile.items || profile.items.includes(spec.items)),
            'This extraction model does not support this field type.', 'UNSUPPORTED_CAPABILITY');
        check(spec.null_threshold === undefined || !(profile.noThreshold ?? []).includes(spec.type),
            'This extraction model does not support null_threshold on this field.', 'UNSUPPORTED_CAPABILITY');
        check(!profile.clairic || spec.null_threshold === undefined || spec.null_threshold > 0, 'Clairic requires null_threshold above zero.');
        check(spec.unit === undefined || !(['text', 'date', 'time', 'datetime', 'list'].includes(spec.type) && !profile.clairic ||
            spec.type === 'number' && profile.noNumberUnit), 'This extraction model does not support this unit label.', 'UNSUPPORTED_CAPABILITY');
    }
}
