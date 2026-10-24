// Synthetic providers exercise orchestration without hosted inference.
export const routingRequest = { state: 'test task', questions: { yes: { type: 'noul', instructions: 'True?' } } };
export function worker(name, handler, capabilities) {
    return { kind: 'decision', name, defaultModel: name,
        ...(capabilities ? { getCapabilities: () => capabilities } : {}),
        async evaluate(request, options) {
            return handler ? handler(request, options) : { model: request.model,
                answers: { yes: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: null, output_tokens: null } };
        },
    };
}
export function selector(handler, precision) {
    const provider = worker('selector', handler ?? (request => {
        const names = Object.keys(request.questions.route.criteria);
        return { model: 'selector', answers: { route: { type: 'choice', choice: names[0],
            probabilities: Object.fromEntries(names.map((name, index) => [name, index === 0 ? 1 : 0])) } },
        usage: { input_tokens: 5, output_tokens: 1 } };
    }));
    if (precision !== undefined) provider.getResultValidationOptions = () => ({ probabilityDecimalPlaces: precision });
    return provider;
}
export function registry(policy = {}, routes = {}) {
    return { defaultRoute: 'auto', routes: {
        auto: { policy: 'deterministic', candidates: ['a', 'b'], ...policy },
        a: { provider: worker('a') }, b: { provider: worker('b') }, ...routes,
    } };
}
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
