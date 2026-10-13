// Synthetic CLI fixtures and temporary workspaces for local software tests.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';

const bin = fileURLToPath(new URL('../bin/decision.mjs', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));

export const one = { state: 'test', questions: { yes: { type: 'noul', instructions: 'Is this a test?' } } };

const moduleText = `export function createProvider({ model = 'local-test-fixture' } = {}) {
  return { kind: 'decision', name: 'fixture-only', defaultModel: model, probabilitySource: 'synthetic',
    async evaluate(request) {
      if (request.state === 'slow') await new Promise(r => setTimeout(r, 30));
      return { model: request.model, answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: 'noul', noul: 0.42 }])),
        usage: { input_tokens: 0, output_tokens: 0 } };
    }, async listModels() { return { models: [{ name: model }] }; }
  };
}`;

export function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DECISION_') &&
    !['TYPESAFE_API_KEY', 'JEV_MODEL', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].includes(key)));
  return { ...env, ...extra };
}

export function child(args, { cwd = root, input, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [bin, ...args], { cwd, env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });
    proc.on('error', reject);
    proc.stdin.on('error', () => {});
    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.stdin.end(input);
  });
}

export async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'decision-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'request.json'), JSON.stringify(one));
  await writeFile(join(directory, 'provider.mjs'), moduleText);
  return directory;
}

export function streams() {
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  let out = ''; let err = '';
  stdout.on('data', c => { out += c; }); stderr.on('data', c => { err += c; });
  return { stdin, stdout, stderr, output: () => out, error: () => err };
}

export async function temporaryWorkspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'decision-bridge-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}
