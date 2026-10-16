import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { OPENAI_DEFAULT_MODEL } from '../providers/openai-profile.mjs';
import { DecisionError, requireCondition as check } from '../errors.mjs';
import { validateConfig, NUMERIC, PROVIDER_FIELDS } from './config-validation.mjs';
import { jevDangerZone } from '../providers/jev-profile.mjs';
export { validateConfig } from './config-validation.mjs';
export { configuredProvider } from './provider-loader.mjs';

const ENV_FIELDS = {
    DECISION_PROVIDER: 'provider', DECISION_PRESET: 'preset', DECISION_MODEL: 'model', DECISION_BASE_URL: 'baseURL',
    DECISION_API_KEY_ENV: 'apiKeyEnv', DECISION_TIMEOUT_MS: 'timeoutMs',
    DECISION_MAX_RETRIES: 'maxRetries', DECISION_RESPONSE_FORMAT: 'responseFormat',
    DECISION_ACCOUNT_ID: 'accountId', DECISION_REJECT_IF_BUSY: 'rejectIfBusy', DECISION_GATEWAY_ID: 'gateway',
    DECISION_JEV_IMAGES: 'jevImages', DECISION_JEV_LONG_CONTEXT: 'jevLongContext',
};

async function boundedFile(path, maxBytes, label) {
  try {
    const info = await stat(path);
    check(info.isFile() && info.size <= maxBytes, `${label} must be a regular file within its size limit.`, 'CONFIGURATION_ERROR');
    const buffer = await readFile(path);
    check(buffer.length <= maxBytes, `${label} exceeds its size limit.`, 'CONFIGURATION_ERROR');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    if (error instanceof DecisionError) throw error;
    throw new DecisionError(`Cannot read ${label}; check its path, permissions, and UTF-8 encoding.`, { code: 'CONFIGURATION_ERROR' });
  }
}

/** Explicit file only. Flags > DECISION_* environment > file > defaults. */
export async function loadConfig({ configPath, envFile, overrides = {}, cwd = process.cwd(), env = process.env, allowIncomplete = false } = {}) {
  const effectiveEnv = { ...env };
  if (envFile) {
    const text = await boundedFile(resolve(cwd, envFile), 65536, 'environment file');
    let parsed;
    try { parsed = parseEnv(text); }
    catch { throw new DecisionError('Invalid environment file.', { code: 'CONFIGURATION_ERROR' }); }
    for (const [key, value] of Object.entries(parsed)) if (effectiveEnv[key] === undefined) effectiveEnv[key] = value;
  }
  let fileConfig = {};
  let moduleBase = cwd;
  if (configPath) {
    const path = resolve(cwd, configPath);
    const text = await boundedFile(path, 1048576, 'configuration file');
    try { fileConfig = JSON.parse(text); }
    catch { throw new DecisionError('Configuration file is not valid JSON.', { code: 'CONFIGURATION_ERROR' }); }
    fileConfig = validateConfig(fileConfig);
    moduleBase = dirname(path);
  }
  const environment = Object.create(null);
  for (const [key, field] of Object.entries(ENV_FIELDS)) {
    if (effectiveEnv[key] === undefined) continue;
    const value = effectiveEnv[key];
    if (NUMERIC.has(field)) check(typeof value === 'string' && /^\d+$/.test(value),
      'Numeric DECISION_* variables must contain decimal integers.', 'CONFIGURATION_ERROR');
    if (field === 'jevImages' || field === 'jevLongContext') {
      check(value === 'true' || value === 'false', 'Jev DECISION_* flags must be true or false.', 'CONFIGURATION_ERROR');
      environment.dangerZone = { ...(Object.hasOwn(environment, 'dangerZone') ? environment.dangerZone : {}),
        [field === 'jevImages' ? 'images' : 'longContext']: value === 'true' };
    } else if (field === 'rejectIfBusy') {
      check(value === 'true' || value === 'false', 'DECISION_REJECT_IF_BUSY must be true or false.', 'CONFIGURATION_ERROR');
      environment[field] = value === 'true';
    } else environment[field] = field === 'gateway' ? { id: value } : NUMERIC.has(field) ? Number(value) : value;
  }
  // Merge each precedence layer separately. A flag switching away from an
  // environment-selected provider must not inherit that provider's key/endpoint.
  function mergeProviderLayer(base, layer, layerModuleBase = moduleBase) {
    const next = { ...base };
    const dangerZone = Object.hasOwn(layer, 'dangerZone') ? layer.dangerZone : undefined;
    // Validate before spreading, without filling defaults that would erase a
    // different opt-in from a lower layer.
    if (dangerZone !== undefined) jevDangerZone(dangerZone);
    // File and flag paths have different bases. Equal path text can identify
    // different implementations; compare destinations before changing the base.
    const moduleChanged = layer.module !== undefined && (typeof layer.module !== 'string' ||
      base.module === undefined || resolve(layerModuleBase, layer.module) !== resolve(moduleBase, base.module));
    const changed = (layer.provider !== undefined && layer.provider !== (base.provider ?? 'jev'))
      || (layer.preset !== undefined && layer.preset !== base.preset)
      || moduleChanged;
    if (changed) for (const key of PROVIDER_FIELDS) delete next[key];
    if (layer.module !== undefined) moduleBase = layerModuleBase;
    return { ...next, ...layer,
      ...(dangerZone === undefined ? {} : { dangerZone: {
        ...(Object.hasOwn(next, 'dangerZone') ? next.dangerZone : {}), ...dangerZone,
      } }),
      ...(layer.gateway === undefined ? {} : { gateway: { ...next.gateway, ...layer.gateway } }) };
  }
  const config = validateConfig(mergeProviderLayer(mergeProviderLayer(
    { schemaVersion: 1, provider: 'jev', ...fileConfig }, environment), overrides, cwd), { complete: !allowIncomplete });
  if (config.provider === 'jev' && config.model === undefined && effectiveEnv.JEV_MODEL?.trim()) {
    config.model = effectiveEnv.JEV_MODEL.trim();
  }
  if (config.provider === 'openai-decisions' && config.model === undefined) config.model = OPENAI_DEFAULT_MODEL;
  if (config.provider === 'cloudflare-decisions' && config.model === undefined) config.model = 'clef';
  return { config, env: effectiveEnv, moduleBase };
}
