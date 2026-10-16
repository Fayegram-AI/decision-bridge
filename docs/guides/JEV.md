# Jev images, boxes, and long context

Jev uses TypeSafe's native `POST /v1/systemone` endpoint. The SDK defaults to
`jev-latest`; `jev-preview` and explicit version IDs are also accepted. Model
listing is account-specific and may list aliases without versioned IDs.
The returned `model` records the service-reported version independently of
`meta.requestedModel`.

## Experimental opt-ins

Jev images and long context are disabled by default. Enable each independently
in provider configuration. TypeSafe treats these capabilities as experimental;
their accuracy, formats, and limits can change.

```javascript
import { createBridge, JevProvider, box, noul } from '@fayegram-ai/decision-bridge';

const provider = new JevProvider({
    model: 'jev-1.14.0',
    dangerZone: { images: true, longContext: true },
});
const bridge = createBridge({ provider });

// imageBase64 is a caller-prepared PNG or JPEG, without a data URL prefix.
const result = await bridge.evaluate({
    input: [
        { type: 'text', text: 'A photograph from the kitchen camera.' },
        { type: 'image', dataUrl: 'data:image/png;base64,' + imageBase64 },
    ],
    questions: {
        present: noul('Is there a coffee mug in the image?'),
        mug: box('The coffee mug in the image'),
    },
});
console.log(result.answers.present.noul, result.answers.mug.box);
```

`dangerZone.images` sends `TypeSafe-Danger-Zone-Images: true` and enables common
image input and boxes. It works with Jev 1.13 and 1.14 for images. Boxes require
`jev-preview` or a pinned Jev version of 1.14.0 or newer. Local box capability
lookup remains conservative for moving stable aliases and unknown model names;
use a supported pinned ID or `jev-preview` for boxes. Account access and hosted
model availability are still checked by the service.

`dangerZone.longContext` sends `TypeSafe-Danger-Zone-Long-Context: true`. TypeSafe
documents 262k tokens for both the per-request and per-question contexts with
this header, compared with default limits of 64k and 32k respectively. This
option works on Jev 1.13 and 1.14. It does not change the byte budget or estimate
token counts. Longer contexts are slower and less accurate.

Ordered common input becomes a state array in the same order. Text stays text;
each image becomes an asset reference. The SDK chooses references that do not
collide with the input or question text. Jev does not support image detail
controls: omit `detail`, or use `null` or `auto`. Audio/video, typed choices,
labelled scores, and safety identifiers remain unsupported by this provider.

## Native assets in instructions and criteria

Use `provider.createDecision()` when images belong inside structured state,
instructions, or criteria. It accepts the native JSON request shape and returns
`{ decision, meta }`. Native calls share validation, transport, cancellation,
and retry policy with common calls, and bypass bridge extensions and observers.

```javascript
const { decision, meta } = await provider.createDecision({
    state: { photo: 'photo-unique-reference' },
    assets: {
        'photo-unique-reference': {
            type: 'image', format: 'png', data_base64: imageBase64,
        },
        'example-unique-reference': {
            type: 'image', format: 'jpg', data_base64: exampleBase64,
        },
    },
    questions: {
        same: noul('Does the object in `photo` match this picture: example-unique-reference?'),
        target: box('The matching object in `photo`'),
    },
});
console.log(decision.answers.target.box, meta.requestedModel);
```

References are substituted in string values, including inside sentences and
nested JSON. Object keys are not substituted. Every asset must be referenced.
Whole-value references are resolved first. In longer strings, matches are
consumed from left to right; when keys overlap at the same position, the current
API uses asset-map order. A reference hidden by another match does not count as
used. Preflight rejects unused assets before dispatch. Place references in
separate values when both images are intended.
Use long unique references (for example, fresh UUIDs) that cannot accidentally
match ordinary text. Each reference is at most 1024 UTF-8 bytes; all reference
keys together are at most 65536 bytes. A file is uploaded once, but repeating
its reference repeats the image in the model's expanded input.

The bridge uses the JSON/base64 transport supported by TypeSafe. It does not
accept multipart `part` assets, read local image files, fetch URLs, resize,
rotate, or re-encode images. Base64 overhead counts toward the request limit.
Native Jev assets are separate from the common request shape; use
`createDecision` for images embedded in instructions or criteria.

## Boxes and results

`box(instructions)` takes no criteria. Its answer has `type: 'box'`, `box`,
and native `confidence`. Coordinates are fractions measured from the top-left:
`left` and `right` scale with width; `top` and `bottom` scale with height.
All four values must be finite numbers in 0–1, with `left < right` and
`top < bottom`. Validation rejects malformed boxes rather than repairing them.
Common results containing box questions use result `meta.schemaVersion: 4`;
the CLI configuration schema version remains 1.

Each question returns one box. There is no absent-target result: a box is
returned even when the target is absent. Pair it with a presence `noul` and
choose your own presence/confidence thresholds using representative images.
Jev token usage may be `null`; that means unknown, never zero. Native confidence
and all other result checks remain enforced.

## Image and request limits

- PNG or JPEG (`png`, `jpg`, `jpeg`); still images only. Animated PNG is rejected.
- At most 16 MiB per decoded image file.
- Each dimension is 256–1568 pixels, and area is 78,400–2,458,624 pixels.
  A 256 × 256 image fails the area minimum.
- Jev requests default to a 32 MiB serialized JSON ceiling. `maxRequestBytes`
  can lower it, but cannot exceed 32 MiB. Response budgets remain independently
  configurable, with an 8 MiB default.
- State, each instruction, and each criterion must fit 64 nested JSON levels.
  General bridge snapshots also retain their 200,000-node limit.

Preflight checks base64, headers, dimensions, PNG animation, references, original
image bytes, and serialized request bytes. Full decoding, server re-encoding,
the 32 MiB processed-image and expanded-input limits, and token limits remain
service checks. Client header inspection cannot predict processed sizes.
Prepare upright pixels yourself: TypeSafe removes metadata and does not apply
EXIF orientation. No separate image-count cap is asserted by the bridge;
`maxImages: null` means size and context determine capacity.

## CLI

```json
{
    "schemaVersion": 1,
    "provider": "jev",
    "model": "jev-1.14.0",
    "apiKeyEnv": "TYPESAFE_API_KEY",
    "dangerZone": { "images": true, "longContext": true }
}
```

```shell
decision-bridge validate request.json --config decision.config.json
decision-bridge evaluate request.json --config decision.config.json --env-file .env
decision-bridge validate native.json --native --model jev-preview --jev-images
decision-bridge batch native.jsonl --native --config decision.config.json --env-file .env
```

Common/native validation is offline and uses the same preflight as inference.
`--native` works with `init`, `validate`, `evaluate`, and `batch`. Jev keeps its
`models` command. CLI JSON/JSONL input supports requests up to 32 MiB per record;
the actual serialized request must also fit the configured provider ceiling.

`--jev-images` / `--no-jev-images` and `--jev-long-context` /
`--no-jev-long-context` override independent fields in `dangerZone`.
`DECISION_JEV_IMAGES` and `DECISION_JEV_LONG_CONTEXT` accept exactly `true` or
`false`. Flags override environment, then JSON configuration, then defaults.
Switching providers discards Jev-specific settings; using these flags with
another provider is a configuration error.

## Protocol sources

- [TypeSafe release announcement](https://typesafe.ai/blog/jev-1-14)
- [Images, assets, limits, and experimental header](https://docs.typesafe.ai/images)
- [Box questions and absence behavior](https://docs.typesafe.ai/primitives/box)
- [Models, aliases, and context limits](https://docs.typesafe.ai/models)
- [JavaScript SDK compatibility changes](https://docs.typesafe.ai/sdk/javascript/changelog)
