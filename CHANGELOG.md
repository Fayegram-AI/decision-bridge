# Changelog

## 0.1.4

- Add the `/routing` SDK for direct selection and experimental auto routing of
  decisions and extraction, with enabled targets, capability filtering, rules,
  priorities and optional decision-model selection.
- Add request preparation, application and terminal clarification, ordered
  batches, separate time budgets, bounded failover, cooldowns and usage diagnostics.
- Add version-2 CLI registries, `--route`, offline inspection, initialization
  templates and TypeScript APIs; retain version-1 configuration support.
- Refresh SDK, provider, configuration and troubleshooting documentation for 0.1.4.

## 0.1.3

- Expand OpenAI Decisions with conversation/tool history, remote images and
  prompt caching, including common input, extensions and schema version 5.
- Add Clairic extraction over REST and Workers bindings, with nine field types,
  native predictive metadata and extraction CLI commands.
- Add an existing-connection Live Decisions controller and offline protocol
  validation/replay tools through a dedicated package export.
- Leave service quotas and admission ceilings upstream; preserve explicit client
  resource budgets and improve safe errors and error-aware retries.
- Preserve requested Clairic model aliases in batch diagnostics and parse valid
  retry hints without losing HTTP status or safe IDs when an error body fails.
- Harden Live configuration/history correlation, transcript ordering, item
  acknowledgements, observer isolation, cancellation and connection cleanup.
  Offline event validation and replay retain their respective input/server error
  contracts.
- Document the expanded SDK and CLI APIs, extraction and Live operations, and
  client resource controls.

## 0.1.2

- Add opt-in Jev images, typed bounding boxes, native JSON assets, and long context
  across SDK and CLI, with capability preflight and nullable token usage.

## 0.1.1

- Add OpenAI `default`/`luna` selectors and requested/resolved model metadata; improve CLI configuration and documentation.

## 0.1.0

Initial release of Decision Bridge as `@fayegram-ai/decision-bridge`.

### SDK and providers

- Provider-neutral `createBridge` interface with explicit provider selection,
  immutable requests/results, typed questions, capability preflight, context
  preparation, bounded observations, and ordered batch evaluation.
- Native Jev, OpenAI Decisions, and Cloudflare Clef/Clef-flash/Clef-omni providers, alongside
  explicit custom decision and generative paths. General-purpose adapters are
  retained as maintained OpenAI-compatible, OpenRouter, and Anthropic presets in
  `custom/generative`; the root factory and exports are native-only.
- Required decision/generative provider classification, authoritative
  `providerKind` metadata, definition helpers, and generative provenance validation.
- Explicit CLI custom kinds with preset/module selection, initialization templates,
  editor JSON Schema, and structure-only module validation without execution.
- Common/native OpenAI and Cloudflare access, ordered embedded images, typed
  string/boolean choices, labelled score rubrics, and preserved native values.
- Clef-omni common/native WAV/MP3 audio and MP4/WebM video, grouped media ordering,
  bounded container/duration inspection, and audio/video result schema version 3.
  Omni defaults to a 36 MiB client request budget, configurable through 64 MiB;
  older Clef models retain 13 MiB. Effective request models select their own
  budgets without enlarging explicit smaller ceilings.
- Cloudflare REST and Workers AI binding transports, binding capacity rejection,
  optional AI Gateway controls on both transports, and provider-selected
  four-decimal probability allowance.
  Enabled Clef/Clef-flash/Clef-omni REST busy options fail local preflight with
  `UNSUPPORTED_CAPABILITY`, preventing predictably rejected inference requests; see the
  [Cloudflare compatibility notes](docs/guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway).
- Shared Cloudflare Gateway validation enforces 64-character names, cache TTL
  from 60 seconds through 30 days, and at most five metadata entries without
  caller-supplied `cf.*` keys. Invalid settings fail before dispatch; metadata
  is never silently truncated or stripped.
- Choice policies accept explicit provider probability precision; OpenAI Decisions
  preflight enforces its documented 2–255 choice-option range.
- Explicit native/elicited probability provenance and reported token accounting;
  missing common usage remains null and generative confidence is not fabricated.
- Generative presets reserve tool/function controls, including legacy `functions`
  and `function_call`, with matching CLI editor and runtime validation.
- Invalid async capability hooks raise configuration errors without leaving
  rejected promises unobserved or dispatching inference.
- Custom decision provenance labels are validated as nonempty strings, while
  preserving service-specific labels and provider defaults.
- Exported generative prompt and normalization helpers validate their complete
  request profile, rejecting unsupported input instead of discarding it.
- Bounded requests/responses, cancellation, end-to-end deadlines, conservative
  retries, strict response validation, and safe structured DecisionError details.
- Response-body deadlines also cover continuously ready streams; fragmented
  responses use bounded byte storage. Model-list snapshots reject accessors
  before reading their values.
- Choice policies reject sparse abstention arrays and accessor entries before
  applying thresholds or abstention rules.

### CLI and distribution

- `decision-bridge`, `decision`, and `faye-decision` commands for initialization, evaluation,
  offline validation, generative schemas, supported model listing, and ordered
  JSONL batches with common/native decision dispatch.
- CLI settings retain flags, environment, explicit JSON config, and default
  precedence, including custom module request models and resolved module identity.
  Its built-in provider default is Jev.
- JSONL record limits remain consistent when CRLF delimiters arrive in separate
  chunks, without expanding the per-record or total input ceilings.
- Cloudflare CLI reads within 64 MiB, then uses model-specific SDK preflight for
  embedded media, per-request overrides, and mixed-model batches. The JSONL total
  cap remains 64 MiB and the configuration schema remains version 1.
- ESM source, browser-safe SDK imports, TypeScript declarations, Node.js 22.16+,
  MIT licensing, and zero runtime dependencies.
- Consumer/provider guides, examples, cross-platform CI, functional/type checks,
  and verification by offline installation of the exact npm tarball.
