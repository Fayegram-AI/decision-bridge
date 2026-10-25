# OpenAI Decisions

Conversation/tool history, remote images and prompt caching require **0.1.3 or
later**. See [version availability](../README.md#version-availability).

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

`provider.defaultModel` and `bridge.defaultModel` expose the configured selection, using
`default` when provider configuration omits `model`. Validated requests and extension
context retain the effective selected value. Successful common and native calls expose
`meta.requestedModel` for that selection and `meta.resolvedModel` for the upstream ID
sent. The common `result.model` and native `decision.model` preserve the
service-reported identity, which may differ from the outgoing ID. Byte limits apply to
the encoded request sent to the service.

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

The shared bridge API keeps its usual request and answer formats. Strings pass through
unchanged; structured state, instructions and descriptions are sent as JSON text. Null
choice descriptions are omitted. Legacy scores use zero-based native labels and preserve
the original rubric in their common legend.

`noul` without criteria, or with empty criteria, uses a native predicate. With
true/false descriptions, it uses a native boolean choice carrying both options
and the supplied descriptions; `noul` is the probability for boolean `true`.
That native choice's confidence is retained in provider metadata.

## Ordered text and images

Choose exactly one of `state`, ordered `input` or `conversation`. An existing
JSON array supplied as `state` retains its original meaning. Ordered `input` is
a nonempty array:

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

For an image, supply either a base64 data URL or an HTTP(S) `url`, not both. Native
requests use `image_url` for either form. The bridge forwards image URLs without
fetching them and does not read image files. The service checks image-count limits.
Detail accepts `low`, `high`, `auto`, `original`, or null; omission uses the service
default. Text/image ordering is preserved.

The default transport request/response limits are 8 MiB each, including encoded
images. Set `maxRequestBytes` explicitly for larger requests, up to the existing
64 MiB ceiling. These local limits do not override service limits.

`safetyIdentifier` is an optional per-request opaque string or null. It maps
to `safety_identifier`; length admission remains upstream.

## JSON and question content

Add `{ type: 'json', data }` to common ordered input to mix structured evidence
with text and images. `data` accepts a JSON object or an array of objects;
nested values can contain any JSON value. Existing structured `state`,
`instructions` and descriptions retain their JSON-text encoding.

Use `instructionParts` for question-specific content, exclusively of
`instructions`. Parts use the common `text`, `image` and `json` forms. For example:

```javascript
import { noulWithParts } from '@fayegram-ai/decision-bridge';

const request = {
    input: [{ type: 'json', data: { amount: 42, currency: 'USD' } }],
    questions: {
        allowed: noulWithParts([
            { type: 'text', text: 'Is the amount within the supplied limit?' },
            { type: 'json', data: { limit: 50, currency: 'USD' } },
        ]),
    },
};
```

`choiceWithParts`, `noulWithParts`, `scoreWithParts` and `scoreLevelsWithParts`
take parts as their first argument and the same criteria/options as the
corresponding existing builder. They return immutable questions. Content parts
preserve their order and use the existing answer formats. Box questions do not
accept this form. The [JSON example](../../examples/decisions-content.json) also
works with offline CLI `validate --provider openai-decisions`.

For images, use `{ type: 'image', url }` or `{ type: 'image', dataUrl }`, with
optional `detail`. The SDK forwards references without downloading images.
Question images and shared-input images use one combined provider image budget.
Question parts accept neither cache breakpoints nor audio/video.

Native requests use `{ type: 'input_json', data }` in user-message content.
Native predicate, choice and score `instructions` accept a string or a nonempty
array of `input_text`, `input_image` and `input_json`, without a message wrapper.
Developer/system messages remain text-only; tool outputs support text/images.
JSON parts do not accept cache breakpoints. Keys such as `role` and `image_url`
inside `data` remain ordinary JSON data.

The [API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
specifies JSON limits of 32 container levels, 10,000 values and 256 KiB of compact
UTF-8 JSON. Service admission remains upstream; local JSON safety and complete
request-byte budgets still apply. These limits do not change legacy state or
instruction validation.

Keep reusable reference material in shared `input`: question content is outside
the cacheable prefix. JSON input does not change answers or usage reporting.
The capabilities are `jsonInput` and `questionContent`; both default to false
for custom providers. Requests using these explicit forms select common schema
version 6. Existing instruction arrays are never interpreted as content parts.

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
Choices require at least two distinct options for OpenAI. Service count ceilings
are not enforced locally. Both labelled and legacy scores retain ordered levels;
JSON safety and configured client wire budgets apply to all forms.

## Capabilities and preparation

`bridge.getCapabilities(model?)` synchronously reports support and limits for ordered
input, images, typed choices, labelled scores, and safety identifiers. It also reports
conversation/tool history, remote images and prompt caching. `bridge.validate(request)`
resolves the model, makes a read-only request copy, and checks supported features
without calling the service. Unsupported combinations fail with `UNSUPPORTED_CAPABILITY`
before a request is sent.

Preflight also checks the encoded native structure and the complete UTF-8 wire
body against `maxRequestBytes`. SDK array batches check every raw request before
dispatching any entry. Prepared input is revalidated during each evaluation.

Jev supports shared state and ordered text, with experimental images and boxes;
the maintained generative presets use legacy shared-state forms. Existing custom
providers default to the legacy profile; implement
`getCapabilities(model)` and corresponding behavior to support new forms.

Use `prepareInput(parts, context)` for ordered input, `prepareState` for state,
and `prepareConversation(items, context)` for conversation history.
A preparation extension must implement the hook for the form being used;
incompatible extensions fail explicitly rather than being skipped. Extensions
can implement all three preparation hooks. `onResult` works with every form and runs only after
success, with the existing isolated-failure policy.

Legacy common requests retain `meta.schemaVersion: 1`. New input/question forms
or safety identifiers use version 2. Conversation, remote image URLs or cache
controls select version 5; see [conversation and prompt caching](#conversation-and-prompt-caching).

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

An omitted model inherits the provider's configured selection. Native input accepts
text, role-aware messages, assistant output/refusal content and function/custom-tool
calls and outputs. Images may be embedded or remote HTTP(S) references. File IDs,
audio and item references remain unsupported. Exported native types describe the
Decisions-specific representation; tool payload strings remain verbatim.

`decision` preserves native answer arrays, optional question names, probabilities,
confidence, and full usage. `meta` has the exported `OpenAIDecisionsTransportMetadata`
shape: requested/resolved model identities, transport duration, attempt count,
and request ID when available. Results are immutable. This method bypasses
common bridge extensions.

## Refusals, results, and execution

Both paths fail the complete call with `MODEL_REFUSAL` if any question is refused.
The error retains validated `usage`, `refusedQuestions: [{ index, name }]`, and
available HTTP diagnostics. It does not retain sibling answers or raw upstream bodies. JSONL batches mark
that request `ok: false`; independent rows can succeed.

Common confidence is preserved within its existing [0, 1] invariant. Native
access validates finite confidence without imposing that common range or an
undocumented argmax rule. Common validation rejects inconsistent responses
rather than repairing them. Provider confidence semantics are not assumed to
be equivalent or equally calibrated.

Common usage maps reported input/output and cache counts.
`meta.openaiDecisions.usage` preserves full native usage, including total and
reasoning tokens. `meta.openaiDecisions.answers` retains native answer types and
reported confidence.

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
Decisions offline validation also checks native structure and the configured
request byte limit in both modes.

The `schema` command remains a generative utility and rejects the new request
forms. Generation settings (`maxTokens`, `responseFormat`, `parameters`, etc.)
are rejected for Decisions. See the [CLI reference](../reference/CLI.md).

From a source checkout, the optional `npm run smoke:live -- --decisions --env-file .env`
checks four bounded requests when `RUN_LIVE_TESTS=1` is explicitly set. It checks
protocol behavior rather than prediction quality, disables retries, and prints
only model identities and token usage. Normal verification never runs it.

## Conversation and prompt caching

Common requests select exactly one of `state`, ordered `input` or `conversation`.
Conversation items use `NativeDecisionInputItem`: user/developer/system messages,
assistant messages with optional commentary/final_answer phase, function calls,
custom tool calls and their outputs. Tool outputs reference preceding call IDs.
System/developer content is text; assistant parts are output text or refusal.

`promptCacheKey` and `promptCacheOptions` map to native `prompt_cache_key` and
`prompt_cache_options`. Options support implicit/explicit mode and Decisions'
30m TTL. Eligible common text/image parts accept `promptCacheBreakpoint` with
explicit mode or null; native content uses `prompt_cache_breakpoint`. The adapter
preserves breakpoints, omission and explicit nulls without selecting cache writes.

Use `prepareConversation(items, context)` to transform conversation input.
Transformations are snapshotted, frozen and revalidated before dispatch. Capability
flags are `conversation`, `toolHistory`, `remoteImages` and `promptCaching`;
existing custom providers default to false. These forms use common schema version
5 unless explicit JSON or question content selects version 6; earlier forms
retain versions 1–4.

See [Live Decisions](LIVE_DECISIONS.md) for the separate connection lifecycle.
