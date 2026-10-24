# Security and operational boundaries

## Credentials and data

Keep keys in the process environment or an explicitly loaded local environment file.
Never place them in request JSON, committed profiles, command-line arguments, or shared
logs. The package contains no key, telemetry client, or background job. When you request
a model call, the SDK sends your evidence and question or field definitions to the
selected provider. Conversation/tool history is also request data. Remote HTTP(S) image
references are forwarded to OpenAI without being fetched by the SDK; the provider
handles their retrieval. Review data-sharing requirements before sending private
repository content or documents. Optional Cloudflare Gateway routing can cache
requests/responses or collect logs according to explicit options and the Gateway's
configuration. Review that configuration as part of your data-handling policy; Gateway
is disabled until selected. See the
[Cloudflare guide](docs/guides/CLOUDFLARE_DECISIONS.md#capacity-rejection-and-ai-gateway).

When routing uses a decision model, the selector receives task text, question or field
definitions, eligible target descriptions and caller labels. Recognized media URLs and
payloads are replaced with metadata; arbitrary JSON state remains task content.
`routingDescription` replaces task content in selector input, while schema and media
metadata remain. Keep route definitions and selection policy trusted, and include
selector and explicit failover destinations in your data sharing policy. Deterministic
routing makes no selector call. See
[routing context](docs/guides/ROUTING.md#decision-assisted-selection).

Built-in constructors do not forward ambient credentials to unrelated custom
origins. The CLI requires explicit credential selection for custom URLs. URL
credentials/query/fragment are rejected; HTTP is limited to loopback and redirects
are not followed. These controls do not authenticate an arbitrary configured host,
resolve all DNS-rebinding risks, or sandbox untrusted URLs. An embedding server
must impose its own allowlist and network controls.

## Error reporting and redaction

HTTP failure bodies/headers and unknown exception stacks are not copied into public
errors. Known keys are removed from request IDs and CLI error string values.
Model outputs, requested labels, state and application logs are outside this
redaction scope. Remove secrets before including content in a request or log.
Custom providers must supply safe `DecisionError` messages. Exclude `Authorization`
and `x-api-key` headers from HTTP logs.

## Input and output

Strict plain-JSON checks reject accessors, cycles, non-finite numbers, lossy objects,
and unknown request fields. Clairic additionally preserves safe native response fields,
including predictive JSON and truncation. The SDK limits data size, JSON depth and node
count, retries, concurrent work and waiting time. These checks do not establish decision
accuracy or resist every adversarial semantic input. Question instructions are trusted
configuration; state is untrusted evidence. Prompt separation is a mitigation, not a
guarantee.

Output files use exclusive temporary files and mode 0600 where supported, then
same-directory finalization. Replacing existing output requires `--force`.
Atomicity and permissions depend on the filesystem and operating system. File
output failures cannot undo model calls or data already written to stdout.
The input-overwrite guard resolves known path and file aliases, but cannot prevent
another process from changing paths concurrently. Cancellation is honored until
atomic finalization is submitted to the operating system; it cannot retract that write.

## Plugins and cancellation

Custom provider modules execute ordinary trusted JavaScript with process access. They
are not sandboxed and are never auto-discovered. Extensions can perform I/O and log data
by their own design. Respect the supplied AbortSignals and release resources when
cancelled. The bridge can stop waiting for code that ignores a signal, but cannot
terminate that code or undo its side effects. A provider timeout or cancellation does
not prove remote inference stopped before billing.

The Live controller attaches to a connection supplied by the application. That
application owns authentication, audio, connection setup and reconnection. The
controller sends Decisions commands and consumes parsed notifications; disposing
it releases its listeners/waits without closing the application connection or
undoing actions. Decisions with unmatched or stale correlation require application
policy; receipt of a decision is not proof that an action completed.

## Dependencies and CI

The package has zero runtime dependencies. Keep Node.js updated with security
patches. The pinned TypeScript
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

Consult CI results for the commit or release and [Testing](docs/development/TESTING.md)
for the checks performed. Automated tests cover software behavior and package
integrity; security audits and authenticated provider checks require separate review.
