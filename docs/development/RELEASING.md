# Packaging and release

The npm package build archives ESM source without compilation. The versioned
tarball contains the runtime, TypeScript declarations, examples, and maintained
docs. Tests and development scripts remain in the source repository.

## Verify source and package contents

From a clean source checkout, verify the code and build the installable artifact:

```text
npm run check
npm run test:coverage
npm run typecheck
npm run build
```

`npm run build` packs the source with lifecycle scripts disabled, installs and
checks that exact tarball in a clean offline consumer, and retains it at
`release/fayegram-ai-decision-bridge-VERSION.tgz`. The `release/` directory is Git-ignored.
Packing and individual verification commands have 120-second bounds; the combined
installed-consumer verification stage has a separate 600-second bound and streams
its progress. This accommodates CLI startup across multiple verification commands.
To check that archive again, run:

```text
node scripts/package-smoke.mjs --tarball release/fayegram-ai-decision-bridge-VERSION.tgz
```

Check public documentation against the implementation, including supported API
shapes, examples, limits, errors, and service compatibility notes. Inspect the MIT
copyright notice and package contents. Complete hosted checks relevant to changed
features using an authorized account/runtime;
fixture and declaration checks do not establish hosted binding/Gateway behavior.
Keep completed verification evidence separate from maintained consumer guidance.
These content and verification checks do not depend on publication account setup.

## Confirm publication prerequisites

Before publication, confirm the repository exists at the metadata destination and
inspect CI results for the exact release commit. Make sure the hosted repository
has a private vulnerability-reporting route as described in
[SECURITY.md](../../SECURITY.md). Confirm that the npm login can publish under
`@fayegram-ai`. Direct publication requires account 2FA or a granular token
permitted to bypass it; see [npm's requirements](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

Building only creates and checks the artifact; it does not publish it. The package
name and registry are `@fayegram-ai/decision-bridge` and the public npm registry.
Coordinate the GitHub source release and publication of the verified tarball to
npm as one release. The source release commit and archive must contain the same
intended files, including README and documentation. A packed or uploaded archive
is a snapshot: subsequent source edits do not change its contents.

The tracked `.npmrc` routes this scope to npm in this checkout without changing
the user's npm configuration. Keep credentials in the user configuration, never
in the repository. Verify the target with `npm config get @fayegram-ai:registry`
before staging or publishing. Replace `VERSION` and `STAGE_ID` below with the
package version and the returned stage identifier. The `./` prefix identifies a
local archive path to npm.

## Stage, inspect, and approve an archive

With npm CLI 11.15.0+ and package write access, stage the verified archive:

```text
npm stage publish ./release/fayegram-ai-decision-bridge-VERSION.tgz --access public --tag latest
npm stage view STAGE_ID --json
npm stage download STAGE_ID
```

Compare the downloaded archive's checksum with the retained artifact, then verify
that exact download using `node scripts/package-smoke.mjs --tarball PATH_TO_DOWNLOAD`.
The staged version becomes publicly installable when a maintainer approves it
with 2FA:

```text
npm stage approve STAGE_ID
```

Approval publishes that version; no additional `npm publish` is needed. A first
stage for a new package creates a public `0.0.0-stage` placeholder, which is not
the staged SDK. See [npm's staged publishing guide](https://docs.npmjs.com/staged-publishing/).

If packaged files change before approval, build and verify a fresh archive.
Reject the old stage with `npm stage reject STAGE_ID` (requires 2FA), then stage
the new archive and repeat inspection. A pending stage reserves its version, so
remove it before staging a replacement with the same unpublished version. See
the [npm stage reference](https://docs.npmjs.com/cli/v12/commands/npm-stage/).

## Direct publication alternative

For a version without a pending stage, publish the verified archive directly:

```text
npm publish ./release/fayegram-ai-decision-bridge-VERSION.tgz --access public --tag latest
```

After the coordinated release, confirm that the package page
links to the source repository and `npm install @fayegram-ai/decision-bridge` works.
Keep generated archives and verification logs outside tracked source.
