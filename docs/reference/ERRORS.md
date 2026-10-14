# Errors and recovery

`DecisionError` extends `Error` and exposes `code`, optional `status`, `requestId`,
`gatewayLogId`, `attempts`, and numeric `upstreamCode` for Cloudflare diagnostics.
OpenAI Decisions refusal errors can also carry validated `refusedQuestions` and
`usage`. `toJSON()` and `publicError(error)` return safe structured details.
Unknown exceptions become a generic message, not a copied stack/body. Custom
providers deliberately constructing `DecisionError` must keep its message safe.

| Code | Meaning and response |
| --- | --- |
| `DECISION_ERROR` | Generic code for a deliberately constructed DecisionError without a more specific code |
| `CONFIGURATION_ERROR` | Invalid/unknown option, missing credential, incompatible provider setting, or invalid endpoint; fix configuration |
| `VALIDATION_ERROR` | Invalid request/template/JSON; fix input before retrying |
| `UNSUPPORTED_CAPABILITY` | Selected provider/model or preparation extension cannot support this request; fails before dispatch |
| `USAGE_ERROR` | Invalid CLI flags/arguments or stdin usage; consult help |
| `IO_ERROR` | Input/output path or permissions failure; preserve previous output |
| `INPUT_TOO_LARGE` | CLI byte limit exceeded; reduce or split input |
| `REQUEST_TOO_LARGE` | Encoded provider request exceeds configured limit; reduce input/schema |
| `RESPONSE_TOO_LARGE` | Provider response exceeds configured limit; inspect budget/model behavior |
| `HTTP_ERROR` | Non-success HTTP response; use status/request ID, not raw error body |
| `CAPACITY_EXCEEDED` | Cloudflare capacity unavailable (3040); busy mode does not queue/retry |
| `ALLOCATION_EXCEEDED` | Cloudflare allocation limit exceeded (3036) |
| `RATE_LIMITED` | Cloudflare HTTP 429 without a more specific code |
| `AUTHENTICATION_ERROR`, `PERMISSION_DENIED` | Cloudflare authentication or authorization failure |
| `UPSTREAM_TIMEOUT`, `UPSTREAM_ABORTED` | Cloudflare upstream timeout (3007) or abort (3008) |
| `NETWORK_ERROR` | Transport failed ambiguously; no automatic network retry occurred |
| `RETRY_BUDGET_EXCEEDED` | Server delay cannot fit remaining deadline; choose a later attempt explicitly |
| `TIMEOUT` | Provider, bridge, preparation, or listing deadline exceeded |
| `ABORTED` | Caller cancelled; remote work might already have been billed |
| `INVALID_RESPONSE` | Non-byte response chunks, wrong envelope, or invalid UTF-8/JSON/schema/distribution/usage; do not trust partial answers |
| `MODEL_REFUSAL` | Provider explicitly declined the evaluation; no fabricated result |
| `TRUNCATED_OUTPUT` | Output/context budget exhausted; revise budget/input explicitly |
| `EXTENSION_ERROR` | Preparation failed; inference was not issued after that failure |
| `PROVIDER_ERROR` | Sanitized custom-provider exception |
| `UNSUPPORTED_OPERATION` | Provider does not implement listing or another requested operation |
| `BATCH_SKIPPED` | SDK stop-on-error prevented a not-yet-started record |
| `UNEXPECTED_ERROR` | Unrecognized error sanitized for public output |

## Retry policy

OpenAI Decisions refusals include `refusedQuestions` and validated `usage`, plus
available HTTP diagnostics. A refusal of any question fails that complete call;
successful siblings are not exposed as a partial result.

The shared response transport retries statuses **429, 502, 503, 504, and 529**
only, for both HTTP requests and Workers AI binding responses. `maxRetries`
means additional attempts; the default 2 allows at most 3 total attempts. Native
OpenAI Decisions and Cloudflare Clef default to 0; explicitly enabling retries can repeat a billed
request. All
attempts, backoff, and response-body reading share one timeout budget.

`Retry-After` seconds or HTTP dates are honored. Without it, exponential backoff
starts at 250 ms with jitter and an 8-second base cap. A delay that cannot fit the
remaining budget fails instead of violating the server's requested wait.

Authentication failures, generic HTTP 500, invalid output, model refusal, and
ambiguous network failures are not retried automatically. HTTP retries are not an
exactly-once billing guarantee. Set `maxRetries: 0` when your workflow requires
manual retry decisions. The bridge never retries a successful request because an
observer failed; inspect `meta.observerFailures` separately.

## Practical diagnosis

401/403 usually requires checking key/account/model authorization with the provider;
the client reports the actual status rather than claiming to diagnose account
state. 404 can indicate an incorrect API base/model/route. 429 exposes throttling;
repeated retries can increase load. For `INVALID_RESPONSE`, a schema-capable model
may still emit invalid probabilities or be routed through an incompatible endpoint.
Change configuration deliberately and retest; do not disable local validation.

Enabling busy execution options for Cloudflare Clef REST fails local preflight
with `UNSUPPORTED_CAPABILITY`, without an HTTP status, upstream code, or dispatch.
Direct calls to the hosted service were observed to reject that field with
HTTP 422 and `upstreamCode: 5012`, distinct from capacity code 3040. Other upstream
validation failures can still return HTTP 422/5012 and retain safe diagnostics.
Keep the default disabled setting for ordinary REST
inference; see the [Cloudflare guide](../guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway).

Keep a request ID and available Gateway log ID, bridge version, configured provider,
model selection, reported model, and template revision for incident analysis.
For successful OpenAI calls, retain
the requested selection, resolved outgoing ID, and reported model separately;
see [model identities](../guides/OPENAI_DECISIONS.md#model-selection). Log input or results only under your
own data-handling policy. No logging or telemetry is enabled by default.
