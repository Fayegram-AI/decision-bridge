# Architecture

## Bridge and provider responsibilities

Decision Bridge exposes one application contract for structured decisions. The
bridge owns request snapshots, common validation, extension sequencing, the total
deadline, final result validation, immutable results, and bounded observations.
A provider owns its API encoding, transport, decoding, model selection,
capabilities, and native operations. Multiple models sharing a protocol can use
one provider implementation.

`createBridge` requires an explicitly selected provider or the Jev shortcut.
`createProvider` requires an explicit native type. `custom/decision` and
`custom/generative` expose classified extension helpers; maintained generative
adapters are loaded only through their opt-in subpath. The CLI resolves its own configuration
and Jev default before constructing the SDK bridge.

```text
Application / CLI
  state or ordered input + question definitions + optional model
        |
        v
  request snapshot, common validation, capabilities, provider preflight
        |
  ordered prepareState or prepareInput extensions + revalidation
        |
  Provider.evaluate (explicit decision/generative kind)
        +-- Jev: native systemone
        +-- OpenAI Decisions: native /v1/decisions
        +-- Cloudflare Clef / Clef-flash / Clef-omni: REST or Workers AI binding
        +-- custom/decision: new native decision protocol
        +-- custom/generative: OpenAI-compatible / OpenRouter / Anthropic or new protocol
        |
  canonical result validation using provider precision policy
        |
  immutable result + bounded observation
        |
  application policy / storage / downstream action
```

Native OpenAI and Cloudflare providers also expose `createDecision` directly.
Common and native paths share provider validation, codecs, and bounded transport.
Direct native calls use provider deadlines; bridge calls additionally enforce the
shared evaluation deadline and extension lifecycle.

Application policy decides whether a downstream action is permitted. The SDK
returns decisions without executing actions or maintaining an agent loop.

## Model selection and request preparation

The bridge applies the provider's configured default when a request omits `model`.
Its validated request and extension context retain that selected string. A provider
may resolve a selection to an upstream ID while preparing its outgoing request;
the shared provider contract has no selector-resolution hook.

OpenAI's `openai-profile.mjs` owns the `default` selection, accepted selectors,
upstream targets, and capabilities. Common and native preparation retain the
validated selection separately from the resolved native request. Preflight returns
the selected request, while serialization and byte-limit checks use the resolved
request. Common evaluation and native `createDecision()` share dispatch, which
sends only that resolved request.

Successful OpenAI calls report the selected string in `meta.requestedModel` and
the outgoing ID in `meta.resolvedModel`. The response's `model` retains the
service-reported identity. CLI offline validation and execution use the same
preflight, and generated OpenAI requests inherit selection from configuration.
See [OpenAI model selection](../guides/OPENAI_DECISIONS.md#model-selection).

## Module map

| Module | Responsibility |
| --- | --- |
| `src/index.mjs`, `src/index.d.mts` | Public runtime exports and TypeScript contract |
| `src/bridge.mjs` | Orchestration, extension lifecycle, total deadline, immutable results |
| `src/validation.mjs`, `src/input.mjs` | Lossless snapshots, common input and result invariants |
| `src/questions.mjs` | Immutable typed question builders, independent of inference selection |
| `src/capabilities.mjs` | Provider/model capability checks and common schema versions |
| `src/probabilities.mjs` | Provider-selected precision allowance without normalization |
| `src/provider-contract.mjs` | Required classification, authoritative metadata, and generative provenance |
| `src/custom/decision.mjs` | Explicit native decision definition helper |
| `src/custom/generative/` | Opt-in protocol presets, schema, prompts, and result derivation |
| `schemas/decision.config.schema.json` | Shipped CLI configuration structure and editor support |
| `src/providers/` | API orchestration, model profiles, preflight, codecs, bounded image/audio/video inspection, and transports |
| `src/providers/openai-profile.mjs`, `src/providers/decisions-preflight.mjs` | Release-owned OpenAI selection, capabilities, and preparation of selected and outgoing requests |
| `src/embedded.mjs` | Shared embedded data URL and canonical base64 checks |
| `src/transport.mjs`, `src/response-transport.mjs` | Credential destinations, bounded bodies, safe errors, retries |
| `src/async.mjs` | Deadlines and cancellation races |
| `src/options.mjs` | Unknown-field/accessor rejection for options |
| `src/errors.mjs` | DecisionError and safe public diagnostics |
| `src/batch.mjs` | Ordered bounded-concurrency SDK arrays |
| `src/policy.mjs` | Explicit choice thresholds, without action execution |
| `src/cli/ordered.mjs` | Concurrent JSONL processing with a bounded ordered window |
| `src/cli/`, `bin/decision.mjs` | Configuration, input/output, commands, process signals |

## Results and precision

Generative providers elicit distributions and derive argmax choices, weighted
scores, and rubric legends in code. Native decision providers validate and retain
their returned values, confidence, and reported usage. No path repairs malformed
distributions or invents confidence. The common shape preserves provenance without
claiming equivalent statistical semantics across models.

The bridge takes result-validation policy from the provider contract. Cloudflare
uses an allowance for four-decimal distributions; other built-ins retain the
baseline. Response metadata cannot relax validation. See the [SDK reference](../reference/SDK.md).
Application code passes that precision explicitly when using `decideChoice`; the
policy helper does not infer it from the answer or its metadata.

## Reliability and configuration

Provider deadlines include dispatch, configured retries, backoff, and bounded body
reading. The bridge deadline additionally covers validation, preparation, provider
waiting, and result processing. Expired synchronous work cannot dispatch a call.
Cancellation bounds waiting for custom promises; custom code must honor signals
to release its own resources. Observations use a separate bounded budget.

Retries cover selected explicit transient responses. Ambiguous failures and failed
observers do not trigger another inference. CLI atomic files protect previous
output but cannot undo remote work or emitted stdout.

JSON configuration is explicit. Custom ESM executes only when selected. Custom
origins do not inherit unrelated ambient credentials. Gateway settings remain
provider configuration, and do not replace the bridge's total deadline.

## Extension boundaries

Use preparation hooks for context, observation hooks for metrics, classified custom providers
for another API, and application code for policy. Ordered images and richer
questions require declared capabilities. Native provider guides document limits.
Cloudflare Omni supports grouped embedded images/audio/video before text. Model
profiles resolve request byte limits per call; transport instances share no
mutable request limit or response identifiers. Header/container inspection is
bounded and does not perform full media decoding.

The SDK does not host models or provide a server API, persistent state, autonomous
actions, streaming, transcription, transcoding, frame extraction,
provider-side asynchronous batch jobs, platform
management, automatic model search, or automatic provider failover. SDK arrays and
CLI JSONL batches provide bounded client-side concurrency.
