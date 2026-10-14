# Troubleshooting

## The command cannot find a key

General `node bin/decision.mjs ...` calls need exported environment variables or an
explicit `--env-file .env`. Only the documented convenience npm scripts
preload `.env`. The file must name the selected provider's credential variable.
Do not pass a TypeSafe key to OpenRouter or vice versa. Existing shell environment
values win over a file; an old exported value can therefore mask a newly edited file.

## My model or base URL seems ignored

Unknown options are rejected, but model precedence still matters:
`--model > request.model > resolved config/environment model > provider default`.
Provider changes discard
incompatible fields inherited from a different JSON profile. Use a complete
explicit config. A compatible base includes its version prefix, not the final
`/chat/completions` path. Jev and the custom Anthropic preset require origins
without a path. See [configuration](../reference/CONFIGURATION.md#precedence).

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

Check that the selected endpoint/model supports the requested `json_schema` mode.
Choose `json_object` or `text` explicitly when appropriate; local validation remains
strict. Some servers require `--token-parameter max_tokens`. A valid schema does
not guarantee probabilities sum to one. `INVALID_RESPONSE` must not be treated as
an approved decision. Large schemas also consume context/output budget.

## The model returns JSON but confidence is absent

This is expected for generative backends. They produce elicited probabilities
and do not report the native confidence carried by Jev, OpenAI Decisions, or
Cloudflare choice/score answers. Read `meta.probabilitySource`. A null token
count means the server did not report it. Neither absence should be silently
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

Inspect `meta.observerFailures`. Observation occurs after inference; a failed log
sink must not cause another model call. Preparation failures instead throw
`EXTENSION_ERROR` before continuing to inference. Observe the separate provider,
bridge, and observer deadlines documented in the SDK reference.

## Batch output is incomplete

Per-record errors are explicit JSONL records and do not stop the CLI. A global
input, UTF-8, limit, interruption, or filesystem failure can stop the batch. Atomic
file output is not finalized in that case; stdout can contain a completed prefix.
Some requests may already have been sent/billed. Retrying an entire prefix can
repeat work, so retain completed records externally when designing resumability.

## Type checks fail because tsc is missing

Runtime and tests have no TypeScript dependency. Development type checks require
TypeScript 5.8.3, the verified compiler. Install it as a developer tool using the
instructions in [Testing](../development/TESTING.md). Do not confuse an absent
development compiler with a broken runtime package.

## Filing a useful issue

Include bridge version, Node version, OS, command with secrets removed, provider,
requested model, safe error JSON, and a minimal nonsensitive reproduction. Never
include `.env`, keys, private prompts, or raw confidential documents. Security
reports should be private; see the root security policy.
