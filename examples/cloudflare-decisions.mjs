// Run explicitly with: node --env-file=.env examples/cloudflare-decisions.mjs
// These two hosted inference calls may incur charges.
import { createBridge, CloudflareDecisionsProvider, choice, noul, publicError } from '../src/index.mjs';

try {
    const provider = new CloudflareDecisionsProvider({ model: process.env.DECISION_MODEL ?? 'clef' });
    const bridge = createBridge({ provider });
    const state = { ticket: 'The production checkout is unavailable.' };
    const common = await bridge.evaluate({ state, questions: {
        urgent: noul('Does this need immediate attention?'),
        route: choice('Choose a route.', [{ value: true, description: 'Immediate incident response.' },
            { value: 'review', description: 'Normal review.' }]),
    } });
    console.log(JSON.stringify(common, null, 2));
    const native = await provider.createDecision({ state, questions: {
        urgent: { type: 'noul', instructions: 'Does this need immediate attention?' },
    } });
    console.log(JSON.stringify(native, null, 2));
} catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
}
