// Synthetic contract fixtures. No hosted model output or application data.
export const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==';
export const usage = { input_tokens: 42, output_tokens: 0, total_tokens: 42,
    input_tokens_details: { cached_tokens: 5, cache_write_tokens: 2 }, output_tokens_details: { reasoning_tokens: 0 } };

export function decisionResponse(request) {
    return { model: request.model, usage: structuredClone(usage), answers: request.questions.map(q => {
        const base = { type: q.type, name: q.name ?? null };
        if (q.type === 'predicate') return { ...base, probability: 0.7 };
        if (q.type === 'choice') return { ...base, choice: q.choices[0].value, confidence: 0.8,
            probabilities: q.choices.map((option, i) => ({ value: option.value,
                probability: q.choices.length === 1 ? 1 : i === 0 ? 0.8 : 0.2 / (q.choices.length - 1) })) };
        return { ...base, confidence: 0.6, score: (q.levels.length - 1) / 2,
            probabilities: q.levels.map((level, i) => ({ value: i, label: level.label, probability: 1 / q.levels.length })) };
    }) };
}
