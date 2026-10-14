# Cloudflare Clef decisions

Use `cloudflare-decisions` for hosted inference with `clef` (the default),
`clef-flash`, or `clef-omni`. All three support common bridge requests and the
dedicated native API. Each accepts its full `@cf/cloudflare/<model>` alias.
The provider normalizes the endpoint identifier and the required input selector together.
See the [model selector inventory](../../README.md#model-selectors) for supported
short selectors and full forms.

| Model | Hosted context, in tokens | Default client request budget | Media |
| --- | ---: | ---: | --- |
| Clef | 65,536 | 13 MiB | Images |
| Clef-flash | 24,576 | 13 MiB | Images |
| Clef-omni | 64,000 | 36 MiB | Images, audio, video |

Questions and media consume context before text state; the service truncates
remaining text state to fit. Requests whose questions/media exhaust context can
fail. Byte checks cannot guarantee token fit or detect remote truncation.
Clef's serving improvements and Clef-flash's lower pricing apply upstream without
client configuration. Consult the official [model pages](#official-references)
for current pricing and availability; the bridge does not discover account access.

## Supported inference paths

| Path | Required application configuration |
| --- | --- |
| REST | Account ID and Workers AI API token |
| REST through AI Gateway | REST credentials and an existing Gateway ID in that account |
| Workers AI binding | An existing Worker's AI binding injected as `ai` |
| Workers AI binding through Gateway | AI binding and an existing Gateway ID in that account |

Common `bridge.evaluate()` and native `provider.createDecision()` access work
through either transport. REST is the default and is also the CLI transport.
Gateway routing is optional. The bridge supplies inference integration;
applications configure their own Worker and Gateway resources.

## REST credentials and common access

Create a Cloudflare API token with **Account > Workers AI > Read** permission
scoped to the intended account. Set these variables in your application's ignored
environment file:

```dotenv
CLOUDFLARE_ACCOUNT_ID=replace_with_your_account_id
CLOUDFLARE_API_TOKEN=replace_with_your_api_token
```

Load it explicitly with Node's `--env-file` or the CLI's `--env-file` flag.
The REST constructor reads these variables only for the official Cloudflare origin.
A custom origin requires explicit `accountId` and `apiKey`.
REST requests use
`/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/{model}`.
The account ID selects the account in that URL; the token authorizes access.
Gateway inference uses the same Workers AI permission. Gateway management
permissions apply to creating or changing Gateway resources, which the SDK does
not perform.

```javascript
import { createBridge, CloudflareDecisionsProvider, choice, noul, scoreLevels } from '@fayegram-ai/decision-bridge';

const provider = new CloudflareDecisionsProvider({ model: 'clef-flash' });
const bridge = createBridge({ provider });
const result = await bridge.evaluate({
    state: { ticket: 'The production checkout is unavailable.' },
    questions: {
        urgent: noul('Does this need immediate attention?'),
        route: choice('Choose a route.', [
            { value: true, description: 'Escalate to the incident team.' },
            { value: 'review', description: 'Send to normal review.' },
        ]),
        severity: scoreLevels('Rate severity.', [
            { label: 'Low', description: 'No production impact.' },
            { label: 'High', description: 'Production functionality is unavailable.' },
        ]),
    },
});
console.log(result.answers, result.usage, result.meta.cloudflareDecisions);
```

Structured state, instructions, criteria, and rubric descriptions remain JSON.
Typed choices use generated native IDs and map back to the exact original
string or boolean values; `true` and `"true"` remain distinct.

## Dedicated native access

```javascript
const { decision, meta } = await provider.createDecision({
    state: { ticket: 'The production checkout is unavailable.' },
    questions: {
        urgent: { type: 'noul', instructions: 'Does this need immediate attention?' },
        route: { type: 'choice', instructions: 'Choose a route.',
            criteria: { incident: 'Immediate incident response.', review: 'Normal review.' } },
        severity: { type: 'score', instructions: 'Rate severity.',
            criteria: ['No production impact.', 'Production functionality is unavailable.'] },
    },
});
console.log(decision.answers, meta.requestId);
```

The SDK supplies an omitted model from the provider default. Explicit `null`
model or execution options are invalid and fail before dispatch. Native questions
use `criteria`; common typed `options` and labelled `levels` are available through
`bridge.evaluate()`. Results preserve native probabilities, confidence, model,
and input/output token counts. Unreported cache or total-token counts are not invented.
`createDecision()` accepts an optional second argument containing `signal`.
Configure its timeout on the provider; direct native access bypasses bridge
extensions and the bridge's separate total deadline.

## Embedded images and limits

Clef accepts up to four embedded PNG, JPEG, or WebP images. Native `images` entries
can be base64 data URLs or `{ content_type, base64 }` objects. Remote URLs are
rejected. Common ordered input places all images before all text:

```javascript
import { readFile } from 'node:fs/promises';

const bytes = await readFile('screenshot.png');
const imageResult = await bridge.evaluate({
    input: [
        { type: 'image', dataUrl: 'data:image/png;base64,' + bytes.toString('base64') },
        { type: 'text', text: 'Assess this screenshot.' },
    ],
    questions: { error: noul('Does the screenshot show an error?') },
});
console.log(imageResult.answers.error.noul);
```

Text parts concatenate exactly, without inserted separators. Image detail can be
omitted, `null`, or `auto`; explicit `low`, `high`, and `original` are unsupported.
Safety identifiers are unsupported by this provider.

| Boundary | Limit |
| --- | --- |
| Questions per request | 1–64 |
| Question IDs | 1–100 ASCII letters, digits, `_`, `.`, or `-` |
| Choice options | 2–255 |
| Score levels | 2–10, ordered lowest first, indexed from zero |
| Images | At most four |
| Decoded image size | 4 MiB each; 8 MiB combined |
| Image dimensions | Positive dimensions; at most 16 million pixels each |
| Serialized request | Clef/Clef-flash: at most 13 MiB; Omni: 36 MiB by default, configurable through 64 MiB |

Preflight checks supported formats, base64 syntax, headers, dimensions, and size.
Header inspection is not full image decoding; the service can reject corrupt image data.
Limits include execution options and binding envelope overhead. Omni's 36 MiB
default is a bridge policy allowing base64 expansion of the permitted decoded
media; its published schema specifies no whole-request byte ceiling. The effective
request model selects the budget, including per-call overrides. An explicit
`maxRequestBytes` remains a caller ceiling and is never enlarged by selecting Omni.

Cloudflare's four-decimal probability precision receives a count-aware sum
allowance: the larger of 0.001 and half a decimal unit per option, plus floating-point
slack. This additional allowance applies only when every probability aligns to
that precision. Values are preserved without renormalization; missing options,
out-of-range probabilities, wrong choices, and inconsistent score rubrics remain errors.

When applying `decideChoice` to these answers, supply the same precision from
the provider contract. The helper keeps the stricter baseline when it is omitted:

```javascript
import { decideChoice } from '@fayegram-ai/decision-bridge';

const policy = decideChoice(result.answers.route, {
    minProbability: 0.8,
    probabilityDecimalPlaces: provider.getResultValidationOptions(result.model).probabilityDecimalPlaces,
});
console.log(policy.status, policy.reason);
```

## Omni audio and video

Common Omni input follows **images → audio → videos → text**, with any group
optional. Order within each group is preserved, and text concatenates exactly.
Interleaving groups is rejected because native requests represent them as separate
arrays. Common requests still require exactly one of `state` or `input`; native
requests can combine structured `state` with `images`, `audio`, and `videos`.

```javascript
const omniProvider = new CloudflareDecisionsProvider({ model: 'clef-omni' });
const omniBridge = createBridge({ provider: omniProvider });
const audioUrl = 'data:audio/wav;base64,' + (await readFile('clip.wav')).toString('base64');
const videoUrl = 'data:video/mp4;base64,' + (await readFile('clip.mp4')).toString('base64');
const mediaResult = await omniBridge.evaluate({
    input: [
        { type: 'audio', dataUrl: audioUrl },
        { type: 'video', dataUrl: videoUrl },
        { type: 'text', text: 'Assess these clips.' },
    ],
    questions: { speech: noul('Is audible speech present?') },
});
const nativeMedia = await omniProvider.createDecision({
    state: { purpose: 'Assess these clips.' },
    audio: [audioUrl],
    videos: [videoUrl],
    questions: { speech: { type: 'noul', instructions: 'Is audible speech present?' } },
});
```

Native media entries accept data URLs or `{ content_type, base64 }` objects.
Audio supports WAV (`audio/wav`, alias `audio/x-wav`) and MP3 (`audio/mpeg`, alias
`audio/mp3`). Video supports MP4 (`video/mp4`) and WebM (`video/webm`). Common
audio/video parts accept only `type` and `dataUrl`; remote URLs, paths, image
detail, and caller-provided durations are rejected. Other providers and the older
Clef models reject audio/video before dispatch.

| Media | Count | Decoded size per item | Duration per item |
| --- | ---: | ---: | ---: |
| Audio | 4 | 8 MiB | 300 seconds |
| Video | 2 | 16 MiB | 60 seconds |

Audio and video together are limited to 16 MiB decoded. Image limits above remain
separate. Bounded inspectors validate canonical base64, MIME/header consistency,
and container structure, and reject excessive duration when PCM/float WAV,
ordinary MP3 frames, MP4 metadata, or WebM metadata establishes it reliably.
Full decoding, codec validity, and duration that cannot be established locally
(including compressed WAV, free-format MP3, or missing container duration) remain
service validation. The bridge performs no transcription, transcoding, frame
extraction, or streaming, and adds no runtime media dependency.

Cloudflare samples video at two frames per second. Video soundtracks are processed
only when **every supplied video has a soundtrack**. Common results use
`meta.schemaVersion: 3` when audio or video is present; older requests retain
their existing schema version. See the [runnable Omni example](../../examples/cloudflare-omni.mjs).

## Workers AI binding

Inject your configured binding to avoid REST credentials:

```javascript
const workerProvider = new CloudflareDecisionsProvider({
    transport: 'binding',
    ai: env.AI,
    model: 'clef',
    rejectIfBusy: true,
});
const workerBridge = createBridge({ provider: workerProvider });
```

Both transports support cancellation, bounded response reads, and deadlines.
The binding receives `signal`, `returnRawResponse: true`, execution options, and
Gateway options through `ai.run()`. Request and Gateway log IDs come from each
response rather than shared binding fields. Available IDs are also preserved in
safe public errors, including response validation and body-reading failures. See the complete
[inference handler example](../../examples/cloudflare-worker.mjs).

The example covers inference integration. Route requests through your application's
authorization and enforce an incoming HTTP body limit appropriate to the selected
model before parsing JSON: 13 MiB for Clef/Clef-flash, or the configured Omni
budget (36 MiB by default). SDK preflight validates the parsed decision request; it cannot bound
the HTTP body already consumed by `request.json()` or authorize callers.

REST is the ordinary account-ID/token API path. Workers binding and Gateway are
optional, supported inference paths for all three models. Use your Worker's configured
AI binding for binding transport and a Gateway in the same account for Gateway
routing; the bridge does not create or deploy those resources.

## Capacity rejection and AI Gateway

`rejectIfBusy` defaults to false. With binding transport, set it to true to
reject unavailable capacity instead of waiting in the inference queue. Capacity rejection reports
`CAPACITY_EXCEEDED`, HTTP 429, and numeric `upstreamCode: 3040`.
It cannot be combined with client retries or multiple Gateway attempts.

REST requests with effective `rejectIfBusy: true` fail local preflight with
`UNSUPPORTED_CAPABILITY` before dispatch. This applies to common/native SDK calls,
CLI evaluation/batching, and credential-free offline validation, with or without
Gateway. An explicit native `options.rejectIfBusy: false` can override a true
provider default; disabled execution options are omitted from REST requests.

The hosted
Clef, Clef-flash, and Clef-omni REST service rejects the `options` field with HTTP 422 and upstream code
`5012`, including `options: { rejectIfBusy: true }`, although the general Workers AI
documentation describes that field. The bridge rejects this known unavailable
feature instead of dispatching it or silently disabling the requested behavior.
Binding execution options use the third `ai.run()`
argument; use the binding transport for these models with `rejectIfBusy: true`.
Omni option acceptance was checked through binding both directly and through
Gateway; those checks did not deliberately exhaust capacity. This compatibility
behavior was checked on 2026-10-09; REST rejection was reconfirmed on 2026-10-10.
The model-specific documentation does not establish whether this REST limitation
is intentional or a platform defect. Behavior can change upstream.

Gateway routing is disabled unless configured. Use an existing Gateway:

```javascript
const gatewayProvider = new CloudflareDecisionsProvider({
    gateway: {
        id: 'existing-gateway',
        skipCache: true,
        collectLog: false,
        metadata: { application: 'support-routing' },
        requestTimeoutMs: 10000,
        retries: { maxAttempts: 1, retryDelayMs: 0, backoff: 'constant' },
    },
});
```

Use the same `gateway` object alongside `transport: 'binding'` and `ai: env.AI`
for binding requests through Gateway. REST sends documented `cf-aig-*` headers;
binding sends Gateway settings in the third `ai.run()` argument.

| Setting | Accepted value |
| --- | --- |
| `id` | Required nonblank printable ASCII string, 1–64 characters |
| `cacheKey` | Optional nonblank printable ASCII string, 1–200 characters |
| `cacheTtl` | Integer seconds, 60–2,592,000 (30 days) |
| `skipCache`, `collectLog` | Optional booleans |
| `metadata` | At most five entries with JSON primitive values; caller-supplied `cf.*` keys are reserved |
| `requestTimeoutMs` | Positive integer milliseconds, up to 2,147,483,647 |
| `retries.maxAttempts` | 1–5; defaults to 1 when Gateway is configured |
| `retries.retryDelayMs` | 0–60,000 milliseconds |
| `retries.backoff` | `constant`, `linear`, or `exponential` |

The shared validator rejects invalid Gateway settings with `CONFIGURATION_ERROR`
before dispatch. Metadata is preserved unchanged: the bridge rejects entries
that [Cloudflare would ignore or remove](https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/)
instead of silently dropping them. Cloudflare's [cache TTL documentation](https://developers.cloudflare.com/ai-gateway/features/caching/)
describes the upper limit as one month; its [official numeric reference](https://github.com/cloudflare/skills/blob/0cb6116228ad153126f474dce1dfbd05f7944604/skills/cloudflare/references/ai-gateway/README.md)
specifies 2,592,000 seconds (30 days). Cache TTL and first-response timeout have
separate validation bounds.

Gateway timeout covers time to the first response; the bridge's total deadline
continues to bound the call. Gateway logging/caching follows the explicit options
and your Gateway configuration. Client retries and Gateway attempts are separate
controls and both may repeat inference. Busy mode requires zero client retries
and one Gateway attempt.

The provider defaults to a 30-second transport timeout, zero client retries,
the model-specific request budget above, and an 8 MiB response limit. Gateway's
[25 MB cacheable-request limit](https://developers.cloudflare.com/ai-gateway/reference/limits/)
is separate from inference and client byte limits; the bridge preserves explicit
Gateway settings without automatically enabling caching. The bridge defaults to a separate
60-second total deadline. Explicit client retries use the existing eligible HTTP
status policy and the same deadline; ambiguous network failures are not retried.

## CLI

```bash
decision-bridge init my-clef --provider cloudflare-decisions --native
decision-bridge validate my-clef/request.json --provider cloudflare-decisions --native
decision-bridge evaluate my-clef/request.json --provider cloudflare-decisions --native --env-file .env
decision-bridge evaluate request.json --provider cloudflare-decisions --model clef-flash --env-file .env
decision-bridge evaluate omni-request.json --provider cloudflare-decisions --model clef-omni --env-file .env
decision-bridge batch requests.jsonl --provider cloudflare-decisions --env-file .env --concurrency 4
```

Initialization writes credential placeholders. Offline validation needs no credentials.
Use `--account-id`, `--gateway-id`, and `--no-reject-if-busy` for explicit overrides;
richer Gateway settings belong in the JSON config's `gateway` object. The SDK
Gateway example above shows that object's fields. A native request's
`options.rejectIfBusy` overrides its configured default; an explicit busy-mode
CLI flag overrides the native request option.
`--reject-if-busy` is retained for explicit configuration but fails local preflight
for Clef REST. The CLI uses REST; enabled busy mode requires the SDK binding path.

Cloudflare single JSON input and individual JSONL records are read within a
64 MiB cap, then the same model-specific SDK preflight applies. This supports
request-level model overrides and mixed-model batches. JSONL retains its 64 MiB
total cap. No separate media-upload flags are needed; use embedded input parts
or native arrays in JSON. The configuration schema version remains 1. `models` is unsupported.
SDK array batching prevalidates all requests before inference; CLI JSONL batching
validates incrementally. Neither uses Cloudflare's asynchronous batch service.

## Official references

- [Clef](https://developers.cloudflare.com/workers-ai/models/clef/), [Clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/), and [Clef-omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/)
- [Omni input schema](https://developers.cloudflare.com/workers-ai/models/clef-omni/schema-input.json) and [output schema](https://developers.cloudflare.com/workers-ai/models/clef-omni/schema-output.json)
- [Input schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json) and [output schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json)
- [REST and token permissions](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [Reject busy requests](https://developers.cloudflare.com/workers-ai/features/reject-if-busy/)
- [Gateway binding configuration](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)
- [Gateway request handling](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/)
- [Workers AI errors](https://developers.cloudflare.com/workers-ai/platform/errors/)
