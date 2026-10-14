# Changelog

Notable user-facing changes by version.

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
