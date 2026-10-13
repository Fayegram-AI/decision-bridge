# Custom provider contracts

Decision Bridge has one bridge and two explicit extension paths:

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

- `defaultModel`: a nonempty model ID, otherwise the request must supply one.
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

The request is already snapshotted, validated, resolved to a model, and frozen.
Return canonical `{ model, answers, usage, meta? }`; the bridge validates and
freezes the result. Custom providers own API encoding, transport, response mapping,
credential destinations, bounded bodies, safe errors, and cancellation cleanup.
Internal transport helpers are not stable public exports. Delegate a maintained
preset for a protocol already supported, or implement and test your own transport.

Capability omissions retain the legacy shared-state and question profile. Audio
and video additions default to false/zero. Declare richer forms only when their
encoding and validation are implemented. The bridge runs preflight again after
preparation hooks. Unknown usage is null; no provider should invent token counts,
confidence, or calibration. Generative native-provenance claims are rejected.
Supplied `probabilitySource` and `confidenceSource` metadata must be nonempty
strings. Decision providers may use custom labels; omitted probability provenance
uses the provider's declared value, or `unspecified` when none is declared.

## Explicit CLI modules

Select a custom kind and `module` in JSON, or pass both `--provider custom-decision`
(or `custom-generative`) and `--provider-module FILE`. A module flag does not infer
a kind. A generative profile chooses exactly one `preset` or `module`; module
profiles require JSON `options` for implementation-specific transport/tuning.
Inline `apiKey`/`api_key` options are rejected; use top-level `apiKeyEnv`.

The module exports `createProvider(options)`, synchronously or asynchronously.
Import/factory waiting is bounded by `timeoutMs` (30 seconds by default) and CLI
cancellation, separately from evaluation. The loader passes JSON `options`, then
the selected `apiKey` and `model` when present. Its returned kind must match the
selected path. The CLI also applies its configured model to common requests that
omit a model, independently of the factory's own default; an explicit request
model takes precedence, and `--model` overrides both. Module paths in JSON resolve
relative to that file; flag paths
resolve relative to the working directory. Explicit modules execute trusted code;
this extension point is not a sandbox. No module is discovered automatically.

`init` creates an honest service implementation placeholder when no implementation
is selected. When given an existing module, it references that module without
loading or overwriting it. Offline `validate` never imports custom modules or
requires credentials; it reports structure-only validation for unknown protocols.
`bridge.validate()` on an instantiated provider includes capabilities and preflight.

## Tests for a new protocol

Test serialized bodies, credentials/headers, endpoint paths, all supported question
mappings, usage/provenance, refusals/truncation, malformed distributions, timeouts,
cancellation, and safe errors. Use local HTTP fixtures for deterministic protocol
checks. Live tests must be explicit and credential-dependent; fixture tests do
not establish model quality. See [testing](../development/TESTING.md).
