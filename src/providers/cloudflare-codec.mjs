import { validateResult } from '../validation.mjs';
import { CLOUDFLARE_RESULT_OPTIONS } from './cloudflare-profile.mjs';

/** Generated keys keep typed primitive identities distinct on the native map wire. */
export function encodeCloudflareDecision(request) {
    const questions = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        const criteria = question.options ? Object.fromEntries(question.options.map((option, i) => [
            'option_' + i, { value: option.value, ...(Object.hasOwn(option, 'description') ? { description: option.description } : {}) },
        ])) : question.levels ?? question.criteria;
        return [id, { type: question.type, instructions: question.instructions,
            ...(criteria === undefined ? {} : { criteria }) }];
    }));
    const images = request.input?.filter(part => part.type === 'image').map(part => part.dataUrl);
    const audio = request.input?.filter(part => part.type === 'audio').map(part => part.dataUrl);
    const videos = request.input?.filter(part => part.type === 'video').map(part => part.dataUrl);
    return { model: request.model, state: Object.hasOwn(request, 'state') ? request.state :
        request.input.filter(part => part.type === 'text').map(part => part.text).join(''), questions,
    ...(images?.length ? { images } : {}), ...(audio?.length ? { audio } : {}), ...(videos?.length ? { videos } : {}) };
}

export function decodeCloudflareDecision(decision, request, meta) {
    const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        const answer = decision.answers[id];
        if (!question.options) return [id, answer];
        const selected = Number(answer.choice.slice('option_'.length));
        return [id, { type: 'choice', choice: question.options[selected].value, confidence: answer.confidence,
            probabilities: question.options.map((option, i) => ({
                value: option.value, probability: answer.probabilities['option_' + i],
            })) }];
    }));
    const details = Object.fromEntries(Object.entries(decision.answers).map(([id, answer]) => [id, {
        type: answer.type, ...(Object.hasOwn(answer, 'confidence') ? { confidence: answer.confidence } : {}),
    }]));
    return validateResult({ model: decision.model, answers, usage: decision.usage,
        meta: { ...meta, provider: 'cloudflare-decisions', requestedModel: request.model,
            probabilitySource: 'native', confidenceSource: 'native', modelSource: 'reported',
            cloudflareDecisions: { usage: decision.usage, answers: details } },
    }, request.questions, CLOUDFLARE_RESULT_OPTIONS);
}
