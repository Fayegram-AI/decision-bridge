# Command runner reference

The optional command runner evaluates files using the same bridge available in
the SDK. For application integration, start with the [SDK guide](../guides/GETTING_STARTED.md).

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

The CLI defaults to Jev. Flags override `DECISION_*` environment settings, which
override an explicit config file and then built-in defaults. It constructs an
explicit provider for the SDK; `createBridge` itself has no implicit selection.
Choose a supported native model from the
[model selector inventory](../../README.md#model-selectors).
Custom generative presets require an explicit model ID.

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
| `schema [FILE\|-]` | Print the generative response schema for these questions; local only |
| `models` | List the configured provider's models; may be paginated |
| `batch FILE\|-` | Stream JSONL inputs and ordered JSONL result/error records |

No input filename on `evaluate`, `validate`, or `schema` selects the bundled sample,
not stdin. Use `-` explicitly for stdin. Empty invocation prints help. Configuration
and credential errors do not cause fallback to another backend.

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

Preset initialization writes a ready-to-configure profile and credential
placeholders. An unselected custom implementation writes `provider.mjs` with an
explicit service implementation error until you connect it. An existing
`--provider-module` is referenced without execution or overwrite. All profiles
include a copied JSON Schema for editor validation. See [custom providers](../guides/CUSTOM_PROVIDERS.md).

OpenAI initialization writes the selected model into configuration, using `default`
when omitted. Its generated common and native requests omit `model`, allowing
later configuration changes to control selection.

## Flags

| Flag | Meaning |
| --- | --- |
| `--config FILE` | Explicit JSON configuration; never autodiscovered |
| `--env-file FILE` | Load an explicit environment file without changing the parent shell |
| `--provider NAME` | `jev`, `openai-decisions`, `cloudflare-decisions`, `custom-decision`, `custom-generative` |
| `--preset NAME` | custom-generative preset: `openai-compatible`, `openrouter`, or `anthropic`; exclusive with module |
| `--native` | Explicit native Decisions input/output; init/evaluate/validate/batch only |
| `--model SELECTOR` | Model selector or supported upstream ID; overrides input JSON model and configured default |
| `--base-url URL` | Custom endpoint; requires explicit credential selection |
| `--api-key-env NAME` | Environment variable name, never the key itself |
| `--account-id ID` | Cloudflare REST account ID |
| `--reject-if-busy`, `--no-reject-if-busy` | Explicit Cloudflare native-request override. Enabling fails local REST preflight with `UNSUPPORTED_CAPABILITY`; disabling permits ordinary inference. See the [REST limitation](../guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway) |
| `--gateway-id ID` | Existing Cloudflare Gateway; richer settings in config |
| `--no-auth` | Only for a loopback OpenAI-compatible endpoint |
| `--timeout-ms N` | HTTP and bridge deadline for each evaluation/listing |
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
| `--help`, `-h`, `--version`, `-v` | Informational commands |

Unknown or duplicate flags fail. Provider-inapplicable flags fail instead of being
ignored. `--model` wins over request.model; otherwise request.model wins over the
configured model. See [configuration](CONFIGURATION.md) for full precedence.

## JSON output contract

Single evaluation stdout is exactly the result object plus a newline. It is not
wrapped in a progress log or Markdown. Errors are `{ "error": { "code", "message",
... } }` on stderr. No debug stacks or raw HTTP error bodies are printed.

Native Decisions output is `{ decision, meta }`. OpenAI refused questions fail the
complete evaluation, with allowlisted refusal diagnostics and validated usage.

Common results include `meta.providerKind` from the provider contract. Offline
`validate` requires no credentials and never imports custom modules. Its JSON
includes `validationScope: 'provider'` for known native/preset profiles or
`'structure'` for a custom module. Structure validation cannot verify an unknown
module's capabilities or protocol. `schema` is an offline generative-output tool;
it does not add generative support to a native provider.

A batch emits one compact record per nonblank input line:

```text
{"line":1,"ok":true,"result":{...}}
{"line":2,"ok":false,"error":{"code":"VALIDATION_ERROR","message":"..."}}
```

This is a schematic shape, not an inference example. `line` is the original
one-based physical line number, including blank lines in the numbering. Blank
lines produce no record. Malformed JSON on a single line is a failed record and
processing continues. Evaluation failures likewise remain explicit records.

The CLI streams input with a bounded, ordered window. A completed oldest result
is emitted even when stdin remains open and the producer has not sent another
line; the window does not have to fill before output begins. A slow earlier request can
hold back emission and dispatch even when later requests finish; this prioritizes
bounded memory and stable ordering over maximum throughput. Up to `concurrency`
requests may already be running when a failure is encountered. There is no CLI
`stopOnError` flag; the SDK array batch API provides that policy.

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

Both signals are handled as cancellation by this CLI; it intentionally does not
use 143 for SIGTERM. Cancellation also interrupts a blocked stdout write. The
POSIX subprocess SIGINT check is excluded on Windows, where console signal
delivery needs separate validation.

## I/O and resource limits

Single JSON input: **8 MiB**. JSONL: **8 MiB per line, 64 MiB total**. Config:
**1 MiB**. Environment file: **64 KiB**. Provider request and response default to
8 MiB each, configurable to at most 64 MiB. Cloudflare reads single JSON inputs
and individual JSONL records within 64 MiB, then applies model-specific serialized
request validation: Clef/Clef-flash default/cap 13 MiB; Omni default 36 MiB,
configurable through 64 MiB. Explicit smaller ceilings remain in force. Request
model overrides and mixed-model JSONL batches use each effective model's budget.
The 64 MiB JSONL total remains. These are client limits, not a promise
that every remote model has an equivalent context window.

Per-line limits exclude LF or CRLF delimiters, regardless of stream chunking.
A final record may omit its newline; its complete bytes must still fit the limit.
The total input limit includes delimiters.

Output files are written to a same-directory exclusive temporary file with mode
0600, synced, then committed. Existing paths are protected unless `--force` is
explicit. A batch containing ordinary failed records still produces a complete
JSONL file and exits 1. A global failure removes the unfinished temporary output.
Stdout cannot be rolled back and may contain a valid prefix after interruption.
No parent output directories are created automatically. Filesystems without hard
link support can reject no-clobber finalization; the error is explicit. File mode
and atomic filesystem semantics remain operating-system/filesystem dependent.

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
