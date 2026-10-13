import { optionsObject } from './options.mjs';
import { requireCondition as check, publicError } from './errors.mjs';
import { validateRequest } from './validation.mjs';
import { validateSignal } from './async.mjs';
import { assertCapabilities, LEGACY_CAPABILITIES } from './capabilities.mjs';

/** Ordered, bounded-concurrency batch. Validate every input before spending. */
export async function evaluateBatch(bridge, inputs, options = {}) {
  const { concurrency = 4, signal, stopOnError = false } = optionsObject(options, ['concurrency', 'signal', 'stopOnError'], 'Batch options');
  check(bridge && typeof bridge.evaluate === 'function', 'A bridge is required.', 'CONFIGURATION_ERROR');
  check(Array.isArray(inputs) && inputs.length <= 10000, 'inputs must be an array of at most 10000 requests.');
  check(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 64,
    'concurrency must be an integer from 1 to 64.', 'CONFIGURATION_ERROR');
  check(typeof stopOnError === 'boolean', 'stopOnError must be boolean.', 'CONFIGURATION_ERROR');
  validateSignal(signal);
  const requests = Array.from(inputs, input => typeof bridge.validate === 'function' ? bridge.validate(input)
    : assertCapabilities(validateRequest(input, bridge.defaultModel ?? ''), LEGACY_CAPABILITIES));
  const results = new Array(requests.length);
  let next = 0;
  let stopped = false;
  async function worker() {
    while (next < requests.length) {
      if (signal?.aborted || stopped) return;
      const index = next++;
      try { results[index] = { index, ok: true, result: await bridge.evaluate(requests[index], { signal }) }; }
      catch (error) {
        results[index] = { index, ok: false, error: publicError(error) };
        if (stopOnError) stopped = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));
  for (let index = 0; index < results.length; index++) {
    results[index] ??= { index, ok: false, error: { code: signal?.aborted ? 'ABORTED' : 'BATCH_SKIPPED',
      message: signal?.aborted ? 'Request cancelled before dispatch.' : 'Request skipped after a batch failure.' } };
  }
  return results;
}
