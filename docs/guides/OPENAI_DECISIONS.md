# OpenAI Decisions

The `openai-decisions` provider implements the native `POST /v1/decisions` API.
Its default model selector is `default`; `luna` selects the supported Luna-family
model, and `gpt-6-luna` selects that explicit upstream ID. Decision Bridge resolves
all three selections to `gpt-6-luna` in this release before calling the service.
This integration follows the official [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
and [API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).
Account access and remote limits still apply. Unknown models fail locally with
`UNSUPPORTED_CAPABILITY`. The opt-in `openai-compatible` preset in `custom/generative` continues
using Chat Completions.

## Model selection

```javascript
import { createProvider } from '@fayegram-ai/decision-bridge';

createProvider({ type: 'openai-decisions' }); // Selects default.
createProvider({ type: 'openai-decisions', model: 'luna' });
createProvider({ type: 'openai-decisions', model: 'gpt-6-luna' });
```

These are alternative configurations. An omitted request `model` inherits the
provider's configured selection; an explicit request `model` overrides it.
With no provider or request model configured, the selection is `default`:

| Selection | Selected value | Current upstream target |
| --- | --- | --- |
| Omitted, with no configured model | `default` | `gpt-6-luna` |
| `default` | `default` | `gpt-6-luna` |
| `luna` | `luna` | `gpt-6-luna` |
| `gpt-6-luna` | `gpt-6-luna` | `gpt-6-luna` |

Mappings are fixed by the installed Decision Bridge release; there is
no runtime model discovery, automatic upgrading, or fallback after failure.
The `default` selector follows the provider default, while `luna` stays within
the Luna family. The resolved upstream model must have a supported capability
profile before a selector can target it.

`provider.defaultModel` and `bridge.defaultModel` expose the configured selection,
using `default` when provider configuration omits `model`. Validated requests and
extension context retain the effective selected value. Successful common
and native calls expose `meta.requestedModel` for that selection and
`meta.resolvedModel` for the upstream ID sent. The common `result.model` and native
`decision.model` preserve the service-reported identity, which may differ from
the outgoing ID. Byte limits apply to the resolved wire request.

## Common bridge access

Set `OPENAI_API_KEY` in the process environment:

```javascript
import { createBridge, createProvider, choice, noul, scoreLevels } from '@fayegram-ai/decision-bridge';

const provider = createProvider({ type: 'openai-decisions' });
const bridge = createBridge({ provider });
const result = await bridge.evaluate({
    state: { complaint: 'I was charged twice.' },
    questions: {
        route: choice('Route the complaint.', { billing: 'Payments.', other: null }),
        duplicate: noul('Does this describe a duplicate charge?'),
        impact: scoreLevels('Rate the impact.', [
            { label: 'Low', description: 'Small inconvenience.' },
            { label: 'High', description: 'A required task is blocked.' },
        ]),
    },
});
console.log(result.answers.route.choice);
```

Existing state/question forms and answer shapes are retained. Strings remain
unchanged; structured state, instructions, and descriptions become JSON text.
Null choice descriptions are omitted. Legacy scores use zero-based native labels
and preserve the original rubric in their common legend.

`noul` without criteria, or with empty criteria, uses a native predicate. With
true/false descriptions, it uses a native boolean choice carrying both options
and the supplied descriptions; `noul` is the probability for boolean `true`.
That native choice's confidence is retained in provider metadata.

## Ordered text and images

Provide exactly one of `state` or `input`. An existing JSON array supplied as
`state` retains its original meaning. New `input` is a nonempty ordered array:

```javascript
const result = await bridge.evaluate({
    input: [
        { type: 'text', text: 'Assess this product photo.' },
        { type: 'image', dataUrl: imageDataUrl, detail: 'high' },
        { type: 'text', text: 'Consider only visible damage.' },
    ],
    safetyIdentifier: 'opaque-application-user-id',
    questions: { damaged: noul('Is visible damage present?') },
});
```

Images must be nonempty inline base64 data URLs, such as
`data:image/png;base64,...`. The bridge does not fetch image URLs or read files.
Convert image bytes in your application. OpenAI permits at most 128 images.
Detail accepts `low`, `high`, `auto`, `original`, or null; omission uses the service
default. Text/image ordering is preserved.

The default transport request/response limits are 8 MiB each, including encoded
images. Set `maxRequestBytes` explicitly for larger requests, up to the existing
64 MiB ceiling. These local limits do not override service limits.

`safetyIdentifier` is an optional per-request opaque string of at most 128
Unicode characters, or null. It maps to `safety_identifier`; avoid private identity
data. Character limits count Unicode code points rather than UTF-16 code units.

## Typed choices and labelled scores

The array overload of `choice` accepts `{ value: string | boolean, description? }`:

```javascript
const question = choice('Choose the matching outcome.', [
    { value: true, description: 'The condition is satisfied.' },
    { value: false, description: 'The condition is not satisfied.' },
    { value: 'unknown', description: 'Insufficient evidence.' },
]);
```

This question stores `options` instead of `criteria`. Its answer preserves the
typed `choice` and uses `probabilities: [{ value, probability }, ...]`. Boolean
`true` and string `"true"` are distinct; values must be unique. Numeric choices and
coercion to object keys are not supported. TypeScript preserves literal unions.
`decideChoice` supports these answers and typed abstention values.

`scoreLevels` stores ordered `levels` instead of `criteria` and requires at least
two `{ label, description? }` objects. Its answer retains the numeric score and
index-keyed probability map, with the original level objects in the legend.
OpenAI choice questions require 2–255 unique options in both common forms and
native requests. Labelled scores do not inherit Jev's 10-level limit; legacy
score criteria retain the 2–10-level limit. JSON snapshots and transport caps
apply to all requests.

## Capabilities and preparation

`bridge.getCapabilities(model?)` synchronously reports support and limits for
ordered input, images, typed choices, labelled scores, and safety identifiers.
`bridge.validate(request)` resolves the model, snapshots/freezes the request,
and checks capabilities without inference. Unsupported combinations fail before
dispatch with `UNSUPPORTED_CAPABILITY`.

Preflight also checks the encoded native field limits and the complete UTF-8 wire
body against `maxRequestBytes`. SDK array batches check every raw request before
dispatching any entry. Prepared input is revalidated during each evaluation.

Jev, OpenAI-compatible, OpenRouter, and Anthropic currently support the legacy
common forms. Existing custom providers default to that profile; implement
`getCapabilities(model)` and corresponding behavior to support new forms.

Use `prepareInput(parts, context)` for ordered input and `prepareState` for state.
A preparation extension must implement the hook for the form being used;
incompatible extensions fail explicitly rather than being skipped. Extensions
can implement both hooks. `onResult` works with either form and runs only after
success, with the existing isolated-failure policy.

Legacy common requests retain `meta.schemaVersion: 1`. New input/question forms
or safety identifiers use version 2.

## Dedicated native access

```javascript
const { decision, meta } = await provider.createDecision({
    input: 'The customer reports a broken screen.',
    questions: [
        { type: 'predicate', name: 'damaged', instructions: 'Is damage reported?' },
        { type: 'choice', instructions: 'Choose a route.', choices: [
            { value: 'repair' }, { value: 'review' },
        ] },
        { type: 'score', name: 'impact', instructions: 'Rate the impact.', levels: [
            { label: 'Low' }, { label: 'High' },
        ] },
    ],
    safety_identifier: 'opaque-application-user-id',
}, { signal: controller.signal });
```

An omitted model inherits the provider's configured selection. Native input accepts text or
multiple user messages containing text or ordered `input_text`/`input_image`
parts. Only user roles are supported. Files, external image URLs, audio, tools,
and item references are rejected locally. Exported `NativeDecisionRequest` and
related types describe this format.

`decision` preserves native answer arrays, optional question names, probabilities,
confidence, and full usage. `meta` has the exported `OpenAIDecisionsTransportMetadata`
shape: requested/resolved model identities, transport duration, attempt count,
and request ID when available. Results are immutable. This method bypasses
common bridge extensions.

## Refusals, results, and execution

Both paths fail the complete call with `MODEL_REFUSAL` if any question is refused.
They return no fabricated answer or partial success. The error retains validated
`usage`, `refusedQuestions: [{ index, name }]`, and available HTTP diagnostics;
it does not retain sibling answers or raw upstream bodies. JSONL batches mark
that request `ok: false`; independent rows can succeed.

Common confidence is preserved within its existing [0, 1] invariant. Native
access validates finite confidence without imposing that common range or an
undocumented argmax rule. Common validation rejects inconsistent responses
rather than repairing them. Provider confidence semantics are not assumed to
be equivalent or equally calibrated.

Common usage maps reported input/output and cache counts.
`meta.openaiDecisions.usage` preserves full native usage, including total and
reasoning tokens. `meta.openaiDecisions.answers` retains native answer types and
reported confidence. Predicate confidence and token counts are never invented.

Decisions defaults to **zero HTTP retries**. Explicit `maxRetries` opts into the
existing bounded policy and may repeat a billed request. There is no model
fallback, streaming, generation-parameter passthrough, or model listing.
`bridge.listModels()` fails with `UNSUPPORTED_OPERATION`.

Ambient `OPENAI_API_KEY` is used only for the default `https://api.openai.com`
origin. Custom origins require an explicit key; the CLI requires `apiKeyEnv`.
Supply an origin without a `/v1` base path. Authentication cannot be disabled.
Existing transport deadlines, cancellation, byte limits, and redaction apply.

## Command runner

```bash
decision-bridge evaluate request.json --provider openai-decisions --env-file .env
decision-bridge validate request.json --provider openai-decisions
decision-bridge init ./native-decisions --provider openai-decisions --native
decision-bridge validate ./native-decisions/request.json --provider openai-decisions --native
decision-bridge evaluate ./native-decisions/request.json --provider openai-decisions --native --env-file .env
decision-bridge batch native-requests.jsonl --provider openai-decisions --native --env-file .env
```

`--native` applies only to `init`, `evaluate`, `validate`, and `batch` with this
provider. Native evaluation/validation/batch require an explicit file or `-`.
Mode is never inferred from JSON. Initialization writes a native request, which
must still be evaluated with `--native`. Offline validation checks built-in
capabilities without credentials; custom capabilities are checked at evaluation.
OpenAI initialization stores the model selection in configuration and omits it
from the generated request so later configuration changes apply. The default
configuration uses `default`. Offline validation reports the selected value as
`model` and the outgoing upstream ID as `resolvedModel`.
Decisions offline validation also checks native field limits and the configured
request byte limit in both modes.

The `schema` command remains a generative utility and rejects the new request
forms. Generation settings (`maxTokens`, `responseFormat`, `parameters`, etc.)
are rejected for Decisions. See the [CLI reference](../reference/CLI.md).

From a source checkout, the optional `npm run smoke:live -- --decisions --env-file .env`
checks four bounded requests when `RUN_LIVE_TESTS=1` is explicitly set. It checks
protocol behavior rather than prediction quality, disables retries, and prints
only model identities and token usage. Normal verification never runs it.
