# Design rationale

## Native decisions as the application contract

Requests combine shared state, ordered input or conversation with independent typed
questions. The bridge owns orchestration; providers own their model API protocols.
This gives applications a stable decision interface and makes customization explicit at
each call. Native decision models are the main package scope; generative protocols are
opt-in custom strategies with their own public subpath. Every provider declares its
decision/generative kind. Not every model can satisfy this contract reliably;
compatibility and quality must be tested separately.

Extraction and Live are dedicated operations. Clairic keeps its native fields
and predictive response envelope; Live attaches commands and events to an
application-owned connection. Each has its own API and result contract, separate
from the bridge's `evaluate` interface.

## ESM JavaScript with declarations and no runtime dependencies

The SDK uses standard fetch, streams and JSON. Node-specific APIs are confined to
development tools and the optional CLI. The package ships ESM source and `.d.mts`
declarations without a transpilation step. Running on Node.js requires version 22.16 or newer;
browser use depends on modern web APIs and the provider's CORS policy. Type checks
verify declaration compatibility. CommonJS applications can use dynamic import.

## Provenance is part of the result

Native versus elicited probabilities are tagged. Native codecs preserve reported
probabilities, confidence, and scores. Generative strategies derive choice/score from
their elicited distributions and do not supply native confidence; unreported token
counts are null. Applications must handle optional confidence/usage, and identical
output schemas do not imply interchangeable calibration or correctness.

## Fail explicitly instead of silently repairing or falling back

Decision calls reject invalid JSON, unsupported request fields, wrong labels,
distributions outside the provider precision allowance, malformed results and refusals;
generative paths also reject explicit output truncation. Require explicit output modes
and models. Services may truncate input without reporting it; local byte limits do not
guarantee token fit. Invalid results fail explicitly so applications can apply their
own error-handling policy.

Clairic preserves additional safe native JSON and its truncation flag. Live
preserves native refusal events and marks ambiguous correlation as unmatched.

## Service admission and client resources

The server owns quotas, rate limits, service counts, context admission and media
ceilings. Report rejection through safe structured errors; do not estimate tokens,
track account allocations, split requests or schedule service capacity. Local
byte/JSON safeguards, cancellation, deadlines and caller-selected concurrency
bound client resources. Custom-provider quantitative contracts remain explicit.

## Trusted extensions and explicit configuration

Read JSON config only when named. Load custom ESM only when explicitly selected. Protect
credential destinations and expose bounded callbacks. Plugins are powerful and must be
trusted; cancellation is not a JavaScript sandbox.

## Release-owned model selectors

OpenAI Decisions offers `default` for the provider's default supported model and `luna`
for the supported Luna-family model, alongside explicit supported upstream IDs. The
installed package fixes the target and capability profile for each selector. The
provider resolves it locally before serialization; no discovery, automatic upgrade, or
fallback occurs during a call. Applications can use a stable selection string while
inspecting selected, outgoing, and reported model identities separately. A future target
change requires an intentional package update and verification of that model's protocol
and capabilities.

## Conservative retries and independent observations

Retry selected explicit transient HTTP statuses within a deadline. Do not retry
ambiguous network failures, malformed decisions, or observer failures. Users can choose
manual retry policies, but exactly-once billing cannot be promised.

## Explicit automatic routing

Routing selects from a configured registry. Eligibility precedes preference or
model selection, and a single eligible target needs no selector inference.
Deterministic mode supports automation without a decision model. Decision-assisted
mode requires explicit thresholds and validates the selector's response against
the eligible set. Missing local configuration and capability restrictions remain
observable, and neither preferences nor recovery can restore an excluded target.

Clarification is an application callback or CLI interaction with its own budget; it is
not a provider responsibility. Recovery is disabled by default and restricted to
configured targets and typed transient rejections. Applications can automate selection
while retaining control over which services receive data, when an additional inference
is allowed, and how ambiguity is resolved. See the
[routing guide](../guides/ROUTING.md).

## MIT licensing and coordinated distribution

The source and packaged SDK use the MIT License, with the copyright notice in
`LICENSE` and the matching SPDX identifier in package metadata. Both distributions
carry the same license and public API.

## Verified npm package artifact

The build retains a versioned tarball after verifying its offline installation.
Using the same archive for GitHub and npm keeps their package contents consistent.
See [packaging and release](RELEASING.md) for the verification and publication steps.
