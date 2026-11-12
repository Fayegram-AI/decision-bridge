/** Google response and refusal validation; response content never selects rounding policy. */
import { DecisionError, requireCondition as check } from '../errors.mjs';
import { cloneJson, freezeJson, isRecord } from '../validation.mjs';
import { validateProbabilitySum } from '../probabilities.mjs';
import { GEMINI_JSON_NODES } from './gemini-profile.mjs';

const safetyCodes = new Set(['safety', 'prohibited_content', 'blocklist', 'image_safety', 'content_blocked']);
const feedbackCodes = new Set(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'OTHER', 'IMAGE_SAFETY',
    'CONTENT_BLOCKED', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_OTHER', 'JAILBREAK']);
const valid = (condition, message) => check(condition, message, 'INVALID_RESPONSE');
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const tokens = value => Number.isSafeInteger(value) && value >= 0;

export function geminiError(data, status, meta) {
    const upstream = data?.error?.code;
    const code = safetyCodes.has(upstream) ? 'MODEL_REFUSAL'
        : status === 429 ? 'RATE_LIMITED' : status === 503 ? 'CAPACITY_EXCEEDED' : 'HTTP_ERROR';
    const diagnostic = safetyCodes.has(upstream) ? { upstreamErrorCode: upstream }
        : tokens(upstream) ? { upstreamCode: upstream } : {};
    return new DecisionError('Gemini returned HTTP ' + status + '.', { ...meta, code, status, source: 'provider',
        ...diagnostic });
}

function feedback(value) {
    if (value === undefined) return;
    valid(isRecord(value), 'Invalid Gemini prompt feedback.');
    const reason = value.block_reason ?? value.blockReason;
    if (reason === undefined || reason === 0 || ['BLOCK_REASON_UNSPECIFIED', 'BLOCKED_REASON_UNSPECIFIED', 'UNSPECIFIED'].includes(reason)) return;
    valid(typeof reason === 'string' && reason.length > 0 || tokens(reason), 'Invalid Gemini block reason.');
    const diagnostic = typeof reason === 'number' ? { upstreamCode: reason }
        : { upstreamErrorCode: safetyCodes.has(reason) || feedbackCodes.has(reason) ? reason : 'content_blocked' };
    throw new DecisionError('Gemini blocked the request.', { code: 'MODEL_REFUSAL', source: 'provider', ...diagnostic });
}

function usage(value) {
    valid(isRecord(value) && tokens(value.total_input_tokens) && value.total_output_tokens === 0, 'Invalid Gemini token usage.');
    if (value.total_tokens !== undefined) valid(value.total_tokens === value.total_input_tokens, 'Inconsistent Gemini total token usage.');
    for (const key of ['input_tokens_by_modality', 'output_tokens_by_modality']) if (value[key] !== undefined) {
        valid(Array.isArray(value[key]) && value[key].every(item => isRecord(item) &&
            typeof item.modality === 'string' && item.modality.length > 0 && tokens(item.tokens)), 'Invalid Gemini modality usage.');
    }
}

export function validateGeminiDecision(input, request) {
    const response = cloneJson(input, 'Gemini decision response', 'INVALID_RESPONSE', GEMINI_JSON_NODES);
    valid(isRecord(response), 'Invalid Gemini decision response.');
    feedback(response.prompt_feedback);
    usage(response.usage);
    valid(isRecord(response.answers) && Object.keys(response.answers).length === Object.keys(request.questions).length,
        'Gemini answer count mismatch.');
    for (const [id, question] of Object.entries(request.questions)) {
        const answer = response.answers[id];
        valid(Object.hasOwn(response.answers, id) && isRecord(answer) && answer.type === question.type, 'Gemini answer type or key mismatch.');
        valid(probability(answer.confidence), 'Invalid Gemini confidence.');
        if (question.type === 'noul') {
            valid(probability(answer.noul) && answer.noul >= 0.01 && answer.noul <= 0.99, 'Invalid Gemini yes/no probability.');
            valid(Math.abs(answer.confidence - Math.max(answer.noul, 1 - answer.noul)) <= 0.001, 'Inconsistent Gemini yes/no confidence.');
            continue;
        }
        const labels = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index));
        valid(isRecord(answer.probabilities) && Object.keys(answer.probabilities).length === labels.length &&
            labels.every(label => Object.hasOwn(answer.probabilities, label) && probability(answer.probabilities[label])), 'Invalid Gemini distribution.');
        validateProbabilitySum(Object.values(answer.probabilities));
        const highest = Math.max(...Object.values(answer.probabilities));
        valid(Math.abs(answer.confidence - highest) <= 0.001, 'Inconsistent Gemini confidence.');
        if (question.type === 'choice') {
            valid(typeof answer.choice === 'string' && labels.includes(answer.choice) &&
                answer.probabilities[answer.choice] + 1e-6 >= highest, 'Invalid Gemini selected choice.');
        } else {
            valid(isRecord(answer.legend) && Object.keys(answer.legend).length === labels.length &&
                labels.every((label, index) => Object.hasOwn(answer.legend, label) && answer.legend[label] === question.criteria[index]),
            'Gemini score legend mismatch.');
            const mean = labels.reduce((sum, key) => sum + Number(key) * answer.probabilities[key], 0);
            valid(typeof answer.score === 'number' && Number.isFinite(answer.score) && answer.score >= 0 &&
                answer.score <= labels.length - 1 && Math.abs(answer.score - mean) <= 0.02 * labels.length,
            'Gemini score is inconsistent with its rubric.');
        }
    }
    return freezeJson(response);
}
