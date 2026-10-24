# Contributing

## Report an issue or propose a change

Search [existing issues](https://github.com/Fayegram-AI/decision-bridge/issues) before
opening a new one. For a bug, include the bridge version, Node.js version,
operating system, a minimal reproducible request with synthetic data, expected
behavior, and actual behavior. For a feature proposal, describe the use case and
how it fits the provider-independent contract. Report vulnerabilities through the
private route in [SECURITY.md](SECURITY.md), not in an issue.

Use a source checkout with Node.js 22.16 or newer. No build step or runtime
dependencies are required. `npm ci --ignore-scripts` installs the pinned
development-only TypeScript compiler, official Workers declarations, and Ajv
configuration-schema validator from the lockfile. See the
[testing guide](docs/development/TESTING.md).

## Understand the design

Start with the [architecture](docs/development/ARCHITECTURE.md),
[design rationale](docs/development/DESIGN.md), and
[repository layout](docs/development/REPOSITORY_LAYOUT.md). Preserve the
provider-independent contract of exactly one of `state`, ordered `input` or
`conversation`, plus `questions`, and explicit probability provenance. Extraction and
Live have separate request and result formats. Let services enforce their own quotas and
acceptance limits, while keeping SDK resource limits configurable. Add focused
regression tests for bug fixes and tests of encoded requests and responses for protocol
changes. Fixtures must contain no credentials or live-account data, and synthetic
responses must be labelled. Routing must check which targets can handle a request before
choosing one, require opt-in for generative targets, limit recovery attempts, and
preserve metadata identifying the provider and probability source. See the
[routing lifecycle](docs/development/ARCHITECTURE.md#routing-lifecycle).

## Make and verify a change

Work on a focused branch. Use ESM JavaScript, four-space indentation for new code,
LF line endings, and a final newline. Avoid unrelated reformatting of existing
files. Update `.d.mts` declarations and compile-time regressions when public APIs
change. Document user-visible changes in the changelog.

```text
npm run verify
```

Verification includes syntax/JSON/doc-link checks, functional tests, strict public
type contracts, and a clean offline installation of the npm tarball. Coverage is
a separate command. Tests use fixtures and local servers; they do not contact
model accounts. Package checks require npm. Run `npm run test:coverage` when
reviewing coverage; it reruns the same functional suite.

Keep generated files and credentials out of commits. Maintained contributor
documentation belongs in `docs/development/`.

## Review and release

Keep commits focused and explain behavior changes and the checks performed.
Open a pull request with a short description of the behavior change and the
verification you ran; link the relevant issue when one exists.
Inspect `git diff` and `git diff --cached` before committing. Respect existing
authorship and use the project identity configured for the repository.

Follow the [packaging guide](docs/development/RELEASING.md) for the coordinated
source and npm release. The project is licensed under [MIT](LICENSE).
