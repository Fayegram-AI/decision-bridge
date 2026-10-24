# Errors and recovery

`DecisionError` extends `Error` and exposes `code`, optional `status`, `requestId`,
`gatewayLogId`, `attempts`, and numeric `upstreamCode` for Cloudflare diagnostics.
Optional `source`, `upstreamErrorCode`, `upstreamErrorType`, `retryAfterMs` and
`retryable` help identify whether a failure came from local limits or the service.
OpenAI Decisions refusal errors can also carry validated `refusedQuestions` and `usage`.
Routed errors can carry immutable `routing` diagnostics with candidate statuses,
selector usage, execution attempts and timings. `toJSON()` and `publicError(error)`
return safe structured details. Unknown exceptions use a generic message; stack traces
and raw response bodies are omitted. Custom providers deliberately constructing
`DecisionError` must keep its message safe.

| Code | Meaning and response |
| --- | --- |
| `DECISION_ERROR` | Generic code for a deliberately constructed DecisionError without a more specific code |
| `CONFIGURATION_ERROR` | Invalid/unknown option, missing credential, incompatible provider setting, or invalid endpoint; fix configuration |
| `VALIDATION_ERROR` | Invalid request/template/JSON; fix input before retrying |
| `UNSUPPORTED_CAPABILITY` | Selected provider/model or preparation extension cannot support this request; fails before dispatch |
| `USAGE_ERROR` | Invalid CLI flags/arguments or stdin usage; consult help |
| `IO_ERROR` | Input/output path or permissions failure; preserve previous output |
| `INPUT_TOO_LARGE` | CLI byte limit exceeded; reduce or split input |
| `REQUEST_TOO_LARGE` | Configured client byte budget or upstream size admission rejected the request; inspect `source` and optional status |
| `RESPONSE_TOO_LARGE` | Provider response exceeds configured limit; inspect budget/model behavior |
| `HTTP_ERROR` | Non-success HTTP response; use status/request ID, not raw error body |
| `CAPACITY_EXCEEDED` | Cloudflare capacity unavailable (3040); busy mode does not queue/retry |
| `ALLOCATION_EXCEEDED` | Provider allocation, credit or spending limit exceeded; not automatically retried |
| `RATE_LIMITED` | Temporary provider throttling without a more specific allocation/capacity code |
| `AUTHENTICATION_ERROR`, `PERMISSION_DENIED` | Provider authentication or authorization failure |
| `UPSTREAM_TIMEOUT`, `UPSTREAM_ABORTED` | Cloudflare upstream timeout (3007) or abort (3008) |
| `NETWORK_ERROR` | Transport failed ambiguously; no automatic network retry occurred |
| `RETRY_BUDGET_EXCEEDED` | Server delay cannot fit remaining deadline; choose a later attempt explicitly |
| `TIMEOUT` | Provider, bridge, preparation, or listing deadline exceeded |
| `ABORTED` | Caller cancelled; remote work might already have been billed |
| `INVALID_RESPONSE` | Non-byte response chunks, wrong envelope, or invalid UTF-8/JSON/schema/distribution/usage; do not trust partial answers |
| `MODEL_REFUSAL` | Provider declined the evaluation; no result is returned |
| `TRUNCATED_OUTPUT` | Output/context budget exhausted; revise budget/input explicitly |
| `EXTENSION_ERROR` | Preparation failed; inference was not issued after that failure |
| `PROVIDER_ERROR` | Sanitized custom-provider exception |
| `UNSUPPORTED_OPERATION` | Provider does not implement listing or another requested operation |
| `BATCH_SKIPPED` | SDK stop-on-error prevented a not-yet-started record |
| `INVALID_REQUEST` | Upstream request rejection; inspect safe machine code/type and correct the request |
| `CONNECTION_CLOSED`, `DISPOSED` | Live connection ended or controller was disposed; pending work is cancelled |
| `RESOURCE_LIMIT` | Live client pending-operation budget exceeded; settle existing operations before submitting more |
| `OBSERVER_ERROR` | Live observer notification failed; no command or application action is repeated |
| `UNEXPECTED_ERROR` | Unrecognized error sanitized for public output |

## Retry policy

OpenAI Decisions refusals include `refusedQuestions` and validated `usage`, plus
available HTTP diagnostics. A refusal of any question fails that complete call;
successful siblings are not exposed as a partial result.

The shared response transport retries statuses **429, 502, 503, 504, and 529**
as a fallback for HTTP and binding responses. Provider decoders refine eligibility; known allocation/billing failures are never retried. `maxRetries`
means additional attempts; the default 2 allows at most 3 total attempts. Native
OpenAI Decisions, Cloudflare Clef and Clairic default to 0; explicitly enabling retries can repeat a billed
request. All
attempts, backoff, and response-body reading share one timeout budget.

Valid `Retry-After` decimal integer seconds or HTTP dates are honored. All three
HTTP date forms are interpreted in UTC; an elapsed date means zero delay.
Malformed values are ignored, including fractional, signed, hexadecimal and
exponent numbers. Without a valid hint, exponential backoff
starts at 250 ms with jitter and an 8-second base cap. A delay that cannot fit the
remaining budget fails instead of violating the server's requested wait.

When an HTTP rejection body is malformed, too large, or interrupted, the known
status, safe request/Gateway IDs and valid `Retry-After` remain available. If the
body cannot be decoded, classification and retry eligibility use the status
alone; unavailable upstream codes are omitted. Caller cancellation and the total
deadline still take precedence over this fallback.

Authentication failures, invalid output, model refusal, and
ambiguous network failures are not retried automatically. OpenAI may classify HTTP 500 as retryable; other transports retain their fallback policy. HTTP retries are not an
exactly-once billing guarantee. Set `maxRetries: 0` when your workflow requires
manual retry decisions. The bridge never retries a successful request because an
observer failed; inspect `meta.observerFailures` separately.

## Routing failures and recovery

The `/routing` API in 0.1.4 adds these codes:

| Code | Meaning and response |
| --- | --- |
| `NO_ELIGIBLE_ROUTE` | No configured candidate can execute the request; inspect enabled state, readiness, capabilities and hard constraints |
| `ROUTE_UNAVAILABLE` | A direct target is disabled, automatic targets are cooling down, or the selected target became unavailable before dispatch; inspect any `retryAfterMs` hint |
| `ROUTING_AMBIGUOUS` | Multiple eligible targets remain without an accepted selection; configure preferences, clarification or a decision selector |
| `ROUTING_CONTEXT_TOO_LARGE` | Selector context exceeds its configured byte ceiling; shorten `routingDescription` or configure explicit local fallback |
| `CLARIFICATION_TIMEOUT` | Active clarification exceeded its budget; provide an answer within the budget or use unattended selection |

When a routed call ends with a provider failure, the error keeps that provider error
code. Cross-route recovery is disabled by default and must be configured through
`auto.failover`. Before dispatch, a selected target that becomes unavailable can be
skipped for a configured eligible fallback. After dispatch, only typed `RATE_LIMITED`
and `CAPACITY_EXCEEDED` failures can advance to another eligible target. Generic
HTTP/network failures, refusal, invalid responses, authentication/allocation errors and
cancellation do not. Router-owned failover disables additional transport/Gateway
attempts; supplied providers must declare and honor `singleDispatch: true`.

Selector fallback is configured separately and requires a route that can be chosen by
rules or priority. Both fallback paths still enforce hard request constraints. See
[routing recovery and diagnostics](../guides/ROUTING.md#optional-recovery-and-diagnostics).

## Practical diagnosis

For 401 or 403, check that the key is valid and the account has permission to use the
model. The client reports the service's status; it cannot determine your account state.
A 404 may indicate an incorrect API base, model or route. A 429 can represent temporary
throttling or an allocation/billing failure; inspect `code`, `upstreamErrorCode`,
`upstreamErrorType` and `retryable`. For `INVALID_RESPONSE`, a schema-capable model may
still emit invalid probabilities or be routed through an incompatible endpoint. Change
configuration deliberately and retest; do not disable local validation.

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

## Extraction and Live

Clairic preserves native nulls, empty lists and the `truncated` flag in a successful
extraction envelope; truncation is not converted into a decision-style failure.
The application decides whether that extraction is sufficient for its task.

Live preserves native refusal answers on completed decision events. Malformed
server events report `INVALID_RESPONSE`; the offline event-file validator reports
caller input as `VALIDATION_ERROR`. Observer failures produce `observer_error`
notifications containing a safe `OBSERVER_ERROR`. Command submission receipts do
not promise a completed decision. No Live command or application action is
automatically replayed. See [Live lifecycle](../guides/LIVE_DECISIONS.md).
