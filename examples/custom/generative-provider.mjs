import { defineGenerativeProvider, OpenAICompatibleProvider } from '../../src/custom/generative/index.mjs';

/** Delegate a supported protocol while retaining explicit generative provenance. */
export function createProvider(options = {}) {
    const backend = new OpenAICompatibleProvider(options);
    return defineGenerativeProvider({
        name: 'project-compatible-endpoint',
        defaultModel: backend.defaultModel,
        evaluate: (request, callOptions) => backend.evaluate(request, callOptions),
        listModels: callOptions => backend.listModels(callOptions),
        getCapabilities: model => backend.getCapabilities(model),
    });
}
