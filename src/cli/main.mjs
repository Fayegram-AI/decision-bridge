import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DecisionError, requireCondition as check, publicError } from '../errors.mjs';
import { createBridge } from '../bridge.mjs';
import { abortError, deadline, withSignal } from '../async.mjs';
import { VERSION } from '../version.mjs';
import { validateRequest } from '../validation.mjs';
import { assertCapabilities, builtInCapabilities } from '../capabilities.mjs';
import { decisionProfile } from './decisions.mjs';
import { initialize } from './initialize.mjs';
import { isModule } from './config-validation.mjs';
import { loadConfig, configuredProvider } from './config.mjs';
import { assertDistinctFiles, createWriter, readJson, readJsonLines } from './io.mjs';
import { mapOrdered } from './ordered.mjs';

const SAMPLE_PATH = fileURLToPath(new URL('../../examples/request.json', import.meta.url));
const BOOLS = ['help', 'version', 'pretty', 'compact', 'no-auth', 'force', 'native', 'reject-if-busy', 'no-reject-if-busy'];
const STRINGS = ['config', 'env-file', 'provider', 'preset', 'model', 'base-url', 'api-key-env', 'timeout-ms',
  'retries', 'max-tokens', 'response-format', 'token-parameter', 'input', 'output', 'concurrency', 'provider-module', 'account-id', 'gateway-id'];
const FIELD_MAP = { preset: 'preset', provider: 'provider', model: 'model', 'base-url': 'baseURL', 'api-key-env': 'apiKeyEnv',
  'timeout-ms': 'timeoutMs', retries: 'maxRetries', 'max-tokens': 'maxTokens',
  'response-format': 'responseFormat', 'token-parameter': 'tokenParameter', 'provider-module': 'module', 'account-id': 'accountId' };

export const HELP = `decision-bridge ${VERSION} — typed decisions, Jev by default

Usage:
  decision-bridge init [directory] [--provider NAME] [--model MODEL]
  decision-bridge evaluate [request.json | -] [options]    (aliases: eval, ask)
  decision-bridge validate [request.json | -] [options]    (offline)
  decision-bridge schema [request.json | -] [options]      (offline generative schema)
  decision-bridge models [options]
  decision-bridge batch requests.jsonl [--concurrency 4] [options]

Command aliases: decision, faye-decision

Native providers: jev, openai-decisions, cloudflare-decisions
Custom paths: custom-decision, custom-generative
Generative presets: openai-compatible, openrouter, anthropic

Options:
  --config FILE             Explicit JSON configuration; never auto-discovered
  --env-file FILE           Explicit .env file; existing environment takes precedence
  --provider NAME           Select backend; default jev
  --preset NAME             Preset for provider custom-generative
  --model ID                Override even the model in the input request
  --base-url URL            API base URL; custom endpoints need --api-key-env
  --api-key-env NAME        Read credential from this environment variable
  --no-auth                 Local OpenAI-compatible endpoint only
  --timeout-ms N            End-to-end evaluation/provider deadline
  --retries N               HTTP retries, 0–10; Decisions default 0, others 2
  --native                  Selected decision provider native format (init/evaluate/validate/batch)
  --account-id ID           Cloudflare account (otherwise CLOUDFLARE_ACCOUNT_ID)
  --reject-if-busy          Unavailable for Clef REST; rejected before inference
  --no-reject-if-busy       Explicitly disable Cloudflare capacity rejection
  --gateway-id ID           Use an existing Cloudflare AI Gateway
  --max-tokens N            Generative output-token budget; default 4096
  --response-format FORMAT  json_schema (default), json_object, or text
  --token-parameter NAME    max_completion_tokens or max_tokens
  --provider-module FILE    Trusted ESM module; explicitly select a custom path
  --input FILE              Alternative to positional request filename
  --output FILE, -o FILE    Atomic file output (0600); default stdout
  --force                   Explicitly replace an existing --output file
  --concurrency N           Batch maximum in-flight calls, 1–64; default 4
  --pretty / --compact      JSON layout; default pretty (batch is always JSONL)
  --help, -h / --version, -v

Without an input file, evaluate/validate/schema use the bundled sample.
No credentials, file reads, or network calls are needed for help/version.
All API calls are explicit; evaluate/models/batch may access paid services.
Exit codes: 0 success; 1 provider/partial-batch failure; 2 input/config/IO;
            130 interrupted. A closed downstream pipe exits 0.
`;

function argumentsFor(argv) {
  try {
    const options = Object.fromEntries([
      ...BOOLS.map(name => [name, { type: 'boolean', ...(name === 'help' ? { short: 'h' } : name === 'version' ? { short: 'v' } : {}) }]),
      ...STRINGS.map(name => [name, { type: 'string', ...(name === 'output' ? { short: 'o' } : {}) }]),
    ]);
    const parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true, tokens: true });
    const seen = new Set();
    for (const token of parsed.tokens) if (token.kind === 'option') {
      check(!seen.has(token.name), 'Duplicate CLI option.', 'USAGE_ERROR');
      seen.add(token.name);
    }
    for (const name of STRINGS) if (parsed.values[name] !== undefined) {
      check(parsed.values[name].trim().length > 0, 'String CLI options must not be empty.', 'USAGE_ERROR');
    }
    return parsed;
  } catch (error) {
    if (error instanceof DecisionError) throw error;
    throw new DecisionError('Invalid CLI arguments. Run --help for supported options.', { code: 'USAGE_ERROR' });
  }
}

function overridesFor(values) {
  const overrides = {};
  for (const [flag, field] of Object.entries(FIELD_MAP)) if (values[flag] !== undefined) {
    const value = values[flag];
    if (['timeoutMs', 'maxRetries', 'maxTokens'].includes(field)) {
      check(/^\d+$/.test(value), 'Numeric flags require decimal integers.', 'USAGE_ERROR');
      overrides[field] = Number(value);
    } else overrides[field] = value;
  }
  if (values['no-auth']) overrides.noAuth = true;
  check(!(values['reject-if-busy'] && values['no-reject-if-busy']), 'Choose one reject-if-busy flag.', 'USAGE_ERROR');
  if (values['reject-if-busy'] || values['no-reject-if-busy']) overrides.rejectIfBusy = !!values['reject-if-busy'];
  if (values['gateway-id'] !== undefined) overrides.gateway = { id: values['gateway-id'] };
  return overrides;
}

const INPUT_CODES = new Set(['USAGE_ERROR', 'CONFIGURATION_ERROR', 'VALIDATION_ERROR', 'UNSUPPORTED_CAPABILITY', 'IO_ERROR', 'INPUT_TOO_LARGE', 'REQUEST_TOO_LARGE']);
export function exitCode(error) {
  return error?.code === 'ABORTED' ? 130 : INPUT_CODES.has(error?.code) ? 2 : 1;
}

function scrub(value, env, explicitSecret) {
  const secrets = Object.entries(env).filter(([name, secret]) => typeof secret === 'string' &&
    secret.length >= 4 && /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name)).map(([, secret]) => secret);
  if (typeof explicitSecret === 'string' && explicitSecret) secrets.push(explicitSecret);
  function visit(item) {
    if (typeof item === 'string') {
      for (const secret of secrets) item = item.split(secret).join('[REDACTED]');
      return item;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    return item;
  }
  return visit(value);
}

export async function runCli(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr,
  cwd = process.cwd(), env = process.env, signal } = {}) {
  let writer;
  let activeEnv = env;
  let explicitSecret;
  const internal = new AbortController();
  const cancelled = () => internal.abort();
  if (signal?.aborted) cancelled();
  signal?.addEventListener('abort', cancelled, { once: true });
  try {
    const { values, positionals } = argumentsFor(argv);
    if (values.help || (positionals.length === 0 && !values.version)) { stdout.write(HELP); return 0; }
    if (values.version) { stdout.write(VERSION + '\n'); return 0; }
    const aliases = { eval: 'evaluate', ask: 'evaluate' };
    const command = aliases[positionals[0]] ?? positionals[0];
    if (command === 'help') { stdout.write(HELP); return 0; }
    if (internal.signal.aborted) throw abortError();
    check(['evaluate', 'validate', 'schema', 'models', 'init', 'batch'].includes(command), 'Unknown command. Run --help.', 'USAGE_ERROR');
    check(positionals.length <= (command === 'models' ? 1 : 2), 'Too many positional arguments.', 'USAGE_ERROR');
    check(!(values.input && positionals[1]), 'Supply either --input or a positional file, not both.', 'USAGE_ERROR');
    check(!(values.pretty && values.compact), 'Choose --pretty or --compact, not both.', 'USAGE_ERROR');
    check(!values.concurrency || command === 'batch', '--concurrency applies only to batch.', 'USAGE_ERROR');
    check(!values.force || (values.output && values.output !== '-'), '--force requires a file output.', 'USAGE_ERROR');
    check(command !== 'init' || (!values.input && !values.output), 'init does not accept --input or --output.', 'USAGE_ERROR');
    check(command !== 'models' || !values.input, 'models does not accept --input.', 'USAGE_ERROR');
    let concurrency;
    if (command === 'batch') {
      check(values.input || positionals[1], 'batch requires an explicit JSONL filename or -.', 'USAGE_ERROR');
      check(values.concurrency === undefined || /^\d+$/.test(values.concurrency), 'concurrency requires a decimal integer.', 'USAGE_ERROR');
      concurrency = Number(values.concurrency ?? 4);
      check(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 64,
        'concurrency must be from 1 to 64.', 'USAGE_ERROR');
    }
    const loaded = await loadConfig({ configPath: values.config, envFile: values['env-file'],
      overrides: overridesFor(values), cwd, env, allowIncomplete: command === 'init' });
    const profile = decisionProfile(loaded.config.provider);
    check(!values.native || (profile && ['init', 'evaluate', 'validate', 'batch'].includes(command)),
      '--native requires a decision provider and init/evaluate/validate/batch.', 'USAGE_ERROR');
    check(!values.native || command === 'init' || values.input || positionals[1],
      '--native requires an explicit input file or -.', 'USAGE_ERROR');
    check(command !== 'models' || !profile,
      'This decision provider does not implement model listing.', 'UNSUPPORTED_OPERATION');
    activeEnv = loaded.env;
    explicitSecret = loaded.config.apiKeyEnv ? activeEnv[loaded.config.apiKeyEnv] : undefined;
    const inputPath = values.input ?? positionals[1] ?? SAMPLE_PATH;
    if (values.output && values.output !== '-' && inputPath !== '-') {
      await assertDistinctFiles(inputPath, values.output, cwd);
    }
    writer = await createWriter({ output: values.output, force: values.force, stdout, cwd, signal: internal.signal });
    const writeJson = value => writer.write(JSON.stringify(value, null, values.compact ? 0 : 2) + '\n');
    const context = { stdin, cwd, signal: internal.signal, maxInputBytes: profile?.inputLimit };
    const withModel = input => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
      // Apply the configured fallback independently of a custom factory's default.
      // Preserve explicit request values (including invalid ones) for validation.
      const model = values.model ?? (isModule(loaded.config) && !Object.hasOwn(input, 'model')
        ? loaded.config.model : undefined);
      const request = model === undefined ? input : { ...input, model };
      if (values.native && (values['reject-if-busy'] || values['no-reject-if-busy'])) {
        check(request.options === undefined || (request.options !== null && typeof request.options === 'object' &&
          !Array.isArray(request.options)), 'Native execution options must be an object.');
        return { ...request, options: { ...request.options, rejectIfBusy: !!values['reject-if-busy'] } };
      }
      return request;
    };
    const validateInput = raw => {
      if (values.native) return profile.native(raw, profile.options(loaded.config));
      if (profile && command !== 'schema') return profile.common(raw, profile.options(loaded.config));
      const request = validateRequest(raw, raw?.model ?? loaded.config.model ?? 'validation-only');
      if (!isModule(loaded.config)) assertCapabilities(request,
        builtInCapabilities(loaded.config.provider, request.model));
      return request;
    };
    if (command === 'init') {
      await writeJson(await initialize(resolve(cwd, positionals[1] ?? '.'), loaded.config, values.native, loaded.moduleBase));
    } else if (command === 'validate' || command === 'schema') {
      const raw = withModel(await readJson(inputPath, context));
      const selectedModel = raw?.model ?? loaded.config.model ?? (loaded.config.provider === 'jev' ? 'jev-latest' : null);
      const request = validateInput(raw);
      const buildResponseSchema = command === 'schema'
        ? (await import('../custom/generative/schema.mjs')).buildResponseSchema : undefined;
      await writeJson(command === 'schema' ? buildResponseSchema(request.questions)
        : { valid: true, validationScope: isModule(loaded.config) ? 'structure' : 'provider', questionCount: Object.keys(request.questions).length, model: selectedModel,
          ...(profile?.resolveModel ? { resolvedModel: profile.resolveModel(request.model) } : {}),
          ...(values.native ? { native: true } : {}) });
    } else {
      let request;
      if (command === 'evaluate') {
        // Validate before constructing a provider or issuing any network request.
        request = withModel(await readJson(inputPath, context));
        // Validate structure without inventing the custom provider's default model.
        // The actual model is resolved by bridge.evaluate after provider creation.
        validateInput(request);
      }
      const provider = await configuredProvider(loaded, { signal: internal.signal });
      const bridge = createBridge({ provider, timeoutMs: loaded.config.timeoutMs ?? 60000 });
      async function evaluateInput(input) {
        if (!values.native) return bridge.evaluate(input, { signal: internal.signal });
        const budget = deadline(loaded.config.timeoutMs ?? 60000, internal.signal);
        try {
          budget.throwIfAborted();
          const result = await withSignal(Promise.resolve().then(() => {
            const request = validateInput(input);
            budget.throwIfAborted();
            return provider.createDecision(request, { signal: budget.signal });
          }), budget.signal);
          budget.throwIfAborted();
          return result;
        } catch (error) {
          if (internal.signal.aborted) throw abortError();
          if (budget.timedOut) throw new DecisionError('Native decision deadline exceeded.', { code: 'TIMEOUT' });
          throw error;
        } finally { budget.close(); }
      }
      if (command === 'models') await writeJson(await bridge.listModels({ signal: internal.signal }));
      else if (command === 'evaluate') await writeJson(await evaluateInput(request));
      else {
        let failed = false;
        async function evaluateLine(row) {
          if (row.error) return { line: row.line, ok: false, error: row.error };
          try { return { line: row.line, ok: true, result: await evaluateInput(withModel(row.input)) }; }
          catch (error) { return { line: row.line, ok: false, error: scrub(publicError(error), activeEnv, explicitSecret) }; }
        }
        try {
          for await (const record of mapOrdered(readJsonLines(inputPath, context), evaluateLine,
            { concurrency, signal: internal.signal })) {
            if (!record.ok) failed = true;
            await writer.write(JSON.stringify(record) + '\n');
          }
        } catch (error) {
          internal.abort();
          throw error;
        }
        await writer.finish();
        return internal.signal.aborted ? 130 : failed ? 1 : 0;
      }
    }
    await writer.finish();
    return 0;
  } catch (error) {
    internal.abort();
    await writer?.abort();
    if (error?.code === 'EPIPE') return 0;
    const safe = scrub(publicError(error), activeEnv, explicitSecret);
    stderr.write(JSON.stringify({ error: safe }) + '\n');
    return exitCode(error);
  } finally { signal?.removeEventListener('abort', cancelled); }
}
