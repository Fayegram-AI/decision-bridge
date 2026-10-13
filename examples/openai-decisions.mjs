import { createBridge, createProvider, choice, noul, scoreLevels, publicError } from '../src/index.mjs';

// Run explicitly with OPENAI_API_KEY configured; this performs one paid request.
try {
    const bridge = createBridge({ provider: createProvider({ type: 'openai-decisions' }) });
    const result = await bridge.evaluate({
        state: 'Export fails in Safari but works in Chrome.',
        questions: {
            route: choice('Select a queue.', [{ value: 'engineering' }, { value: 'review' }]),
            browserSpecific: noul('Does this report describe a browser-specific failure?'),
            severity: scoreLevels('Rate the impact.', [
                { label: 'Minor' }, { label: 'Workaround available' }, { label: 'Blocked' },
            ]),
        },
    });
    console.log(JSON.stringify(result, null, 4));
} catch (error) {
    console.error(JSON.stringify({ error: publicError(error) }));
    process.exitCode = 1;
}
