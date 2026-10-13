// Prefer a project-local compiler; otherwise use the compiler available on PATH.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const windows = process.platform === 'win32';
let executable = windows ? 'cmd.exe' : 'tsc';
let args = windows
    ? ['/d', '/s', '/c', 'tsc --project tsconfig.json']
    : ['--project', 'tsconfig.json'];

try {
    args = [require.resolve('typescript/bin/tsc'), '--project', 'tsconfig.json'];
    executable = process.execPath;
} catch {
    // PATH is a fallback for source users without the pinned development install.
}

for (const project of ['tsconfig.json', 'tsconfig.workers.json']) {
    const projectArgs = args.map(argument => argument.replace('tsconfig.json', project));
    const result = spawnSync(executable, projectArgs, {
        cwd: new URL('..', import.meta.url),
        stdio: 'inherit',
    });
    if (result.error) {
        console.error('TypeScript is required for this development check. Install typescript@5.8.3 or provide tsc on PATH.');
    }
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
