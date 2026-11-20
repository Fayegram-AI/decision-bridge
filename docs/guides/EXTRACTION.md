# Cloudflare extraction

See [installation](GETTING_STARTED.md#install-into-your-application) and
[version availability](../README.md#version-availability).

Import `@fayegram-ai/decision-bridge/extraction` to extract typed values and predictive
statistics with Cloudflare Clairic or Clairic Flash. Connect through REST or supply a Workers AI binding.
Extraction has its own field definitions and result format, separate from the bridge's
questions and answers.
For OpenRouter extraction, use the same package export with
[`OpenRouterExtractionProvider`](OPENROUTER_NATIVE.md#extractions). The field limits,
assets and response requirements below describe Cloudflare extraction.

```javascript
import { CloudflareExtractionProvider } from '@fayegram-ai/decision-bridge/extraction';

const provider = new CloudflareExtractionProvider();
const { extraction, meta } = await provider.extract({
    state: 'Invoice total: 1080 USD. Due date: 2026-11-01.',
    reference_date: '2026-10-20',
    fields: {
        amount: { type: 'number', unit: 'USD' },
        due_date: { type: 'date' },
        payment_days: { type: 'estimate', min: 0, max: 90, step: 1 },
    },
    options: { include_quantiles: true, return_state_text: true },
});
console.log(extraction.answers.amount.value, extraction.truncated, meta.requestId);
```

REST accepts explicit `apiKey` and `accountId`. With the official origin, it
also reads `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and their
`DECISION_BRIDGE_` aliases. Custom origins require explicit credentials.
See [credential lookup](../reference/CONFIGURATION.md#recognized-environment-variables).

| Model | Short selector | Full Workers AI ID |
| --- | --- | --- |
| Clairic (default) | `clairic` | `@cf/cloudflare/clairic` |
| Clairic Flash | `clairic-flash` | `@cf/cloudflare/clairic-flash` |

A request's `model` overrides the provider default. For configured routes, an
explicit model must match the route's model after alias resolution.
`meta.requestedModel` retains an explicit request selector, `meta.resolvedModel`
uses its short name, and `extraction.model` reports the value returned by Workers AI.

## Fields and results

| Type | Definition | Returned value |
| --- | --- | --- |
| `text` | Instructions describing a text value | String or null |
| `number` | Optional unit, integer and decimal settings | Number or null |
| `date`, `time`, `datetime` | Instructions describing the temporal value | String or null; no implicit timezone conversion |
| `duration` | Unit: seconds, minutes, hours, days, weeks, months or years | Number or null |
| `list` | Required `items`: text, number or date. Numeric lists accept integer and decimal settings | Ordered list, including an empty list, or null |
| `estimate` | Required numeric or ISO-date `min` and `max`; optional `step` and `scale` | Number, date string or null, plus available distribution summaries |
| `forecast` | Prediction bounds plus optional `horizon` of 1–64 steps and `interval` | Native value and ordered predictive `steps`, retained as JSON |

Field names can contain up to 64 characters. Date, time, datetime and duration
fields accept a `null_threshold` greater than zero and at most one. Number and
duration fields and numeric lists accept boolean `integer` and integer `decimals`
from 0 through 6. Number, duration, list, estimate and forecast fields accept `unit`.
Grids support positive numeric steps, `month`, or `year`. Set `scale` to `linear`
or `log`. Forecast intervals are `step`, `minute`, `hour`, `day`, `week`,
`month`, `quarter`, or `year`.

The immutable envelope is `{ extraction, meta }`. The native extraction retains
all returned fields: values, guesses, confidence, `p_null`, spans, means,
medians, `p10`/`p90`, bounds probabilities, quantiles, forecast steps, `truncated`,
optional `state_text`, and usage including optional pass counts. Unknown native
response fields are retained after safe JSON validation.

A null value can coexist with a guess and span. Typed output does not establish factual
accuracy. The adapter does not recalculate predictions or token totals. Predictive
fields whose detailed structure is not specified use JSON value types. Spans can be null
when Workers AI finds no unique source match. Treat returned offsets as provider offsets.

## Images, binding and Gateway

Provide at least one evidence source using text `state`, embedded `images` or
embedded PDF `documents`. Images accept PNG/JPEG/WebP data URLs or
`{ content_type, base64 }` objects. Workers AI checks image dimensions and applies
its own image admission limits.

```javascript
const provider = new CloudflareExtractionProvider({
    transport: 'binding',
    ai: env.AI,
    gateway: { id: 'existing-gateway', skipCache: true },
});
```

`include_quantiles` and `return_state_text` stay in the model input's `options`.
`rejectIfBusy` is an execution setting, configurable on the provider or request
options; binding dispatch places it in the third `ai.run` argument. Gateway
settings use the same routing and diagnostics as the Clef provider. A service
rejection of an execution setting is reported without dropping the setting.

## PDF documents

Use a `data:application/pdf;base64,...` URL or an object with
`content_type: 'application/pdf'` and a `base64` string. Both forms require
canonical base64 and a PDF header. Supply the PDF bytes inline.

```javascript
import { readFile } from 'node:fs/promises';
import { CloudflareExtractionProvider } from '@fayegram-ai/decision-bridge/extraction';

const provider = new CloudflareExtractionProvider({ model: 'clairic-flash' });
const pdf = await readFile('invoice.pdf');
const { extraction } = await provider.extract({
    documents: [{ content_type: 'application/pdf', base64: pdf.toString('base64') }],
    fields: { amount: { type: 'number', instructions: 'Invoice total' } },
});
console.log(extraction.answers.amount.value);
```

PDF requests accept up to four image and document entries, up to 4 MiB of
decoded data per attachment and 8 MiB combined. The serialized request must
fit both the configured client budget and the 16 MiB hosted body ceiling.
Workers AI renders the PDFs and checks readability and encryption. Rendered PDF
pages and standalone images can total at most four.

## Validation, batching and errors

`validateExtractionRequest(request, options?)` is credential-free offline Clairic validation.
`provider.validate(request)` uses the configured provider settings. Both check request
structure and configured size limits. Passing local validation does not guarantee that
the service will accept a request.

Request and response budgets default to 8 MiB each and can be configured through
64 MiB. PDF requests also have the limits above. `extract(request, { signal })`
accepts an `AbortSignal`. Set `timeoutMs` on the provider constructor to bound
validation, dispatch and response handling; extraction call options accept only
`signal` and have no per-call timeout override.
Retries default to zero. Billing/allocation errors are not retried even when
retries are enabled; temporary eligible failures use the shared error policy.
See [errors and recovery](../reference/ERRORS.md).

`extractBatch(provider, requests, { concurrency, signal, stopOnError })` validates
all array requests before dispatch and returns ordered `{ index, ok, result }`
or `{ index, ok, error }` records. Concurrency defaults to four and is a client
execution setting, independent of any service quota.
Batch results use the same model selectors and metadata as individual calls.

## CLI

```shell
decision extraction init my-extraction
decision extraction validate request.json
decision extraction run request.json --env-file .env
decision extraction batch requests.jsonl --concurrency 4 --env-file .env
```

The namespace defaults to `cloudflare-extraction`. Select `openrouter-extraction`
explicitly for OpenRouter; other provider kinds are rejected. Configure the Cloudflare account, credential, Gateway,
timeout and retry settings in a
[single-provider profile](../reference/CONFIGURATION.md#single-provider-profiles-version-1).
Set `model` in the profile to select a default. The Cloudflare sample generated
by `extraction init` inherits that default. Inference options belong in
request JSON. Validation is offline and reports `fieldCount`.
Streaming JSONL batches can complete valid rows before a later row fails.

For selection among configured extraction targets, use `createExtractionRouter` and
`extractRoutedBatch` from `/routing`, or a CLI routing registry. The
`extraction init DIRECTORY --route auto` command creates a registry template;
`extraction inspect FILE --config REGISTRY` reports offline eligibility.
The extraction request and native result remain unchanged, with routing metadata
added. See [configurable routing](ROUTING.md).

See the [runnable extraction example](../../examples/extraction.mjs), the official
[Clairic schema](https://developers.cloudflare.com/workers-ai/models/clairic/#parameters),
[Clairic Flash schema](https://developers.cloudflare.com/workers-ai/models/clairic-flash/#parameters)
and [extraction concepts](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/).

## Provider-neutral extraction

`createExtractionProvider({ type, ...options })` selects `cloudflare-extraction`
or `openrouter-extraction`. Both accept named `fields` with text `state`, embedded
`images` or both, plus optional `reference_date` and `model`. Cloudflare accepts
`documents` on the shared request. For OpenRouter PDFs, use `createExtraction()`
and its native `assets` field on a model that supports PDFs. Field and
inference-option support depends on the selected provider.

`provider.validate(request)` performs offline preflight and returns an immutable
common request with a resolved model. The returned request can be validated again
or passed to `extract`, `extractBatch` and extraction routing with its embedded
attachments intact. For `validateResult(result, request)`, use the input you
passed to `extract`, including the model selector if you supplied one. The
validator checks the saved envelope against that input without inference.

Cloudflare responses require `truncated`. OpenRouter preserves optional
`truncated` and nullable `state_text`. See
[OpenRouter Extractions](OPENROUTER_NATIVE.md#extractions) for native assets and
provider-specific options.
