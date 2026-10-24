# Provider contracts and compatibility

## Native decision providers

| Provider type | Wire API | Credential | Default selector | Output strategy |
| --- | --- | --- | --- | --- |
| `jev` | `POST /v1/systemone` at api.typesafe.ai | `TYPESAFE_API_KEY` | `jev-latest` | Native typed decisions |
| `openai-decisions` | `POST /v1/decisions` at api.openai.com | `OPENAI_API_KEY` | `default` | Native Decisions with common and dedicated access |
| `cloudflare-decisions` | Workers AI REST model route or `AI.run` binding | `CLOUDFLARE_API_TOKEN` and account ID for REST | `clef` | Native Clef decisions with common and dedicated access |

`createProvider()` and the root SDK export these three native providers only. Custom
decision services use `defineDecisionProvider` from `custom/decision`. General-purpose
models use the maintained presets in `custom/generative`. Import that entry point when
you want to prompt a model for decisions. See
[custom providers](../guides/CUSTOM_PROVIDERS.md).

## Supported model selection

The [model selector inventory](../../README.md#model-selectors) summarizes the
built-in providers. Jev accepts `jev-latest` and explicit Jev IDs from
its account catalog. OpenAI Decisions accepts `default`, `luna`, and explicit
`gpt-6-luna`. Decision Bridge resolves these to the upstream `gpt-6-luna` model
in this release. The selected value remains in `meta.requestedModel`, the outgoing
ID in `meta.resolvedModel`, and the service-reported identity in the response's `model`.
Cloudflare supports `clef`, `clef-flash`, and `clef-omni`, including each full
`@cf/cloudflare/<model>` alias. Unsupported OpenAI/Cloudflare selectors fail
local preflight with `UNSUPPORTED_CAPABILITY`.

Custom generative presets require an explicit available model and have no default.
Custom decision or generative modules define their own model/capability contract. A
model being supported by the SDK does not mean your account can access it or that the
service is currently available.

Choose a model and endpoint that support the required input and output format,
then test representative requests with your account. The optional
[live checks](../development/TESTING.md) can help verify a configured integration.
See the protocol [sources](SOURCES.md) for the APIs used by each adapter.

## Common request capabilities

All native providers and custom generative presets accept the legacy shared-state and `choice` / `noul` / `score`
contract. The following additional forms are checked before dispatch:

| Provider | Ordered text / embedded images | Typed string/boolean choices | Labelled score levels | Safety identifier | Model listing |
| --- | --- | --- | --- | --- | --- |
| Jev | Ordered text; images with explicit opt-in | Unsupported | Unsupported | Unsupported | Supported |
| OpenAI Decisions | Supported; preserving order | Supported | Supported | Supported | Unsupported |
| Cloudflare Clef / Clef-flash | Supported; images before text | Supported | Supported; ordered levels | Unsupported | Unsupported |
| Cloudflare Clef-omni | Supported; images before audio/video/text | Supported | Supported; ordered levels | Unsupported | Unsupported |
| OpenAI-compatible / OpenRouter / Anthropic | Unsupported | Unsupported | Unsupported | Unsupported | Supported; service-specific catalog |

`bridge.getCapabilities(model)` reports the local profile, and
`bridge.validate(request)` checks that profile and provider preflight without
inference. These methods do not authenticate an account or query availability.
Legacy choice maps and score rubrics have structural requirements, described in the
[SDK reference](SDK.md#question-builders). Custom providers declare additional
capabilities explicitly.

Omni additionally accepts embedded audio clips and videos; service counts remain
upstream. The optional capability fields `audio`, `videos`, `maxAudioClips`, and
`maxVideos` normalize to
false/zero when omitted, preserving legacy custom profiles. Cloudflare's older
models and all other shipped providers reject audio/video before inference.

Jev additionally supports `box` questions on `jev-preview` and pinned 1.14+ models
when `dangerZone.images` is enabled. Other built-ins reject box questions.
See the [Jev guide](../guides/JEV.md) for asset placement and experimental opt-ins.

OpenAI additionally supports `conversation`, `toolHistory`, `remoteImages` and
`promptCaching`. These optional capability flags default to false for existing
custom providers. Built-in quantitative limits use `null` where admission is
left to the service; explicit custom-provider limits remain enforced.

Dedicated `createDecision()` access is available on Jev, OpenAI Decisions and
Cloudflare providers. It uses each service's native request/response shape and
bypasses bridge preparation and observation hooks.

## Native Jev

The SDK sends `model`, shared `state` and `questions` directly to Jev's decision API. It
validates and preserves Jev's `choice`, `noul` and `score` results. `GET /v1/models`
lists native models. A listed catalog can differ from valid aliases; `jev-latest` is the
documented stable alias.

`jev-preview` selects the preview release. Images and longer context require
explicit `dangerZone` settings. Common image input preserves ordering; native
`createDecision()` additionally accepts JSON assets referenced in state,
instructions, and criteria. Box outputs preserve normalized edges and confidence.
See the [Jev guide](../guides/JEV.md) for limits and absence handling.

For consistent model selection, evaluate a version on your workload and pin its ID.
Store the returned `model` along with the
requested model and your question-template revision.

## Native OpenAI Decisions

For the native Decisions endpoint, use `openai-decisions`; its capabilities,
refusal policy, image input, and dedicated API are documented in the
[OpenAI Decisions guide](../guides/OPENAI_DECISIONS.md). Native decision providers
report native probabilities, with provider-specific confidence semantics.

## Native Cloudflare Clef

Use `cloudflare-decisions` for Clef, Clef-flash, and Clef-omni through REST or an injected
Workers AI binding. Common and native access share validation and codecs. See the
[Cloudflare guide](../guides/CLOUDFLARE_DECISIONS.md) for image/audio/video limits, structured
content, typed values, rounding, capacity rejection, Gateway, and CLI examples.

## Native versus elicited probabilities

Jev, OpenAI Decisions and Clef report native outputs and confidence. Generative models
are prompted to produce probability distributions; these estimates are separate from
token logprobs and repeated-sampling frequencies. Accuracy and calibration depend on
the model and task.

Generative providers choose the option with the highest returned probability and
calculate scores as a probability-weighted average. They do not add native confidence
values. Both provider kinds use the same result format; metadata records whether
probabilities are `native` or `elicited`. `meta.providerKind` separately records
`decision` or `generative` from the provider contract. Classification does not force
Jev's confidence/usage requirements on a custom decision service. Evaluate performance
and calibration on representative labeled data before adopting thresholds or comparing
costs/latencies.

## Compatibility boundaries

Remote context limits, JSON Schema limits, model availability, output budgets,
pricing, and rate limits are provider/account specific. The bridge's local caps
do not override them. The SDK has no silent provider failover, model search,
credential refresh or provider-side batch API.
Unsupported protocols require an explicit custom decision or generative provider; unsupported server
features require an explicitly supported mode or a different model.

The [routing API](../guides/ROUTING.md) selects among configured decision or
extraction targets after capability preflight. It supports deterministic rules,
optional decision-model selection, and explicitly configured failover. It does
not discover models or establish account access. Generative targets require
`allowGenerative: true` and cannot act as decision selectors.

## Dedicated operations

Clairic is a native extraction model exposed through [extraction](../guides/EXTRACTION.md).
Its provider is not a DecisionProvider and is not accepted by createBridge.
[Live Decisions](../guides/LIVE_DECISIONS.md) owns a connection-oriented command
and event lifecycle through a dedicated export.
