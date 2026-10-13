# Custom decision providers

Use this path for a service that exposes a decision model. It is separate from
eliciting decisions from a general-purpose model. The root SDK already supports
Jev, OpenAI Decisions, and Cloudflare; a new native decision protocol uses
`@fayegram-ai/decision-bridge/custom/decision`.

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

For a new service, replace the delegated evaluation with your encoding, transport,
and canonical response mapping. The helper validates and freezes the contract,
sets `kind: 'decision'`, and preserves callback receivers. It does not infer
capabilities or implement a protocol. Omitted capabilities use the legacy
shared-state contract.

Return `{ model, answers, usage, meta? }`. Preserve native values and reported
usage; use null for unknown token counts. Confidence is optional in the common
contract and must not be invented. Classification alone does not apply the stricter
Jev confidence/count validation mode to another service. Declare probability
provenance explicitly when known; the default is `unspecified`.

## CLI module

```bash
npm exec -- decision-bridge init ./my-service --provider custom-decision
```

This writes a configuration, schema, request, environment placeholders, and a
`provider.mjs` edit point. The module exports `createProvider(options)` and must
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
