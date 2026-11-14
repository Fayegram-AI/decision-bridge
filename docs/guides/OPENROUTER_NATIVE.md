# OpenRouter native Decisions and Extractions

Use `openrouter-decisions` for OpenRouter's native Decisions API and
`openrouter-extraction` for Extractions. Both require an explicit model ID and
read `OPENROUTER_API_KEY` for the official endpoint. The SDK accepts native model
IDs without an account catalog allowlist. The service determines model access.
Leading and trailing whitespace does not change model selection.
The separate `custom/generative` preset `openrouter` uses chat completions and
elicited probabilities.

Set `model` on the provider or each request. A request can omit it to use the
provider's configured model; an explicit value must be a nonempty string.
Native `session_id` and `user` identifiers accept up to 256 Unicode code points.

## Decisions

```javascript
import { createBridge, createProvider, noul } from '@fayegram-ai/decision-bridge';

const provider = createProvider({
    type: 'openrouter-decisions',
    model: 'cloudflare/clef',
    providerPreferences: { allow_fallbacks: false },
});
const result = await createBridge({ provider }).evaluate({
    state: 'The build completed with zero failures.',
    questions: { passed: noul('Did the build pass?') },
});
console.log(result.answers.passed.noul, result.meta.upstreamProvider);
```

The default endpoint is `POST https://openrouter.ai/api/alpha/decisions`.
Setting `api: 'systemone'` explicitly selects `/api/v1/systemone`. The SDK does
not switch endpoints after an error. A custom `baseURL` must be an origin and
requires an explicit key. Requests default to 8 MiB, responses to 8 MiB, and
retries to zero; each byte budget can be raised through 64 MiB.

`provider.createDecision(request)` accepts native `model`, `state`, `questions`,
`assets`, `provider`, `session_id`, `user`, and `trace`. It returns
`{ decision, meta }`, preserving optional native probabilities, confidence,
score legends, cost, response ID and upstream provider identity. Native score
rubrics can contain one level. Common `evaluate()` keeps the common rubric and
distribution requirements: a choice/score response without probabilities raises
`UNSUPPORTED_CAPABILITY`. No probabilities or confidence are fabricated.
Common metadata keeps additional native usage under `meta.openRouter.usage`.
Optional Noul confidence is retained under `meta.openRouter.answers[id].confidence`;
the common Noul answer contains its probability.

`provider.listModels()` queries `/api/v1/models?endpoints=/api/alpha/decisions`.
With `api: 'systemone'`, it filters by `/api/v1/systemone` instead. Extraction-only
models are excluded. Model entries retain upstream metadata, including endpoint
and architecture information.
Discovery lists advertised IDs; it does not establish your account's inference
access. Native requests can use other IDs accepted by the service.

## Common media and capability profiles

All native model IDs accept the basic shared-state contract and ordered text.
Richer common capabilities are enabled for these model profiles:

| Model ID | Images | Boxes | Typed choices / labelled scores | Audio / video |
| --- | --- | --- | --- | --- |
| `typesafe/jev-1.13` | PNG/JPEG | No | No | No |
| `typesafe/jev-1.14`, `~typesafe/jev-latest` | PNG/JPEG | Yes | No | No |
| `cloudflare/clef`, `cloudflare/clef-flash` | PNG/JPEG/WebP | No | Yes | No |
| `cloudflare/clef-omni` | PNG/JPEG/WebP | No | Yes | Yes |
| `openai/gpt-6-luna-decisions` | PNG/JPEG/WebP | No | Yes | No |
| `google/gemini-decision-1` | Any inline `image/*`, HTTPS images | No | No | Inline audio; inline/HTTPS video |
| `scaledown/classify-1` | PNG/JPEG/TIFF | No | No | No |
| `heygen/heygen-decision-1`, `heygen/heygen-decision-1-turbo` | PNG/JPEG/WebP | No | No | No |
| `baseten/joey-1`, `baseten/mammoth-1`, `baseten/elephant-1` | PNG/JPEG/WebP | No | No | No |
| `liquid/d1`, `liquid/d1.1`, `liquid/d1-ultra`, `~liquid/d1-latest`, `~liquid/d1-ultra-latest` | PNG/JPEG/WebP | No | No | No |
| `morph/reflex` | PNG/JPEG/WebP | No | No | No |
| `perplexity/pplx-decider-v1.2`, `perplexity/pplx-decider-flash-v1.2`, `perplexity/pplx-decider-v1.3:free`, `perplexity/pplx-decider-flash-v1.3:free`, `~perplexity/pplx-decider-latest`, `~perplexity/pplx-decider-flash-latest` | PNG/JPEG/WebP | No | No | No |

Ordered input retains its order. Native text items are strings, images use
`image_url` parts with embedded data URLs, audio uses `input_audio` with raw
base64 and a format, and video uses `video_url` with an embedded data URL.
Google's profile also accepts HTTPS images and video. Remote audio and
Responses-style `input_image` parts are unsupported. Image `detail` accepts
`auto`, `low` or `high`; common `resolution` controls are unsupported through
OpenRouter. Native media parts on known profiles are validated before dispatch.
Only Jev images can be nested in state, instructions or criteria; other media
belong in the top-level state array. A native `file` may also be the whole state.

Common documents use `{ type: 'document', dataUrl }` or
`{ type: 'document', url }`, encoded as native `file` parts. Google accepts PDF,
CSV, Word (`.doc`, `.docx`), Excel (`.xls`, `.xlsx`), PowerPoint (`.ppt`, `.pptx`)
and OpenDocument (`.odt`, `.ods`, `.odp`) MIME types. HTTPS document URLs require
one of these filename extensions in their path; signed query strings are
preserved. ScaleDown accepts inline PDF, PNG, JPEG and TIFF files. Its image
parts count toward its single-document service limit. The SDK forwards media
references without fetching them. `documentMimeTypes` reports accepted inline
document MIME types. Document input uses common result schema version 7.
See the [CSV example](../../examples/openrouter-media.mjs) for a complete common
document request through Google's OpenRouter profile.

Native image assets use `{ type: 'image', format: 'png' | 'jpg' | 'jpeg',
data_base64 }`. Jev references can appear inside state, instructions or criteria,
including substrings. Other model references must be whole items in the top-level
state array. Every asset must be referenced. The SDK checks placement, formats,
base64 and bounded image structure; the service applies its own media quotas.

## Extractions

```javascript
import { createExtractionProvider } from '@fayegram-ai/decision-bridge/extraction';

const provider = createExtractionProvider({
    type: 'openrouter-extraction',
    model: process.env.EXTRACTION_MODEL, // An extraction model available to your account.
});
const result = await provider.extract({
    state: 'Invoice total: 42 USD',
    fields: { total: { type: 'number', unit: 'USD' } },
});
console.log(result.extraction.answers.total.value);
```

The endpoint is `POST /api/alpha/extractions`. `extract()` accepts common
`state`, `fields`, `images`, `reference_date`, and optional `model`. Common
PNG/JPEG/WebP images become native assets. Image-only requests omit native
`state`; requests with text append generated references. Cloudflare-specific request
`options` are rejected; use explicit `providerPreferences.options` where the
selected upstream provider documents them.

`validate(request)` checks the common request and encoded size without inference.
It returns an immutable common request with a resolved model, retaining `images`
for reuse with `extract()`, `extractBatch()` and `validateResult()`.

`createExtraction()` accepts the native shape with optional `state`, `fields`,
`assets`, `reference_date` and OpenRouter request metadata. Assets can be PNG,
JPEG or WebP images, or `{ type: 'document', format: 'pdf', data_base64 }` PDFs,
subject to the model's formats. Omit `state` or set it to an empty string for
asset-only input; references are then unnecessary. With nonempty text, every
asset must be referenced in state or field instructions.

Clairic accepts PNG/JPEG/WebP images, and rejects a bare asset key as state or
field instructions when there are multiple images. ScaleDown accepts one PDF,
PNG or JPEG asset and reads either text or that asset; omit state or use the
sole asset key for file-only input. Mercury Decide, Schematron, Sage and
Perplexity extraction profiles accept text only.

The nine field types are text, number, date, datetime, time,
duration, list, estimate and forecast. Forecast fields require a `horizon` from
1 through 64 and an `interval`; `decimals` accepts 0 through 6 where supported.
Known models enforce their field contracts:

| Model | Fields and options |
| --- | --- |
| `cloudflare/clairic` | All nine types; optional unit labels, including text/date/time and lists; numeric lists accept `integer` and `decimals`. No `null_threshold` on list/estimate/forecast; other thresholds must be above zero. |
| `inception/mercury-decide` | Text and text lists; no unit labels or `reference_date`. |
| `inference-net/schematron-v2-small`, `inference-net/schematron-v2-turbo` | Text, number, date, time, datetime and lists; no unit labels, `null_threshold` or `reference_date`. |
| `levanto/sage-2` | Text, number, date, time, datetime, duration and lists; no text/list/number unit labels, list `null_threshold` or `reference_date`. Duration units are supported. |
| `perplexity/pplx-decider-v1.3`, `perplexity/pplx-decider-flash-v1.3` (including `:free`) | Text and text lists; no unit labels, `null_threshold` or `reference_date`. |
| `scaledown/extract` | Text and text lists; no unit labels, `null_threshold` or `reference_date`. |

Other model IDs use the general field grammar, including thresholds from zero
through one; the service determines their support and availability.
Forecast values are arrays of
numbers or strings, or null; their predictive arrays and step values are validated.

Results preserve omitted `truncated`, nullable `state_text` and null entries in
optional `spans` arrays. The API does not
insert Cloudflare defaults into native responses. `validateResult(result, commonRequest)`
checks a saved envelope against the configured provider, model and common request's
field contract without inference. `extractBatch()` supports both built-in extraction providers.
For extraction model discovery, query OpenRouter's Models API directly with
`endpoints=/api/alpha/extractions`; the SDK has no extraction listing method.

## CLI and routing

```bash
decision-bridge init ./decisions --provider openrouter-decisions --model cloudflare/clef
decision-bridge extraction init ./extract --provider openrouter-extraction --model VENDOR/MODEL
decision-bridge evaluate request.json --config decisions/decision.config.json
decision-bridge extraction run native.json --native --config extract/decision.config.json
```

Both profiles support offline validation, common/native initialization, evaluation
and JSONL batching. Set `providerPreferences` in configuration JSON for either
profile. Only `openrouter-decisions` accepts `api` to select its endpoint.
`--native` selects the native request/response shape.

Routing registries accept both native provider types. Upstream
`providerPreferences.allow_fallbacks` defaults to `false`. If local router
failover is enabled, it must remain false and transport retries must remain zero,
so the local attempt budget owns recovery. Explicit upstream fallback is available
on routes without local failover. Native envelopes use the dedicated methods;
common routers return their established decision or extraction envelopes.

See the official [OpenAPI schema](https://openrouter.ai/openapi.json) and
[multimodal Decisions guide](https://openrouter.ai/docs/guides/community/multimodal-decisions).
