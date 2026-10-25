# Configuration and credentials

Use a single-provider profile to configure one backend, or a routing registry to
define named targets and a selection policy. Profiles use `schemaVersion: 1`
(optional); registries require `schemaVersion: 2` and Decision Bridge 0.1.4 or later.
See [version availability](../README.md#version-availability).

## Single-provider profiles (version 1)

```json
{
  "$schema": "./decision.config.schema.json",
  "schemaVersion": 1,
  "provider": "jev",
  "model": "jev-latest",
  "apiKeyEnv": "TYPESAFE_API_KEY",
  "timeoutMs": 30000,
  "maxRetries": 2
}
```

Load it with `--config path/to/decision.config.json` and load credentials with
`--env-file .env`. Both files must be named explicitly. SDK applications configure
providers through constructor options.

Jev is the CLI's built-in provider default. In SDK code, `createBridge` requires
an explicit `provider` or `jev` selection, and `createProvider` requires `type`.
Provider-specific model defaults apply after that selection. Root SDK selection
is native-only. Generative presets use `createGenerativeProvider` from the
`custom/generative` subpath. CLI custom modules declare their kind explicitly.

`init` copies the configuration JSON Schema beside the generated config and adds
`$schema` for editor completion. The packaged schema is available at
`@fayegram-ai/decision-bridge/config.schema.json` and in
[schemas/decision.config.schema.json](../../schemas/decision.config.schema.json). The
schema checks profile structure. Before execution, runtime validation also checks the
endpoint, credentials, supported features and encoded request size. Cloudflare CLI
configuration always selects REST. Inject a Workers AI binding through the SDK's
`CloudflareDecisionsProvider` or `CloudflareExtractionProvider` constructor instead of a
JSON profile. Gateway configuration is optional for either SDK transport and for CLI
REST.

| Field | Values / scope |
| --- | --- |
| `$schema` | Optional nonempty schema reference for editors |
| `schemaVersion` | 1; optional, but generated profiles include it |
| `provider` | `jev` default for decision commands, `openai-decisions`, `cloudflare-decisions`, `cloudflare-extraction` for extraction commands, `custom-decision`, `custom-generative` |
| `preset` | `custom-generative` only: `openai-compatible`, `openrouter`, `anthropic`; mutually exclusive with module |
| `model` | Nonempty model selector or supported upstream ID; built-in native providers have defaults; required for generative evaluation unless the request supplies it |
| `baseURL` | HTTPS API base; loopback may use HTTP |
| `apiKeyEnv` | Credential environment variable name; inline `apiKey` is rejected |
| `noAuth` | Boolean; true only for loopback OpenAI-compatible endpoints |
| `timeoutMs` | Positive integer up to 2,147,483,647 milliseconds |
| `maxRetries` | Integer 0–10; OpenAI/Cloudflare default 0; Jev and generative presets default 2 |
| `maxRequestBytes`, `maxResponseBytes` | Positive integer through 64 MiB; default 8 MiB, including Clairic. Jev requests default 32 MiB. Clef/Clef-flash requests default 13 MiB; Omni 36 MiB. Explicit request budgets can select through 64 MiB for every built-in provider |
| `accountId` | Cloudflare REST account ID; otherwise `CLOUDFLARE_ACCOUNT_ID` |
| `rejectIfBusy` | Cloudflare boolean; default false, incompatible with retries. Effective true fails Clef REST preflight with `UNSUPPORTED_CAPABILITY`; Clairic forwards the setting for server acceptance/rejection. See the [Clef limitation](../guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway) and [extraction options](../guides/EXTRACTION.md#images-binding-and-gateway) |
| `gateway` | Cloudflare Gateway object; see the [Cloudflare guide](../guides/CLOUDFLARE_DECISIONS.md) |
| `dangerZone` | Jev-only `{ images?: boolean, longContext?: boolean }`; both default false; see the [Jev guide](../guides/JEV.md) |
| `maxTokens` | Generative output budget, 1–1,048,576; default 4096 |
| `responseFormat` | Compatible presets: `json_schema`, `json_object`, `text`; Anthropic modes: `tool` (default), `json_schema` |
| `apiVersion` | Anthropic-only option: `2023-06-01` (default) or `2026-10-21` |
| `tokenParameter` | Compatible generative presets: `max_completion_tokens` or `max_tokens` |
| `parameters` | Extra JSON generation parameters, excluding bridge-controlled fields |
| `module` | Required for custom-decision; alternative to preset for custom-generative; explicit local ESM file |
| `options` | Custom factory's JSON options, e.g. its own baseURL |

These upper bounds define valid client settings. A service or model may impose smaller
limits. Jev requests default to a 32 MiB client budget; an explicit `maxRequestBytes`
can select a budget through 64 MiB. `DECISION_JEV_IMAGES` and
`DECISION_JEV_LONG_CONTEXT` accept `true` or `false`; their CLI overrides are
`--jev-images`, `--no-jev-images`, `--jev-long-context`, and `--no-jev-long-context`.
Cloudflare selects its byte budget from the effective request model, including per-call
overrides. An explicit smaller `maxRequestBytes` remains the ceiling; selecting Omni
cannot enlarge it. This is a client resource limit; service limits apply separately.
Provider-specific unused fields are rejected. In a module profile,
transport and generation settings belong inside `options`; the custom factory owns them.
Top-level `timeoutMs` still bounds the bridge. The module may implement its own
networking.

`parameters` cannot override model, messages, system instructions, schemas, tools,
streaming, token-limit fields, or credentials. Legacy `functions` and
`function_call` controls are also reserved. Unrecognized model-specific
parameters may be rejected by the server; the SDK does not silently drop them.

## Precedence

For single-provider settings:

```text
CLI flags > DECISION_* environment variables > explicit JSON file > defaults
```

For credentials loaded from an explicit environment file:

```text
existing process environment > --env-file values
```

Loading an environment file does not change the process environment. SDK provider
constructors read their documented credential variables from that environment.

The [model selector list](../../README.md#model-selectors) records native
selectors and defaults. Configuration precedence does not expand a
provider's accepted models or grant account access.

For evaluation model selection:

```text
--model > request.model > resolved config/environment model > provider default
```

Jev defaults to `jev-latest`, with `JEV_MODEL` as a legacy/direct convenience.
Native OpenAI Decisions defaults to `default` and accepts `luna` or explicit
`gpt-6-luna`; Decision Bridge currently resolves each to upstream `gpt-6-luna`.
OpenAI accepts transport settings
and rejects generative output settings. Its default retry count is zero. Cloudflare Clef defaults to `clef`, uses
account/token credentials, rejects generation settings, and also defaults to zero retries.
A `DECISION_MODEL` or file model takes precedence over `JEV_MODEL`.
Custom generative presets and modules do not inherit a
Jev model. Offline validation of a generative/module request without a model reports
`model: null`; evaluation requires a request model or provider default.

The CLI merges each configuration layer separately. If a higher-priority layer selects a
different provider, preset or module, it discards the implementation settings inherited
from lower-priority layers: endpoint, key selector, model, generation parameters,
transport retries/byte limits, preset/module/options, and Cloudflare
account/busy/Gateway settings. Only `timeoutMs` is shared. This keeps credentials and
protocol settings from carrying over to a different implementation. Overrides for the
same implementation keep compatible settings. Supply the settings for the new
implementation when switching. A module-to-preset or preset-to-module switch clears the
old selector. Module identity uses the resolved file path: a file-relative module and a
working-directory-relative flag retain settings only when both identify the same file.

## Routing registries (version 2)

Auto mode is experimental, including deterministic and decision-assisted
policies.

Set `schemaVersion: 2` and load the registry with `--config`. Provider settings
belong inside each concrete route's `config`, using the profile fields above,
including `provider` and `apiKeyEnv`. The reserved `routes.auto` entry contains
selection policy. See the [routing guide](../guides/ROUTING.md#cli-registry-configuration)
for a complete configuration and commands.

| Top-level field | Purpose |
| --- | --- |
| `$schema` | Optional editor schema reference |
| `schemaVersion` | Required value `2` |
| `routes` | Concrete provider configurations and optional `auto` policy |
| `defaultRoute` | Configured ID or `auto`; otherwise supply `--route` |
| `policyRevision` | Optional application policy identifier included in diagnostics |
| `workTimeoutMs` | Cumulative preparation, selection, execution and recovery budget; default 60,000 ms |
| `clarificationTimeoutMs` | Active clarification budget, excluding queue time; default 300,000 ms |
| `observerTimeoutMs` | SDK observation budget; default 1,000 ms; JSON cannot define an observer callback |

Concrete route settings include `enabled`, `required`, `operation`, `description`,
`allowGenerative`, `singleDispatch`, and `cooldownGroup`. Disabled targets need no
credentials and their modules are not imported. Optional targets missing local
configuration are unavailable; an enabled required automatic candidate with missing
configuration fails execution for its operation. These checks use local configuration;
they do not contact a service or verify account access.

Routing registries ignore `DECISION_*` provider/model settings and reject the
single-provider override flags, including `--model`, `--provider`, `--timeout-ms`
and transport overrides. Edit a route's configuration and choose it with `--route`.
Request `model` narrows compatible targets; it cannot replace a route's model.
Each route still resolves `apiKeyEnv`, or its provider's default credential variable,
from the process environment and explicit `--env-file`. Existing environment values
win. Custom module paths remain relative to the configuration file.

The shipped JSON Schema covers both configuration formats. Runtime checks also
enforce route references, operation compatibility and cross-field policy constraints. SDK
registries use `config.type` instead of CLI `config.provider`, require explicit
credentials in native descriptors, and can also accept providers or factories.

## Recognized environment variables

The `DECISION_*` selection variables below apply to single-provider profiles.
Provider credential variables also supply configured routes as described above.

| Variable | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Native Jev credential |
| `OPENAI_API_KEY` | Native Decisions and OpenAI-compatible credential at the OpenAI origin |
| `OPENROUTER_API_KEY` | OpenRouter credential |
| `ANTHROPIC_API_KEY` | Anthropic credential |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare REST account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare REST token at the official origin |
| `DECISION_ACCOUNT_ID` | CLI Cloudflare account selection |
| `DECISION_REJECT_IF_BUSY` | CLI Cloudflare busy mode; literal `true` or `false` |
| `DECISION_GATEWAY_ID` | CLI Cloudflare Gateway ID |
| `JEV_MODEL` | Native Jev default model convenience |
| `DECISION_PROVIDER` | CLI provider selection |
| `DECISION_PRESET` | CLI custom-generative preset selection |
| `DECISION_MODEL` | CLI configured model |
| `DECISION_BASE_URL` | CLI explicit endpoint |
| `DECISION_API_KEY_ENV` | CLI credential variable selector |
| `DECISION_TIMEOUT_MS` | CLI timeout, decimal integer |
| `DECISION_MAX_RETRIES` | CLI retry count, decimal integer |
| `DECISION_RESPONSE_FORMAT` | CLI preset output mode |
| `DECISION_ANTHROPIC_API_VERSION` | Anthropic API-version selection |

`RUN_LIVE_TESTS=1` applies only to the explicit development smoke helper.
No background access or live testing is enabled by normal test commands.

## Custom endpoint credential boundary

A CLI `baseURL` always requires explicit `apiKeyEnv`, even when it happens to equal
a preset origin, or `noAuth: true` for loopback compatible servers. This makes the
credential destination a deliberate selection. OpenRouter's preset origin cannot
be changed; use the `openai-compatible` custom-generative preset for a different gateway.

In SDK constructors, an ambient key is used only for the provider's original
origin. A caller-supplied third-party origin requires an explicit `apiKey`.
`apiKey: null` disables authentication only for OpenAI-compatible loopback URLs.
Credentials in URL userinfo, query strings, or fragments are rejected. Redirects
are not followed. These protections are not an SSRF sandbox: applications that
accept untrusted endpoint configuration must enforce their own destination policy.

## Profiles

See [examples/configs/](../../examples/configs/) for native profiles, generative
presets, and separate custom decision/generative modules. Use
`--provider custom-generative --preset NAME` for a preset, or select a custom kind
with `--provider-module FILE`. The module flag does not infer classification. Replace placeholder model identifiers
with IDs available to your account or server. Profiles reference environment
variables for credentials.

## Extraction and Live configuration

The `extraction` namespace supplies provider `cloudflare-extraction` only when
flags, environment and an explicit file have selected no provider. Its default
model is `clairic`; `@cf/cloudflare/clairic` is also accepted. An explicit
incompatible provider is rejected. Provider switching follows the same isolation
rules above, including transitions between Clef and Clairic. Single-provider
extraction profiles use `schemaVersion: 1`. Routing registries select configured
extraction routes through `defaultRoute` or `--route`.

OpenAI prompt-cache controls and Clairic inference settings (`include_quantiles`,
`return_state_text`) belong in request JSON. Extraction busy-mode flags override
the request's `options.rejectIfBusy`; otherwise that request value overrides the
provider setting. See [extraction](../guides/EXTRACTION.md).

Live SDK configuration is passed directly to `createLiveDecisions` with a supplied
transport. Offline `live validate` and `live replay` do not load provider profiles,
credentials or environment files. See [Live Decisions](../guides/LIVE_DECISIONS.md).

Offline validation checks request structure and configured resource limits. The service
checks quotas, model context, media and Gateway limits. The SDK and CLI do not estimate
tokens or enforce request or token rate limits.
