# Configurable routing

Requires **0.1.4**. See [version availability](../README.md#version-availability).

Use `/routing` to choose among the providers and models you configure. Each route gives
a target a name, such as `fast` or `multimodal`. Pass that name to choose it directly,
or use `route: 'auto'` to let the router choose. Auto mode can use your rules and
priorities, ask a decision model, or request clarification when the choice is unclear.
You can continue using `createBridge()` or the extraction provider directly when you
only need one provider.

**Auto mode is experimental in 0.1.4**, whether it uses rules or a decision model
to choose a route. This covers both decision and extraction requests. Its settings
and routing behavior may change as the feature develops. Try it with your
application's typical requests and enabled models, and check that it chooses
suitable routes.

## Deterministic SDK setup

```javascript
import { createDecisionRouter } from '@fayegram-ai/decision-bridge/routing';

const router = createDecisionRouter({
    defaultRoute: 'auto',
    policyRevision: 'application-policy-1',
    routes: {
        auto: {
            policy: 'deterministic',
            candidates: ['fast', 'multimodal'],
            priority: ['fast', 'multimodal'],
        },
        fast: {
            config: {
                type: 'cloudflare-decisions', model: 'clef-flash',
                accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
                apiKey: process.env.CLOUDFLARE_API_TOKEN,
            },
        },
        multimodal: {
            enabled: false,
            config: { type: 'cloudflare-decisions', model: 'clef-omni' },
        },
    },
});

const request = {
    state: 'ModuleNotFoundError: No module named pytest',
    questions: { missing: { type: 'noul', instructions: 'Is a dependency missing?' } },
};
console.log(router.inspect(request)); // Offline; no provider construction or inference.
const result = await router.evaluate(request);
console.log(result.answers.missing.noul, result.meta.routing.selectedRoute);
```

Supply credentials in each SDK route's configuration. An optional route is marked
unavailable if it lacks the credentials or local connection settings it needs. If an
enabled auto candidate has `required: true`, missing configuration causes an error for
that operation instead. Disabled routes need no credentials or initialized clients.
These checks use local settings; they do not contact a service to check permissions,
allocation or availability.

Concrete decision routes accept exactly one of:

- `config`: native provider options with `type` (`jev`, `openai-decisions`, or
  `cloudflare-decisions`), including REST or Workers binding options.
- `provider`: an existing Provider, without bridge preparation extensions.
- `factory`: an asynchronous or synchronous function receiving `{ signal }`, with
  an explicit `kind: 'decision' | 'generative'` and optional `model` and `ready`.
  Successful initialization is cached by the router. Initialization failures are
  configuration errors, not an indication to silently exclude the route.

Generative providers/factories require `allowGenerative: true`; results retain
elicited probability provenance. Extraction routes use
`config: { type: 'cloudflare-extraction', ... }` or an existing
`CloudflareExtractionProvider` with `operation: 'extraction'`. They use the
established Clairic request and result contract. A registry may include both
operations; each router filters candidates to its operation.

The router copies its configuration when you create it. Create a new router to change
enabled routes or policy. IDs use letters, digits, underscores, dots and hyphens, start
with a letter or digit, and have at most 64 characters. `auto` is reserved. References
must name configured concrete routes; recursive automatic routes are rejected. The
registry supports up to 256 concrete routes. The router rejects targets it can identify
as duplicates.

For extraction, create a router with `createExtractionRouter` from the same
subpath and call `router.extract(request)`. The request contains Clairic
`fields` and `state`/`images`; the result remains `{ extraction, meta }` with
`meta.routing` added. See the [extraction guide](EXTRACTION.md) for field types.
Routing does not apply to Live connections or native decision envelopes.

## Selection behavior

| Situation | Behavior |
| --- | --- |
| Concrete route ID | Validate and execute that target; no automatic substitution |
| No call route or configured default | Configuration error |
| No eligible automatic target | `NO_ELIGIBLE_ROUTE`, or `ROUTE_UNAVAILABLE` for temporary cooldowns |
| One eligible target | Select locally, after full capability and request validation |
| Multiple eligible targets and a matching preference/priority | Select locally |
| Multiple eligible targets without a local choice | Clarify, invoke the configured selector, or return `ROUTING_AMBIGUOUS` |

`policy: 'deterministic'` never invokes a selector and does not require one.
The single-target path applies equally when only one route is enabled and when
capabilities, hard rules or call constraints reduce several enabled routes to one.
Decision-assisted configuration requirements are described below.

A target is eligible only if it is enabled, locally configured, and able to handle the
operation and request. The router checks the requested model, supported features, input
order, media and encoded request size, experimental opt-ins, hard rules and cooldowns.
Where a built-in provider recognizes equivalent model aliases, the router treats them as
the same model. A request's `model` limits which targets can be selected; it does not
change a route's configured model. Direct calls still check the provider's requirements,
but do not apply auto rules or cooldowns.

`rules` are ordered objects with `effect`, `when`, and ordered `routes`:

```javascript
const rules = [
    { effect: 'require', when: { modalities: ['video'] }, routes: ['multimodal'] },
    { effect: 'prefer', when: { labels: ['interactive'] }, routes: ['fast'] },
];
```

A rule matches only when all its conditions hold. For a list, every listed fact must be
present. Conditions can use `operation`, `modalities`, `questionTypes`, `fieldTypes`,
and caller `labels`. Each matching `require` rule keeps only the eligible targets named
by that rule; multiple requirements must all be satisfied. Preferences cannot bring an
excluded target back. The first matching preference that contains an eligible target
wins, using its route order. The router then checks `priority` if no preference resolves
the choice. Targets outside these lists have no implicit rank, and registration order
never breaks a tie. You can omit rules and priority when only one target is eligible.
Call `candidates` can only narrow the configured `auto.candidates` list.

Use `inspect()` to check routing without making a service call. It runs synchronously
and does not execute preparation hooks, load modules, initialize factories or prompt.
Its report distinguishes verified candidates from provisional ones that still need
checks, and identifies missing selector settings for unattended use. If preparation or
custom initialization is needed, `validationScope` is `structure` and `outcome` stays
`unresolved`; the remaining checks run during execution.

## Decision-assisted selection

Set `auto.policy` to `decision-assisted` and configure:

```javascript
const selector = {
    route: 'judge',
    when: 'ambiguous',
    minProbability: 0.75,
    minMargin: 0.2,
    timeoutMs: 5000,
    maxContextBytes: 32768,
};
```

Register `judge` as an enabled **decision** route with a model and complete local
configuration. The thresholds above are examples; choose values based on your own
evaluations. When running without clarification, decision-assisted mode requires both
thresholds and a ready selector, even if only one execution target remains eligible. The
router selects that sole target locally without calling the selector.

`when: 'ambiguous'` invokes the selector only when deterministic selection remains
unresolved. `when: 'multiple'` requests model selection whenever multiple eligible
targets remain, bypassing soft preferences. Zero/one-candidate and hard-restriction
behavior is unchanged. The selector is an execution candidate only when included
explicitly in `auto.candidates`.

The selector receives task text, question/field schema, eligible IDs and trusted
descriptions, preferences and caller labels. Recognized media is represented by
type, MIME type and byte count where available; media URLs and payloads are not
sent. Arbitrary JSON state remains task content. Supply call `routingDescription`
to replace task content with an application-provided description. The serialized
context defaults to 32 KiB and is never silently truncated.

The selector chooses from internal route IDs and an option to abstain. The router checks
its probability distribution, confirms that the choice is allowed, applies the
provider's declared rounding precision, and checks your thresholds. Abstention,
malformed responses, timeout and service failure stop selection by default.
`selector.fallbackOn` can explicitly enable a deterministic fallback for `abstain`,
`invalid-response`, `timeout`, `unavailable`, or `context-too-large`. Fallback also
requires a local preference or priority winner. Refusal and caller cancellation are
terminal. There is no recursive selector or selection retry loop.

## Preparation, clarification and time budgets

Router `prepare(request, context)` receives a frozen request and
`{ operation, requestedRoute, signal }`. Return a replacement request or `undefined`
to retain it. Structural validation runs before and after preparation. Preparation
runs once per call, including calls that later fail over.

Preparation may replace the question or field schema. TypeScript therefore returns
general answer types from routers configured with `prepare`, including batch
results; narrow each answer's type before accessing type-specific fields. Routers
without preparation preserve inference from the original request schema.

Router or call `onAmbiguity(question, { signal })` receives frozen eligible
candidate descriptions and `selectorAvailable`. Return one of:

- `{ action: 'select', route: 'fast' }` to choose an eligible ID.
- `{ action: 'use-selector' }` for decision-assisted selection.
- `{ action: 'cancel' }` to abort.

The router offers clarification before calling the selector. A handler can choose a
route manually even when decision-assisted mode has no configured selector. Returning
`use-selector` still requires a fully configured selector. Set `clarify: false` or
`auto.clarification.enabled: false` to disable clarification; the unattended
configuration requirements then apply. The router asks at most once for a request and
does not prompt again after a failure.

| Budget | Default | Includes |
| --- | --- | --- |
| `workTimeoutMs` | 60,000 ms | Preparation, initialization, selection, execution and recovery |
| `clarificationTimeoutMs` | 300,000 ms | Active callback/prompt time, excluding admission queue |
| Call `timeoutMs` | Unset | Optional total elapsed time, including queues and clarification |
| Selector timeout | 5,000 ms maximum by default | At most half the remaining work budget |
| `observerTimeoutMs` | 1,000 ms | Isolated post-success observation |

`auto.clarification.timeoutMs` overrides the router's clarification budget. Pass a
`signal` to cancel queued or active work. Handlers and factories should respect it. The
router can stop waiting when a handler ignores cancellation, but cannot terminate that
handler's own work. `onResult(result, context)` runs once after success. Its failure is
recorded in `meta.routing.observerFailed` and never turns a completed inference into a
retry.

`evaluateRoutedBatch(router, requests, options)` and
`extractRoutedBatch(router, requests, options)` prepare and preflight every array
request before any router-issued model inference. They return ordered success/error
records, support `concurrency` (default 4, range 1–64) and `stopOnError`, and use one
entry route per batch. Auto selects independently for each item. Clarification is
serialized in input order and answers apply only to that request.
Inputs and shared call constraints are snapshotted before preparation starts.
Preparation or preflight failure rejects the batch before router-issued inference;
later execution failures become per-item records. Selection refreshes eligibility
for each item and again after clarification admission, so queued items account for
new cooldowns. After admission, the router also reapplies preferences and priority.
A local winner skips clarification and selector inference, except when
`selector.when: 'multiple'` explicitly requests a model choice among several
candidates. A single remaining candidate skips both clarification and selector
inference; no remaining candidate fails without another model call.

## Optional recovery and diagnostics

Recovery is off by default. `auto.failover: { routes: ['backup'], maxAttempts: 2 }`
enables ordered cross-route recovery. All fallbacks must also be candidates and
pass the same hard restrictions on the prepared request. `maxAttempts` counts
execution targets dispatched, including the initial target; the default is two.
Each target is attempted at most once per call. A target that becomes unavailable
before dispatch can be skipped in favor of a configured eligible fallback without
consuming an execution attempt. Without configured failover, this returns
`ROUTE_UNAVAILABLE`.

After dispatch, only typed `RATE_LIMITED` and `CAPACITY_EXCEEDED` failures permit
recovery. Generic HTTP/network errors, timeouts, allocation/authentication failures,
refusal and invalid responses do not.
No selector, preparation, or clarification repeats during recovery.

Router-owned native transports use `maxRetries: 0` and Gateway `maxAttempts: 1`
when failover is enabled; explicit conflicting settings are rejected. Supplied
providers and factories must declare `singleDispatch: true` and implement that
contract. CLI generative presets also use zero retries under failover.

`auto.cooldown: { durationMs: 30000 }` enables per-router cooldowns after those
typed transient failures. A provider retry hint overrides the configured duration.
Optional concrete `cooldownGroup` shares cooldowns explicitly across related
targets. A group name matching an ungrouped route's ID does not affect that route.
Request incompatibility takes precedence over cooldown status when preflight is
available. Direct routes bypass cooldowns. There are no background probes or waits;
when no route is available, a retry hint is returned where known.

If a cooldown expires during preparation, while a batch item is queued, or before
recovery, the router initializes any newly available lazy candidates and checks
their capabilities before considering them. These checks use the remaining work
budget; unsupported targets remain excluded.

Results retain the executed provider, model and probability provenance.
`meta.routing` adds requested/selected IDs, method, optional policy revision,
candidate statuses, selector identity/usage, execution attempts/usage, and work,
clarification and wall durations. Unknown usage stays null, and deterministic
selection does not invent a probability. Errors retain terminal provider codes
and attach bounded routing diagnostics. Additional routing errors are
`NO_ELIGIBLE_ROUTE`, `ROUTING_AMBIGUOUS`, `ROUTE_UNAVAILABLE`,
`ROUTING_CONTEXT_TOO_LARGE`, and `CLARIFICATION_TIMEOUT`.

## CLI registry configuration

Create a deterministic template with `decision-bridge init ./project --route auto`.
Use `decision-bridge extraction init ./project --route auto` for extraction.
Version 2 configuration stores provider definitions inside concrete routes:

```json
{
    "schemaVersion": 2,
    "defaultRoute": "auto",
    "routes": {
        "auto": { "policy": "deterministic", "candidates": ["primary"] },
        "primary": {
            "config": { "provider": "jev", "model": "jev-latest", "apiKeyEnv": "MY_JEV_KEY" }
        }
    }
}
```

```bash
decision-bridge inspect request.json --config routes.json
decision-bridge validate request.json --config routes.json
decision-bridge evaluate request.json --config routes.json --env-file .env
decision-bridge evaluate request.json --config routes.json --route primary
decision-bridge batch requests.jsonl --config routes.json --concurrency 4
```

Extraction supports the same commands under `extraction` (`run` aliases
`evaluate`). Routing uses common decision requests or extraction field requests;
`--native` is unsupported. `inspect` and `validate` stay offline, including custom
modules. `validate` reports its validation scope and rejects known impossibility.
Unknown registry references and cross-field semantics are checked at runtime in
addition to the editor schema's structural checks.

Version 1 configuration retains its precedence. Version 2 ignores legacy
`DECISION_*` provider/model selection variables and rejects provider/model/transport
override flags. Edit the concrete configuration and select with `--route`.
Each route's `apiKeyEnv` still resolves through the environment and optional
`--env-file`. Custom module paths are relative to the configuration file.

With terminal stdin/stderr and a request file, unresolved auto selection prompts
on stderr. Stdout remains JSON/JSONL. `--interactive` requires those terminal
conditions; `--no-interactive` and `--no-routing-prompt` select unattended behavior.
Piped request input is unattended. EOF cancels clarification. Batch prompts are
serialized; neither selections nor answers modify configuration. Streaming JSONL
preflights each row before its own inference, preserving input/output order.
