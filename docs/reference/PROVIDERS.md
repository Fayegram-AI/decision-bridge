# Provider contracts and compatibility

## Native routes

| Provider type | Wire API | Credential | Default model | Output strategy |
| --- | --- | --- | --- | --- |
| `jev` | `POST /v1/systemone` at api.typesafe.ai | `TYPESAFE_API_KEY` | `jev-latest` | Native typed decisions |
| `openai-decisions` | `POST /v1/decisions` at api.openai.com | `OPENAI_API_KEY` | `gpt-6-luna` | Native Decisions with common and dedicated access |
| `cloudflare-decisions` | Workers AI REST model route or `AI.run` binding | `CLOUDFLARE_API_TOKEN` and account ID for REST | `clef` | Native Clef decisions with common and dedicated access |

`createProvider()` and the root SDK export these three native providers only.
Custom decision services use `defineDecisionProvider` from `custom/decision`.
General-purpose adapters are opt-in presets in `custom/generative`; they are
maintained, but are not native decision models. See [custom providers](../guides/CUSTOM_PROVIDERS.md).

## Supported model selection

See the root README's [model list](../../README.md#supported-models) for the
built-in selectors and aliases. Jev accepts `jev-latest` and explicit Jev IDs from
its account catalog. OpenAI Decisions supports only `gpt-6-luna` in this release.
Cloudflare supports `clef`, `clef-flash`, and `clef-omni`, including each full
`@cf/cloudflare/<model>` alias. Unsupported OpenAI/Cloudflare selectors fail
local preflight with `UNSUPPORTED_CAPABILITY`.

Custom generative presets require an explicit available model and have no default.
Custom decision or generative modules define their own model/capability contract.
Local model support is separate from account permission and hosted availability.

The interface is model-neutral, not a guarantee that every model or endpoint
supports every strategy. A compatible URL alone is insufficient: the chosen model
must follow the decision instruction, fit the input/schema, and return valid data.
Provider behavior is covered by local protocol tests and checked against official
specifications. These checks do not establish compatibility with every account or
model. Run the optional [live checks](../development/TESTING.md) for the provider,
account, model, and transport you intend to use; see the protocol [sources](SOURCES.md).

## Common request capabilities

All native providers and custom generative presets accept the legacy shared-state and `choice` / `noul` / `score`
contract. The following additional forms are checked before dispatch:

| Provider | Ordered text / embedded images | Typed string/boolean choices | Labelled score levels | Safety identifier | Model listing |
| --- | --- | --- | --- | --- | --- |
| Jev | Unsupported | Unsupported | Unsupported | Unsupported | Supported |
| OpenAI Decisions | Supported; up to 128 images, preserving order | Supported | Supported | Supported | Unsupported |
| Cloudflare Clef / Clef-flash | Supported; up to four images before text | Supported | Supported; 2–10 levels | Unsupported | Unsupported |
| Cloudflare Clef-omni | Supported; up to four images before audio/video/text | Supported | Supported; 2–10 levels | Unsupported | Unsupported |
| OpenAI-compatible / OpenRouter / Anthropic | Unsupported | Unsupported | Unsupported | Unsupported | Supported; service-specific catalog |

`bridge.getCapabilities(model)` reports the local profile, and
`bridge.validate(request)` checks that profile and provider preflight without
inference. These methods do not authenticate an account or query availability.
Legacy choice maps and score rubrics have their own limits, described in the
[SDK reference](SDK.md#question-builders). Custom providers declare additional
capabilities explicitly.

Omni additionally accepts up to four audio clips and two videos. The optional
capability fields `audio`, `videos`, `maxAudioClips`, and `maxVideos` normalize to
false/zero when omitted, preserving legacy custom profiles. Cloudflare's older
models and all other shipped providers reject audio/video before inference.

Dedicated `createDecision()` access is available on OpenAI Decisions and
Cloudflare providers. It uses each service's native request/response shape and
bypasses bridge preparation and observation hooks.

## Native Jev

The request directly contains `model`, shared `state`, and `questions`. Jev's
`choice`, `noul`, and `score` results are preserved and strictly validated. No
intermediate language model, skill, portal prompt, or chat conversion is used.
`GET /v1/models` lists native models. A listed catalog can differ from valid aliases;
`jev-latest` is the documented stable alias.

Pin a version after evaluating it for your workload rather than assuming a moving
alias yields reproducible quality. Store the returned `model` along with the
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

Jev, OpenAI Decisions, and Clef report native outputs and confidence. Generative models are prompted
to produce probability distributions. Those estimates are not logprobs, repeated
sampling frequencies, calibrated confidence, or proof of correctness.

Generative providers derive an argmax choice and a probability-weighted score from the
elicited distributions. They do not synthesize native confidence statistics. Both
paths use the same application contract, but metadata records their provenance:
`native` versus `elicited`. `meta.providerKind` separately records `decision` or
`generative` from the provider contract. Classification does not force Jev's
confidence/usage requirements on a custom decision service. Evaluate performance and calibration on representative
labeled data before adopting thresholds or comparing costs/latencies.

## Compatibility boundaries

Remote context limits, JSON Schema limits, model availability, output budgets,
pricing, and rate limits are provider/account specific. The bridge's local caps
do not override them. This release has no silent provider failover, model search,
credential refresh, provider-side batch API, or universal quality guarantee.
Unsupported protocols require an explicit custom decision or generative provider; unsupported server
features require an explicitly supported mode or a different model.
