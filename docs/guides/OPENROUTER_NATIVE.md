# OpenRouter native Decisions and Extractions

Use `openrouter-decisions` for OpenRouter's native Decisions API and
`openrouter-extraction` for Extractions. Both require an explicit model ID and
read `OPENROUTER_API_KEY` for the official endpoint. The SDK accepts native model
IDs without an account catalog allowlist. The service determines model access.
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

`provider.listModels()` queries `/api/v1/models?output_modalities=decisions`.
Discovery lists advertised IDs; it does not establish your account's inference
access. Native requests can use other IDs accepted by the service.

## Common media and capability profiles

All native model IDs accept the basic shared-state contract and ordered text.
Richer common capabilities are enabled for these verified profiles:

| Model ID | Images | Boxes | Typed choices / labelled scores | Audio / video |
| --- | --- | --- | --- | --- |
| `typesafe/jev-1.13` | PNG/JPEG | No | No | No |
| `typesafe/jev-1.14`, `~typesafe/jev-latest` | PNG/JPEG | Yes | No | No |
| `cloudflare/clef`, `cloudflare/clef-flash` | PNG/JPEG/WebP | No | Yes | No |
| `cloudflare/clef-omni` | PNG/JPEG/WebP | No | Yes | Yes |
| `openai/gpt-6-luna-decisions` | PNG/JPEG/WebP | No | Yes | No |

Ordered input retains its order. Native text items are strings, images use
`image_url` parts with embedded data URLs, audio uses `input_audio` with raw
base64 and a format, and video uses `video_url` with an embedded data URL.
Remote media URLs and Responses-style `input_image` parts are not translated.
Only the Omni profile enables common audio/video; native JSON remains subject
to the selected model's interpretation and service limits.

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
PNG/JPEG images become referenced native assets. Cloudflare-specific request
`options` are rejected; use explicit `providerPreferences.options` where the
selected upstream provider documents them.

`validate(request)` checks the common request and encoded size without inference.
It returns an immutable common request with a resolved model, retaining `images`
for reuse with `extract()`, `extractBatch()` and `validateResult()`.

`createExtraction()` accepts the native shape with `state`, `fields`, `assets`,
`reference_date` and OpenRouter request metadata. Assets can be PNG/JPEG images
or `{ type: 'document', format: 'pdf', data_base64 }` PDFs referenced in the
state text. The nine field types are text, number, date, datetime, time,
duration, list, estimate and forecast. Forecast fields require a `horizon` from
1 through 64 and an `interval`; `decimals` accepts 0 through 6 where supported.
Native `null_threshold` accepts zero through one. Forecast values are arrays of
numbers or strings, or null; their predictive arrays and step values are validated.

Results preserve omitted `truncated` and nullable `state_text`. The API does not
insert Cloudflare defaults into native responses. `validateResult(result, commonRequest)`
checks a saved envelope against the configured provider, model and common request's
field contract without inference. `extractBatch()` supports both built-in extraction providers.
Extraction discovery is not exposed because the catalog has no documented
extraction-modality filter.

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
