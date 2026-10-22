# Clairic extraction

Requires **0.1.3 or later**. See [version availability](../README.md#version-availability)
and [installation](GETTING_STARTED.md#install-into-your-application).

Import extraction from `@fayegram-ai/decision-bridge/extraction`. This operation
returns typed values and predictive statistics, using Cloudflare Clairic through
REST or an injected Workers AI binding. Its result is independent of the decision
bridge's question/answer contract.

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

REST reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` only for the official
origin, or accepts explicit `apiKey` and `accountId`. Custom origins require
explicit credentials. The default model is `clairic`; the full selector
`@cf/cloudflare/clairic` is also accepted. Requested, resolved and reported model
identities remain separate. There is no model-discovery request.

## Fields and results

| Type | Definition | Returned value |
| --- | --- | --- |
| `text` | Instructions describing a text value | String or null |
| `number` | Optional unit, integer and decimal settings | Number or null |
| `date`, `time`, `datetime` | Instructions describing the temporal value | String or null; no implicit timezone conversion |
| `duration` | Unit: seconds, minutes, hours, days, weeks, months or years | Number or null |
| `list` | Required `items`: text, number or date | Ordered list, including an empty list, or null |
| `estimate` | Required numeric or ISO-date `min` and `max`; optional `step` and `scale` | Number, date string or null, plus available distribution summaries |
| `forecast` | Prediction bounds plus optional positive `horizon` and `interval` | Native value and ordered predictive `steps`, retained as JSON |

`instructions` and `null_threshold` describe individual fields. `null_threshold`
must be greater than zero and at most one. `number` and `duration` accept boolean
`integer` and nonnegative integer `decimals`; numeric lists also accept `decimals`.
Grids support positive numeric steps or `month`/`year`;
`scale` is `linear` or `log`. Forecast intervals are `step`, `minute`, `hour`,
`day`, `week`, `month`, `quarter`, or `year`. Server ceilings remain server-owned.

The immutable envelope is `{ extraction, meta }`. The native extraction retains
all returned fields: values, guesses, confidence, `p_null`, spans, means,
medians, `p10`/`p90`, bounds probabilities, quantiles, forecast steps, `truncated`,
optional `state_text`, and usage including optional pass counts. Unknown native
response fields are retained after safe JSON validation.

A null value can coexist with a guess and span. Typed output does not establish
factual accuracy. The adapter does not recalculate predictions or token totals.
Predictive substructures with an underspecified schema remain JSON values in the
types; span offsets are preserved without assuming JavaScript slicing units.

## Images, binding and Gateway

Provide text `state`, embedded `images`, or both. Images accept PNG/JPEG/WebP data
URLs or `{ content_type, base64 }` objects. Remote images are not supported by
this operation. The adapter checks format and container structure, while the
service owns image-count, decoded-size, dimension and context admission.

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

## Validation, batching and errors

`validateExtractionRequest(request, options?)` is credential-free offline
validation. `provider.validate(request)` uses the configured provider settings.
Both check structure and client resource budgets, without promising admission.

Request/response budgets default to 8 MiB each and can be configured through
64 MiB. Requests are checked before media decoding. `extract(request, { signal })`
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
Batch results retain each caller's `requestedModel`, including the full
`@cf/cloudflare/clairic` alias, while `resolvedModel` and dispatched input use
`clairic`, just as for individual extraction calls.

## CLI

```shell
decision extraction init my-extraction
decision extraction validate request.json
decision extraction run request.json --env-file .env
decision extraction batch requests.jsonl --concurrency 4 --env-file .env
```

The namespace defaults to `cloudflare-extraction`; incompatible explicit
providers are rejected. Configuration schema version remains 1. Use the existing
Cloudflare account, credential, Gateway, timeout and retry settings. Inference
options belong in request JSON. Validation is offline and reports `fieldCount`.
Streaming JSONL batches can complete valid rows before a later row fails.

See the [runnable extraction example](../../examples/extraction.mjs), the
[official model schema](https://developers.cloudflare.com/workers-ai/models/clairic/)
and [extraction concepts](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/).
