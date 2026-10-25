# Testing

Run these commands from a source checkout. An installed npm package contains
runtime code and documentation, but does not contain tests or development scripts.

## Automated code and package checks

Use Node.js 22.16 or newer. Runtime code has zero npm dependencies. Run
`npm ci --ignore-scripts` to install the pinned development tools: TypeScript
5.8.3, the official Workers declarations, and the configuration-schema validator.
Source and installed-consumer type checks use the same local compiler.

| Command | Verification |
| --- | --- |
| `npm run check` | Public-source layout, JavaScript syntax, JSON, formatting, local doc links, versions |
| `npm test` | SDK, CLI, provider, and file/transport behavior using fixtures and loopback servers |
| `npm run test:coverage` | The functional suite with production source/bin coverage floors |
| `npm run typecheck` | Positive and expected-negative TypeScript API contracts |
| `npm run test:package` | Pack, offline install, root/custom/extraction/Live/routing exports and types, browser-safe imports, presets/modules, contents and docs |
| `npm run build` | Retain a versioned npm tarball after checking its offline installation |
| `npm run verify` | Source checks, tests, type contracts, and package smoke check |

`verify` is a convenience command for routine changes. It already runs `npm test`
and `test:package`; running coverage and build immediately after it repeats
those checks. CI and the release guide run `check`, `test:coverage`,
`typecheck`, and `build` once each.

These commands check software behavior and package integrity using synthetic model
responses, temporary workspaces and loopback HTTP servers. They need no account keys
and make no paid model calls. Evaluate model quality and performance separately with
representative data. Coverage requirements are 90% of lines, 80% of branches and 85%
of functions. CI runs on Linux, Windows and
macOS with Node 22.16 and Node 24; check its results for the commit being released.
The subprocess SIGINT test is skipped on Windows. When changing signal handling,
also verify cancellation from a native Windows console.

## Suite ownership

- `contract.test.mjs`: request/result contracts, builders, decision policy, and JSON safety.
- `bridge.test.mjs`: SDK evaluation, extensions, observers, deadlines, and batches.
- `providers.test.mjs`: provider wire formats, response parsing, model listing, and configuration.
- `transport.test.mjs`: HTTP policy, limits, retries, cancellation, and deadlines.
- `deadlines.test.mjs`: synchronous preparation/dispatch/completion and inherited budgets.
- `result-validation.test.mjs`: provider-selected precision and policy-hook boundaries.
- `decisions*.test.mjs`: native/common OpenAI codecs, explicit JSON/question content, builders, selectors and model identities, boundaries, preflight, CLI, and smoke-helper fixtures.
- `anthropic*.test.mjs`: tool/JSON output, API versions, response blocks, parameter restrictions, SDK/CLI/schema parity, and loopback commands.
- `cloudflare*.test.mjs`: models, images, codecs, REST/binding/Gateway arguments, errors, and CLI limits.
- `jev*.test.mjs`: native/common assets, reference substitution, boxes, opt-ins, nullable usage and CLI behavior.
- `capability-expansion.test.mjs`: conversation/tool history, remote images, cache controls, extension revalidation, service-limit ownership and safe rejection diagnostics.
- `extraction.test.mjs`: all nine Clairic field families, native JSON preservation, REST/binding options, batch preflight and model-selection diagnostics.
- `live.test.mjs`: commands/acknowledgements, configuration history, transcript ordering, unmatched/stale/duplicate results, observer isolation and lifecycle cleanup.
- `expansion-cli.test.mjs`: extraction commands/configuration, offline Live validation/replay, per-row errors and provider-switch isolation.
- `routing*.test.mjs`: eligibility, deterministic/model selection, clarification, preparation, budgets, recovery/cooldowns, batch snapshots and registry CLI behavior.
- `custom-providers.test.mjs`, `custom-config.test.mjs`: classified SDK paths, provenance, presets/modules, schema and initialization.
- `generative-helpers.test.mjs`: exported prompt/normalization helper contracts and unsupported input rejection.
- `config.test.mjs`: file/environment/flag precedence and provider transitions.
- `cli.test.mjs`: commands, streams, exit codes, modules, and signals.
- `io.test.mjs`: atomic output, file aliases, and cancellation.
- `ordered.test.mjs`: ordered streaming and bounded concurrency.
- `support.mjs` and `fixtures.mjs`: local test setup and synthetic domain data.
- `types.mts`, `providers.types.mts`, `custom.types.mts`: public type inference and rejected API usage.
- `decisions.types.mts`, `cloudflare.types.mts`: richer questions, native APIs, and precision settings.
- `cloudflare-worker.types.mts`: compatibility with official Workers binding declarations.
- `expansion.types.mts`: conversation/cache inputs, extraction value inference, unions, batches and Live transport/notification contracts.
- `routing.types.mts`: router options, decision/extraction inference, prepared schema replacement and routed batch records.

### OpenAI model-selector coverage

For changes to OpenAI selection or preparation, run the focused suites from the
source root:

```text
node --test test/decisions-selectors.test.mjs test/decisions-preflight.test.mjs test/decisions-cli.test.mjs
```

These cover omitted, `default`, `luna`, and explicit upstream selection; unsupported
and malformed values; independently selected, outgoing, and reported identities;
capabilities and extension context; immutable input; SDK batch preflight; resolved
wire-byte limits; CLI precedence and mixed-selector rows; and generated requests
that inherit later configuration changes. Existing Decisions suites also cover
revalidation after input preparation, refusals, retries, and deadlines.

Type and installed-package checks exercise metadata declarations, SDK/CLI
selection, and browser execution without Node globals. Use `npm run verify` for
the complete integration check. A selector mapping change must be verified against
the target model's protocol and capabilities; local fixtures alone do not establish
compatibility with a newly selected upstream model.

### Capability expansion coverage

For changes across expanded OpenAI input, Clairic or Live, use the existing
functional fixtures and declaration checks. A focused source-root command is:

```text
node --test test/capability-expansion.test.mjs test/extraction.test.mjs test/live.test.mjs test/expansion-cli.test.mjs
npm run typecheck
```

REST and binding test doubles check that model-input options and execution options are
passed separately, and that service errors are reported safely. Live uses a supplied
in-memory connection adapter and the same state reducer as offline replay. These tests
do not exhaust service quotas or establish that a hosted service will accept a request
that passes local validation. Installed-package checks exercise the dedicated exports,
CLI tools, declarations and SDK imports without Node globals.

### Routing coverage

For changes to routing policies or registry integration, run:

```text
node --test test/routing.test.mjs test/routing-batch.test.mjs test/routing-boundaries.test.mjs test/routing-selector.test.mjs test/routing-cli.test.mjs
```

The fixtures cover zero/one/multiple eligible targets, disabled and unavailable
routes, capability restrictions, deterministic mode without AI, selector response
validation, cancellation, clarification order, bounded recovery and cooldowns.
`routing.types.mts` checks typed decision/extraction results and schema-changing
preparation. Installed-package checks exercise the routing export in Node and
without Node globals, plus CLI registry initialization and offline inspection.
These checks do not evaluate selector calibration or account availability.

## Optional authenticated provider smoke check

Live inference is explicitly opted in and can incur charges. Configure credentials
locally, then on POSIX shells:

```bash
RUN_LIVE_TESTS=1 npm run smoke:live -- --env-file .env
```

On PowerShell:

```powershell
$env:RUN_LIVE_TESTS = '1'
npm run smoke:live -- --env-file .env
Remove-Item Env:RUN_LIVE_TESTS
```

Forward provider/model/config options for the selected account. The helper refuses
to infer without the opt-in flag and returns real results or errors. It checks a
configured inference path, not model quality or throughput. For model listing
alone, use `node bin/decision.mjs models --env-file .env`.
Model listing is unsupported for OpenAI Decisions and Cloudflare Clef.

The OpenAI Decisions helper performs four bounded common/native requests when
invoked with `--decisions`. It includes a valid embedded PNG, typed choices, and
labelled scores. For example, after setting the same opt-in variable:

```text
npm run smoke:live -- --decisions --env-file .env
```

Cloudflare REST can use the ordinary smoke command with
`--provider cloudflare-decisions --model clef`, `--model clef-flash`, or
`--model clef-omni`, loading its
account/token environment explicitly. These invocations each check one common
request. Native, image, large-distribution, binding, and Gateway checks require
separate bounded cases; test the latter two in the intended existing runtime and
Gateway. REST busy rejection has a documented
[service limitation](../guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway).
Test all three models and both access shapes when changing those paths. Include typed
string/boolean identity, labelled scores, reported confidence/usage, and distinct
request/Gateway IDs from concurrent calls. Enabling binding busy mode verifies
option acceptance; it does not establish behavior under exhausted capacity.
Header/dimension preflight does not fully decode images, so live image fixtures
must also contain valid encoded image data.
Use valid, decodable WAV/MP3 and MP4/WebM media for hosted Omni tests. The synthetic
containers in local tests exercise header inspection and protocol handling, not
full media decoding. Cover grouped modalities, container
validity, configured client byte budgets, effective-model overrides, request bodies above 13 MiB,
and explicit smaller ceilings. Gateway caching/logging should be disabled for
test payloads, and each bounded run should have a request and total time budget.

Set up test Workers and Gateways separately; the SDK, CLI and test suite do not
create or remove them. The smoke helper does not cover Clairic or GPT-Live.
Test those integrations in your application's runtime or connection, with explicit
request and time limits. Use offline fixtures for routine development and CI.

## Package verification

To test a specific local tarball against this source checkout:

```text
node scripts/package-smoke.mjs --tarball /path/to/fayegram-ai-decision-bridge-VERSION.tgz
```

The check installs the specified archive offline and compares installed bytes,
documentation links, exports, CLI shims, and the bundled sample. It also rejects
local archives and development-only files leaking into the runtime package.
