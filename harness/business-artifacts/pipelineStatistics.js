const DEFAULT_ENDPOINT = 'http://192.168.10.208:8080/geoserver/GX/ows';
const ALLOWED_LAYERS = new Set(['GX:js_ln']);
const MAX_FEATURES = 10000;

function statisticsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function finiteNonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw statisticsError('STATISTICS_INVALID_SOURCE', `${label} is invalid`);
  return number;
}

function normalizeMaterial(value) {
  if (value === null || value === undefined || String(value).trim() === '')
    return '未标注';
  return String(value).trim();
}

export function validatePipelineReplayDescriptor(snapshotDescriptor = {}) {
  if (
    !snapshotDescriptor ||
    typeof snapshotDescriptor !== 'object' ||
    Array.isArray(snapshotDescriptor)
  )
    throw statisticsError(
      'STATISTICS_REPLAY_UNSUPPORTED',
      'snapshot descriptor is invalid'
    );
  const { dataset, scope, query: descriptorQuery } = snapshotDescriptor;
  if (
    dataset !== 'pipeline' ||
    !scope ||
    typeof scope !== 'object' ||
    Array.isArray(scope) ||
    !descriptorQuery ||
    typeof descriptorQuery !== 'object' ||
    Array.isArray(descriptorQuery)
  )
    throw statisticsError(
      'STATISTICS_REPLAY_UNSUPPORTED',
      'snapshot descriptor is not replayable'
    );
  if (
    scope.layerId !== 'GX:js_ln' ||
    Object.keys(scope).some(
      (key) => !['layerId', 'workspaceId'].includes(key)
    ) ||
    (scope.workspaceId !== undefined &&
      (typeof scope.workspaceId !== 'string' || !scope.workspaceId))
  )
    throw statisticsError(
      'STATISTICS_REPLAY_UNSUPPORTED',
      'snapshot scope is not replayable'
    );
  if (
    JSON.stringify(descriptorQuery.metrics) !==
      JSON.stringify(['count', 'total_length']) ||
    JSON.stringify(descriptorQuery.dimensions) !==
      JSON.stringify(['material']) ||
    !Array.isArray(descriptorQuery.filters) ||
    descriptorQuery.filters.length !== 0 ||
    Object.keys(descriptorQuery).some(
      (key) => !['metrics', 'dimensions', 'filters'].includes(key)
    )
  )
    throw statisticsError(
      'STATISTICS_REPLAY_UNSUPPORTED',
      'snapshot query is not replayable'
    );
  return { layerId: scope.layerId };
}

export function createPipelineStatisticsService({
  endpoint = process.env.PIPELINE_WFS_URL || DEFAULT_ENDPOINT,
  fetchImpl = globalThis.fetch,
  allowedLayers = ALLOWED_LAYERS,
  maxFeatures = MAX_FEATURES,
} = {}) {
  if (typeof fetchImpl !== 'function')
    throw new Error('pipeline statistics requires fetch');
  const layerAllowlist = new Set(allowedLayers);

  async function query({ layerId = 'GX:js_ln', signal } = {}) {
    if (!layerAllowlist.has(layerId))
      throw statisticsError(
        'STATISTICS_SCOPE_FORBIDDEN',
        'pipeline layer is not allowed'
      );

    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      service: 'WFS',
      version: '1.0.0',
      request: 'GetFeature',
      typeName: layerId,
      outputFormat: 'application/json',
      propertyName: 'material,shape_leng',
      maxFeatures: String(maxFeatures + 1),
    });

    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', signal });
    } catch (cause) {
      const error = statisticsError(
        'STATISTICS_UNAVAILABLE',
        'pipeline statistics source is unavailable'
      );
      error.cause = cause;
      throw error;
    }
    if (!response.ok)
      throw statisticsError(
        'STATISTICS_UNAVAILABLE',
        `pipeline statistics source returned HTTP ${response.status}`
      );

    let body;
    try {
      body = await response.json();
    } catch {
      throw statisticsError(
        'STATISTICS_INVALID_SOURCE',
        'pipeline statistics source returned invalid JSON'
      );
    }
    if (
      !body ||
      body.type !== 'FeatureCollection' ||
      !Array.isArray(body.features)
    )
      throw statisticsError(
        'STATISTICS_INVALID_SOURCE',
        'pipeline statistics source returned an invalid FeatureCollection'
      );

    const matched = Number(
      body.numberMatched ?? body.totalFeatures ?? body.features.length
    );
    const returned = Number(body.numberReturned ?? body.features.length);
    if (
      !Number.isFinite(matched) ||
      !Number.isFinite(returned) ||
      matched < 0 ||
      returned < 0
    )
      throw statisticsError(
        'STATISTICS_INVALID_SOURCE',
        'pipeline statistics source returned invalid counts'
      );
    if (matched > maxFeatures)
      throw statisticsError(
        'STATISTICS_TOO_LARGE',
        `pipeline statistics exceeds ${maxFeatures} features`
      );
    if (returned !== matched || body.features.length !== matched)
      throw statisticsError(
        'STATISTICS_INCOMPLETE_SOURCE',
        'pipeline statistics source returned a partial dataset'
      );

    let totalLength = 0;
    const materialCounts = new Map();
    for (const feature of body.features) {
      const properties = feature?.properties;
      if (
        !properties ||
        typeof properties !== 'object' ||
        Array.isArray(properties)
      )
        throw statisticsError(
          'STATISTICS_INVALID_SOURCE',
          'pipeline feature properties are invalid'
        );
      totalLength += finiteNonNegative(properties.shape_leng, 'shape_leng');
      const material = normalizeMaterial(properties.material);
      materialCounts.set(material, (materialCounts.get(material) || 0) + 1);
    }

    const groups = [...materialCounts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort(
        (a, b) =>
          b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      );

    return {
      schemaVersion: 'statistics/v1',
      dataset: 'pipeline',
      calculatedAt: new Date().toISOString(),
      scope: { layerId },
      query: {
        metrics: ['count', 'total_length'],
        dimensions: ['material'],
        filters: [],
      },
      data: {
        summary: {
          count: matched,
          total_length: totalLength,
        },
        groups: { material: groups },
      },
      schema: {
        'summary.count': 'number',
        'summary.total_length': 'number',
        'groups.material': 'array<{key:string,count:number}>',
      },
    };
  }

  function canReplay(snapshotDescriptor = {}) {
    try {
      const { layerId } = validatePipelineReplayDescriptor(snapshotDescriptor);
      return layerAllowlist.has(layerId);
    } catch {
      return false;
    }
  }

  async function replay(snapshotDescriptor = {}, { signal } = {}) {
    const { layerId } = validatePipelineReplayDescriptor(snapshotDescriptor);
    if (!layerAllowlist.has(layerId))
      throw statisticsError(
        'STATISTICS_SCOPE_FORBIDDEN',
        'pipeline layer is not allowed'
      );
    return query({ layerId, signal });
  }

  return { query, replay, canReplay };
}

export { DEFAULT_ENDPOINT, ALLOWED_LAYERS, MAX_FEATURES };
