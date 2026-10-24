# Documentation

Start with [using the SDK in your application](../README.md#use-in-your-application)
for installation and a complete first call. Browse usage guides, API references,
and contributor documentation below. The
[getting started guide](guides/GETTING_STARTED.md#install-into-your-application)
covers the 0.1.4 release archive and npm installation.
The hosted playground is [Decision Playground](https://decision-pg.fayegram.com/).
See [model selectors and provider defaults](../README.md#model-selectors) for
built-in decision models and the separate custom generative presets.

Decision Bridge is a JavaScript SDK with an optional command runner. Choose a provider,
define your `questions`, and send the information to assess in exactly one of `state`,
ordered `input` or `conversation`. The provider must support the input form you choose.
The SDK validates the returned decisions. Extraction and Live have separate APIs and
request formats. For provider-specific input forms, consult the
[capability comparison](reference/PROVIDERS.md#common-request-capabilities). The common
bridge API and dedicated native APIs have separate request shapes; the Jev, OpenAI and
Cloudflare guides cover both.

## Version availability

These guides describe **0.1.4**. Use the documentation bundled with your installed
package. For earlier versions, consult the
[0.1.3 documentation](https://github.com/Fayegram-AI/decision-bridge/tree/decision-bridge-v0.1.3/docs)
and [0.1.2 documentation](https://github.com/Fayegram-AI/decision-bridge/tree/decision-bridge-v0.1.2/docs).

| Feature | First supported version |
| --- | --- |
| Configurable decision/extraction routing and CLI routing registries; auto mode is experimental | 0.1.4 |
| OpenAI conversation/tool history, remote images and prompt caching; Clairic extraction; Live Decisions | 0.1.3 |
| Experimental Jev images, boxes and long context | 0.1.2 |
| OpenAI `default`/`luna` model selectors | 0.1.1 |

See [installation](guides/GETTING_STARTED.md#install-into-your-application) for setup
and the [changelog](../CHANGELOG.md) for version history. Earlier APIs remain
supported in 0.1.4.

## Use the bridge

| Guide | Purpose |
| --- | --- |
| [Getting started](guides/GETTING_STARTED.md) | Package installation, credentials, JavaScript/TypeScript integration, and first evaluation |
| [Browser integration](guides/BROWSER.md) | Direct browser use, CORS requirements, and credential exposure |
| [Platforms](guides/PLATFORMS.md) | Windows, macOS, and Linux setup |
| [Switching models](guides/SWITCHING_MODELS.md) | Backend and model selection |
| [Configurable routing](guides/ROUTING.md) | Automatic or direct routes, eligibility, rules, selectors, clarification, recovery and registry configuration |
| [Jev](guides/JEV.md) | Common/native images, boxes, experimental long context, model selection, and CLI opt-ins |
| [OpenAI Decisions](guides/OPENAI_DECISIONS.md) | Model selectors, common/native access, conversation/tool history, remote images, cache controls and typed values |
| [Cloudflare Clef / Clef-flash / Clef-omni](guides/CLOUDFLARE_DECISIONS.md) | Common/native decisions, embedded images and Omni audio/video, REST and Workers AI binding, busy-mode compatibility, and optional Gateway |
| [Clairic extraction](guides/EXTRACTION.md) | Nine extraction/prediction types, REST/binding, native results and extraction CLI |
| [Live Decisions](guides/LIVE_DECISIONS.md) | Existing-connection controller, acknowledgements, correlation and offline replay |
| [Customization](guides/CUSTOMIZATION.md) | Questions, templates, extensions, and policies |
| [Custom providers](guides/CUSTOM_PROVIDERS.md) | Common classified contract and explicit CLI module loading |
| [Custom decision](guides/CUSTOM_DECISION.md) | Extend a native decision model protocol |
| [Custom generative](guides/CUSTOM_GENERATIVE.md) | Opt-in OpenAI-compatible, OpenRouter, Anthropic presets, strategy helpers, and new protocols |
| [Troubleshooting](guides/TROUBLESHOOTING.md) | Configuration, network, model, and output errors |

## Reference

| Document | Purpose |
| --- | --- |
| [SDK](reference/SDK.md) | Questions/results, exports and types, transport options, validation, cancellation, batching, extensions, and routers |
| [Command runner](reference/CLI.md) | Optional commands, routing inspection, flags, streams, and exit codes |
| [Configuration](reference/CONFIGURATION.md) | Single-provider profiles, routing registries, precedence, and credentials |
| [Providers](reference/PROVIDERS.md) | Protocols and probability provenance |
| [Errors](reference/ERRORS.md) | Error codes and retry behavior |
| [Sources](reference/SOURCES.md) | Primary protocol documentation |

## Contribute

Read [CONTRIBUTING.md](../CONTRIBUTING.md), then the
[contributor documentation](development/README.md) for architecture, design
choices, testing, and packaging. The
[repository layout](development/REPOSITORY_LAYOUT.md) explains source and package
contents.

The [security policy](../SECURITY.md) and [changelog](../CHANGELOG.md) cover
operational boundaries and public compatibility history.
