import { requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { serializeRequestBody } from '../transport.mjs';
import { optionsObject } from '../options.mjs';
import { cloudflareBindingBody } from '../providers/cloudflare-preflight.mjs';
import { cloudflareGateway, validateCloudflareLimits } from '../providers/cloudflare-profile.mjs';
import { validateCloudflareImages } from '../providers/cloudflare-images.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const TYPES = ['text', 'number', 'date', 'time', 'datetime', 'duration', 'list', 'estimate', 'forecast'];
const FIELD_KEYS = ['type', 'instructions', 'unit', 'integer', 'decimals', 'items', 'min', 'max',
    'step', 'scale', 'null_threshold', 'horizon', 'interval'];
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function extractionModel(value = 'clairic') {
    check(value === 'clairic' || value === '@cf/cloudflare/clairic', 'Unsupported extraction model.', 'UNSUPPORTED_CAPABILITY');
    return 'clairic';
}

function field(spec) {
    check(isRecord(spec) && Object.keys(spec).every(key => FIELD_KEYS.includes(key)) && TYPES.includes(spec.type), 'Invalid extraction field.');
    for (const key of ['instructions', 'unit']) check(spec[key] === undefined || typeof spec[key] === 'string', `${key} must be text.`);
    check(spec.integer === undefined || (['number', 'duration'].includes(spec.type) && typeof spec.integer === 'boolean'), 'Invalid integer option.');
    check(spec.decimals === undefined || ((['number', 'duration'].includes(spec.type) || spec.type === 'list' && spec.items === 'number') &&
        Number.isSafeInteger(spec.decimals) && spec.decimals >= 0), 'Invalid decimals option.');
    if (spec.type === 'duration' && spec.unit !== undefined) check(['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'].includes(spec.unit), 'Invalid duration unit.');
    if (spec.type === 'list') check(['text', 'number', 'date'].includes(spec.items), 'Lists require an item type.');
    else check(spec.items === undefined, 'items applies only to lists.');
    if (['estimate', 'forecast'].includes(spec.type)) {
        check((typeof spec.min === 'number' && typeof spec.max === 'number' && spec.min <= spec.max) ||
            (isDate(spec.min) && isDate(spec.max) && spec.min <= spec.max), 'Prediction fields require ordered numeric or ISO date bounds.');
    } else check(spec.min === undefined && spec.max === undefined && spec.step === undefined && spec.scale === undefined,
        'Prediction bounds apply only to estimates and forecasts.');
    check(spec.step === undefined || (typeof spec.step === 'number' && spec.step > 0) || ['month', 'year'].includes(spec.step), 'Invalid prediction grid step.');
    check(spec.scale === undefined || ['linear', 'log'].includes(spec.scale), 'Invalid prediction scale.');
    if (spec.scale === 'log') check(typeof spec.min === 'number' && spec.min > 0, 'Log grids require positive numeric bounds.');
    check(spec.null_threshold === undefined || (typeof spec.null_threshold === 'number' && spec.null_threshold > 0 && spec.null_threshold <= 1), 'Invalid null threshold.');
    if (spec.type === 'forecast') {
        check(spec.horizon === undefined || (Number.isSafeInteger(spec.horizon) && spec.horizon > 0), 'Invalid forecast horizon.');
        check(spec.interval === undefined || ['step', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'].includes(spec.interval), 'Invalid forecast interval.');
    } else check(spec.horizon === undefined && spec.interval === undefined, 'Forecast options require a forecast field.');
}

/** Structural validation is independent of route model and transport policy. */
export function validateExtractionStructure(input) {
    const request = cloneJson(input, 'extraction request');
    check(isRecord(request) && Object.keys(request).every(key => ['model', 'state', 'fields', 'images', 'reference_date', 'options'].includes(key)), 'Invalid extraction request fields.');
    check(request.model === undefined || (typeof request.model === 'string' && request.model.trim()), 'model must be nonempty text.');
    check(isRecord(request.fields) && Object.keys(request.fields).length > 0, 'Extraction requires named fields.');
    for (const [name, spec] of Object.entries(request.fields)) {
        check(/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name), 'Invalid extraction field name.');
        field(spec);
    }
    check(request.state === undefined || typeof request.state === 'string', 'Extraction state must be text.');
    check((request.state?.length ?? 0) > 0 || (Array.isArray(request.images) && request.images.length > 0), 'Provide text or embedded images.');
    check(request.reference_date === undefined || isDate(request.reference_date), 'reference_date must be an ISO date.');
    const inference = own(request, 'options') ? request.options : {};
    check(isRecord(inference) && Object.keys(inference).every(key => ['include_quantiles', 'return_state_text', 'rejectIfBusy'].includes(key)) &&
        Object.values(inference).every(value => typeof value === 'boolean'), 'Invalid extraction options.');
    if (own(request, 'images')) validateCloudflareImages(request.images);
    return request;
}

/** Credential-free preflight shares the exact wire budget with actual dispatch. */
export function validateExtractionRequest(input, options = {}) {
    const settings = optionsObject(options, ['model', 'transport', 'gateway', 'maxRequestBytes', 'maxRetries', 'rejectIfBusy'], 'Extraction validation options');
    const request = validateExtractionStructure(input);
    const model = extractionModel(own(request, 'model') ? request.model : settings.model);
    const inference = request.options ?? {};
    const transport = settings.transport === undefined ? 'rest' : settings.transport;
    check(['rest', 'binding'].includes(transport), 'Unknown Cloudflare transport.', 'CONFIGURATION_ERROR');
    const gateway = cloudflareGateway(settings.gateway);
    const rejectIfBusy = inference.rejectIfBusy ?? settings.rejectIfBusy ?? false;
    validateCloudflareLimits({ ...settings, gateway, rejectIfBusy });
    const result = { ...request, model, ...(rejectIfBusy ? { options: { ...inference, rejectIfBusy } } : {}) };
    serializeRequestBody(transport === 'binding' ? cloudflareBindingBody(result, gateway) : result, settings.maxRequestBytes);
    if (own(request, 'images')) validateCloudflareImages(request.images);
    return freezeJson(result);
}

/** Validate established fields without guessing predictive structures or span units. */
export function validateExtractionResponse(input, request) {
    const data = cloneJson(input, 'extraction response', 'INVALID_RESPONSE');
    const invalid = (condition, message) => check(condition, message, 'INVALID_RESPONSE');
    invalid(isRecord(data) && typeof data.model === 'string' && data.model.trim() && isRecord(data.answers) &&
        typeof data.truncated === 'boolean' && isRecord(data.usage), 'Invalid extraction response.');
    invalid(Object.keys(data.answers).length === Object.keys(request.fields).length, 'Extraction answer count mismatch.');
    invalid(data.state_text === undefined || typeof data.state_text === 'string', 'Invalid returned state text.');
    for (const key of ['input_tokens', 'output_tokens', 'state_tokens', 'image_tokens', 'schema_tokens', 'passes']) {
        if (['input_tokens', 'output_tokens'].includes(key) || own(data.usage, key)) {
            invalid(Number.isSafeInteger(data.usage[key]) && data.usage[key] >= 0, 'Invalid extraction usage.');
        }
    }
    for (const [name, spec] of Object.entries(request.fields)) {
        invalid(own(data.answers, name), 'Missing extraction answer.');
        const answer = data.answers[name];
        invalid(isRecord(answer) && answer.type === spec.type && own(answer, 'value'), 'Extraction answer type mismatch.');
        const value = answer.value;
        if (value !== null && spec.type !== 'forecast') {
            if (spec.type === 'list') invalid(Array.isArray(value) && value.every(item =>
                typeof item === (spec.items === 'number' ? 'number' : 'string')), 'Invalid extraction list.');
            else invalid(typeof value === (['number', 'duration'].includes(spec.type) ? 'number'
                : spec.type === 'estimate' ? typeof spec.min : 'string'), 'Invalid extraction value.');
        }
        for (const key of ['confidence', 'p_null', 'p_below', 'p_above']) if (own(answer, key)) {
            invalid(typeof answer[key] === 'number' && answer[key] >= 0 && answer[key] <= 1, 'Invalid extraction probability.');
        }
        const span = item => Array.isArray(item) && item.length === 2 && item.every(n => Number.isSafeInteger(n) && n >= 0) && item[1] >= item[0];
        if (own(answer, 'span')) invalid(span(answer.span), 'Invalid extraction span.');
        if (own(answer, 'spans')) invalid(Array.isArray(answer.spans) && answer.spans.every(span), 'Invalid extraction spans.');
        for (const key of ['quantiles', 'steps']) if (own(answer, key)) invalid(Array.isArray(answer[key]), 'Invalid predictive array.');
    }
    return freezeJson(data);
}
