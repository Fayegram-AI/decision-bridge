import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.mjs';
import { isLocalOnlyPath } from './layout.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
let failed = false;
function walk(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (isLocalOnlyPath(relative(root, path))) continue;
    if (item.isDirectory()) { walk(path); continue; }
    if (/\.(?:mjs|mts|md|json|ya?ml)$/.test(path)) {
      const content = readFileSync(path, 'utf8');
      if (!content.endsWith('\n') || /[\t ]+\r?$/m.test(content)) {
        console.error(`Whitespace/newline issue: ${relative(root, path)}`); failed = true;
      }
    }
    if (path.endsWith('.md')) {
      const content = readFileSync(path, 'utf8');
      for (const match of content.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        if (!existsSync(resolve(dirname(path), decodeURIComponent(target)))) {
          console.error(`Broken local documentation link: ${relative(root, path)} -> ${target}`); failed = true;
        }
      }
    }
    if (path.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) { console.error(result.stderr); failed = true; }
    }
    if (path.endsWith('.json')) {
      try { JSON.parse(readFileSync(path, 'utf8')); }
      catch { console.error(`Invalid JSON: ${relative(root, path)}`); failed = true; }
    }
  }
}
walk(root);
// Ignore rules can be bypassed with `git add -f`; reject local-only paths in the index.
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
if (tracked.status !== 0) {
    console.error('Could not inspect tracked source files.'); failed = true;
} else {
    for (const path of tracked.stdout.split('\0').filter(Boolean)) {
        if (isLocalOnlyPath(path)) {
            console.error(`Local-only file tracked in public source: ${path}`); failed = true;
        }
    }
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const evaluationScript = /(?:^|[/\\:._\-\s])(?:datasets?|benchmarks?|evals?|evaluations?|experiments?)(?=$|[/\\:._\-\s])/i;
for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (evaluationScript.test(name) || evaluationScript.test(command)) {
        console.error(`Model-evaluation script is not public source: ${name}`); failed = true;
    }
}
if (VERSION !== pkg.version) { console.error('Runtime version mismatch.'); failed = true; }
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version ||
    lock.name !== pkg.name || lock.packages?.['']?.name !== pkg.name) {
    console.error('Lockfile package identity mismatch.'); failed = true;
}
const bins = mapping => Object.entries(mapping ?? {}).map(([name, path]) => [name, path.replace(/^\.\//, '')])
    .sort(([left], [right]) => left.localeCompare(right));
if (JSON.stringify(bins(pkg.bin)) !== JSON.stringify(bins(lock.packages?.['']?.bin)) ||
    Object.values(pkg.bin ?? {}).some(path => !existsSync(join(root, path)))) {
    console.error('CLI executable mapping mismatch.'); failed = true;
}
if (!failed) console.log('Source layout, JavaScript syntax, JSON, formatting, local documentation links, and version checks passed.');
process.exitCode = failed ? 1 : 0;
