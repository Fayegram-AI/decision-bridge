# Custom generative providers

Use this entry point to prompt general-purpose models for structured decisions. It
includes maintained OpenAI-compatible, OpenRouter and Anthropic adapters. Import them
from `@fayegram-ai/decision-bridge/custom/generative`; the root factory accepts native
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
`init --provider custom-generative` creates a module template whose service call
throws an error until you implement it.

The subpath exports `buildResponseSchema(questions)`, `buildPrompt(request)`,
`parseGeneratedJson(text)`, and `normalizeGenerated(payload, request, options)`.
Build a prompt/schema from a validated, resolved legacy request, send it using
transport you own, parse the generated JSON, then normalize it. The normalizer
expects exactly `{ answers }`: each `noul` answer contains `{ noul }`, and each
choice/score contains `{ probabilities }` with exactly the supplied option keys
or zero-based level indices. It checks probabilities, derives argmax/weighted
scores and matching legends, and marks absent usage as unknown. It does not repair
JSON or strip Markdown, and it omits confidence. `buildPrompt` and `normalizeGenerated`
independently validate and snapshot the request. They require shared state and
legacy questions, and reject ordered input, `instructionParts`, conversation/tool
history, remote images, prompt-cache controls, typed choices, labelled scores and
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
capabilities, and testing requirements.

## Result semantics

These providers have `kind: 'generative'`. Their probabilities are estimates the model
produces in response to a prompt, labelled `elicited`. They are not native decision
probabilities or token logprobs, and the label does not establish that they are
calibrated. The bridge requires `confidenceSource: 'unavailable'` and rejects
native-confidence claims or confidence fields on answers. Presets support shared state
and legacy `choice`, `noul`, and `score`; ordered input, `instructionParts`,
conversation/tool history, remote images, prompt-cache controls, typed choices,
labelled scores and safety identifiers are unsupported. A new module may declare capabilities only after
implementing and validating them.

## OpenAI-compatible servers

Default base URL: `https://api.openai.com/v1`. Base paths such as `/v1` are preserved;
provide the API base, not the final `/chat/completions` path.

`json_schema` sends `response_format.type = json_schema`, `strict: true`, and a
schema whose required object fields disallow additional properties. Ranges and
normalization are validated locally to accommodate different supported schema
subsets. `json_object` requests JSON without schema enforcement. `text` omits the
format field and relies on instructions plus strict local validation.

Output formats are selected explicitly. An unsupported schema error does not
trigger a second request with weaker enforcement. A refusal, truncated output,
malformed JSON, probability violation, or unexpected tool call is an explicit
error. No Markdown stripping or JSON repair occurs. Automatic target selection
through [routing](ROUTING.md) preserves these output-format constraints and
requires `allowGenerative: true` for each generative target.

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

The provider sends Messages API headers `x-api-key` and `anthropic-version`.
Its defaults are API `2023-06-01` and `responseFormat: 'tool'`. Tool mode defines
and forces a synthetic `submit_decisions` tool whose input schema is the expected
answer object. The returned `tool_use.input` carries the data; no tool is executed
and no follow-up agent cycle is started.

### JSON output and API versions

Configure these two independent options through `createGenerativeProvider` or
`AnthropicProvider`:

| Option | Values | Default |
| --- | --- | --- |
| `responseFormat` | `tool`, `json_schema` | `tool` |
| `apiVersion` | `2023-06-01`, `2026-10-21` | `2023-06-01` |

```javascript
const provider = createGenerativeProvider({
    type: 'anthropic',
    model: 'claude-sonnet-5-5',
    responseFormat: 'json_schema',
    apiVersion: '2026-10-21',
    parameters: { output_config: { effort: 'medium' } },
});
```

Set `ANTHROPIC_API_KEY` through your application's environment. JSON mode sends
the answer schema in `output_config.format`, without tools. It requires an
`end_turn` completion, joins text blocks in order and parses the JSON strictly.
Default `thinking` and `redacted_thinking` response blocks are ignored during
answer extraction. Unexpected blocks, malformed JSON and invalid probabilities
fail; Markdown is not stripped. Results retain elicited probabilities and no
native confidence. `meta.responseFormat` reports the selected mode.

Choose a model that supports the selected output mode. For example,
[Sonnet 5.5 rejects forced tool choice](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide#forced-tool-use-is-not-supported),
so use JSON mode for this decision-output workflow. The SDK does not infer a mode
from the model ID or retry using another mode/version. See Anthropic's
[structured-output contract](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

API `2026-10-21` rejects `temperature`, `top_p` and `top_k`; the SDK and offline
CLI reject their presence locally, including null/default values. API
`2023-06-01` preserves their passthrough, subject to model support. Selecting a
version does not change the output mode. See the
[API migration guide](https://platform.claude.com/docs/en/api/migration-2026-10-21).

Explicit `parameters.thinking` is rejected in both modes. The default `maxTokens`
remains 4096; on models with default thinking, that budget also covers thinking
tokens. Set the budget explicitly when needed. Other `output_config` fields,
such as `effort`, are preserved; `output_config.format` and deprecated
`output_format` are reserved for the adapter and cannot be supplied in parameters.

The CLI accepts `--response-format tool|json_schema` and
`--anthropic-api-version 2023-06-01|2026-10-21`. Their environment equivalents are
`DECISION_RESPONSE_FORMAT` and `DECISION_ANTHROPIC_API_VERSION`. Flags take
precedence over environment, configuration and defaults. See the
[modern configuration example](../../examples/anthropic-json.config.json).

Refusals, truncated output, unexpected stop reasons, and invalid output fail in
both modes. `GET /v1/models` uses the selected version and returns the first page
with `has_more` / `last_id` preserved. Automatic pagination is not implemented.
