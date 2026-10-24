# Architecture

## Bridge and provider responsibilities

Decision Bridge exposes one application contract for structured decisions. The bridge
copies and validates requests, runs extensions in order, applies the total deadline,
validates results, and returns read-only data. Observer callbacks have their own time
limits. A provider owns its API encoding, transport, decoding, model selection,
capabilities, and native operations. Multiple models sharing a protocol can use one
provider implementation.

`createBridge` requires an explicitly selected provider or the Jev shortcut.
`createProvider` requires an explicit native type. `custom/decision` and
`custom/generative` expose classified extension helpers; maintained generative
adapters are loaded only through their opt-in subpath. The CLI resolves its own configuration
and Jev default before constructing the SDK bridge. CLI routing registries
instead construct a router, which selects an explicitly configured target.

```text
Application / CLI
  state, ordered input or conversation + question definitions + optional model
        |
        v
  request snapshot, common validation, capabilities, provider preflight
        |
  ordered prepareState, prepareInput or prepareConversation extensions + revalidation
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

Native Jev, OpenAI and Cloudflare providers also expose `createDecision` directly.
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
| `src/providers/jev-profile.mjs`, `src/providers/jev-preflight.mjs`, `src/providers/jev-images.mjs` | Jev experimental policy, common/native assets, and image preflight |
| `src/providers/decisions-input.mjs`, `src/providers/decisions-codec.mjs` | Decisions item/cache validation and lossless common/native encoding |
| `src/providers/cloudflare-transport.mjs` | Shared decision/extraction REST and binding authentication, dispatch and diagnostics |
| `src/extraction/` | Clairic native field/request/response validation, provider, ordered batches and declarations |
| `src/live/` | Live protocol validation, bounded correlation state, supplied-connection controller and declarations |
| `src/routing/` | Registry snapshots, eligibility, selection, budgets, recovery, diagnostics and routed batches |
| `src/embedded.mjs` | Shared embedded data URL and canonical base64 checks |
| `src/transport.mjs`, `src/response-transport.mjs` | Credential destinations, bounded bodies, safe errors, retries |
| `src/async.mjs` | Deadlines and cancellation races |
| `src/options.mjs` | Unknown-field/accessor rejection for options |
| `src/errors.mjs` | DecisionError and safe public diagnostics |
| `src/batch.mjs` | Ordered bounded-concurrency SDK arrays |
| `src/policy.mjs` | Explicit choice thresholds, without action execution |
| `src/cli/ordered.mjs` | Concurrent JSONL processing with a bounded ordered window |
| `src/cli/routing*.mjs` | Routing configuration, offline inspection, initialization and terminal clarification |
| `src/cli/`, `bin/decision.mjs` | Configuration, input/output, commands, process signals |

## Routing lifecycle

The `/routing` export orchestrates decision or extraction targets without changing
their provider contracts. A registry snapshot defines enabled targets, local
readiness, hard restrictions and optional automatic selection. Preparation runs
once before final eligibility. Direct calls retain provider preflight; automatic
calls select locally when one candidate remains or rules/priority resolve the choice.
An optional decision selector handles unresolved choices or explicitly configured
multiple-candidate selection. SDK clarification callbacks are separate from the
CLI's terminal implementation; SDK imports remain browser-safe.

Work, active clarification and observation have separate budgets. An optional call
deadline also bounds queues and human interaction. Array batches snapshot shared
constraints and prepare/preflight all requests before inference; streaming CLI
batches preflight each row before its own execution. Eligibility is refreshed
before selection and dispatch to account for current cooldown state.

Recovery requires explicit ordered fallback targets. It can skip a selected
target that becomes unavailable before dispatch; after dispatch, it requires a
typed capacity/throttling failure. It reuses the prepared request without repeating
selection or clarification, and enforces a single dispatch per attempted target. Routing
diagnostics preserve selector and attempt usage separately from the final result.
See [configurable routing](../guides/ROUTING.md) for policy and callback contracts.

## Results and precision

Generative providers ask models for probability distributions, then select the
highest-probability choice and calculate weighted scores and rubric legends in code.
Native decision providers validate and retain their returned values, confidence, and
reported usage. Malformed distributions are rejected, and generative results omit
confidence. Result metadata identifies the probability source so applications can
interpret each provider's output appropriately.

The bridge takes result-validation policy from the provider contract. Cloudflare
uses an allowance for four-decimal distributions; other built-ins retain the
baseline. Jev additionally permits explicitly unknown token counts while requiring
native confidence. Response metadata cannot relax validation. See the [SDK reference](../reference/SDK.md).
Application code passes that precision explicitly when using `decideChoice`; the
policy helper does not infer it from the answer or its metadata.

## Reliability and configuration

Built-in validators check structure, representation, adapter capabilities and response
integrity. The services check their own question and media counts, text and context
limits, quotas, and request or token rate limits. Custom quantitative capability limits
remain part of those providers' contracts. Client byte budgets, JSON safeguards,
cancellation and deadlines remain local controls.

Provider deadlines include dispatch, configured retries, backoff, and bounded body
reading. The bridge deadline additionally covers validation, preparation, provider
waiting, and result processing. Expired synchronous work cannot dispatch a call.
Cancellation bounds waiting for custom promises; custom code must honor signals
to release its own resources. Observations use a separate bounded budget.

Retries cover selected explicit transient responses, with machine-code
classification preventing billing/allocation retries. OpenAI Decisions and
Clairic default to zero retries. Valid Retry-After hints share the total deadline;
attempt counts describe adapter dispatches, not hidden Gateway retries.
Malformed rejection bodies retain known safe HTTP diagnostics. Ambiguous failures
and failed observers do not trigger another inference. CLI atomic files protect previous
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
actions, HTTP decision streaming, audio transcription, transcoding, frame extraction,
provider-side asynchronous batch jobs, platform
management, or automatic model discovery. Cross-route recovery is available only
through explicitly configured router failover. SDK arrays and CLI JSONL batches
provide bounded client-side concurrency.

Extraction owns its request/result contract and uses shared Cloudflare dispatch. Its
inference options remain in model input; binding execution options use the third
`ai.run` argument. Native nulls, empty lists, predictive JSON and truncation are
preserved in an immutable `{ extraction, meta }` envelope. Live validates protocol
messages and tracks how results relate to source events within a fixed history limit.
Its controller uses a connection supplied by the application. Offline replay uses the
same state reducer. Their dedicated exports do not widen the existing
decision/generative provider contract. Live configuration changes activate on
acknowledgement. Source snapshots and observed per-direction transcript order support
correlation; unavailable evidence stays unmatched. Manual evaluation and commentary
return submission receipts; completed decisions arrive through subscriptions, preserving
native refusals. The application owns authentication, audio, connection setup and
reconnection.
