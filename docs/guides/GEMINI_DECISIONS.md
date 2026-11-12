# Gemini Decisions

Use `GeminiDecisionsProvider` or provider selector `gemini-decisions` with
`gemini-decision-1`. The provider calls the Gemini Developer API's
`POST /v1beta/decisions` endpoint and returns native probabilities for yes/no,
choice and score questions. It uses REST directly and adds no runtime dependency.

## Credentials and configuration

The default credential variable is scoped to this SDK:

```dotenv
DECISION_BRIDGE_GEMINI_API_KEY=replace_with_your_gemini_api_key
```

Keep the populated environment file ignored. Saved configuration names the
variable through `apiKeyEnv`:

```json
{
    "provider": "gemini-decisions",
    "model": "gemini-decision-1",
    "apiKeyEnv": "DECISION_BRIDGE_GEMINI_API_KEY"
}
```

Provider constructors read that variable from the process environment at Google's
official origin. A server or Worker can supply its binding as the in-memory
`apiKey` option. Custom origins require an explicit key and do not inherit the
ambient Google credential. See [browser credential handling](BROWSER.md).

## Common SDK

```javascript
import { createBridge, GeminiDecisionsProvider, noul, choice, scoreLevels } from '@fayegram-ai/decision-bridge';

const bridge = createBridge({ provider: new GeminiDecisionsProvider() });
const result = await bridge.evaluate({
    state: { message: 'The headphones arrived broken.', orderValue: 80 },
    questions: {
        damaged: noul('Does the message report physical damage?'),
        action: choice('Choose the next action.', {
            replace: 'A damaged item should be replaced.',
            review: 'A person must review the request.',
        }),
        urgency: scoreLevels('Rate urgency.', [
            { label: 'routine', description: 'No immediate impact.' },
            { label: 'urgent', description: 'The product cannot be used.' },
        ]),
    },
});
console.log(result.answers, result.usage);
```

Structured state, instructions and criteria become JSON text. Common question IDs
and typed choice values are mapped to safe native IDs and restored in results;
callers retain boolean/string identity and original score legends. Native answer
confidence is preserved in `meta.geminiDecisions.answers`, including yes/no
confidence. The common yes/no answer remains `{ type: 'noul', noul }`.

Use `instructionParts` for ordered text or JSON question content. JSON parts become
text; question images are unsupported. Adjacent text blocks have no automatic
separator, so include spaces or newlines where the content needs them.

## Media

Common ordered input supports inline and remote media. In this example,
`pdfDataUrl` is a PDF data URL, and `recordingUrl` and `photoUrl` are HTTPS
references accessible to Google:

```javascript
const result = await bridge.evaluate({
    input: [
        { type: 'text', text: 'Inspect this document and recording.\n' },
        { type: 'document', dataUrl: pdfDataUrl },
        { type: 'audio', url: recordingUrl, mimeType: 'audio/ogg' },
        { type: 'image', url: photoUrl, mimeType: 'image/jpeg', resolution: 'ultra_high' },
    ],
    questions: { consistent: noul('Are the supplied materials consistent?') },
});
```

| Common input | Source and MIME contract |
| --- | --- |
| Image | Inline `dataUrl` or `url`. Gemini requires `mimeType` for a remote image. |
| Audio / video | Inline `dataUrl`, or `url` with `mimeType`. |
| Document | PDF `dataUrl` or `url`; the native MIME type is `application/pdf`. |

Each media part has exactly one source. New remote audio/video/document references
require HTTPS without URL credentials or fragments; signed query strings remain
unchanged. Google accepts existing Files API URIs and supported public/signed
HTTPS media references. Upload files and manage their processing status and
lifecycle through Google's [Files API](https://aistudio.google.com/docs/files)
before supplying their URIs. The SDK forwards references without fetching them or
uploading, listing or deleting files. Native Google media and token limits apply separately from
the SDK's client budgets.

Inline MIME types come from the data URL. Google-specific MIME support is checked
before dispatch. Common image `resolution` accepts `low`, `medium`, `high` or
`ultra_high`; video `resolution` accepts `low`, `medium` or `high`. Resolution applies to
inline and remote sources. Audio, PDFs and question content do not accept it.
Existing image `detail: 'low'` and `'high'` map to matching resolutions; `'auto'`
omits the setting. Use either `resolution` or a non-null `detail`, since specifying
both is invalid. Image `detail: 'original'` is unsupported; use
`resolution: 'ultra_high'` for Google's highest image resolution.

## Native API

```javascript
const provider = new GeminiDecisionsProvider();
const { decision, meta } = await provider.createDecision({
    input: [{ type: 'text', text: 'The replacement arrived intact.' }],
    questions: {
        intact: {
            type: 'noul',
            instructions: 'Did the replacement arrive intact?',
            criteria: {
                true_description: 'The item has no reported damage.',
                false_description: 'Damage or breakage is reported.',
            },
        },
    },
});
console.log(decision.answers.intact.confidence, decision.usage, meta.requestedModel);
```

Native input accepts a string, one content block or an array of blocks. Media
blocks use `data` for base64 bytes or `uri` for a reference, plus `mime_type`.
See Google's [MIME and resolution contracts](https://aistudio.google.com/docs/decisions-api#input).
Native question instructions are text-only. Yes/no criteria use optional
`true_description` and `false_description`; choices use a string-description map;
scores use an ordered array of nonempty descriptions.

Native request keys follow Google's documented rules: 1–64 ASCII letters,
digits, underscores or hyphens for question IDs, and bounded option keys without
surrounding whitespace, non-ASCII spaces, or Unicode Other-category characters
(control, format, surrogate, private-use and unassigned code points).
Choices and scores accept 2–255
options/levels; requests accept 1–1,000 questions within service context limits.
Google sorts native option keys by UTF-8 byte order and breaks exact ties by that
ordering. Common record choices preserve this ordering; typed choices retain
their declared order through padded internal IDs.

Both entry points validate responses and preserve returned probability values
without renormalizing them. Explicit blocked prompt feedback or a documented
safety rejection produces `MODEL_REFUSAL`. Invalid or missing answers fail the
response contract.

## Metadata, models and limits

`model` and `meta.requestedModel` identify the selected model. The common result
uses `meta.modelSource: 'requested'` because the documented Decisions response
does not report model identity. `meta.geminiDecisions.usage` retains Google's
native modality counts; common `usage` exposes input tokens and zero output
tokens. Native prompt feedback is retained when supplied.

`bridge.listModels()` reads Google's model-information endpoint for the supported
selector. Model metadata retains the original resource name as `resourceName`.
Listing and inference require account access independently of the local model
profile.

Transport request and response budgets default to 8 MiB. Set `maxRequestBytes`
explicitly for larger inputs, up to 160 MiB (167,772,160 bytes). This client budget
measures the complete serialized UTF-8 JSON body, including base64 expansion and
questions; it is independent of Google's media limits. Google documents 100 MB
of inline data and a separate 50 MB PDF limit. `maxResponseBytes` can be raised
independently through 64 MiB for large answer sets. For example:

```javascript
const provider = new GeminiDecisionsProvider({
    maxRequestBytes: 160 * 1024 * 1024,
    maxResponseBytes: 64 * 1024 * 1024,
});
```

Gemini request and response snapshots allow 1,000,000 JSON nodes with a maximum
nesting depth of 100. These client limits do not replace Google's context window.
Retries default to zero; explicit retries share the configured
deadline. Unsupported selectors, media formats and capabilities fail locally.
Google validates actual remote media, content safety, token limits and admission.

Explicit common `resolution` selects result schema version 8. Document, remote
audio/video or explicit remote MIME metadata selects version 7 when no resolution
is supplied. Earlier request forms retain their prior schema versions.
Gemini supports neither boxes, native conversation/tool history, question media,
prompt caching nor Google hosted Batch API. The bridge's local batch and routing
APIs use ordinary Decisions requests. Extraction and Live are separate APIs.

## CLI

```text
decision-bridge init ./gemini --provider gemini-decisions
decision-bridge validate ./gemini/request.json --config ./gemini/decision.config.json
decision-bridge evaluate ./gemini/request.json --config ./gemini/decision.config.json --env-file .env
decision-bridge models --provider gemini-decisions --env-file .env
decision-bridge init ./gemini-native --provider gemini-decisions --native
```

Native evaluation and JSONL batches use `--native` explicitly. Routing registries
use the same provider selector and `apiKeyEnv` reference. Offline validation and
routing inspection do not make inference requests.

See the [official API guide](https://aistudio.google.com/docs/decisions-api),
[model reference](https://aistudio.google.com/docs/models/gemini-decision-1),
[configuration reference](../reference/CONFIGURATION.md) and
[routing guide](ROUTING.md).
