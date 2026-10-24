# Custom decision providers

Use `@fayegram-ai/decision-bridge/custom/decision` to connect a service with its own
decision-model API. Jev, OpenAI Decisions and Cloudflare are built into the root SDK. If
you are prompting a general-purpose model to produce decisions, use
[custom generative providers](CUSTOM_GENERATIVE.md) instead.

## SDK definition

```javascript
import { createBridge, JevProvider } from '@fayegram-ai/decision-bridge';
import { defineDecisionProvider } from '@fayegram-ai/decision-bridge/custom/decision';

const backend = new JevProvider(); // TYPESAFE_API_KEY; native delegation example.
const provider = defineDecisionProvider({
    name: 'my-decision-service',
    defaultModel: backend.defaultModel,
    probabilitySource: backend.probabilitySource,
    evaluate: (request, options) => backend.evaluate(request, options),
    getCapabilities: model => backend.getCapabilities(model),
});
const bridge = createBridge({ provider });
console.log(bridge.providerKind); // decision
```

The example delegates to Jev. For a new service, replace that call with code to encode
the request, send it, and convert the response to the shared format. The helper
validates and freezes the provider definition, sets `kind: 'decision'`, and preserves
the callbacks' `this` value. You implement the service protocol and declare its
capabilities; omitting them selects the original shared-state format.

Return `{ model, answers, usage, meta? }`. Preserve native values and reported
usage; use null for unknown token counts. Confidence is optional in the common
contract; include it only when the service reports it. Classification alone does
not apply Jev's stricter confidence/count validation to another service. Declare probability
provenance explicitly when known; the default is `unspecified`.

## CLI module

```bash
npm exec -- decision-bridge init ./my-service --provider custom-decision
```

This writes a configuration, schema, request, environment placeholders, and a
`provider.mjs` template. The module exports `createProvider(options)` and must
return a decision-kind provider. Connect it to your service before evaluation.
A runnable Jev delegation example is at
[examples/custom/decision-provider.mjs](../../examples/custom/decision-provider.mjs).

```json
{
    "schemaVersion": 1,
    "provider": "custom-decision",
    "module": "./provider.mjs",
    "model": "YOUR_DECISION_MODEL",
    "apiKeyEnv": "CUSTOM_PROVIDER_API_KEY",
    "timeoutMs": 30000,
    "options": {}
}
```

Module transport settings belong inside `options`. Offline `validate` checks
common structure without importing the module; it reports `validationScope:
'structure'`. Executed module kinds must match the selected CLI path. See the
shared [custom contract](CUSTOM_PROVIDERS.md) for capability/preflight hooks,
module loading, cancellation, and tests.
