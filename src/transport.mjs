import { DecisionError, requireCondition as check } from './errors.mjs';
import { JsonResponseTransport } from './response-transport.mjs';
export { serializeRequestBody, sanitizeId } from './response-transport.mjs';

export function parseBaseURL(baseURL, { originOnly = false } = {}) {
  check(typeof baseURL === 'string' && !baseURL.includes('\\'), 'Invalid baseURL.', 'CONFIGURATION_ERROR');
  let url;
  try { url = new URL(baseURL); }
  catch { throw new DecisionError('Invalid baseURL.', { code: 'CONFIGURATION_ERROR' }); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  check(url.protocol === 'https:' || (url.protocol === 'http:' && loopback),
    'Use HTTPS; HTTP is permitted only for loopback endpoints.', 'CONFIGURATION_ERROR');
  check(!url.username && !url.password && !url.search && !url.hash,
    'baseURL must not contain credentials, a query, or a fragment.', 'CONFIGURATION_ERROR');
  check(!originOnly || url.pathname === '/', 'This provider requires an origin-only baseURL.', 'CONFIGURATION_ERROR');
  return { baseURL: url.href.replace(/\/+$/, ''), loopback, origin: url.origin };
}

export function validateApiKey(value, label = 'API key') {
  check(typeof value === 'string' && value.trim().length > 0 && !/[\x00-\x20\x7f]/.test(value.trim()) &&
    !/^(replace_with_|your_actual_|your_real_|paste_)/i.test(value.trim()),
  `Set ${label} or supply a valid apiKey.`, 'CONFIGURATION_ERROR');
  return value.trim();
}

/** HTTP dispatch backed by the same bounded exchange as binding transports. */
export class JsonTransport {
    #baseURL;
    #headers;
    #fetch;
    #responses;

    constructor({ baseURL, headers = {}, fetchImpl = (input, init) => globalThis.fetch(input, init),
        ...options } = {}) {
        this.#baseURL = parseBaseURL(baseURL).baseURL;
        check(typeof fetchImpl === 'function', 'fetchImpl must be a function.', 'CONFIGURATION_ERROR');
        this.#headers = Object.freeze({ ...headers });
        this.#fetch = fetchImpl;
        this.#responses = new JsonResponseTransport(options);
    }

    async request(method, path, body, callOptions = {}) {
        check(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') &&
            !/[\\?#]/.test(path), 'Invalid provider request path.', 'CONFIGURATION_ERROR');
        return this.#responses.request(body, (serialized, signal) => this.#fetch(`${this.#baseURL}${path}`, {
            method, headers: { accept: 'application/json', ...this.#headers,
                ...(serialized === undefined ? {} : { 'content-type': 'application/json' }) },
            body: serialized, signal, redirect: 'error',
        }), callOptions);
    }
}
