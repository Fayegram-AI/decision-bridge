import { optionsObject } from './options.mjs';
import { providerContract, resultProvenance } from './provider-contract.mjs';
import { VERSION } from './version.mjs';
import { DecisionError, requireCondition as check } from './errors.mjs';
import { JevProvider } from './providers/jev.mjs';
import { cloneJson, freezeJson, isRecord, validateRequest, validateResult } from './validation.mjs';
import { abortError, deadline, withSignal } from './async.mjs';
import { assertCapabilities, commonSchemaVersion, providerCapabilities } from './capabilities.mjs';
import { validateResultOptions } from './probabilities.mjs';

const elapsed = start => Math.round((performance.now() - start) * 1000) / 1000;

/** Stable interface. Prepare context, evaluate, validate, then observe immutable results. */
export function createBridge(options) {
    const configured = optionsObject(options,
        ['provider', 'jev', 'extensions', 'timeoutMs', 'observerTimeoutMs'], 'Bridge options');
    // Inherited fields are not explicit selections; never read inherited selectors.
    const provider = Object.hasOwn(configured, 'provider') ? configured.provider : undefined;
    const jev = Object.hasOwn(configured, 'jev') ? configured.jev : undefined;
    check((provider !== undefined) !== (jev !== undefined),
        'Configure exactly one of provider or jev.', 'CONFIGURATION_ERROR');
    const { extensions = [], timeoutMs = 60000, observerTimeoutMs = 1000 } = configured;
  const backend = provider !== undefined ? provider : new JevProvider(jev);
  const contract = providerContract(backend);
  for (const ms of [timeoutMs, observerTimeoutMs]) check(Number.isSafeInteger(ms) && ms > 0 && ms <= 2147483647,
    'Bridge timeouts must be positive 32-bit integers.', 'CONFIGURATION_ERROR');
  check(Array.isArray(extensions), 'extensions must be an array.', 'CONFIGURATION_ERROR');
  const registered = Array.from(extensions, extension => {
    optionsObject(extension, ['name', 'prepareState', 'prepareInput', 'onResult'], 'Extension');
    check(isRecord(extension) && typeof extension.name === 'string' && extension.name.trim() &&
      extension.name.length <= 100 && !/[\x00-\x1f\x7f]/.test(extension.name),
    'Each extension requires a printable name up to 100 characters.', 'CONFIGURATION_ERROR');
    for (const method of ['prepareState', 'prepareInput', 'onResult']) check(extension[method] === undefined || typeof extension[method] === 'function',
      'Extension handlers must be functions.', 'CONFIGURATION_ERROR');
    return { ...extension };
  });
  check(new Set(registered.map(e => e.name)).size === registered.length,
    'Extension names must be unique.', 'CONFIGURATION_ERROR');
  function validate(input) {
    const request = validateRequest(input, backend.defaultModel ?? '');
    assertCapabilities(request, providerCapabilities(backend, request.model));
    const method = Object.hasOwn(request, 'state') ? 'prepareState' : 'prepareInput';
    for (const extension of registered) {
      check(!(extension.prepareState || extension.prepareInput) || typeof extension[method] === 'function',
        `Preparation extension ${extension.name} cannot handle this input form.`, 'UNSUPPORTED_CAPABILITY');
    }
    freezeJson(request);
    if (backend.validateRequest) {
      try {
        const validation = backend.validateRequest(request);
        // Reject asynchronous preflight without leaving a rejected promise unobserved.
        if (validation !== undefined) Promise.resolve(validation).catch(() => {});
        check(validation === undefined, 'Provider validateRequest must be synchronous and return no value.', 'CONFIGURATION_ERROR');
      } catch (error) {
        if (error instanceof DecisionError) throw error;
        throw new DecisionError('Provider request validation failed.', { code: 'PROVIDER_ERROR' });
      }
    }
    return request;
  }

  return Object.freeze({
    provider: contract.name,
    providerKind: contract.kind,
    defaultModel: backend.defaultModel,
    getCapabilities(model = backend.defaultModel) { return providerCapabilities(backend, model); },
    validate,

    async evaluate(input, callOptions = {}) {
      const { signal, timeoutMs: callTimeoutMs = timeoutMs } = optionsObject(callOptions, ['signal', 'timeoutMs'], 'Call options');
      const started = performance.now();
      const budget = deadline(callTimeoutMs, signal);
      let request;
      let context;
      let result;
      try {
        budget.throwIfAborted();
        request = validate(input);
        context = Object.freeze({ provider: backend.name, model: request.model,
          questionIds: Object.freeze(Object.keys(request.questions)), signal: budget.signal });
        for (const extension of registered) {
          budget.throwIfAborted();
          const field = Object.hasOwn(request, 'state') ? 'state' : 'input';
          const method = field === 'state' ? 'prepareState' : 'prepareInput';
          if (!extension[method]) continue;
          let prepared;
          try {
            prepared = await withSignal(Promise.resolve().then(() => {
              budget.throwIfAborted();
              return extension[method](request[field], context);
            }), budget.signal);
          } catch (error) {
            if (budget.signal.aborted) throw error;
            throw new DecisionError(`Input preparation failed in extension ${extension.name}.`, { code: 'EXTENSION_ERROR' });
          }
          if (prepared !== undefined) request = validate({ ...request, [field]: prepared });
        }
        budget.throwIfAborted();
        let resultOptions;
        try {
          const supplied = backend.getResultValidationOptions ? backend.getResultValidationOptions(request.model) : {};
          // Intrinsic branding observes native Promises across realms without reading then accessors.
          if (!isRecord(supplied)) {
            try { Promise.prototype.then.call(supplied, () => {}, () => {}); }
            catch { /* Non-Promise policies are rejected below. */ }
          }
          resultOptions = validateResultOptions(supplied);
        }
        catch (error) {
          if (error instanceof DecisionError) throw error;
          throw new DecisionError('Provider result-validation policy lookup failed.', { code: 'PROVIDER_ERROR' });
        }
        let response;
        try {
          response = await withSignal(Promise.resolve().then(() => {
            budget.throwIfAborted();
            return backend.evaluate(request, { signal: budget.signal });
          }), budget.signal);
        } catch (error) {
          if (error instanceof DecisionError) throw error;
          throw new DecisionError('Custom provider evaluation failed.', { code: 'PROVIDER_ERROR' });
        }
        budget.throwIfAborted();
        response = validateResult(response, request.questions, resultOptions);
        result = freezeJson({ ...response, meta: {
          ...response.meta, provider: contract.name, providerKind: contract.kind, requestedModel: request.model,
          ...resultProvenance(contract, response),
          bridgeVersion: VERSION, schemaVersion: commonSchemaVersion(request),
          totalDurationMs: elapsed(started), observerDurationMs: 0, observerFailures: [],
        } });
        budget.throwIfAborted();
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (budget.timedOut) throw new DecisionError('Bridge evaluation deadline exceeded.', { code: 'TIMEOUT' });
        throw error;
      } finally { budget.close(); }

      const observationStarted = performance.now();
      const failures = [];
      for (const extension of registered) {
        if (!extension.onResult) continue;
        const observation = deadline(observerTimeoutMs, signal);
        try {
          observation.throwIfAborted();
          await withSignal(Promise.resolve().then(() => {
            observation.throwIfAborted();
            return extension.onResult(result, Object.freeze({ ...context, signal: observation.signal }));
          }), observation.signal);
          observation.throwIfAborted();
        } catch { failures.push(extension.name); }
        finally { observation.close(); }
      }
      // Observation failure must not induce retries of a successful billed call.
      return freezeJson({ ...result, meta: { ...result.meta,
        totalDurationMs: elapsed(started), observerDurationMs: elapsed(observationStarted), observerFailures: failures } });
    },

    async listModels(callOptions = {}) {
      const { signal, timeoutMs: callTimeoutMs = timeoutMs } = optionsObject(callOptions, ['signal', 'timeoutMs'], 'Call options');
      check(typeof backend.listModels === 'function', 'This provider does not implement listModels().', 'UNSUPPORTED_OPERATION');
      const budget = deadline(callTimeoutMs, signal);
      try {
        budget.throwIfAborted();
        const data = await withSignal(Promise.resolve().then(() => {
          budget.throwIfAborted();
          return backend.listModels({ signal: budget.signal });
        }), budget.signal);
        budget.throwIfAborted();
        const snapshot = cloneJson(data, 'model list', 'INVALID_RESPONSE');
        check(isRecord(snapshot) && Array.isArray(snapshot.models), 'Provider must return a models array.', 'INVALID_RESPONSE');
        check(snapshot.models.every(model => isRecord(model) && typeof model.name === 'string' && model.name.trim()),
          'Each listed model requires a name.', 'INVALID_RESPONSE');
        freezeJson(snapshot);
        budget.throwIfAborted();
        return snapshot;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (budget.timedOut) throw new DecisionError('Model-list deadline exceeded.', { code: 'TIMEOUT' });
        if (error instanceof DecisionError) throw error;
        throw new DecisionError('Provider model listing failed.', { code: 'PROVIDER_ERROR' });
      } finally { budget.close(); }
    },
  });
}
