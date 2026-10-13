import { JevProvider } from '../../src/index.mjs';
import { defineDecisionProvider } from '../../src/custom/decision.mjs';

/** Runnable native delegation example; a new protocol must implement its own wire mapping. */
export function createProvider(options = {}) {
    const backend = new JevProvider(options);
    return defineDecisionProvider({
        name: 'project-decision-endpoint',
        defaultModel: backend.defaultModel,
        probabilitySource: backend.probabilitySource,
        evaluate: (request, callOptions) => backend.evaluate(request, callOptions),
        listModels: callOptions => backend.listModels(callOptions),
        getCapabilities: model => backend.getCapabilities(model),
    });
}
