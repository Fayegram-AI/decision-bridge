# Command runner reference

The optional command runner evaluates decision files, runs Clairic extraction,
and validates or replays Live protocol records offline. For application
integration, start with the [SDK guide](../guides/GETTING_STARTED.md).

Routing registries and inspection require **0.1.4**. Extraction and Live commands
require **0.1.3 or later**; see
[version availability](../README.md#version-availability).

After [installing the package](../guides/GETTING_STARTED.md#install-into-your-application)
in your project, run:

```bash
npm exec -- decision-bridge --help
npm exec -- decision-bridge validate
```

The examples below use `decision-bridge` as shorthand: prefix it with `npm exec --`
for a local installation, use it directly after a global installation, or replace
it with `node bin/decision.mjs` from a source checkout. `decision` and
`faye-decision` are equivalent aliases with the same commands and options.
`--help` and `--version` do not access credentials or services.

With a single-provider profile, decision commands default to Jev. Extraction commands
default to `cloudflare-extraction` when no provider is selected. Flags override
`DECISION_*` environment settings, then the named config file, then built-in defaults.
The CLI resolves these settings before constructing a provider; SDK applications must
select a provider when calling `createBridge`. Choose a supported native model from the
[model selector inventory](../../README.md#model-selectors). Custom generative presets
require an explicit model ID. Routing registries select configured
targets through `defaultRoute` or `--route`; see
[routing registries](#routing-registries).

## Commands

`--provider openai-decisions` selects OpenAI Decisions; `--provider cloudflare-decisions`
selects Clef. Add `--native`
for native request/response structures on `init`, `evaluate`, `validate`, or
`batch`; input mode is never inferred. Native calls require an explicit input file
or `-`. See [OpenAI Decisions](../guides/OPENAI_DECISIONS.md) and
[Cloudflare Clef](../guides/CLOUDFLARE_DECISIONS.md) for examples. Both providers report
model listing as unsupported.
OpenAI model selection defaults to `default`; use `--model luna` for the Luna
family or an explicit supported upstream ID. Both stable selectors currently
resolve to `gpt-6-luna` within Decision Bridge. OpenAI `validate` reports the
selected value in `model` and the outgoing ID in `resolvedModel`, without credentials.
Successful common and native calls include `meta.requestedModel` and
`meta.resolvedModel`; response models retain the service-reported identity.
Cloudflare CLI execution uses REST. The Workers AI binding is an SDK transport;
there is no CLI binding selector. Gateway settings route the selected REST request.

| Command | Behavior |
| --- | --- |
| `init [DIRECTORY]` | Create config and schema, sample request, environment template, and gitignore; generate a custom module when needed; never overwrite |
| `evaluate [FILE\|-]` | One evaluation; aliases `eval` and `ask` |
| `validate [FILE\|-]` | Validate input locally; does not call a provider |
| `inspect FILE\|- --config FILE` | Report routing eligibility and selection without inference |
| `schema [FILE\|-]` | Print the generative response schema for these questions; local only |
| `models` | List the configured provider's models; may be paginated |
| `batch FILE\|-` | Stream JSONL inputs and ordered JSONL result/error records |
| `extraction run FILE\|-` | One native extraction; returns `{ extraction, meta }` |
| `extraction validate FILE\|-` | Offline structural and client-budget validation |
| `extraction inspect FILE\|- --config FILE` | Inspect configured extraction routes offline |
| `extraction batch FILE\|-` | Ordered extraction JSONL results and per-row errors |
| `extraction init [DIRECTORY]` | Create an extraction profile, request, schema and credential template |
| `live validate FILE\|- --kind config\|command\|event` | Offline Live structure validation |
| `live replay FILE\|-` | Offline JSONL protocol replay; no connection is opened |

Jev supports both common and `--native` requests for evaluation, validation,
initialization, and ordered batches. Experimental images/boxes require
`--jev-images`, and longer context requires `--jev-long-context` (or matching
JSON configuration). Use `--no-jev-images` and `--no-jev-long-context` to
override enabled settings. See the [Jev guide](../guides/JEV.md).

When using a single-provider profile, omitting the input file for `evaluate`, `validate`
or `schema` uses the bundled sample. Pass `-` to read from stdin. Empty invocation
prints help. Configuration and credential errors do not cause fallback to another
backend. Extraction and Live file operations require an explicit filename or `-`.
Extraction rejects `--native` because its request already uses native fields.

```bash
cat request.json | decision-bridge evaluate - --env-file .env --compact
decision-bridge evaluate request.json --env-file .env --output result.json
decision-bridge batch requests.jsonl --env-file .env --concurrency 4 --output results.jsonl
```

On PowerShell, `Get-Content -Raw request.json | decision-bridge evaluate - --env-file .env`
is an alternative for stdin. File arguments avoid shell encoding differences.

## Custom initialization

```bash
decision-bridge init ./my-model --provider custom-generative --preset openrouter --model VENDOR/MODEL_ID
decision-bridge init ./my-service --provider custom-decision
decision-bridge init ./my-protocol --provider custom-generative
```

Preset initialization writes a ready-to-configure profile and credential placeholders.
If no custom implementation is selected, `init` writes a `provider.mjs` template. Its
service call throws an error until you implement it. An existing `--provider-module` is
referenced without execution or overwrite. All profiles include a copied JSON Schema for
editor validation. See [custom providers](../guides/CUSTOM_PROVIDERS.md).

OpenAI initialization writes the selected model into configuration, using `default`
when omitted. Its generated common and native requests omit `model`, allowing
later configuration changes to control selection.

## Routing registries

Auto mode (`--route auto` or a configured `defaultRoute: 'auto'`) is experimental
in 0.1.4 for both deterministic and decision-assisted policies.

Create a registry template with `init DIRECTORY --route auto`, or
`extraction init DIRECTORY --route auto`. Load it explicitly on later commands:

```bash
decision-bridge inspect request.json --config routes.json
decision-bridge validate request.json --config routes.json
decision-bridge evaluate request.json --config routes.json --env-file .env
decision-bridge evaluate request.json --config routes.json --route primary --env-file .env
decision-bridge batch requests.jsonl --config routes.json --no-routing-prompt
```

The same commands work under `extraction`, where `run` aliases `evaluate`.
Routed commands require a request filename or `-`; they do not use the bundled
sample. `models`, `schema`, and `--native` are unavailable with a registry.
Single-provider override flags are rejected, and legacy `DECISION_*` selection
variables are ignored. Set provider/model/transport fields in each route's
configuration. See [routing configuration](CONFIGURATION.md#routing-registries-version-2)
for the `schemaVersion: 2` file format.

`inspect` and `validate` perform no inference, module imports, or prompts. The report
includes `routes`, `eligible`, `provisional`, `validationScope` and `outcome`, plus
missing selector settings when relevant. `validate` adds `valid: true` unless the
outcome is known to be impossible. An unresolved or provisional report still requires
execution-time validation.

With terminal stdin and stderr and a request file, ambiguous selection can prompt
on stderr; stdout remains JSON/JSONL. `--interactive` requires those terminal
conditions. `--no-interactive` or `--no-routing-prompt` suppresses clarification.
Stdin request input is unattended. EOF cancels clarification, including later
batch rows. Choices apply to one request and never rewrite the registry.
See the [routing guide](../guides/ROUTING.md) for policy and selector requirements.

## Flags

| Flag | Meaning |
| --- | --- |
| `--config FILE` | Explicit JSON configuration; never autodiscovered |
| `--env-file FILE` | Load an explicit environment file without changing the parent shell |
| `--route ID` | Select `auto` or a concrete route in a routing registry; `init --route auto` creates a registry template |
| `--interactive` | Enable terminal clarification when needed; requires terminal stdin/stderr and a request file |
| `--no-interactive`, `--no-routing-prompt` | Suppress routing clarification and enforce unattended selector requirements |
| `--provider NAME` | `jev`, `openai-decisions`, `cloudflare-decisions`, `cloudflare-extraction` (extraction namespace), `custom-decision`, `custom-generative` |
| `--preset NAME` | custom-generative preset: `openai-compatible`, `openrouter`, or `anthropic`; exclusive with module |
| `--native` | Explicit native Decisions input/output; init/evaluate/validate/batch only |
| `--jev-images`, `--no-jev-images` | Enable/disable experimental Jev images and boxes |
| `--jev-long-context`, `--no-jev-long-context` | Enable/disable experimental Jev 262k context |
| `--model SELECTOR` | Model selector or supported upstream ID; overrides input JSON model and configured default |
| `--base-url URL` | Custom endpoint; requires explicit credential selection |
| `--api-key-env NAME` | Environment variable name, never the key itself |
| `--account-id ID` | Cloudflare REST account ID |
| `--reject-if-busy`, `--no-reject-if-busy` | Override Cloudflare request/provider busy settings. Enabling fails Clef REST preflight; Clairic forwards the setting. See the [Clef REST limitation](../guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway) |
| `--gateway-id ID` | Existing Cloudflare Gateway; richer settings in config |
| `--no-auth` | Only for a loopback OpenAI-compatible endpoint |
| `--timeout-ms N` | Single-provider HTTP and bridge deadline for each evaluation/listing; registry budgets belong in configuration |
| `--retries N` | Additional eligible HTTP attempts; 0–10; native OpenAI/Cloudflare default to 0, Jev and generative presets to 2 |
| `--max-tokens N` | Generative output budget; default 4096 |
| `--response-format MODE` | `json_schema`, `json_object`, or `text`; compatible generative presets only |
| `--token-parameter NAME` | `max_completion_tokens` or `max_tokens` |
| `--provider-module FILE` | Explicit trusted ESM module; requires custom-decision or custom-generative |
| `--input FILE` | Alternative to positional request filename |
| `--output FILE`, `-o FILE` | Atomic file output; `-` means stdout |
| `--force` | Replace existing output; valid only with `--output` |
| `--concurrency N` | Batch in-flight limit 1–64; default 4 |
| `--pretty`, `--compact` | JSON formatting; pretty by default; batches always JSONL |
| `--kind config\|command\|event` | Required by `live validate`; rejected by other commands |
| `--help`, `-h`, `--version`, `-v` | Informational commands |

Unknown or duplicate flags fail. Provider-inapplicable flags fail instead of being
ignored. In single-provider mode, `--model` wins over request.model; otherwise
request.model wins over the configured model. Routing uses request.model as a
target constraint. See [configuration](CONFIGURATION.md) for full precedence.

## JSON output contract

Single evaluations write the result object followed by a newline to stdout.
Errors are `{ "error": { "code", "message",
... } }` on stderr. No debug stacks or raw HTTP error bodies are printed.

Native Decisions output is `{ decision, meta }`. OpenAI refused questions fail the
complete evaluation, with allowlisted refusal diagnostics and validated usage.

Common results include `meta.providerKind` from the provider contract. Routed results
also include `meta.routing`; routed failures can include `error.routing`. With a
single-provider profile, offline `validate` needs no credentials and does not import
custom modules. Its JSON includes `validationScope: 'provider'` for known native/preset
profiles or `'structure'` for a custom module. Structure validation cannot verify an
unknown module's capabilities or protocol. `schema` is an offline generative-output
tool; it does not add generative support to a native provider. Decision validation
reports `operation: 'decision'` and `questionCount`; extraction reports
`operation: 'extraction'` and `fieldCount`. Neither checks account access or guarantees
that the service will accept the request. Live validation reports its `kind` and
`validationScope: 'structure'`.

A batch emits one compact record per nonblank input line:

```text
{"line":1,"ok":true,"result":{...}}
{"line":2,"ok":false,"error":{"code":"VALIDATION_ERROR","message":"..."}}
```

The example above shows the record format. `line` is the original one-based physical
line number, including blank lines in the numbering. Blank lines produce no record.
Malformed JSON on a single line is a failed record and processing continues. Evaluation
failures likewise remain explicit records.

The CLI processes a limited number of rows at a time and emits results in input order.
It writes a result as soon as that row and all earlier rows are complete, even if stdin
is still open and no new line has arrived. A slow earlier request can hold back emission
and dispatch even when later requests finish; this prioritizes bounded memory and stable
ordering over maximum throughput. Up to `concurrency` requests may already be running
when a failure is encountered. There is no CLI `stopOnError` flag; the SDK array batch
API provides that policy.

Invalid UTF-8, input-size violations, unreadable input, or interrupted execution are
global failures. Work already sent to a provider may have been billed. Do not assume
that a failed batch sent no requests: unlike the SDK array API, streaming CLI input
is not entirely prevalidated before execution.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success; also a closed downstream pipe (EPIPE) |
| 1 | Provider/evaluation failure or at least one failed batch record |
| 2 | Usage, input, configuration, or filesystem failure |
| 130 | Caller interruption/cancellation, including handled SIGINT/SIGTERM |

The CLI handles both SIGINT and SIGTERM as cancellation with exit code 130.
Cancellation also interrupts a blocked stdout write.

## I/O and resource limits

Single JSON input normally uses **8 MiB**. JSONL normally uses **8 MiB per line,
64 MiB total**. Jev defaults to **32 MiB** for a single JSON input or JSONL record,
then checks serialized requests against its configured ceiling (32 MiB by default).
An explicit larger client request budget raises the input reader budget through 64 MiB.
Config:
**1 MiB**. Environment file: **64 KiB**. Provider request and response default to
8 MiB each, configurable to at most 64 MiB. Cloudflare reads single JSON inputs
and individual JSONL records within 64 MiB, then applies model-specific serialized
request validation: Clef/Clef-flash default 13 MiB, configurable through 64 MiB; Omni default 36 MiB,
configurable through 64 MiB; Clairic defaults to 8 MiB, configurable through 64 MiB.
Explicit smaller ceilings remain in force. Request
model overrides and mixed-model JSONL batches use each effective model's budget.
The 64 MiB JSONL total remains. These are client limits, not a promise
that every remote model has an equivalent context window.

Per-line limits exclude LF or CRLF delimiters, regardless of stream chunking.
A final record may omit its newline; its complete bytes must still fit the limit.
The total input limit includes delimiters.

Routing registries use a 64 MiB input ceiling for single JSON inputs and each
JSONL record, with the same 64 MiB total JSONL limit. Each candidate's provider
preflight then enforces its configured serialized request and media limits.

The CLI writes output to a new temporary file in the destination directory, uses mode
0600 where supported, syncs it, and then creates the final file. It protects existing
output unless you pass `--force`. A batch containing ordinary failed records still
produces a complete JSONL file and exits 1. A global failure removes the unfinished
temporary output. Stdout cannot be rolled back and may contain a valid prefix after
interruption. No parent output directories are created automatically. Filesystems
without hard link support can reject no-clobber finalization; the error is explicit.
File mode and atomic filesystem semantics remain operating-system/filesystem dependent.

## Input and cancellation boundaries

String-valued flags cannot be empty or whitespace-only, including `--config`,
`--env-file`, `--input` and `--output`. Such values return `USAGE_ERROR` before
configuration loading or paid calls, rather than selecting an unintended default.
Valid paths with embedded spaces remain supported.

The input/output check resolves existing paths and file identities, so directory
symlinks/junctions and hard-link aliases cannot bypass the input-overwrite guard.
This is an accidental-overwrite safeguard, not a filesystem sandbox against
another process racing to change paths.

Already-cancelled CLI work does not initialize a project or create an output file.
File writers check cancellation before writes and before submitting the atomic
commit. A commit already submitted to the operating system cannot be undone;
cancellation does not roll back a completed write or remote inference billing.

## Offline Live tools

Live tools load no provider configuration, environment files or credentials and
open no connection. They accept input/output and formatting flags; `--kind` is
required only for validation. Replay always emits compact JSONL.

Replay input records are `{ direction: 'client' | 'server', event }`. Each row
produces `{ line, ok, event }` or `{ line, ok: false, error }` using the same
correlation state as the SDK controller. Malformed rows remain explicit errors
and later rows are processed. A closed session ends that replay lifecycle;
subsequent protocol rows fail with `CONNECTION_CLOSED`.

Malformed event-file validation reports `VALIDATION_ERROR` and exits 2. Malformed
server replay rows retain `INVALID_RESPONSE`; any failed row makes replay exit 1.
See the [Live guide](../guides/LIVE_DECISIONS.md) for correlation guarantees and
the [extraction guide](../guides/EXTRACTION.md) for native extraction requests.
