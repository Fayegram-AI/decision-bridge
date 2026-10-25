# Troubleshooting

## An export or command from these guides is missing

Run `npm exec -- decision-bridge --version` in the consuming project and compare
it with [version availability](../README.md#version-availability). The `/extraction`
and `/live` exports, their CLI commands, and expanded OpenAI history/cache inputs
require 0.1.3 or later. See [installation options](GETTING_STARTED.md#install-into-your-application)
to install a compatible version.
The `/routing` export, `inspect`, routing flags, and routing registries require
0.1.4 or later. Use the [installation options](GETTING_STARTED.md#install-into-your-application)
if your installed package does not include them.

OpenAI JSON/question content, the companion `WithParts` builders, Live
JSON/hosted-image items, and Anthropic output/version settings require 0.1.5 or later.

## The command cannot find a key

General `node bin/decision.mjs ...` calls need exported environment variables or an
explicit `--env-file .env`. Only the documented convenience npm scripts
preload `.env`. The file must name the selected provider's credential variable.
Do not pass a TypeSafe key to OpenRouter or vice versa. Existing shell environment
values win over a file; an old exported value can therefore mask a newly edited file.

## My model or base URL seems ignored

For single-provider profiles, unknown options are rejected, but model precedence still matters:
`--model > request.model > resolved config/environment model > provider default`.
Provider changes discard
incompatible fields inherited from a different JSON profile. Use a complete
explicit config. A compatible base includes its version prefix, not the final
`/chat/completions` path. Jev and the custom Anthropic preset require origins
without a path. See [configuration](../reference/CONFIGURATION.md#precedence).

Routing registries ignore `DECISION_*` selection variables and reject
provider/model override flags. Change the concrete route's `config` and choose it
with `--route`. Request `model` narrows eligible targets instead of changing them.

## Automatic routing has no eligible target or remains ambiguous

Run `decision-bridge inspect request.json --config routes.json` to see which targets
have complete local configuration, which do not support the request, and which still
need checks during execution. Confirm the intended targets are enabled, have local
credentials, match the operation and satisfy request model/capability constraints.
`inspect` does not test account access. Cooldown exclusions can return
`ROUTE_UNAVAILABLE` with a retry hint.

One eligible route is selected locally. With several, configure a matching
preference/priority, clarification handler, or decision selector. Deterministic
mode requires no AI. Unattended decision-assisted mode requires a ready decision
selector with a model and explicit `minProbability` and `minMargin`, even when
only one execution target remains. See [selection behavior](ROUTING.md#selection-behavior).

CLI clarification requires terminal stdin/stderr and a request file. Piped input,
`--no-interactive`, and `--no-routing-prompt` use unattended selection. EOF cancels
the prompt. A selector response must satisfy the configured thresholds; failure
does not silently choose another route unless an applicable fallback was enabled.

## OpenAI reports a versioned model after I select default or luna

`default` and `luna` are Decision Bridge model selectors. Both currently resolve
to `gpt-6-luna`, which is the upstream ID sent to OpenAI. Successful common and
native calls expose the selection as `meta.requestedModel` and the outgoing ID
as `meta.resolvedModel`. `result.model` or native `decision.model` preserves the
service-reported identity, which may differ from the outgoing ID.

An omitted request model inherits the configured model. OpenAI initialization
omits `model` from its generated requests so later configuration edits apply.
If selection fails with `UNSUPPORTED_CAPABILITY`, check the
[accepted selectors](OPENAI_DECISIONS.md#model-selection); the bridge does not
discover another model or fall back after failure.

## Structured output is rejected

Check that the selected endpoint/model supports the requested output mode.
OpenAI-compatible and OpenRouter presets also accept explicit `json_object` or
`text` modes; local validation remains strict. Some compatible servers require
`--token-parameter max_tokens`. A valid schema does
not guarantee probabilities sum to one. `INVALID_RESPONSE` must not be treated as
an approved decision. Large schemas also consume context/output budget.

For Anthropic, check the [output and API-version settings](CUSTOM_GENERATIVE.md#json-output-and-api-versions).
Select `json_schema` or the default `tool` mode;
`json_object`, `text`, and `tokenParameter` are unsupported. API `2026-10-21`
rejects `temperature`, `top_p`, and `top_k`. A `TRUNCATED_OUTPUT` error may require
a larger explicit `maxTokens` budget, which also covers default thinking tokens.

## The model returns JSON but confidence is absent

This is expected for generative backends. Their probabilities are estimates produced in
response to a prompt. They do not include the native confidence reported by Jev, OpenAI
Decisions or Cloudflare choice/score answers. Read `meta.probabilitySource`. A null
token count means the server did not report it. Neither absence should be silently
converted to a number.

## Cloudflare needs an account ID as well as a token

REST inference targets an account-specific URL. Supply `CLOUDFLARE_ACCOUNT_ID`
and `CLOUDFLARE_API_TOKEN`, or explicit SDK credentials, for that account.
Standard REST inference needs no Worker or Gateway. Binding calls instead require
an injected `env.AI`; Gateway routing requires explicit Gateway configuration.
See the [Cloudflare guide](CLOUDFLARE_DECISIONS.md#supported-inference-paths).

## Cloudflare REST busy mode is unavailable

The bridge rejects enabled Clef REST busy mode locally with
`UNSUPPORTED_CAPABILITY` before inference. Direct hosted requests were observed
to reject the execution field with HTTP 422/code `5012`. Leave `rejectIfBusy`
disabled for REST, or use the Workers AI binding for the enabled setting.
This differs from a capacity rejection (`3040`) or an allocation limit (`3036`);
increasing client retries does not fix unsupported
execution options. See [capacity and Gateway settings](CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway).

## Evaluation succeeds but an extension failed

Inspect `meta.observerFailures`. Observation occurs after inference; a failed log sink
must not cause another model call. Preparation failures instead throw `EXTENSION_ERROR`
before continuing to inference. Check the separate provider, bridge and observer
timeouts in the SDK reference.

## Batch output is incomplete

Per-record errors are explicit JSONL records and do not stop the CLI. An input-reading
error, invalid UTF-8, exceeded limit, interruption or filesystem error can stop the
whole batch. An unfinished output file is not saved in that case, but stdout may already
contain results for completed rows. Some requests may already have been sent/billed.
Retrying an entire prefix can repeat work, so retain completed records externally when
designing resumability.

## Extraction or Live does not behave like bridge evaluation

For Clairic, use `CloudflareExtractionProvider` from the `/extraction` export or
the `extraction` CLI namespace with `cloudflare-extraction`. The root decision
factory and `createBridge` do not accept extraction providers. An explicit
provider from config or environment overrides the namespace default and must
match the operation. A null value, empty list or `truncated: true` can be a valid
native result; inspect it according to your application's needs.

For Live, `requestDecision` and `appendCommentary` resolve on submission. Consume
completed decisions through `subscribe`. An unmatched result indicates missing or
ambiguous source/configuration history; a stale result refers to older observed
transcript order. Check correlation before applying the result to the current task.
Disposal and connection closure cancel pending waits. Malformed offline event validation exits
2, while failed replay rows produce exit 1 and processing continues. See
[Live lifecycle](LIVE_DECISIONS.md#results-and-correlation).

## Type checks fail because tsc is missing

Run `npm ci --ignore-scripts` in the source checkout to install the pinned
development dependencies, including TypeScript 5.8.3, then rerun
`npm run typecheck`. The installed SDK and CLI run without TypeScript. See
[testing](../development/TESTING.md) for the development setup.

## Filing a useful issue

Include bridge version, Node version, OS, command with secrets removed, provider,
requested model, safe error JSON, and a minimal nonsensitive reproduction. Never
include `.env`, keys, private prompts, or raw confidential documents. Security
reports should be private; see the root security policy.
