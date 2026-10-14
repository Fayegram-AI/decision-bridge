# Design rationale

## Native decisions as the application contract

Use shared state or ordered input and independent typed questions as the public
contract. The bridge owns orchestration; providers own their model API protocols.
This gives applications a stable decision interface and makes customization
explicit at each call. Native decision models are the main package scope;
generative protocols are opt-in custom strategies with their own public subpath.
Every provider declares its decision/generative kind. Consequence: not every model can satisfy this contract
reliably; compatibility and quality must be tested separately.

## ESM JavaScript with declarations and no runtime dependencies

Use standard fetch, streams, and JSON in the SDK; keep Node's test runner,
argument parser, and filesystem APIs in development tools and the optional CLI.
Ship ESM source plus `.d.mts` types without a transpilation build. Consequence:
Node 22.16+ is required for Node use, while browser use depends on modern web
APIs and the provider's CORS policy. TypeScript declaration synchronization needs
its own tests. A CommonJS entry point is not claimed.

## Provenance is part of the result

Native versus elicited probabilities are tagged. Native codecs preserve reported
probabilities, confidence, and scores. Generative strategies derive choice/score
from their elicited distributions and do not supply native confidence;
unreported token counts are null. Consequence: applications must handle optional
confidence/usage, and identical output schemas do not imply interchangeable
calibration or correctness.

## Fail explicitly instead of silently repairing or falling back

Reject invalid JSON, extra fields, wrong labels, distributions outside the provider
precision allowance, explicit output truncation, and refusals. Require explicit
output modes and models. Services may truncate input without reporting it; local
byte limits do not guarantee token fit. Consequence:
some calls fail that a permissive wrapper might guess at, but failures remain
observable and cannot silently change budgets or decision policies.

## Trusted extensions and explicit configuration

Read JSON config only when named. Load custom ESM only when explicitly selected.
Protect credential destinations and expose bounded callbacks. Consequence: plugins
are powerful and must be trusted; cancellation is not a JavaScript sandbox.

## Release-owned model selectors

OpenAI Decisions offers `default` for the provider's default supported model and
`luna` for the supported Luna-family model, alongside explicit supported upstream
IDs. The installed package fixes the target and capability profile for each
selector. The provider resolves it locally before serialization; no discovery,
automatic upgrade, or fallback occurs during a call. Consequence: applications can
use a stable selection string while inspecting selected, outgoing, and reported
model identities separately. A future target change requires an intentional
package update and verification of that model's protocol and capabilities.

## Conservative retries and independent observations

Retry selected explicit transient HTTP statuses within a deadline. Do not retry
ambiguous network failures, malformed decisions, or observer failures. Consequence:
users can choose manual retry policies, but exactly-once billing cannot be promised.

## MIT licensing and coordinated distribution

Publish the maintained source under the MIT License, with the copyright notice
in `LICENSE` and matching SPDX identifiers in package metadata. Release the source
repository and npm package together. Consequence: source and package recipients
have the same MIT permissions and obligations; building an archive alone does not
publish a release.

## Verified npm package artifact

Build a versioned npm tarball from the source package and retain it only after an
offline installation check of the exact archive. Publish that verified artifact
to the public npm registry as part of the coordinated source and package release;
building alone never publishes it. Consequence: consumers install the release from
npm, while maintainers verify the exact archive before publication.
