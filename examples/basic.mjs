import { createBridge, choice, noul } from '../src/index.mjs';

const bridge = createBridge({ jev: {} }); // TYPESAFE_API_KEY; direct TypeSafe; jev-latest by default.
const result = await bridge.evaluate({
  state: { error: "ModuleNotFoundError: No module named 'pytest'" },
  questions: {
    category: choice('Classify this failure from the supplied evidence.', {
      dependency: 'A required package or module is unavailable.',
      network: 'A network operation failed.',
      assertion: 'A test assertion failed.',
      unknown: 'Insufficient evidence for the other categories.',
    }),
    missing_dependency: noul('Does this error indicate a missing Python dependency?'),
  },
});
console.log(JSON.stringify(result, null, 2));
// The caller decides what happens next. This example does not execute any action.
