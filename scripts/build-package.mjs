import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmCommand } from './toolchain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = join(root, 'release');
const temporary = mkdtempSync(join(tmpdir(), 'decision-bridge-build-'));

function run(command, args, timeoutMs = 120000, inheritOutput = false) {
    const result = spawnSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: timeoutMs,
        stdio: inheritOutput ? 'inherit' : 'pipe',
    });
    if (result.status !== 0) {
        throw Error(`Package command failed: ${result.stderr || result.error || result.status}`);
    }
    return result.stdout;
}

try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const npm = npmCommand();
    const parsedPack = JSON.parse(run(npm.command, [
        ...npm.prefix, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary,
    ]));
    const packed = Array.isArray(parsedPack) ? parsedPack : Object.values(parsedPack);
    assert(Array.isArray(packed) && packed.length === 1, 'Expected one npm package artifact.');
    assert.equal(packed[0].name, pkg.name);
    assert.equal(packed[0].version, pkg.version);

    const tarball = resolve(temporary, packed[0].filename);
    assert.equal(dirname(tarball), temporary, 'Package filename must stay in the build directory.');
    assert(statSync(tarball).size > 0, 'Package artifact is empty.');

    // Allow aggregate CLI startup overhead while retaining each command's bound.
    // Stream progress and retain the artifact only after its exact bytes pass.
    run(process.execPath, [
        join(root, 'scripts/package-smoke.mjs'), '--tarball', tarball,
    ], 600000, true);
    mkdirSync(outputDirectory, { recursive: true });
    const output = join(outputDirectory, packed[0].filename);
    copyFileSync(tarball, output);
    console.log(`Built npm package: ${output}`);
} finally {
    rmSync(temporary, { recursive: true, force: true });
}
