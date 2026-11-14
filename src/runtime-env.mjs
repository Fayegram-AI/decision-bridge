/** Read Node environment defaults without requiring a Node global in browsers. */
export function environmentValue(name, env = globalThis.process?.env) {
    return env?.[name];
}

/** A defined SDK-scoped value takes precedence, including an invalid empty value. */
export function providerEnvironmentValue(name, env = globalThis.process?.env) {
    if (name === undefined) return undefined;
    const scoped = environmentValue('DECISION_BRIDGE_' + name, env);
    return scoped === undefined ? environmentValue(name, env) : scoped;
}
