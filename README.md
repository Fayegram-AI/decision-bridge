# Decision Bridge

[![MIT license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Zero runtime dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)](package.json)

A JavaScript SDK that turns supplied information into structured decisions inside
your application. An optional Node command runner is included for evaluating files.
Give it a `state` (text or JSON to assess) and one or more `questions`; it returns
validated choices, probabilities for yes/no (`noul`) questions, or rubric-based
scores. Capable providers also accept ordered media input or conversation history.
For example, pass a failed test log to classify the failure and estimate whether
a missing dependency caused it. Your application decides what to do with the result.

Try the [Decision Playground](https://decision-pg.fayegram.com/).

The main SDK supports native decision models: Jev through TypeSafe, OpenAI
Decisions, and Cloudflare Clef. Custom decision services use the explicit
`custom/decision` entry point. General-purpose models remain available through
the opt-in `custom/generative` entry point, with maintained OpenAI-compatible,
OpenRouter, and Anthropic presets. The bridge handles the shared request and result
contract; each provider handles its API protocol and model capabilities.

[OpenAI Decisions](docs/guides/OPENAI_DECISIONS.md) also supports ordered text/image
input, typed string/boolean choices, labelled scores, conversation/tool history, remote images, prompt caching, and dedicated native access.
[Cloudflare Clef, Clef-flash, and Clef-omni](docs/guides/CLOUDFLARE_DECISIONS.md) provide
common/native access, embedded images, typed choices, labelled scores, REST,
Workers AI bindings, and optional AI Gateway routing. Omni additionally supports
embedded WAV/MP3 audio and MP4/WebM video, ordered images → audio → videos → text.
The common API checks provider/model capabilities before dispatch; refusals are
errors.

**Version 0.1.3 · Node.js 22.16+ or modern browsers (SDK) · ESM · zero runtime dependencies**

These docs cover 0.1.3. For supported features by version, see
[version availability](docs/README.md#version-availability) and the
[changelog](CHANGELOG.md). Start with the
[installation options](docs/guides/GETTING_STARTED.md#install-into-your-application).

The npm package is
[@fayegram-ai/decision-bridge](https://www.npmjs.com/package/@fayegram-ai/decision-bridge).
Source and issue reports are maintained at
[Fayegram-AI/decision-bridge](https://github.com/Fayegram-AI/decision-bridge).
Report security issues privately as described in [SECURITY.md](SECURITY.md).

This is an independent project. The custom generative presets identify their
probabilities as elicited model outputs.
Changing providers does **not** make their accuracy or calibration equivalent.

## Model selectors

Use these model selectors with the built-in decision providers:

| Decision provider | Model selectors | Provider default |
| --- | --- | --- |
| Jev through TypeSafe (`jev`) | `jev-latest` | `jev-latest` |
| OpenAI Decisions (`openai-decisions`) | `default`, `luna` | `default` |
| Cloudflare (`cloudflare-decisions`) | `clef`, `@cf/cloudflare/clef` | `clef` |
| Cloudflare (`cloudflare-decisions`) | `clef-flash`, `@cf/cloudflare/clef-flash` | — |
| Cloudflare (`cloudflare-decisions`) | `clef-omni`, `@cf/cloudflare/clef-omni` | — |

`jev-latest` is Jev's default alias. Jev also accepts `jev-preview` and explicit model IDs available through your TypeSafe account;
use `bridge.listModels()` or the CLI `models` command to inspect that catalog.
The bridge does not maintain a static list of Jev versions. A moving alias or a
catalog entry does not guarantee inference access or reproducible model quality.
For OpenAI Decisions, `default` selects the provider default and `luna` selects
the supported Luna-family model. Decision Bridge resolves selectors to supported
upstream model IDs before calling the service. Mappings are fixed by the installed
Decision Bridge release. Explicit supported model IDs can also be selected; see
the [OpenAI model selection guide](docs/guides/OPENAI_DECISIONS.md#model-selection)
for details. Results retain the selected value in `meta.requestedModel`,
the outgoing ID in `meta.resolvedModel`, and the service-reported model in `model`.
The Cloudflare decision provider accepts the three decision models above, in short or full form.
Model discovery is unsupported for OpenAI Decisions and Cloudflare.

Additional decision protocols use [custom decision providers](docs/guides/CUSTOM_DECISION.md).
General-purpose models use the separate [custom generative](docs/guides/CUSTOM_GENERATIVE.md)
entry point, with `openai-compatible`, `openrouter`, or `anthropic` presets, or
an explicit provider module. Those presets require a model ID supported by your
configured service and have no default model or fixed model catalog.

Clairic uses the dedicated [extraction API](docs/guides/EXTRACTION.md), with
selectors `clairic` and `@cf/cloudflare/clairic` (default `clairic`). It returns
typed values, estimates and forecasts through REST or Workers bindings.
[Live Decisions](docs/guides/LIVE_DECISIONS.md) attaches to an application-owned
GPT-Live connection for delegation, transcript triggers and Decision events.
These operations have dedicated `/extraction` and `/live` package exports.

Service quotas and admission limits are handled upstream. The SDK validates its
contracts and configurable client resource budgets and returns structured errors.

## Choose a provider

All native providers support shared state and the common `choice`, `noul`, and
`score` questions. Additional input and question forms depend on the provider:

| Provider | Additional supported features | Guide |
| --- | --- | --- |
| Jev | Native decisions, opt-in images, boxes, and long context through TypeSafe | [Jev guide](docs/guides/JEV.md) |
| OpenAI Decisions | Ordered text/images, conversation/tool history, remote images, prompt caching, typed choices, labelled scores, safety identifiers, native access | [OpenAI Decisions](docs/guides/OPENAI_DECISIONS.md) |
| Cloudflare Clef / Clef-flash | Embedded images before text, typed choices, labelled scores, native access, Workers AI binding, optional Gateway | [Cloudflare decisions](docs/guides/CLOUDFLARE_DECISIONS.md) |
| Cloudflare Clef-omni | The same decision and transport features, plus embedded audio/video | [Omni media and limits](docs/guides/CLOUDFLARE_DECISIONS.md#omni-audio-and-video) |
| Custom decision service | Explicit decision provider contract | [Custom decision providers](docs/guides/CUSTOM_DECISION.md) |
| Custom generative presets / modules | General-purpose output mapped into decisions; explicit opt-in | [Custom generative providers](docs/guides/CUSTOM_GENERATIVE.md) |

For Cloudflare REST, provide an account ID and API token. Workers binding and
Gateway are optional paths with their own configured resources. Enabled
`rejectIfBusy` currently requires the binding path for all three Clef models.
Enabling it for REST fails local preflight with `UNSUPPORTED_CAPABILITY`; see the
[service compatibility note](docs/guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway).
Use [provider capabilities](docs/reference/PROVIDERS.md#common-request-capabilities)
and `bridge.validate()` to check a request before inference. Capability support
does not establish account access or model quality.

## Use in your application

For this server-side example, use Node.js **22.16 or newer**. Install the package
in your application's directory:

```bash
npm install @fayegram-ai/decision-bridge
```

The installed SDK runs without a compilation step. See
[getting started](docs/guides/GETTING_STARTED.md) for source and archive setup.

Create `.env` in your application's directory and set your TypeSafe API key:

```dotenv
TYPESAFE_API_KEY=your_real_key_here
```

Add `.env` to your application's `.gitignore`. The SDK reads the process
environment; the Node command below explicitly loads this file before startup.

Save this complete example as `app.mjs` beside `.env`. The `.mjs` extension enables
ESM imports without changing your application's `package.json`:

```javascript
import { createBridge, choice, noul, publicError } from '@fayegram-ai/decision-bridge';

try {
    const bridge = createBridge({ jev: {} }); // TYPESAFE_API_KEY; model defaults to jev-latest.
    const result = await bridge.evaluate({
        state: { log: "ModuleNotFoundError: No module named 'pytest'" },
        questions: {
            category: choice('Classify the failure using only the evidence.', {
                dependency: 'A required package or module is unavailable.',
                network: 'A network operation failed.',
                unknown: 'The evidence is insufficient.',
            }),
            missing_package: noul('Does the error indicate a missing package?'),
        },
    });
    console.log(result.answers.category.choice);
    console.log(result.answers.missing_package.noul);
    console.log(result.meta.probabilitySource);
} catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
}
```

```bash
node --env-file=.env app.mjs
```

This makes one real Jev evaluation and may incur charges. The first output is one
of your category labels. The second is a probability between 0 and 1; `noul` does
not turn it into a boolean. For Jev, `probabilitySource` is `native`. Answers depend
on the model; the example does not assume a particular prediction.

Edit `state` and the question definitions for each call. No saved prompt
registration is required. `publicError()` exposes a stable error code and safe
message, with HTTP diagnostics when available; see [errors](docs/reference/ERRORS.md).

The example explicitly selects Jev using the `jev` shortcut. For a native provider,
construct it with `createProvider({ type: 'YOUR_PROVIDER', ...options })` or a
built-in provider class, then pass it to `createBridge({ provider })`.
`createBridge()` and `createBridge({})` reject missing provider selection.

Continue with [getting started](docs/guides/GETTING_STARTED.md) for TypeScript,
CommonJS, and optional command-runner usage, or the [SDK reference](docs/reference/SDK.md)
for the complete request and result contracts.

## Browser use

The same SDK import works in modern browser applications. Supply credentials
explicitly; browsers do not have Node's process environment. Direct requests work
only when the provider permits your web origin through CORS, including the
authorization and content-type headers. The default Jev endpoint needs TypeSafe
to allow the app's origin before a browser can call it. A browser-visible API key
is accessible to users of that app, so use only credentials intended for client
exposure. See [browser integration](docs/guides/BROWSER.md) for the boundary and
an example. The optional command runner remains Node-only.

## Change the backend, not the request

[Switching models](docs/guides/SWITCHING_MODELS.md) provides a complete SDK example
for changing native providers. To elicit decisions from a locally served general-purpose
model, explicitly opt into the maintained custom generative preset:

```javascript
import { createBridge } from '@fayegram-ai/decision-bridge';
import { OpenAICompatibleProvider } from '@fayegram-ai/decision-bridge/custom/generative';

const provider = new OpenAICompatibleProvider({
    baseURL: 'http://127.0.0.1:8000/v1',
    apiKey: null,                       // Explicitly allowed only for loopback.
    model: process.env.LOCAL_MODEL,     // Your locally served model ID.
    responseFormat: 'json_schema',      // Must be supported by that endpoint.
    tokenParameter: 'max_tokens',
});
const bridge = createBridge({ provider });
// await bridge.evaluate(theSameRequest);
```

The `custom/generative` entry point also exports the other presets. For OpenRouter, use `new OpenRouterProvider({ model: 'your-provider/your-model' })`
with `OPENROUTER_API_KEY`. For Anthropic, use
`new AnthropicProvider({ model: 'your-account-model-id' })` with
`ANTHROPIC_API_KEY`. Substitute real available model IDs; the bridge does not
choose an arbitrary remote model on your behalf.

A server may implement only JSON-object or text output. Select that mode explicitly
with `responseFormat: 'json_object'` or `'text'`; the client still validates every
answer. It never silently downgrades formats, repairs JSON, or changes models.

## Optional command runner

The installed package includes `decision-bridge` for working with request files.
The `decision` and `faye-decision` aliases run the same CLI with the same options.
Run it through npm from your application directory:

```bash
npm exec -- decision-bridge init ./my-decisions
npm exec -- decision-bridge validate ./my-decisions/request.json
```

These two commands are offline. To evaluate with a real account, copy the generated
`.env.example` to `.env` inside `my-decisions`, set the key, then run:

```bash
npm exec -- decision-bridge evaluate ./my-decisions/request.json --config ./my-decisions/decision.config.json --env-file ./my-decisions/.env
```

The runner uses explicit environment/configuration paths. See the
[command reference](docs/reference/CLI.md) for flags, streams, and exit codes.
Its built-in provider default is Jev; SDK construction requires explicit selection.

## What this repository produces

| Component | What you get |
| --- | --- |
| JavaScript SDK | Import `@fayegram-ai/decision-bridge` in your application; TypeScript declarations are included |
| Optional command runner | `decision-bridge`, `decision`, and `faye-decision`, all backed by `bin/decision.mjs` |
| npm package artifact | `npm run build` creates and verifies `release/fayegram-ai-decision-bridge-VERSION.tgz` |

For maintainers, `npm run build` archives the ESM source and verifies an offline
install of the exact tarball used for the npm release. See
[packaging and release](docs/development/RELEASING.md).

For running the source examples, see [source setup](docs/guides/GETTING_STARTED.md#run-from-a-source-checkout).
See [platform setup](docs/guides/PLATFORMS.md) for Windows/macOS/Linux details.

## What is included

The source checkout includes these runtime features and development tools. The npm
tarball contains the SDK, Node command, small examples, and maintained docs; it excludes the
test suite and development scripts.

| Area | Implementation |
| --- | --- |
| Stable contract | Runtime-defined [questions](docs/reference/SDK.md#question-builders), state, ordered input or conversation according to capabilities, typed answers, immutable results |
| Native providers | Jev, OpenAI Decisions, Cloudflare Clef/Clef-flash/Clef-omni |
| Custom providers | Separate decision and generative contracts; opt-in Chat Completions, OpenRouter, and Anthropic presets |
| SDK | Provider factory, [capability preflight](docs/reference/SDK.md#bridgegetcapabilitiesmodel-and-bridgevalidaterequest), [cancellation](docs/reference/SDK.md#cancellation-and-deadlines), and [ordered batch evaluation](docs/reference/SDK.md#sdk-batch-evaluation) |
| Dedicated operations | [Clairic extraction](docs/guides/EXTRACTION.md) and [Live Decisions](docs/guides/LIVE_DECISIONS.md), with separate exports and native results |
| Application extensions | [State/input/conversation preparation and result observation](docs/guides/CUSTOMIZATION.md), plus [choice thresholds and abstention policies](docs/guides/CUSTOMIZATION.md#application-policy-is-a-separate-stage) |
| Node command | [Decision/extraction commands and offline Live validation/replay](docs/reference/CLI.md#commands), with [explicit JSON profiles](docs/reference/CONFIGURATION.md) |
| Reliability | [Transport byte limits and fetch injection](docs/reference/SDK.md#provider-transport-options), deadlines, [limited retries and safe errors](docs/reference/ERRORS.md), strict response validation, atomic output |
| Development | Functional tests, coverage, TypeScript and Workers binding contracts, offline tarball-install checks, cross-platform CI configuration |

## Result semantics

`result` contains `answers`, `model`, `usage`, and `meta`. Native provider confidence is
preserved. `bridge.providerKind` and `result.meta.providerKind` distinguish
`'decision'` from `'generative'`; the bridge takes this classification from the
provider contract. Generative backends **do not invent confidence**; missing token counts
are `null`, not zero. Their choices and scores are derived from the returned
probability distributions. See [SDK reference](docs/reference/SDK.md) and
[provider compatibility](docs/reference/PROVIDERS.md).

This library does not execute the selected action, operate an agent loop, train a
model, enforce user authorization, or guarantee decision correctness. It is the
integration layer on which you can build those policies explicitly.

## Documentation

Start with the [documentation index](docs/README.md), including:

- [Getting started](docs/guides/GETTING_STARTED.md), [customization](docs/guides/CUSTOMIZATION.md), and [custom providers](docs/guides/CUSTOM_PROVIDERS.md), including [generative presets](docs/guides/CUSTOM_GENERATIVE.md).
- [SDK](docs/reference/SDK.md), [configuration](docs/reference/CONFIGURATION.md), [errors](docs/reference/ERRORS.md), and the optional [command runner](docs/reference/CLI.md).
- [Contributor documentation](docs/development/README.md) and [security](SECURITY.md).

## Project origins

Decision Bridge builds on the original
[Jev Adapter repository](https://github.com/Fayegram-AI/jev-adapter).
It carries forward the structured-decision SDK and CLI, with Jev supported
alongside the other providers.

## Contributing and verification

Start with [CONTRIBUTING.md](CONTRIBUTING.md). User guides and API references live
under `docs/guides/` and `docs/reference/`; maintained contributor documentation
lives under `docs/development/`. See the [repository layout](docs/development/REPOSITORY_LAYOUT.md)
for the source and package contents.

From a source checkout, run `npm run verify` for routine code, contract, and
package checks. `npm run test:coverage` reruns the functional suite with coverage
floors; the [release guide](docs/development/RELEASING.md) gives a single-pass
verification sequence. These software checks use synthetic fixtures and local
HTTP servers; they do not measure model quality. The
[testing guide](docs/development/TESTING.md) covers code and package checks plus
an optional live integration smoke check. Package preparation is described in the
[release guide](docs/development/RELEASING.md).
Public behavior changes are recorded in the [changelog](CHANGELOG.md).

## License

This project is licensed under the [MIT License](LICENSE).
