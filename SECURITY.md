# Security and operational boundaries

## Credentials and data

Keep keys in the process environment or an explicitly loaded local environment
file. Never place them in request JSON, committed profiles, command-line arguments,
or shared logs. The package contains no key, telemetry client, or background job.
It sends supplied decision evidence/question definitions or extraction evidence/
fields to the selected provider when the operation is explicitly requested.
Conversation/tool history is also request data. Remote HTTP(S) image references
are forwarded to OpenAI without being fetched by the SDK; the provider handles
their retrieval. Review data-sharing requirements
before sending private repository content or documents.
Optional Cloudflare Gateway routing can cache requests/responses or collect logs
according to explicit options and the Gateway's configuration. Review that
configuration as part of your data-handling policy; Gateway is disabled until
selected. See the [Cloudflare guide](docs/guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway).

Built-in constructors do not forward ambient credentials to unrelated custom
origins. The CLI requires explicit credential selection for custom URLs. URL
credentials/query/fragment are rejected; HTTP is limited to loopback and redirects
are not followed. These controls do not authenticate an arbitrary configured host,
resolve all DNS-rebinding risks, or sandbox untrusted URLs. An embedding server
must impose its own allowlist and network controls.

## Safe errors, not a universal secret scanner

HTTP failure bodies/headers and unknown exception stacks are not copied into public
errors. Known keys are removed from request IDs and CLI error string values.
Model outputs, requested labels, state, and arbitrary application logs are not
universally scrubbed. Do not deliberately include secrets in prompts. A custom
provider constructing DecisionError is responsible for a safe message. Never add a
verbose HTTP logger that prints Authorization or x-api-key headers.

## Input and output

Strict plain-JSON checks reject accessors, cycles, non-finite numbers, lossy objects,
and unknown request fields. Clairic additionally preserves safe native response
fields, including predictive JSON and truncation. Bytes, nesting, nodes, retries,
concurrency, and waiting time are bounded. These checks do not establish decision accuracy or resist every
adversarial semantic input. Question instructions are trusted configuration;
state is untrusted evidence. Prompt separation is a mitigation, not a guarantee.

Output files use exclusive temporary files and mode 0600 where supported, then
same-directory finalization. Existing output requires explicit --force. Atomicity
and permissions depend on the filesystem/OS; there is no power-loss-proof
transaction across model billing, stdout, and filesystem writes.

## Plugins and cancellation

Custom provider modules execute ordinary trusted JavaScript with process access.
They are not sandboxed and are never auto-discovered. Extensions can perform I/O
and log data by their own design. Honor supplied AbortSignals and close resources;
the bridge can stop awaiting a non-cooperative promise, not terminate arbitrary
code or undo side effects. A provider timeout or cancellation does not prove remote
inference stopped before billing.

The Live controller attaches to a connection supplied by the application. That
application owns authentication, audio, connection setup and reconnection. The
controller sends Decisions commands and consumes parsed notifications; disposing
it releases its listeners/waits without closing the application connection or
undoing actions. Decisions with unmatched or stale correlation require application
policy; receipt of a decision is not proof that an action completed.

## Dependencies and CI

There are zero runtime dependencies. This reduces dependency surface but is not a
security certification. Maintain Node.js security updates. The pinned TypeScript
compiler, official Workers declarations, and Ajv configuration-schema validator
are development-only dependencies; none is required by the installed SDK or CLI.
The supplied CI uses read-only repository permissions, no model
keys, and no publishing. Review third-party action updates and pin audited action
commits under your organization's policy before using CI in a privileged setting.

## Reporting

Use the repository's **Security** tab and **Report a vulnerability** to submit a
private report. If the reporting button is unavailable, ask the maintainer for a
private contact method without including vulnerability details in a public issue.

Include the affected version, impact, and a minimal redacted reproduction. Do
not publish credentials, confidential inputs, or exploit details in an issue.

## Release assurance

Automated tests and package verification are engineering checks, not an
independent security audit. Consult CI results for the specific commit or
release. Ordinary tests do not establish authenticated vendor
compatibility. See [Testing](docs/development/TESTING.md) for the verification scope.

The input-overwrite guard resolves known path/file aliases; it does not lock the
whole filesystem against concurrent changes. File-output cancellation is honored
until atomic finalization is submitted. It cannot retract an OS operation already
submitted. Parameter objects are validated before inspection/spreading so accessors
are rejected without being invoked by the provider constructors.
