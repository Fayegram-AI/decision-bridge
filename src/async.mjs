import { DecisionError, requireCondition as check } from './errors.mjs';

// Carry absolute deadlines through our nested AbortSignals without changing their public shape.
const signalDeadlines = new WeakMap();

export function validateSignal(signal) {
  check(signal === undefined || signal instanceof AbortSignal,
    'signal must be an AbortSignal.', 'CONFIGURATION_ERROR');
}

export function abortError() {
  return new DecisionError('Request cancelled by caller.', { code: 'ABORTED' });
}

/** Bound caller-visible waiting even when user-supplied code ignores the signal. */
export function withSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(abortError()); };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); },
    );
  });
}

export function deadline(timeoutMs, parent) {
  validateSignal(parent);
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2147483647,
    'timeoutMs must be a positive 32-bit integer.', 'CONFIGURATION_ERROR');
  const controller = new AbortController();
  const expiresAt = Math.min(performance.now() + timeoutMs, signalDeadlines.get(parent) ?? Infinity);
  signalDeadlines.set(controller.signal, expiresAt);
  let timedOut = false;
  let closed = false;
  const expire = () => { timedOut = true; controller.abort(); };
  // Timers cannot fire during synchronous validation, encoding or user callbacks.
  const refresh = () => {
    if (!closed && !controller.signal.aborted && performance.now() >= expiresAt) expire();
  };
  const cancel = () => controller.abort();
  if (parent?.aborted) cancel();
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(expire, Math.max(0, Math.ceil(expiresAt - performance.now())));
  return {
    signal: controller.signal,
    get timedOut() { refresh(); return timedOut; },
    get remainingMs() { return Math.max(0, expiresAt - performance.now()); },
    throwIfAborted() { refresh(); if (controller.signal.aborted) throw abortError(); },
    close() {
      closed = true;
      clearTimeout(timer);
      signalDeadlines.delete(controller.signal);
      parent?.removeEventListener('abort', cancel);
    },
  };
}
