# JavaScript SDK reference

Import from `@fayegram-ai/decision-bridge` in your application after package installation.
See [getting started](../guides/GETTING_STARTED.md) for a complete JavaScript call,
TypeScript setup, and CommonJS dynamic import. The source-tree entry point is
`src/index.mjs`. The package exposes ESM. Public
TypeScript declarations are in `src/index.d.mts`; runtime JavaScript is authoritative
and checked independently of those declarations.

## Create a bridge

```javascript
import { createBridge, createProvider } from '@fayegram-ai/decision-bridge';

const provider = createProvider({
  type: 'jev', model: 'jev-latest', timeoutMs: 30000, maxRetries: 2,
});

const bridge = createBridge({
  provider,
  timeoutMs: 60000,
  observerTimeoutMs: 1000,
  extensions: [],
});
```

Select exactly one non-undefined `provider` (a `Provider` with an explicit kind) or `jev`
(native Jev options). The explicit shortcut `createBridge({ jev: {} })` reads
Jev's credentials and model defaults. Missing selection, null selectors, and
simultaneous selections are configuration errors. The exported `BridgeOptions`
type requires selection, and `createBridge` returns a `Bridge`.
Selection uses own configuration properties: inherited `provider`, `jev`, or
factory `type` properties do not select a provider, and their getters are not read.
The bridge's `provider`, `providerKind`, and `defaultModel` properties are read-only.
`providerKind` is `decision` or `generative`, selected from the provider contract.
Unknown options are errors, not ignored settings. Provider credentials are resolved
at construction time; create a new provider after rotating credentials.

### Provider transport options

Native REST providers and maintained custom generative presets accept the public
`TransportOptions` fields below through their constructors or the appropriate
provider factory. Model, credentials, endpoint selection, and generation settings
remain provider-specific; see [configuration](CONFIGURATION.md) and the provider
guides. These are SDK options, not per-evaluation bridge options.

| Option | Default and behavior |
| --- | --- |
| `timeoutMs` | 30,000 ms; positive integer through 2,147,483,647; one transport budget for dispatch, retries, backoff, and response reading |
| `maxRetries` | Additional eligible attempts, 0–10; Jev and generative presets default to 2, native OpenAI and Cloudflare to 0 |
| `maxRequestBytes` | Complete serialized request ceiling; normally 8 MiB, configurable from 1 byte through 64 MiB; Cloudflare applies its [model-specific budgets](../guides/CLOUDFLARE_DECISIONS.md#embedded-images-and-limits) |
| `maxResponseBytes` | 8 MiB; configurable from 1 byte through 64 MiB; applies while reading the response body |
| `fetchImpl` | Optional `(url: string, init?: RequestInit) => Promise<Response>`; defaults to the runtime's `fetch` |

Use `fetchImpl` to wrap or inject a fetch implementation in an application or
local protocol test. The SDK supplies the destination URL, method, headers, body,
abort signal, and `redirect: 'error'`. A wrapper must preserve those settings and
return a standard byte-stream response; it owns the behavior of any replacement
networking. The CLI's JSON configuration cannot contain functions, so this option
is SDK-only. Cloudflare binding transport accepts the timeout, retry, and byte
controls, but rejects `fetchImpl` and REST credential/endpoint options.

The bridge separately defaults to a 60,000 ms evaluation budget and a 1,000 ms
timeout per observer. Call-level `timeoutMs` changes the bridge budget, while
provider constructor `timeoutMs` changes the transport budget. The
[cancellation and deadlines](#cancellation-and-deadlines) section explains how
they interact; [errors](ERRORS.md#retry-policy) lists retryable statuses.

### `bridge.evaluate(request, options?)`

`request` has exactly one of `state` or ordered `input`, `questions`, and optional
`model` and `safetyIdentifier`. New forms require declared provider capabilities;
see [OpenAI Decisions](../guides/OPENAI_DECISIONS.md) and
[Cloudflare Clef](../guides/CLOUDFLARE_DECISIONS.md). The request model
wins over the provider's configured default, which an omitted request model inherits.
OpenAI Decisions uses the `default` selector when its provider configuration omits
`model`; `luna` and explicit `gpt-6-luna` are also supported. Its selectors
resolve to upstream IDs within the provider. No default is assumed for a generative provider.
`options` accepts `signal: AbortSignal` and `timeoutMs`, overriding the bridge's
60-second evaluation budget for this call. It does not mutate the provider's
independent transport timeout, including Workers AI binding calls.

Ordered parts are `{ type: 'text', text }`, `{ type: 'image', dataUrl, detail? }`,
`{ type: 'audio', dataUrl }`, or `{ type: 'video', dataUrl }`. Audio/video are
supported by Cloudflare Clef-omni and explicitly capable custom providers; other
built-ins reject them before dispatch. Cloudflare requires images → audio →
videos → text. Media use embedded data URLs, with format and size checks described
in the [Cloudflare guide](../guides/CLOUDFLARE_DECISIONS.md#omni-audio-and-video).

The bridge snapshots and freezes its input, runs sequential state or input preparation,
invokes the provider once, validates the result, then observes an immutable result.
Built-in transports can retry eligible response statuses within that invocation
when client retries are configured.

### `bridge.getCapabilities(model?)` and `bridge.validate(request)`

Capability lookup is synchronous and reports implemented features and limits.
`validate` applies the default model selection, snapshots/freezes the request, and checks capabilities
and preparation-extension compatibility without inference. Unsupported features
fail with `UNSUPPORTED_CAPABILITY` before dispatch. Native Decisions has no model
listing operation; capability lookup is not account model discovery.
OpenAI validated requests retain the selected value, while preflight checks the
resolved outgoing request, including its model ID, against the byte limit.

Providers can implement optional `validateRequest(resolvedRequest)` for additional
static checks. This synchronous hook receives a frozen request, must return no
value, and rejects by throwing; it must not perform inference or other side
effects. OpenAI Decisions and Cloudflare Clef use it to check native fields and UTF-8 request
bytes against `maxRequestBytes`. The bridge repeats validation after preparation.

### `bridge.listModels(options?)`

Calls the provider's listing operation. Returns `{ models: [{ name, ... }], ... }`.
Pagination markers are preserved; this is not a promise of an exhaustive catalog.
OpenAI Decisions, Cloudflare Clef, and custom providers without listing support
throw `UNSUPPORTED_OPERATION`.

## Request data

`state` is a string, plain JSON object, or array. It may be empty, but not null,
a top-level number, or a top-level boolean. Values nested within objects/arrays can
be any JSON values. JSON snapshots reject `undefined`, cycles, non-finite numbers,
functions, dates, class instances, accessors, symbols, sparse arrays, and extra or
non-enumerable array/object properties. Limits: nesting depth 100, 200,000 nodes.

`questions` is a nonempty object keyed by application-owned identifiers. Every
question requires non-null `instructions`: nonempty text, a JSON object, or an
array. Descriptions can be text or structured JSON. Only choice descriptions permit
raw null. Question IDs and legacy choice-map keys must be nonempty; typed string
choice values may be empty. Request and question unknown fields are rejected.

### Question builders

```javascript
const q1 = choice('Which queue should receive this?', {
  billing: 'Invoices or payment problems.',
  engineering: 'Technical defects.',
  unknown: 'Insufficient evidence.',
});
const q2 = noul('Does the evidence show a failed test?', {
  true: 'At least one executed test failed.',
  false: 'No executed test is shown to have failed.',
});
const q3 = score('How far did processing progress?', [
  'Not started.', 'Started but incomplete.', 'Completed.',
]);
```

Builders return immutable question objects. `choice(instructions, criteria)` accepts
a label map containing 1 to 255 options. `noul(instructions, criteria?)` accepts an
optional criteria object,
with only `true` and `false` keys. `score(instructions, criteria)` accepts **2–10**
ordered levels; numeric level indices are zero-based. There is no boolean alias:
`noul` means a probability, not a thresholded truth value.

`choice(instructions, options)` accepts ordered objects with unique string or
boolean `value` fields and optional text or structured JSON descriptions. Boolean `true` and string
`"true"` remain distinct. `scoreLevels(instructions, levels)` accepts at least two
ordered label/description objects. Provider preflight applies service limits:
OpenAI Decisions and Cloudflare require 2–255 choices; Cloudflare limits scores
to 2–10 levels, while OpenAI labelled scores have no additional client count cap.

## Returned data

```text
EvaluationResult
  model                     Reported model identity, or explicitly marked fallback
  answers.<question-id>     Typed answer, matched to that input question
  usage                     Token counts; unreported generic counts are null
  meta                      Provenance, version, timings, diagnostics
```

**Legacy choice:** `{ type: 'choice', choice, probabilities, confidence? }`.
The probability keys must exactly match the options, all values must be in [0,1],
and the sum must be within 0.001 of 1, except for the provider-selected rounding
allowance described below. The selected option must be maximal within
rounding tolerance. Jev requires reported choice/score confidence; the other
native providers validate and preserve their service-specific confidence.
Generative providers derive the selected option from
the distribution and omit confidence. Generative ties choose the first label in
JavaScript property enumeration order; numeric-looking keys
follow JavaScript's numeric property ordering.
Native selections are retained after validation.

Typed choice questions instead return a typed string/boolean selection and an
array of `{ value, probability }` entries. See the [Decisions guide](../guides/OPENAI_DECISIONS.md).

Cloudflare selects four-decimal probability validation. Distributions aligned to
that precision allow `max(0.001, optionCount * 0.00005)`, plus a small floating-point
allowance. Other Cloudflare distributions and existing providers retain the 0.001
baseline. The bridge selects this policy from the provider contract, never from
response metadata, and preserves all returned numbers.

**Noul:** `{ type: 'noul', noul }`, with a number in [0,1]. The library never
thresholds this into true/false without application code.

**Score:** `{ type: 'score', score, probabilities, legend, confidence? }`.
For N levels, keys are `'0'` through `String(N-1)`. The score is the weighted mean
of these indices; validation tolerance is `0.02 * N` (accommodating 2-decimal rounded probability distributions from live services). `legend` must match the input
rubric exactly. Generative providers calculate score and legend locally. Native
values are validated and preserved, not normalized or replaced.

**Usage:** `input_tokens` and `output_tokens` are nonnegative integers or null.
Jev, OpenAI Decisions, and Cloudflare require reported integer counts. OpenAI and
Anthropic cache creation/read counts are preserved separately when provided;
Cloudflare does not fabricate cache or total-token fields. No total price, inferred cache saving, or
estimated token count is fabricated.

**Metadata:**

| Field | Meaning |
| --- | --- |
| `provider` | Bridge backend name; native Jev reports `typesafe` |
| `providerKind` | `decision` or `generative`; authoritative provider classification, never response-selected |
| `requestedModel` | Selected model after applying the provider default; OpenAI retains `default`, `luna`, or the explicit ID |
| `resolvedModel` | Upstream model ID sent by OpenAI Decisions; optional for other providers |
| `probabilitySource` | `native`, `elicited`, or custom/`unspecified` provenance |
| `confidenceSource` | `native` or `unavailable` for built-in providers |
| `modelSource` | `reported` or `requested` fallback for built-in providers |
| `bridgeVersion`, `schemaVersion` | Package version and result contract version |
| `attempts`, `requestId` | Transport diagnostics when supplied |
| `gatewayLogId` | Cloudflare Gateway response identifier when reported |
| `openaiDecisions`, `cloudflareDecisions` | Provider-specific reported usage and native answer/confidence metadata |
| `durationMs` | Provider transport duration, including retries and body reading |
| `totalDurationMs` | Bridge duration through observation |
| `observerDurationMs` | Observation phase duration; initially zero inside observers |
| `observerFailures` | Names of failed/timed-out observers |

Metadata can have additional JSON fields. Application logic should not assume
unavailable metadata exists. Result objects and nested data returned by the bridge
are immutable. Standalone validation functions return snapshots, not frozen values.

`schemaVersion` remains 1 for legacy requests and 2 for ordered images/text or
richer question forms. Audio/video requests use 3. This result version is separate
from the CLI configuration schema, which remains 1.

## Extensions

An extension has a unique printable `name` (maximum 100 characters), optional
`prepareState(state, context)`, `prepareInput(input, context)`, and
`onResult(result, context)`. Preparation extensions must support the request's
input form; incompatible hooks fail explicitly before dispatch.

Preparation returns replacement state or input, or `undefined` to leave it unchanged.
Preparation exceptions fail before inference with `EXTENSION_ERROR`; transformed
content is revalidated, including capabilities and provider preflight. Preparation
cannot rewrite question definitions or switch the model.
Construct the request directly for those changes.

Observers run after successful inference; their failures are collected in
`meta.observerFailures`. They do not change answers, fail the successful request,
or trigger another billed call. Each observer gets its own timeout, default 1,000
milliseconds. Results shown to observers precede final timing/failure aggregation.

`context` contains `provider`, `model`, frozen `questionIds`, and an `AbortSignal`.
Custom callbacks should honor the signal. The bridge can stop waiting for ignored
signals, but cannot terminate arbitrary user code or its external side effects.
See [customization](../guides/CUSTOMIZATION.md) for runnable examples.

## Cancellation and deadlines

```javascript
const controller = new AbortController();
const resultPromise = bridge.evaluate(request, {
  signal: controller.signal,
  timeoutMs: 15000,
});
// controller.abort() cancels the in-flight request when needed.
```

The transport deadline covers dispatch, attempts, backoff, and body reading for
REST and Workers AI binding calls. A bridge deadline
also covers preparation and the provider. The first applicable deadline wins.
Observer time is additional and bounded separately. Aborting after a successful
inference while observing preserves the successful result and records observer
failure; it does not pretend the billed evaluation failed.

Elapsed time is checked before dispatch and before accepting completion, including
when synchronous work delays timer callbacks. Nested transport calls inherit the
remaining bridge deadline. Synchronous user code cannot be interrupted; an
overrun is detected when control returns, without undoing completed side effects.

## SDK batch evaluation

```javascript
const records = await evaluateBatch(bridge, requests, {
  concurrency: 4,
  stopOnError: false,
  signal: controller.signal,
});
```

This array API validates all raw requests, including provider preflight, before
dispatch. Preparation runs during each evaluation, so errors introduced by hooks
remain per-request failures. Maximum array length is
10,000; concurrency is 1–64. Records retain input order and are either
`{ index, ok: true, result }` or `{ index, ok: false, error }`.
With `stopOnError`, already-started work completes and new work is marked
`BATCH_SKIPPED`. Cancellation marks undispatched records `ABORTED`. There is no
automatic model fallback. The CLI has a separate streaming JSONL implementation.

## Additional exports

- `createProvider(config)`: factory requiring an explicit `type` equal to `jev`,
  `openai-decisions`, or `cloudflare-decisions`.
- `JevProvider`, `OpenAIDecisionsProvider`, `CloudflareDecisionsProvider`: native provider classes.
- `scoreLevels(instructions, levels)` and the array overload of `choice`:
  labelled rubrics and typed string/boolean options, with provider capability checks.
- `OpenAIDecisionsProvider.createDecision(request, options?)`: dedicated native
  access returning `{ decision, meta }`; see the [Decisions guide](../guides/OPENAI_DECISIONS.md).
- `CloudflareDecisionsProvider.createDecision(request, options?)`: dedicated native
  Clef access returning `{ decision, meta }`; see the [Cloudflare guide](../guides/CLOUDFLARE_DECISIONS.md).
- `validateRequest(input, defaultModel?)`: snapshot and validate. Requires
  an own `input.model` property or an explicitly supplied default; inherited
  models are ignored, and it never selects a Jev model.
  Question builders and schema generation validate without selecting an inference model.
- `validateResult(input, questions, { native = false, probabilityDecimalPlaces })`: snapshot supplied
  questions and validate the canonical result; native mode requires confidence
  and reported counts.
- `decideChoice(answer, { minProbability, minMargin = 0, abstainOptions = [], probabilityDecimalPlaces })`:
  returns a policy result, never executes an action. `minProbability` is required.
- `DecisionError`, `publicError(error)`: public structured failure handling.

`decideChoice` returns `status: 'selected' | 'review'`, the model's choice, selected
probability, margin to the runner-up, and a reason. Thresholds are your policy;
no default claims of safety or empirical calibration are implied.
Its optional `probabilityDecimalPlaces` uses the same sum validation as
`validateResult`. Supply the precision from the provider's contract when using
rounded distributions, such as Cloudflare's four-decimal results. Omission keeps
the existing 0.001 tolerance; the helper never infers precision from an answer.

## Custom entry points

The root exports common `Provider`, `ProviderKind`, `DecisionProvider`, request,
result, and transport types. Every provider requires `kind`. Generative classes
and types use the explicit `custom/generative` entry point; the root provider
factory selects native decision providers.

| Entry point | Runtime exports | Types |
| --- | --- | --- |
| `custom/decision` | `defineDecisionProvider` | `DecisionProviderDefinition`; `DecisionProvider` |
| `custom/generative` | `defineGenerativeProvider`, `createGenerativeProvider`, `OpenAICompatibleProvider`, `OpenRouterProvider`, `AnthropicProvider` | `GenerativeProvider`, definition/config, and preset options |
| `custom/generative` | `buildResponseSchema`, `buildPrompt`, `parseGeneratedJson`, `normalizeGenerated` | Typed legacy generative strategy helpers |

Import these as package subpaths under `@fayegram-ai/decision-bridge/`. All SDK
entry points are browser-safe ESM. Definition helpers preserve callback receivers
and validate/freeze wrappers; they do not implement a new protocol. Both kinds
work with the same bridge, extensions, cancellation, and batch API.

Generative results always use elicited probabilities and unavailable confidence.
The bridge rejects native provenance and answer confidence from that path.
Supplied probability/confidence provenance labels must be nonempty strings;
decision providers may preserve custom string labels. Generative prompt and
normalization helpers independently validate the shared-state, legacy-question
profile and explicitly reject unsupported request capabilities.
Decision-kind classification alone does not require confidence or known counts;
`validateResult({ native: true })` is a separate strict validation option used for
Jev's contract. See [custom decision](../guides/CUSTOM_DECISION.md),
[custom generative](../guides/CUSTOM_GENERATIVE.md), and the shared
[custom contract](../guides/CUSTOM_PROVIDERS.md).

## Validation guarantees

Legacy choice criteria maps allow at most 255 options, matching Jev's contract. Noul
criteria must be omitted or an object; its present true/false descriptions cannot
be raw null. Score levels likewise cannot be raw null (nested null JSON values are
still allowed). These invalid forms now fail before provider dispatch.

`decideChoice()` rejects unknown option names and abstention labels not present in
the answer. `evaluateBatch()` validates array holes as invalid requests before any
item is dispatched, rather than spending on adjacent valid entries.

The optional third argument to `validateResult()` must be a plain options object
with optional boolean `native` and integer `probabilityDecimalPlaces` (1–15) fields.
Providers can declare a pure synchronous `getResultValidationOptions(model)` hook;
its policy is validated before inference and is not read from response metadata.
Returning a Promise is a configuration error; its rejection is observed without
calling inference or reading a custom `then` accessor.
Cloudflare selects four-decimal rounding; other built-ins retain the 0.001 sum tolerance.
Unknown keys, accessors, symbol keys, non-enumerable fields, a non-boolean `native`,
or invalid probability precision are rejected as `CONFIGURATION_ERROR`.
An omitted or explicitly undefined `native` value keeps the default `false`.
Extension arrays must be dense; a hole is not an omitted extension.

Standalone `validateResult()` snapshots both the response and supplied questions.
Matching structured score rubrics compare by JSON content, including plain
objects with a null prototype. Invalid question JSON fails with `VALIDATION_ERROR`;
accessors are rejected without invocation. Question and result inputs are neither
mutated nor frozen.

Native provider cancellation/timeout errors preserve the last observed sanitized
request ID and attempt count when available. The bridge may settle its own
cancellation race before the provider returns diagnostics; do not require those
optional fields on every `ABORTED` or `TIMEOUT` error.
