# Custom provider contracts

Custom providers work with the same bridge as the built-in providers. Choose the
extension path that matches the service you are integrating:

| Path | SDK helper | CLI provider | Purpose |
| --- | --- | --- | --- |
| [Custom decision](CUSTOM_DECISION.md) | `defineDecisionProvider` from `custom/decision` | `custom-decision` with `module` | A new decision model protocol |
| [Custom generative](CUSTOM_GENERATIVE.md) | `defineGenerativeProvider` from `custom/generative` | `custom-generative` with `preset` or `module` | Elicit structured decisions from a general-purpose model |

The root `createProvider()` factory supports native Jev, OpenAI Decisions, and
Cloudflare only. `createGenerativeProvider()` selects maintained generative
presets. Select the corresponding custom entry point explicitly for either
extension path.

## Common SDK contract

`Provider` requires a nonempty `name`, explicit `kind: 'decision' | 'generative'`,
and `evaluate(request, { signal? })`. Optional fields and hooks are:

- `defaultModel`: a nonempty selection string, otherwise the request must supply one.
- `probabilitySource`: known provenance; generative providers use `elicited`.
- `getCapabilities(model)`: a pure synchronous capability profile.
- `validateRequest(request)`: pure synchronous provider preflight; no inference.
- `getResultValidationOptions(model)`: pure synchronous probability precision
  policy, never derived from a response or its metadata.
- `listModels({ signal? })`: a model catalog when the service implements one.

Both definition helpers validate plain data definitions and freeze their wrappers.
Callbacks keep their original receiver. The bridge also accepts provider classes
that implement this contract directly. Missing or invalid kinds fail at construction.
`bridge.providerKind` and `result.meta.providerKind` come from the contract and
cannot be overridden by response metadata.

The bridge passes a validated, read-only copy of the request with its selected model. If
your service uses a different model ID, resolve that ID inside the provider. Return
`{ model, answers, usage, meta? }` in the shared result format; the bridge validates it
and makes the returned result immutable. Your provider handles API encoding, networking,
response conversion, credential destinations, body-size limits, safe errors and cleanup
after cancellation. Internal transport helpers are not stable public exports. Delegate a
maintained preset for a protocol already supported, or implement and test your own
transport.

If you omit capabilities, the provider supports the original shared-state question
format. Audio and video flags/counts default to false/zero; conversation, tool history,
remote images and prompt caching default to false. Numeric limits you declare are
enforced; `null` leaves a limit to the service. Declare additional input forms only
after implementing their encoding and validation. The bridge checks the request again
after preparation hooks. Unknown usage is null; no provider should invent token counts,
confidence, or calibration. Generative native-provenance claims are rejected. Supplied
`probabilitySource` and `confidenceSource` metadata must be nonempty strings. Decision
providers may use custom labels; omitted probability provenance uses the provider's
declared value, or `unspecified` when none is declared.

## Explicit CLI modules

Select a custom kind and `module` in JSON, or pass both `--provider custom-decision`
(or `custom-generative`) and `--provider-module FILE`. A module flag does not infer
a kind. A generative profile chooses exactly one `preset` or `module`; module
profiles require JSON `options` for implementation-specific transport/tuning.
Inline `apiKey`/`api_key` options are rejected; use top-level `apiKeyEnv`.

The module exports `createProvider(options)`, synchronously or asynchronously. The CLI
waits up to `timeoutMs` (30 seconds by default) for import and factory initialization,
with cancellation support. This deadline is separate from evaluation. The loader passes
JSON `options`, then the selected `apiKey` and `model` when present. Its returned kind
must match the selected path. In single-provider mode, the CLI applies its configured
model to common requests that omit one, independently of the factory's own default. A
request model takes precedence, and `--model` overrides both. Module paths in JSON
resolve relative to that file; flag paths resolve relative to the working directory.
Explicit modules execute trusted code; this extension point is not a sandbox. No module
is discovered automatically.

`init` creates a provider module with an unimplemented service call when no
implementation is selected. When given an existing module, it references that module without
loading or overwriting it. Single-provider offline `validate` never imports custom
modules or requires credentials; it reports structure-only validation for unknown protocols.
`bridge.validate()` on an instantiated provider includes capabilities and preflight.

## Routed providers

A routing registry accepts a provider instance or a `factory({ signal })` that creates
one when needed. Declare the provider kind when using a factory. Disabled factories are
never called; inspection marks checks that need initialization as provisional. In a
version-2 CLI registry, a custom route's `config` contains the same module/preset
fields, with paths relative to the registry file. Inspection stays offline and does not
import the module.

Generative targets require `allowGenerative: true` and retain elicited provenance.
A decision selector must be decision-kind with a configured model. Providers
participating in router failover must declare `singleDispatch: true` and disable
their own retries. See [routing](ROUTING.md) for readiness, initialization and
recovery contracts.

## Tests for a new protocol

Test serialized bodies, credentials/headers, endpoint paths, all supported question
mappings, usage/provenance, refusals/truncation, malformed distributions, timeouts,
cancellation, and safe errors. Use local HTTP fixtures for deterministic protocol
checks. Live tests must be explicit and credential-dependent; fixture tests do
not establish model quality. See [testing](../development/TESTING.md).
