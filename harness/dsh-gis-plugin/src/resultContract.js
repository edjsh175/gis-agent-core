const EFFECT_STATUSES = new Set(['none', 'partial', 'unknown', 'applied']);

export const GIS_TOOL_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'effect'],
      properties: {
        ok: { type: 'boolean', const: true },
        data: {},
        effect: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: { type: 'string', const: 'applied' },
            kind: { type: 'string' },
            stateRevision: { type: 'integer' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'error', 'effect'],
      properties: {
        ok: { type: 'boolean', const: false },
        error: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
        effect: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['none', 'partial', 'unknown', 'applied'] },
            kind: { type: 'string' },
            stateRevision: { type: 'integer' },
          },
        },
      },
    },
  ],
};

function invalidResult(message) {
  const error = new Error(message);
  error.name = 'GisFrontendResultError';
  error.code = 'GIS_FRONTEND_INVALID_RESULT';
  return error;
}

function normalizeEffect(effect) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect) || !EFFECT_STATUSES.has(effect.status)) {
    throw invalidResult('GIS frontend result has an invalid effect status.');
  }
  const normalized = { status: effect.status };
  if (typeof effect.kind === 'string') normalized.kind = effect.kind;
  if (Number.isInteger(effect.stateRevision)) normalized.stateRevision = effect.stateRevision;
  return normalized;
}

export function normalizeFrontendResult(operation, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.ok !== 'boolean') {
    throw invalidResult('GIS frontend provider returned an invalid result envelope.');
  }

  const effect = normalizeEffect(result.effect);
  if (result.ok) {
    if (effect.status !== 'applied') {
      throw invalidResult('A successful GIS frontend result must prove effect.status=applied.');
    }
    if (operation === 'import_vector_dataset' &&
        (typeof result.data?.layer_ref !== 'string' || result.data.layer_ref.length === 0)) {
      throw invalidResult('import_vector_dataset succeeded without a layer_ref.');
    }
    return {
      ok: true,
      ...(result.data === undefined ? {} : { data: structuredClone(result.data) }),
      effect,
    };
  }

  if (!result.error || typeof result.error.code !== 'string' || typeof result.error.message !== 'string') {
    throw invalidResult('A failed GIS frontend result must include error.code and error.message.');
  }
  return {
    ok: false,
    error: { code: result.error.code, message: result.error.message },
    effect,
  };
}
