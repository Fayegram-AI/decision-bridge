/** Public errors never retain raw upstream bodies, headers or original exceptions. */
export class DecisionError extends Error {
  constructor(message, { code = 'DECISION_ERROR', status, requestId, gatewayLogId, attempts, refusedQuestions, usage, upstreamCode,
    source, upstreamErrorCode, upstreamErrorType, retryAfterMs, retryable } = {}) {
    super(message);
    this.name = 'DecisionError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (requestId !== undefined) this.requestId = requestId;
    if (gatewayLogId !== undefined) this.gatewayLogId = gatewayLogId;
    if (attempts !== undefined) this.attempts = attempts;
    if (refusedQuestions !== undefined) this.refusedQuestions = refusedQuestions;
    if (usage !== undefined) this.usage = usage;
    if (upstreamCode !== undefined) this.upstreamCode = upstreamCode;
    for (const [key, value] of Object.entries({ source, upstreamErrorCode, upstreamErrorType, retryAfterMs, retryable })) {
      if (value !== undefined) this[key] = value;
    }
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      ...(this.gatewayLogId === undefined ? {} : { gatewayLogId: this.gatewayLogId }),
      ...(this.attempts === undefined ? {} : { attempts: this.attempts }),
      ...(this.refusedQuestions === undefined ? {} : { refusedQuestions: this.refusedQuestions }),
      ...(this.usage === undefined ? {} : { usage: this.usage }),
      ...(this.upstreamCode === undefined ? {} : { upstreamCode: this.upstreamCode }),
      ...Object.fromEntries(['source', 'upstreamErrorCode', 'upstreamErrorType', 'retryAfterMs', 'retryable']
        .filter(key => this[key] !== undefined).map(key => [key, this[key]])),
    };
  }
}

export function requireCondition(condition, message, code = 'VALIDATION_ERROR') {
  if (!condition) throw new DecisionError(message, { code });
}

/** Unknown exceptions can contain credentials or prompts; never serialize them. */
export function publicError(error) {
  return error instanceof DecisionError ? error.toJSON() : {
    code: 'UNEXPECTED_ERROR', message: 'Unexpected bridge failure.',
  };
}

/** Preserve safe HTTP diagnostics when decoding a successful response fails. */
export function withResponseMeta(meta, decode) {
  try { return decode(); }
  catch (error) {
    if (!(error instanceof DecisionError)) throw error;
    throw new DecisionError(error.message, { ...meta, ...error.toJSON() });
  }
}
