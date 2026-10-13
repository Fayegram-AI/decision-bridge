# Custom generative providers

This opt-in path elicits decisions from general-purpose models. It retains the
maintained OpenAI-compatible, OpenRouter, and Anthropic adapters. Import them from
`@fayegram-ai/decision-bridge/custom/generative`; the root factory accepts native
decision providers only.

## Use a maintained preset

```javascript
import { createBridge, noul } from '@fayegram-ai/decision-bridge';
import { createGenerativeProvider } from '@fayegram-ai/decision-bridge/custom/generative';

const provider = createGenerativeProvider({
    type: 'openrouter',
    model: process.env.DECISION_MODEL, // A model available through your account.
});
const bridge = createBridge({ provider });
const result = await bridge.evaluate({
    state: 'Test report: two assertions failed.',
    questions: { failure: noul('Does the report explicitly state that a test failed?') },
});
console.log(result.meta.providerKind);      // generative
console.log(result.meta.probabilitySource); // elicited
```

Set `OPENROUTER_API_KEY` and a real `DECISION_MODEL`, then load your environment
explicitly with Node or your application's configuration. Evaluation is a real
service call. Presets have no default model. The classes `OpenAICompatibleProvider`,
`OpenRouterProvider`, and `AnthropicProvider` and their option types are exported
from the same subpath.

## CLI presets

```bash
npm exec -- decision-bridge init ./my-model --provider custom-generative --preset openrouter --model VENDOR/MODEL_ID
npm exec -- decision-bridge evaluate ./my-model/request.json --config ./my-model/decision.config.json --env-file .env
```

Use `--preset openai-compatible` or `--preset anthropic` for the other protocols.
A configuration selects exactly one preset or module:

```json
{
    "schemaVersion": 1,
    "provider": "custom-generative",
    "preset": "openai-compatible",
    "model": "YOUR_MODEL_ID",
    "apiKeyEnv": "OPENAI_API_KEY",
    "responseFormat": "json_schema",
    "timeoutMs": 30000
}
```

For a loopback server, set `baseURL`, `noAuth: true`, the served model, and the
appropriate `tokenParameter`. Remote custom origins require explicit credentials.
See [configuration](../reference/CONFIGURATION.md).

## A new protocol

Use `defineGenerativeProvider` for a module implementing a new wire protocol.
`init --provider custom-generative` creates a module with a clear unimplemented
service call; it never produces synthetic decisions as a fallback.

The subpath exports `buildResponseSchema(questions)`, `buildPrompt(request)`,
`parseGeneratedJson(text)`, and `normalizeGenerated(payload, request, options)`.
Build a prompt/schema from a validated, resolved legacy request, send it using
transport you own, parse the generated JSON, then normalize it. The normalizer
expects exactly `{ answers }`: each `noul` answer contains `{ noul }`, and each
choice/score contains `{ probabilities }` with exactly the supplied option keys
or zero-based level indices. It checks probabilities, derives argmax/weighted
scores and matching legends, and marks absent usage as unknown. It does not repair
JSON, strip Markdown, or create confidence. `buildPrompt` and `normalizeGenerated`
independently validate and snapshot the request. They require shared state and
legacy questions, and reject ordered input, typed choices, labelled scores, and
safety identifiers with `UNSUPPORTED_CAPABILITY`. Malformed request JSON raises
`VALIDATION_ERROR`; unsupported input is never silently discarded. New modules
implement their own encoding and normalization for richer capabilities.

| Helper | Return value and responsibility |
| --- | --- |
| `buildResponseSchema(questions)` | JSON Schema for legacy question answers; validates the definitions without selecting an inference model |
| `buildPrompt(request)` | `{ system, user }` strings for a resolved shared-state request; requires a model in the request |
| `parseGeneratedJson(text)` | Parsed JSON; rejects empty or malformed content with `INVALID_RESPONSE`; answer validation happens in normalization |
| `normalizeGenerated(payload, request, options?)` | Canonical, validated `{ model, answers, usage, meta }`; returns a snapshot that the bridge subsequently freezes |

The normalizer's optional third argument accepts `model`, `usage`, and `meta`:

| Field | Meaning |
| --- | --- |
| `model` | Reported nonempty model ID; omission or null uses `request.model` and marks `modelSource: 'requested'` |
| `usage` | Validated common token counts, with null for unreported counts; omission produces null input/output counts |
| `meta` | Additional JSON metadata from your transport; normalization supplies authoritative `requestedModel`, `modelSource`, `probabilitySource: 'elicited'`, and `confidenceSource: 'unavailable'` |

None of these helpers sends a request. Your provider supplies the transport,
cancellation, response extraction, and safe error handling. Use the
[common usage and metadata contract](../reference/SDK.md#returned-data) for the
reported fields; the bridge adds its own classification and final timings.

A runnable delegation module is provided at
[examples/custom/generative-provider.mjs](../../examples/custom/generative-provider.mjs).
Use the shared [module contract](CUSTOM_PROVIDERS.md) for loader options, timeouts,
capabilities, and testing requirements. No arbitrary declarative HTTP mapping
language is supported.

## Result semantics

These providers have `kind: 'generative'`. The bridge requires elicited probability
provenance and `confidenceSource: 'unavailable'`, and rejects returned native
confidence claims or answer confidence fields. Their output is an estimate elicited
from a model, not a native probability, logprob, or calibration guarantee.
Presets support shared state and legacy `choice`, `noul`, and `score`; ordered
media, typed choices, labelled scores, and safety identifiers are unsupported.
A new module may declare capabilities only after implementing and validating them.

## OpenAI-compatible servers

Default base URL: `https://api.openai.com/v1`. Base paths such as `/v1` are preserved;
provide the API base, not the final `/chat/completions` path.

`json_schema` sends `response_format.type = json_schema`, `strict: true`, and a
schema whose required object fields disallow additional properties. Ranges and
normalization are validated locally to accommodate different supported schema
subsets. `json_object` requests JSON without schema enforcement. `text` omits the
format field and relies on instructions plus strict local validation.

There is **no auto mode**: an unsupported schema error is visible rather than
triggering a second request with weaker enforcement. A refusal, truncated output,
malformed JSON, probability violation, or unexpected tool call is an explicit
error. No Markdown stripping or JSON repair occurs.

The default token field is `max_completion_tokens`. Some compatible servers need
`max_tokens`; set `tokenParameter` explicitly. No temperature or reasoning setting
is forced. Additional generation parameters must be supported by the selected
model. Presets reserve current and legacy tool/function controls, including
`functions` and `function_call`, to preserve their answer-output protocol. Use a
custom module when you need to implement a different protocol.
This provider does not implement OpenAI Responses API, realtime streaming,
multimodal inputs, or a general function-calling agent loop.

## OpenRouter

`OpenRouterProvider` is a fixed-endpoint generative preset. It reads its own key
and defaults to `max_tokens`. It sets
`parameters.provider.require_parameters = true` so required request features are
not silently ignored by routing. Other explicit routing settings are preserved.
The preset does not guarantee which upstream host serves a model; use OpenRouter's
routing controls for stricter requirements.

Select a **generative model** that supports the chosen output mode. Other API
protocols require an explicit [custom provider](CUSTOM_PROVIDERS.md).

## Anthropic

The provider sends Messages API headers `x-api-key` and
`anthropic-version: 2023-06-01`. It defines a synthetic `submit_decisions` tool whose
input schema is the expected answer object, then forces exactly that tool. The
returned `tool_use.input` carries the data; **no tool is executed** and no follow-up
agent cycle is started.

Extended thinking is not enabled in this forced-tool strategy; a `thinking`
parameter is rejected. Refusals, truncated output, unexpected stop reasons, and
missing/extra named tools fail. `GET /v1/models` returns the first page with
`has_more` / `last_id` preserved. Automatic pagination is not implemented.
