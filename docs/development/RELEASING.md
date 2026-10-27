# Packaging and release

The build packages the ESM source directly, without a compilation step. The versioned
tarball contains the runtime, TypeScript declarations, examples, and maintained docs.
Tests and development scripts remain in the source repository.

## Verify source and package contents

From a clean source checkout, verify the code and build the installable artifact:

```text
npm run check
npm run test:coverage
npm run typecheck
npm run build
```

`npm run build` packages the source, verifies the package, and writes
`release/fayegram-ai-decision-bridge-VERSION.tgz`. The `release/` directory is
Git-ignored. Use a new package version for each publication and preserve published
archives unchanged. See [Testing](TESTING.md) for details of the checks.

To verify an existing package archive, run:

```text
node scripts/package-smoke.mjs --tarball release/fayegram-ai-decision-bridge-VERSION.tgz
```

Review the changelog, API examples, compatibility notes, license, and package
contents before publication. Include relevant verification results and compatibility
limits in the pull request.

## Confirm publication prerequisites

Before publication, inspect CI results for the release commit. Make sure the repository
has a private vulnerability-reporting route as described in
[SECURITY.md](../../SECURITY.md). Confirm that the npm login can publish under
`@fayegram-ai`. Direct publication requires account 2FA or a granular token
permitted to bypass it; see [npm's requirements](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

The package name is `@fayegram-ai/decision-bridge` on the public npm registry.
Finalize the changelog, documentation and version fields before building. If
packaged files change afterward, rebuild and verify the archive before publication.

The tracked `.npmrc` routes this scope to npm in this checkout without changing
the user's npm configuration. Keep credentials in the user configuration, never
in the repository. Verify the target with `npm config get @fayegram-ai:registry`
before staging or publishing. Replace `VERSION` and `STAGE_ID` below with the
package version and the returned stage identifier. The `./` prefix identifies a
package file on the filesystem to npm.

## Publish the source release

Submit release changes to `main` through a pull request. Review the changes since
the previous release, including the changelog, version fields and package contents.
After the checks pass, squash-merge the pull request and create the
`decision-bridge-vVERSION` tag from the merged commit. Preserve existing release
commits and tags.

Build the release archive from that commit and attach it to the GitHub release
with concise notes describing the changes. Publish the same verified archive to
npm using one of the methods below.

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

After publication, check the GitHub tag and release page, npm version and package
links, then install the published version in a clean project. Confirm that the
downloaded archive matches the verified build.
Keep generated archives and verification logs outside tracked source.
