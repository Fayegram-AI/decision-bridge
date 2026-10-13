import { requireCondition as check } from './errors.mjs';

/** Snapshot classification once; response metadata cannot select the provider path. */
export function providerContract(provider) {
    check(provider && ['decision', 'generative'].includes(provider.kind),
        'A provider must declare kind decision or generative.', 'CONFIGURATION_ERROR');
    check(typeof provider.name === 'string' && provider.name.trim() &&
        (provider.defaultModel === undefined || (typeof provider.defaultModel === 'string' && provider.defaultModel.trim())),
        'A provider requires a name and an optional nonempty defaultModel.', 'CONFIGURATION_ERROR');
    check(typeof provider.evaluate === 'function', 'A provider requires evaluate().', 'CONFIGURATION_ERROR');
    for (const method of ['listModels', 'getCapabilities', 'validateRequest', 'getResultValidationOptions']) {
        check(provider[method] === undefined || typeof provider[method] === 'function',
            `Provider ${method} must be a function.`, 'CONFIGURATION_ERROR');
    }
    check(provider.probabilitySource === undefined || (typeof provider.probabilitySource === 'string' && provider.probabilitySource.trim()),
        'Provider probabilitySource must be a nonempty string.', 'CONFIGURATION_ERROR');
    check(provider.kind !== 'generative' || provider.probabilitySource === undefined || provider.probabilitySource === 'elicited',
        'Generative providers must declare elicited probability provenance.', 'CONFIGURATION_ERROR');
    return Object.freeze({ kind: provider.kind, name: provider.name,
        probabilitySource: provider.kind === 'generative' ? 'elicited' : provider.probabilitySource });
}

/** Generative estimates must never be advertised as native confidence statistics. */
export function resultProvenance(contract, response) {
    const meta = response.meta ?? {};
    const probabilitySource = Object.hasOwn(meta, 'probabilitySource') ? meta.probabilitySource : undefined;
    const confidenceSource = Object.hasOwn(meta, 'confidenceSource') ? meta.confidenceSource : undefined;
    for (const label of [probabilitySource, confidenceSource]) {
        check(label === undefined || (typeof label === 'string' && label.trim()),
            'Result provenance labels must be nonempty strings.', 'INVALID_RESPONSE');
    }
    if (contract.kind === 'generative') {
        check(probabilitySource === undefined || probabilitySource === 'elicited',
            'Generative result probability provenance must be elicited.', 'INVALID_RESPONSE');
        check(confidenceSource === undefined || confidenceSource === 'unavailable',
            'Generative results cannot report native confidence.', 'INVALID_RESPONSE');
        check(Object.values(response.answers).every(answer => !Object.hasOwn(answer, 'confidence')),
            'Generative results cannot include native confidence.', 'INVALID_RESPONSE');
        return { probabilitySource: 'elicited', confidenceSource: 'unavailable' };
    }
    return { probabilitySource: probabilitySource ?? contract.probabilitySource ?? 'unspecified' };
}
