import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { readdirSync } from 'node:fs';
import { npmCommand } from './toolchain.mjs';
import { isLocalOnlyPath } from './layout.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decisionsScenario, cloudflareScenario } from './package/native-scenarios.mjs';
import { jevScenario } from './package/jev-scenario.mjs';
import { customScenario, browserScenario, consumerTypes } from './package/custom-scenarios.mjs';
import { expansionScenario, expansionTypes } from './package/expansion-scenarios.mjs';
import { routingScenario, routingTypes } from './package/routing-scenarios.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'decision package '));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DECISION_') &&
  !['TYPESAFE_API_KEY', 'JEV_MODEL', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].includes(key)));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw Error(`${command} failed (${result.status}): ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
function runNpm(args, cwd) {
  const npm = npmCommand();
  return run(npm.command, [...npm.prefix, ...args], cwd);
}
try {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === '--tarball'),
    'Usage: node scripts/package-smoke.mjs [--tarball FILE]');
  const parsedPack = args.length ? null
    : JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root));
  const pack = args.length ? { filename: resolve(args[1]) }
    : (Array.isArray(parsedPack) ? parsedPack[0] : Object.values(parsedPack)[0]);
  if (pack.files) assert(!pack.files.some(file => /(^|\/)\.env$|\.git\/|node_modules\/|^test\//.test(file.path)));
  const tarball = resolve(temporary, pack.filename);
  const consumer = join(temporary, 'consumer'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"name":"package-smoke-consumer","private":true,"type":"module"}\n');
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', tarball], consumer);
  const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(name, '@fayegram-ai/decision-bridge');
  const script = `import assert from 'node:assert/strict';
import * as sdk from ${JSON.stringify(name)};
import { createBridge, DecisionError, noul, createProvider } from ${JSON.stringify(name)};
// Check the complete installed entry point against its public contract.
assert.deepEqual(Object.keys(sdk).sort(), [
    'createBridge', 'JevProvider', 'OpenAIDecisionsProvider', 'CloudflareDecisionsProvider',
    'createProvider', 'choice', 'noul', 'score', 'scoreLevels', 'box', 'decideChoice',
    'evaluateBatch', 'DecisionError', 'publicError',
    'validateRequest', 'validateResult',
].sort());
const failure = new DecisionError('Safe message');
assert.equal(failure.name, 'DecisionError');
assert.equal(failure.toJSON().code, 'DECISION_ERROR');
assert.throws(() => createBridge(), { code: 'CONFIGURATION_ERROR' });
assert.throws(() => createProvider(), { code: 'CONFIGURATION_ERROR' });
const bridge = createBridge({ provider: { kind: 'decision', name: 'package-test-fixture', defaultModel: 'fixture', async evaluate(r) {
  return { model: r.model, answers: { yes: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: null, output_tokens: null } };
} } });
const result = await bridge.evaluate({ state: 'Local package test, not live inference.', questions: { yes: noul('True?') } });
assert.equal(result.answers.yes.noul, 0.5);
assert.equal(result.meta.bridgeVersion, ${JSON.stringify(version)});
assert.equal(typeof createProvider, 'function');
assert.equal(result.meta.providerKind, 'decision');
assert.equal(bridge.providerKind, 'decision');
console.log('Installed SDK imports and evaluates a local test fixture.');\n`;
  writeFileSync(join(consumer, 'smoke.mjs'), script);
  console.log(run(process.execPath, ['smoke.mjs'], consumer).trim());
  const installed = join(consumer, 'node_modules', name);
  for (const [file, source] of [
    ['decisions-smoke.mjs', decisionsScenario(name)],
    ['cloudflare-smoke.mjs', cloudflareScenario(name)],
    ['jev-smoke.mjs', jevScenario(name)],
    ['custom-smoke.mjs', customScenario(name)],
    ['browser-smoke.mjs', browserScenario(name)],
    ['expansion-smoke.mjs', expansionScenario(name)],
    ['routing-smoke.mjs', routingScenario(name)],
  ]) {
    writeFileSync(join(consumer, file), source);
    console.log(run(process.execPath, [file], consumer).trim());
  }
  writeFileSync(join(consumer, 'types.mts'), consumerTypes(name) + expansionTypes(name) + routingTypes(name));
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM'], strict: true, noEmit: true, skipLibCheck: false }, files: ['types.mts'],
  }));
  const require = createRequire(import.meta.url);
  run(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', join(consumer, 'tsconfig.json')], consumer);
  console.log('Installed root/custom TypeScript export resolution passed.');
  assert.equal(run(process.execPath, [join(installed, 'bin/decision.mjs'), '--version'], consumer).trim(), version);
  assert.equal(JSON.parse(run(process.execPath, [join(installed, 'bin/decision.mjs'), 'validate'], consumer)).valid, true);

  for (const command of ['decision-bridge', 'decision', 'faye-decision']) {
    const binShim = join(consumer, 'node_modules/.bin', command + (process.platform === 'win32' ? '.cmd' : ''));
    assert(existsSync(binShim), `Missing installed command: ${command}`);
    const help = runNpm(['exec', '--offline', '--', command, '--help'], consumer);
    assert.match(help, /Usage:\s*decision-bridge init/);
    assert.match(help, /Command aliases: decision, faye-decision/);
    assert.equal(runNpm(['exec', '--offline', '--', command, '--version'], consumer).trim(), version);
    console.log(`Installed ${command} help and version checks passed.`);
  }
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).bin).sort(),
    ['decision', 'decision-bridge', 'faye-decision']);
  const installedCli = (...args) => run(process.execPath, [join(installed, 'bin/decision.mjs'), ...args], consumer);
  assert.match(installedCli('--help'), /Usage:\s*decision-bridge init/);
  const initialized = JSON.parse(runNpm(['exec', '--offline', '--', 'decision-bridge', 'init', './my-decisions'], consumer));
  assert.equal(initialized.initialized, true);
  for (const file of ['decision.config.json', 'decision.config.schema.json', 'request.json', '.env.example', '.gitignore']) {
    assert(existsSync(join(consumer, 'my-decisions', file)), `Installed CLI did not create ${file}.`);
  }
  assert.equal(JSON.parse(runNpm(['exec', '--offline', '--', 'faye-decision', 'validate', './my-decisions/request.json'], consumer)).valid, true);
  assert.equal(JSON.parse(installedCli('schema', './my-decisions/request.json')).type, 'object');
  // Exercise installed commands without contacting a model account.
  writeFileSync(join(consumer, 'provider.mjs'), `export function createProvider() {
    return {
      kind: 'decision', name: 'package-cli-fixture', defaultModel: 'fixture', probabilitySource: 'synthetic',
      async evaluate(request) {
        return { model: request.model, answers: { yes: { type: 'noul', noul: 0.5 } },
          usage: { input_tokens: null, output_tokens: null } };
      },
      async listModels() { return { models: [{ name: 'fixture' }] }; },
    };
  }\n`);
  const offlineRequest = { state: 'package check', questions: { yes: { type: 'noul', instructions: 'True?' } } };
  writeFileSync(join(consumer, 'request.json'), JSON.stringify(offlineRequest));
  assert.equal(JSON.parse(installedCli('evaluate', './request.json', '--provider', 'custom-decision', '--provider-module', './provider.mjs'))
    .answers.yes.noul, 0.5);
  assert.equal(JSON.parse(installedCli('models', '--provider', 'custom-decision', '--provider-module', './provider.mjs'))
    .models[0].name, 'fixture');
  writeFileSync(join(consumer, 'requests.jsonl'), `${JSON.stringify(offlineRequest)}\n${JSON.stringify(offlineRequest)}\n`);
  const batch = installedCli('batch', './requests.jsonl', '--provider', 'custom-decision', '--provider-module', './provider.mjs')
    .trim().split('\n').map(JSON.parse);
  assert.deepEqual(batch.map(record => [record.line, record.ok, record.result.answers.yes.noul]),
    [[1, true, 0.5], [2, true, 0.5]]);
  const cloudflareInit = JSON.parse(installedCli('init', './my-clef', '--provider', 'cloudflare-decisions', '--native'));
  assert.equal(cloudflareInit.provider, 'cloudflare-decisions');
  assert.equal(JSON.parse(installedCli('validate', './my-clef/request.json', '--provider', 'cloudflare-decisions', '--native')).valid, true);
  installedCli('init', './my-omni', '--provider', 'cloudflare-decisions', '--model', 'clef-omni', '--native');
  assert.equal(JSON.parse(installedCli('validate', './my-omni/request.json', '--provider', 'cloudflare-decisions', '--native')).valid, true);
  assert(existsSync(join(installed, 'src/cloudflare-decisions.d.mts')));
  assert(existsSync(join(installed, 'src/index.d.mts')));
  console.log('Installed offline CLI initialization, schema, model listing and batch checks passed.');
  // Verify actual installed bytes and every relative Markdown link, not just an import.
  function files(directory, prefix = '') {
    return readdirSync(directory, { withFileTypes: true }).flatMap(item => {
      const name = prefix + item.name;
      assert(!item.isSymbolicLink(), 'Unexpected symlink in installed package.');
      return item.isDirectory() ? files(join(directory, item.name), name + '/') : [name];
    });
  }
  const installedFiles = files(installed);
  assert(installedFiles.includes('README.md'), 'README.md missing from installed package.');
  assert(!installedFiles.includes('.npmrc'), 'Project npm configuration leaked into installed package.');
  for (const name of installedFiles) {
    assert(!isLocalOnlyPath(name), `Local material leaked into npm package: ${name}`);
    assert(!/(^|\/)\.env$|^(?:test|scripts|benchmarks|\.github)\//.test(name), `Development-only file in npm package: ${name}`);
    assert(existsSync(join(root, name)), `Unexpected installed file: ${name}`);
    assert.deepEqual(readFileSync(join(installed, name)), readFileSync(join(root, name)), `Installed content mismatch: ${name}`);
    if (!name.endsWith('.md')) continue;
    for (const match of readFileSync(join(installed, name), 'utf8').matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      assert(existsSync(resolve(dirname(join(installed, name)), decodeURIComponent(target))), `Broken installed-doc link: ${name} -> ${target}`);
    }
  }
  for (const directory of ['src', 'bin', 'docs', 'examples', 'schemas']) {
    for (const name of files(join(root, directory), directory + '/')) {
      if (/(^|\/)\.gitignore$/.test(name)) continue;
      assert(installedFiles.includes(name), `Missing installed file: ${name}`);
    }
  }
  console.log(`Installed package bytes and documentation links verified (${installedFiles.length} files).`);
  console.log(`npm tarball ${pack.filename}: clean offline installation, CLI commands, SDK exports, bundled sample and declarations passed.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
