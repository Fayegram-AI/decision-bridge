/** Native Google wire validation. Media is forwarded, never downloaded or uploaded. */
import { requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { base64ByteLength } from '../embedded.mjs';
import { isTextWithinLimit, validateMediaReference } from '../input.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { fields } from './decisions-input.mjs';
import { GEMINI_MODEL, GEMINI_MIME_TYPES, GEMINI_JSON_NODES, geminiModel } from './gemini-profile.mjs';

function textContent(part) {
    fields(part, ['type', 'text'], ['type', 'text'], 'Gemini text content');
    check(part.type === 'text' && typeof part.text === 'string', 'Gemini text content requires text.');
}

export function validateGeminiContent(part, { instructions = false } = {}) {
    if (part?.type === 'text') return textContent(part);
    check(!instructions && isRecord(part) && Object.hasOwn(GEMINI_MIME_TYPES, part.type),
        'Unsupported Gemini content type.', 'UNSUPPORTED_CAPABILITY');
    fields(part, ['type', 'data', 'uri', 'mime_type', 'resolution'], ['type', 'mime_type'], 'Gemini media');
    check(Object.hasOwn(part, 'data') !== Object.hasOwn(part, 'uri'), 'Gemini media requires exactly one of data or uri.');
    check(GEMINI_MIME_TYPES[part.type].includes(part.mime_type), 'Unsupported Gemini media MIME type.', 'UNSUPPORTED_CAPABILITY');
    if (Object.hasOwn(part, 'data')) base64ByteLength(part.data);
    else {
        validateMediaReference(part.uri);
        const host = new URL(part.uri).hostname.toLowerCase();
        check(part.type !== 'video' || !/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host),
            'Gemini Decisions does not support YouTube URLs.', 'UNSUPPORTED_CAPABILITY');
    }
    if (Object.hasOwn(part, 'resolution')) {
        const allowed = part.type === 'image' ? ['low', 'medium', 'high', 'ultra_high']
            : part.type === 'video' ? ['low', 'medium', 'high'] : [];
        check(allowed.includes(part.resolution), 'Unsupported Gemini media resolution.', 'UNSUPPORTED_CAPABILITY');
    }
}

function instructions(value) {
    if (typeof value === 'string') {
        check(value.trim().length > 0, 'Gemini instructions must be nonempty.');
        return;
    }
    const parts = Array.isArray(value) ? value : [value];
    check(parts.length > 0, 'Gemini instructions require content.');
    parts.forEach(part => validateGeminiContent(part, { instructions: true }));
    check(parts.some(part => part.text.trim()), 'Gemini instructions must be nonempty.');
}

function optionKey(value) {
    // Google excludes every Unicode Other category, including format and private-use characters.
    check(isTextWithinLimit(value, 128) && value.length > 0 && !/^\s|\s$|\p{C}/u.test(value) &&
        !Array.from(value).some(character => character !== ' ' && /\p{White_Space}/u.test(character)),
    'Invalid Gemini choice key.');
    check(new TextEncoder().encode(value).length <= 512, 'Gemini choice key exceeds its byte limit.');
}

export function prepareGeminiDecision(input, settings = {}) {
    const request = cloneJson(input, 'Gemini native request', 'VALIDATION_ERROR', GEMINI_JSON_NODES);
    fields(request, ['model', 'input', 'questions'], ['input', 'questions'], 'Gemini request');
    request.model = geminiModel(Object.hasOwn(request, 'model') ? request.model : settings.model ?? GEMINI_MODEL);
    if (typeof request.input === 'string') check(request.input.length > 0, 'Gemini input must not be empty.');
    else {
        const parts = Array.isArray(request.input) ? request.input : [request.input];
        check(parts.length > 0, 'Gemini input requires content.');
        parts.forEach(part => validateGeminiContent(part));
        check(parts.some(part => part.type !== 'text' || part.text.length > 0), 'Gemini input must not be empty.');
    }
    check(isRecord(request.questions) && Object.keys(request.questions).length >= 1 &&
        Object.keys(request.questions).length <= 1000, 'Gemini requires 1 to 1000 questions.');
    for (const [id, question] of Object.entries(request.questions)) {
        check(/^[A-Za-z0-9_-]{1,64}$/.test(id), 'Invalid Gemini question key.');
        check(isRecord(question) && ['noul', 'choice', 'score'].includes(question.type), 'Unsupported Gemini question type.', 'UNSUPPORTED_CAPABILITY');
        fields(question, ['type', 'instructions', 'criteria'], ['type', 'instructions'], 'Gemini question');
        instructions(question.instructions);
        if (question.type === 'noul') {
            if (Object.hasOwn(question, 'criteria')) {
                fields(question.criteria, ['true_description', 'false_description'], [], 'Gemini yes/no criteria');
                check(Object.values(question.criteria).every(value => typeof value === 'string'), 'Gemini criteria descriptions must be text.');
            }
        } else if (question.type === 'choice') {
            check(isRecord(question.criteria) && Object.keys(question.criteria).length >= 2 &&
                Object.keys(question.criteria).length <= 255, 'Gemini choice requires 2 to 255 options.');
            Object.keys(question.criteria).forEach(optionKey);
            check(Object.values(question.criteria).every(value => typeof value === 'string'), 'Gemini choice descriptions must be text.');
        } else {
            check(Array.isArray(question.criteria) && question.criteria.length >= 2 && question.criteria.length <= 255 &&
                question.criteria.every(value => typeof value === 'string' && value.trim()), 'Gemini score requires 2 to 255 nonempty levels.');
        }
    }
    serializeRequestBody(request, settings.maxRequestBytes);
    return freezeJson(request);
}
