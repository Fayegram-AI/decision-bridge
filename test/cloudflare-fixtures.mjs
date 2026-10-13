// Synthetic hosted-Clef contracts; no inference account is used by functional tests.
import { CloudflareDecisionsProvider, createBridge } from '../src/index.mjs';

// Complete 1x1 RGBA PNG with valid chunk checksums, suitable for hosted decoding.
export const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==';
export const native = { state: 'Synthetic evidence', questions: { q: { type: 'noul', instructions: 'True?' } } };
export const common = native;
export function cloudflareResponse(request) {
    return { model: request.model, answers: Object.fromEntries(Object.entries(request.questions).map(([id, q]) => {
        if (q.type === 'noul') return [id, { type: 'noul', noul: 0.7 }];
        const labels = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
        const values = labels.map((_, i) => labels.length > 20 ? Number((1 / labels.length).toFixed(4)) :
            i === 0 ? 0.8 : 0.2 / (labels.length - 1));
        const probabilities = Object.fromEntries(labels.map((label, i) => [label, values[i]]));
        return [id, q.type === 'choice' ? { type: 'choice', choice: labels[0], probabilities, confidence: values[0] } :
            { type: 'score', score: values.reduce((sum, p, i) => sum + p * i, 0),
                legend: Object.fromEntries(q.criteria.map((level, i) => [String(i), level])), probabilities, confidence: 0.8 }];
    })), usage: { input_tokens: 42, output_tokens: 0 } };
}
export const envelope = result => ({ result, success: true, errors: [], messages: [] });
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json', ...headers },
});
export function fixture({ mutate = () => {}, ...options } = {}) {
    const requests = [];
    const provider = new CloudflareDecisionsProvider({ accountId: 'fixture-account', apiKey: 'fixture-key', ...options,
        fetchImpl: async (url, init) => {
            const request = JSON.parse(init.body);
            requests.push({ url, init, request });
            const response = cloudflareResponse(request);
            mutate(response, request);
            return json(envelope(response), 200, { 'cf-ai-req-id': 'fixture-request-id', 'cf-aig-log-id': 'fixture-log-id' });
        } });
    return { provider, requests, bridge: createBridge({ provider }) };
}
