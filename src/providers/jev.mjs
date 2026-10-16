import { optionsObject, TRANSPORT_FIELDS } from '../options.mjs';
import { withResponseMeta, requireCondition as check } from '../errors.mjs';
import { freezeJson, isRecord, validateResult } from '../validation.mjs';
import { JsonTransport, parseBaseURL, validateApiKey } from '../transport.mjs';
import { environmentValue } from '../runtime-env.mjs';
import { builtInCapabilities } from '../capabilities.mjs';
import { jevDangerZone, jevHeaders, jevRequestLimit, JEV_RESULT_OPTIONS } from './jev-profile.mjs';
import { prepareCommonJevDecision, prepareJevDecision } from './jev-preflight.mjs';

/** Native TypeSafe HTTP provider: one shared-state request, no chat emulation. */
export class JevProvider {
  name = 'typesafe';
  kind = 'decision';
  probabilitySource = 'native';
  #transport;
  #options;

  constructor(options = {}) {
    const { apiKey,
    model = environmentValue('JEV_MODEL')?.trim() || 'jev-latest',
    baseURL = 'https://api.typesafe.ai', dangerZone, ...transportOptions } = Object.assign(Object.create(null), optionsObject(options,
      ['apiKey', 'model', 'baseURL', 'dangerZone', ...TRANSPORT_FIELDS], 'Jev options'));
    const endpointInfo = parseBaseURL(baseURL, { originOnly: true });
    const supplied = apiKey === undefined && endpointInfo.origin === 'https://api.typesafe.ai'
      ? environmentValue('TYPESAFE_API_KEY') : apiKey;
    const key = validateApiKey(supplied, 'TYPESAFE_API_KEY');
    check(typeof model === 'string' && model.trim(), 'model must be nonempty.', 'CONFIGURATION_ERROR');
    const endpoint = endpointInfo.baseURL;
    this.defaultModel = model.trim();
    this.#options = { model: this.defaultModel, dangerZone: jevDangerZone(dangerZone),
        maxRequestBytes: jevRequestLimit(transportOptions.maxRequestBytes) };
    this.#transport = new JsonTransport({ ...transportOptions, maxRequestBytes: this.#options.maxRequestBytes, baseURL: endpoint,
      headers: { authorization: `Bearer ${key}`, ...jevHeaders(this.#options.dangerZone) }, secrets: [key] });
  }

  async evaluate(input, options = {}) {
    const prepared = prepareCommonJevDecision(input, this.#options);
    const { decision, meta } = await this.#perform(prepared, options);
    return freezeJson({ ...decision, meta: { ...meta, provider: this.name,
      probabilitySource: 'native', confidenceSource: 'native', modelSource: 'reported' } });
  }

  getCapabilities(model = this.defaultModel) { return builtInCapabilities('jev', model, this.#options); }

  getResultValidationOptions() { return JEV_RESULT_OPTIONS; }

  validateRequest(request) { prepareCommonJevDecision(request, this.#options); }

  /** Native JSON assets allow images anywhere in state, instructions or criteria. */
  async createDecision(input, options = {}) {
    return this.#perform(prepareJevDecision(input, this.#options), options);
  }

  async #perform({ request, native }, options) {
    const { data, meta: transport } = await this.#transport.request('POST', '/v1/systemone', native, options);
    const meta = { ...transport, requestedModel: request.model };
    const decision = withResponseMeta(meta, () => validateResult(data, request.questions, JEV_RESULT_OPTIONS));
    return freezeJson({ decision, meta });
  }

  async listModels(options = {}) {
    const { data, meta } = await this.#transport.request('GET', '/v1/models', undefined, options);
    return withResponseMeta(meta, () => {
      check(isRecord(data) && Array.isArray(data.models) && data.models.every(m =>
        isRecord(m) && typeof m.name === 'string' && m.name.trim()),
      'Model-list response must contain a models array.', 'INVALID_RESPONSE');
      return data;
    });
  }
}
