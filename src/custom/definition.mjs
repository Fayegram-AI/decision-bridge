import { optionsObject } from '../options.mjs';
import { providerContract } from '../provider-contract.mjs';

/** Definition callbacks retain their original receiver; no protocol is inferred. */
export function defineProvider(definition, kind) {
    optionsObject(definition, ['name', 'defaultModel', 'probabilitySource', 'evaluate',
        'listModels', 'getCapabilities', 'validateRequest', 'getResultValidationOptions'], 'Provider definition');
    const provider = { kind, name: definition.name };
    for (const field of ['defaultModel', 'probabilitySource']) {
        if (definition[field] !== undefined) provider[field] = definition[field];
    }
    if (kind === 'generative' && provider.probabilitySource === undefined) provider.probabilitySource = 'elicited';
    for (const method of ['evaluate', 'listModels', 'getCapabilities', 'validateRequest', 'getResultValidationOptions']) {
        if (typeof definition[method] === 'function') provider[method] = definition[method].bind(definition);
        else if (definition[method] !== undefined) provider[method] = definition[method];
    }
    providerContract(provider);
    return Object.freeze(provider);
}
