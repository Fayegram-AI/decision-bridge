/** Native-probability questions through the shared Gemini bridge interface. */
import { createBridge, GeminiDecisionsProvider, noul, choice } from '../src/index.mjs';

const bridge = createBridge({ provider: new GeminiDecisionsProvider() });
const result = await bridge.evaluate({
    state: { message: 'The headphones arrived broken.' },
    questions: {
        damaged: noul('Does the customer report physical damage?'),
        action: choice('Choose the next action.', {
            replacement: 'The item is damaged and should be replaced.',
            review: 'A person should review the request.',
        }),
    },
});
console.log(JSON.stringify(result, null, 2));
