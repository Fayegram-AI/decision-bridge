# Configuration and credentials

## Explicit CLI JSON configuration

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

Load it with `--config path/to/decision.config.json`. The CLI never scans a working
directory for executable configuration. It does not read `.env` implicitly; use
`--env-file .env`. Runtime SDK configuration uses constructor options instead.

Jev is the CLI's built-in provider default. In SDK code, `createBridge` requires
an explicit `provider` or `jev` selection, and `createProvider` requires `type`.
Provider-specific model defaults apply after that selection. Root SDK selection
is native-only. Generative presets use `createGenerativeProvider` from the
`custom/generative` subpath. CLI custom modules declare their kind explicitly.

`init` copies the configuration JSON Schema beside the generated config and adds
`$schema` for editor completion. The packaged schema is available at
`@fayegram-ai/decision-bridge/config.schema.json` and in
[schemas/decision.config.schema.json](../../schemas/decision.config.schema.json).
It checks profile structure; runtime preflight additionally checks endpoint,
credential, capability, and model-specific limits.
Cloudflare CLI configuration always selects REST. Inject a Workers AI binding
through the SDK's `CloudflareDecisionsProvider` constructor instead of a JSON
profile. Gateway configuration is optional for either SDK transport and for CLI REST.

| Field | Values / scope |
| --- | --- |
| `$schema` | Optional nonempty schema reference for editors |
| `schemaVersion` | 1; optional, but generated profiles include it |
| `provider` | `jev` default, `openai-decisions`, `cloudflare-decisions`, `custom-decision`, `custom-generative` |
| `preset` | `custom-generative` only: `openai-compatible`, `openrouter`, `anthropic`; mutually exclusive with module |
| `model` | Nonempty model ID; built-in native providers have defaults; required for generative evaluation unless the request supplies it |
| `baseURL` | HTTPS API base; loopback may use HTTP |
| `apiKeyEnv` | Credential environment variable name; inline `apiKey` is rejected |
| `noAuth` | Boolean; true only for loopback OpenAI-compatible endpoints |
| `timeoutMs` | Positive integer up to 2,147,483,647 milliseconds |
| `maxRetries` | Integer 0–10; OpenAI/Cloudflare default 0; Jev and generative presets default 2 |
| `maxRequestBytes`, `maxResponseBytes` | Positive integer through 64 MiB; default 8 MiB. Cloudflare requests: Clef/Clef-flash default/cap 13 MiB; Omni default 36 MiB, configurable through 64 MiB |
| `accountId` | Cloudflare REST account ID; otherwise `CLOUDFLARE_ACCOUNT_ID` |
| `rejectIfBusy` | Cloudflare boolean; default false, incompatible with retries. Effective true fails REST preflight with `UNSUPPORTED_CAPABILITY`; see the [binding support and REST limitation](../guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway) |
| `gateway` | Cloudflare Gateway object; see the [Cloudflare guide](../guides/CLOUDFLARE_DECISIONS.md) |
| `maxTokens` | Generative output budget, 1–1,048,576; default 4096 |
| `responseFormat` | Compatible generative presets: `json_schema`, `json_object`, `text` |
| `tokenParameter` | Compatible generative presets: `max_completion_tokens` or `max_tokens` |
| `parameters` | Extra JSON generation parameters, excluding bridge-controlled fields |
| `module` | Required for custom-decision; alternative to preset for custom-generative; explicit local ESM file |
| `options` | Custom factory's JSON options, e.g. its own baseURL |

Upper numeric limits validate client configuration, not vendor model capabilities.
Cloudflare selects its byte budget from the effective request model, including
per-call overrides. An explicit smaller `maxRequestBytes` remains the ceiling;
selecting Omni cannot enlarge it. Omni's default is a bridge policy, not a
documented whole-request service guarantee.
Provider-specific unused fields are rejected. In a module profile, transport and
generation settings belong inside `options`; the custom factory owns them. Top-level
`timeoutMs` still bounds the bridge. The module may implement its own networking.

`parameters` cannot override model, messages, system instructions, schemas, tools,
streaming, token-limit fields, or credentials. Legacy `functions` and
`function_call` controls are also reserved. Unrecognized model-specific
parameters may be rejected by the server; they are not silently dropped by us.

## Precedence

For provider/configuration settings:

```text
CLI flags > DECISION_* environment variables > explicit JSON file > defaults
```

For credentials loaded from an explicit environment file:

```text
existing process environment > --env-file values
```

The loader does not mutate the process environment. The SDK independently reads
its documented ambient credential variables at provider construction.

The [supported-model list](../../README.md#supported-models) records native
selectors, aliases and defaults. Configuration precedence does not expand a
provider's accepted models or grant account access.

For evaluation model selection:

```text
--model > request.model > resolved config/environment model > provider default
```

Jev defaults to `jev-latest`, with `JEV_MODEL` as a legacy/direct convenience.
Native OpenAI Decisions defaults to `gpt-6-luna`; it accepts transport settings
and rejects generative output settings. Its default retry count is zero. Cloudflare Clef defaults to `clef`, uses
account/token credentials, rejects generation settings, and also defaults to zero retries.
A `DECISION_MODEL` or file model takes precedence over that convenience.
Custom generative presets and modules do not inherit a
Jev model. Offline validation of a generative/module request without a model reports
`model: null`; evaluation requires a request model or provider default.

Each layer is merged separately. Changing provider, preset, or module at a layer
boundary discards all lower-layer implementation settings: endpoint, key selector,
model, generation parameters, transport retries/byte limits, preset/module/options,
and Cloudflare account/busy/Gateway settings. Only `timeoutMs` is shared. This
prevents stale credentials and protocol options crossing implementation boundaries.
Same-implementation overrides retain compatible settings. Supply new settings
explicitly when switching. A module-to-preset or preset-to-module switch clears
the old selector. Module identity uses the resolved file path: a file-relative
module and a working-directory-relative flag retain settings only when both
identify the same file.

## Recognized environment variables

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
| `DECISION_RESPONSE_FORMAT` | CLI compatible output mode |

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
with IDs returned by the intended account/server. Profiles intentionally contain
no real key or claim that one model is available to every user.
