# Documentation

Start with [using the SDK in your application](../README.md#use-in-your-application)
for installation and a complete first call. This index separates usage guides,
API reference, and contributor documentation.
Install `@fayegram-ai/decision-bridge` with npm; the
[getting started guide](guides/GETTING_STARTED.md#install-into-your-application)
also covers installation from a verified archive.
The hosted playground is [Decision Playground](https://decision-pg.fayegram.com/).
See [model selectors and provider defaults](../README.md#model-selectors) for
built-in decision models and the separate custom generative presets.

Decision Bridge is a JavaScript SDK with an optional command runner. It evaluates
supplied `state` or ordered `input`, plus `questions`, with an explicitly selected
provider and returns
validated, structured decisions.
For provider-specific input forms, consult the
[capability comparison](reference/PROVIDERS.md#common-request-capabilities).
The common bridge API and dedicated native APIs have separate request shapes;
the Jev, OpenAI and Cloudflare guides cover both.

## Use the bridge

| Guide | Purpose |
| --- | --- |
| [Getting started](guides/GETTING_STARTED.md) | Package installation, credentials, JavaScript/TypeScript integration, and first evaluation |
| [Browser integration](guides/BROWSER.md) | Direct browser use, CORS requirements, and credential exposure |
| [Platforms](guides/PLATFORMS.md) | Windows, macOS, and Linux setup |
| [Switching models](guides/SWITCHING_MODELS.md) | Backend and model selection |
| [Jev](guides/JEV.md) | Common/native images, boxes, experimental long context, model selection, and CLI opt-ins |
| [OpenAI Decisions](guides/OPENAI_DECISIONS.md) | Model selectors and upstream targets, selection metadata, common/native access, ordered images, and typed values |
| [Cloudflare Clef / Clef-flash / Clef-omni](guides/CLOUDFLARE_DECISIONS.md) | Common/native decisions, embedded images and Omni audio/video, REST and Workers AI binding, busy-mode compatibility, and optional Gateway |
| [Customization](guides/CUSTOMIZATION.md) | Questions, templates, extensions, and policies |
| [Custom providers](guides/CUSTOM_PROVIDERS.md) | Common classified contract and explicit CLI module loading |
| [Custom decision](guides/CUSTOM_DECISION.md) | Extend a native decision model protocol |
| [Custom generative](guides/CUSTOM_GENERATIVE.md) | Opt-in OpenAI-compatible, OpenRouter, Anthropic presets, strategy helpers, and new protocols |
| [Troubleshooting](guides/TROUBLESHOOTING.md) | Configuration, network, model, and output errors |

## Reference

| Document | Purpose |
| --- | --- |
| [SDK](reference/SDK.md) | Questions/results, exports and types, transport options, validation, cancellation, batching, extensions, and policies |
| [Command runner](reference/CLI.md) | Optional commands, flags, streams, and exit codes |
| [Configuration](reference/CONFIGURATION.md) | Precedence, credentials, and profiles |
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
