# Repository layout

The source repository contains the SDK, CLI, examples, functional tests, CI, and
maintained documentation. The installable npm tarball contains the SDK and CLI
with declarations, examples, and docs; it excludes tests and development scripts.

```text
README.md                  Product overview and quick start
CONTRIBUTING.md             Contributor entry point
CHANGELOG.md                User-visible changes
SECURITY.md                 Security boundaries and reporting guidance
LICENSE                    MIT license
package.json               Package identity, exports, commands, and file allowlist
package-lock.json          Pinned development dependency metadata
.env.example               Provider credential placeholders
src/                       Common SDK, native providers, CLI, declarations
src/custom/                Explicit decision definitions and generative presets
src/extraction/            Dedicated Clairic provider, validation, batches and types
src/live/                  Supplied-connection Live controller, protocol state and types
src/routing/               Target registry, selection, clarification, recovery and batches
bin/                       Node.js CLI entry point
examples/                  Native SDK examples and request profiles
examples/custom/           Opt-in generative and native delegation examples
schemas/                   Packaged CLI configuration JSON Schema
docs/guides/               User guides
docs/reference/            SDK, CLI, configuration, and provider contracts
docs/development/          Architecture, tests, and packaging guidance
test/                      Functional and type-contract tests
scripts/                   Source, type, and package checks
.github/                   CI and dependency update configuration
```

The `package.json` `files` allowlist defines the npm tarball.
`npm run test:package` verifies the installed files and offline CLI commands. `npm run build`
retains its verified tarball under the ignored `release/` directory. Credentials
belong in local environment files, not in source or package contents.
