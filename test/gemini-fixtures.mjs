/** Valid protocol fixtures shared by provider, CLI, routing and package checks. */
export const usage = { total_input_tokens: 12, total_output_tokens: 0, total_tokens: 12,
    input_tokens_by_modality: [{ modality: 'text', tokens: 12 }] };

export function geminiResponse(request) {
    return { answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        if (question.type === 'noul') return [id, { type: 'noul', noul: 0.8, confidence: 0.8 }];
        const labels = question.type === 'choice' ? Object.keys(question.criteria).sort()
            : question.criteria.map((_, index) => String(index));
        const probabilities = Object.fromEntries(labels.map((label, index) => [label, index === 0 ? 0.8 : 0.2 / (labels.length - 1)]));
        return [id, question.type === 'choice'
            ? { type: 'choice', choice: labels[0], probabilities, confidence: 0.8 }
            : { type: 'score', score: labels.reduce((sum, key) => sum + Number(key) * probabilities[key], 0),
                legend: Object.fromEntries(question.criteria.map((text, index) => [String(index), text])), probabilities, confidence: 0.8 }];
    })), usage };
}

export const nativeRequest = { input: 'Evidence', questions: { yes: { type: 'noul', instructions: 'Is it present?' } } };
export const pdf = 'data:application/pdf;base64,' + btoa('%PDF-1.7\nfixture');
