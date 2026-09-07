import { createGeoServerAdapter } from '../adapters/geoserverAdapter.js';

import { success as ok, failure as fail } from '../contracts.js';
import { quoteValue, quoteIdentifier } from './filters.js';

/** @returns {import('../contracts.js').DataCapabilities} */
export function createDataCapabilities({
  catalog,
  config,
  transport,
  adapter,
} = {}) {
  if (
    !catalog ||
    typeof catalog.getLayer !== 'function' ||
    typeof catalog.listLayers !== 'function' ||
    typeof catalog.getVersion !== 'function'
  )
    throw new TypeError(
      'catalog must implement getLayer, listLayers and getVersion'
    );
  const geoServer = adapter || createGeoServerAdapter({ config, transport });
  const metadataCache = new Map();
  let cacheVersion = catalog.getVersion();

  return {
    async listLayers() {
      return ok({
        layers: catalog
          .listLayers()
          .map(({ id, label, queryable }) => ({ id, label, queryable })),
      });
    },

    async queryFeatures(input = {}, { signal } = {}) {
      if (!input || typeof input !== 'object')
        return fail('INVALID_ARGUMENT', 'Expected query object');
      const { layerId, filters, limit = 100 } = input;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return fail(
          'INVALID_ARGUMENT',
          'limit must be an integer from 1 to 100'
        );
      if (!Array.isArray(filters) || filters.length === 0)
        return fail('INVALID_ARGUMENT', 'filters must be a non-empty array');
      const layer = catalog.getLayer(layerId);
      if (!layer) return fail('UNKNOWN_LAYER', `Unknown layer: ${layerId}`);
      if (layer.queryable === false || !layer.typeName)
        return fail('UNSUPPORTED_CAPABILITY', 'Layer is not queryable');
      const version = catalog.getVersion();
      let metadata;
      try {
        if (signal?.aborted)
          return fail('OPERATION_CANCELLED', 'Query cancelled');
        metadata = await getMetadata(layer, signal);
        if (signal?.aborted)
          return fail('OPERATION_CANCELLED', 'Query cancelled');
        if (version !== catalog.getVersion())
          return fail('STALE_CONTEXT', 'Catalog changed');
      } catch (error) {
        return errorResult(error, 'METADATA_UNAVAILABLE');
      }
      const fields = new Map(
        (metadata.fields || []).map((field) => [field.name, field])
      );
      const conditions = [];
      for (const filter of filters) {
        if (
          !filter ||
          filter.op !== 'eq' ||
          typeof filter.field !== 'string' ||
          !fields.has(filter.field) ||
          !validValue(filter.value) ||
          typeof filter.value !== fields.get(filter.field).type
        )
          return fail(
            'INVALID_ARGUMENT',
            'Only metadata-backed, type-matching eq filters are supported'
          );
        conditions.push(
          `${quoteIdentifier(filter.field)} = ${quoteValue(filter.value)}`
        );
      }
      try {
        const collection = await geoServer.queryFeatures(layer, {
          cqlFilter: conditions.join(' AND '),
          limit: limit + 1,
          signal,
        });
        if (signal?.aborted)
          return fail('OPERATION_CANCELLED', 'Query cancelled');
        if (version !== catalog.getVersion())
          return fail('STALE_CONTEXT', 'Catalog changed');
        const source = Array.isArray(collection.features)
          ? collection.features
          : [];
        const total = collection.totalFeatures ?? collection.numberMatched;
        const knownTotal =
          typeof total === 'number' &&
          Number.isInteger(total) &&
          total >= source.length;
        const truncated =
          source.length > limit
            ? true
            : source.length === 0
              ? false
              : knownTotal
                ? total > source.length
                : config?.respectsRequestedLimit === true
                  ? false
                  : null;
        if (
          source.some(
            (feature) =>
              feature?.type !== 'Feature' ||
              !feature.properties ||
              typeof feature.properties !== 'object' ||
              Array.isArray(feature.properties)
          )
        )
          throw new Error('Invalid GeoJSON feature');
        const features = source
          .slice(0, limit)
          .map((feature) => ({
            type: 'Feature',
            layerId,
            sourceFeatureId: feature.id ?? null,
            geometry: feature.geometry ?? null,
            properties: feature.properties || {},
          }));
        return ok({
          features,
          returnedCount: features.length,
          truncated,
          crs: 'EPSG:4326',
        });
      } catch (error) {
        return errorResult(error, 'SERVICE_ERROR');
      }
    },
  };

  async function getMetadata(layer, signal) {
    const version = catalog.getVersion();
    if (cacheVersion !== version) {
      metadataCache.clear();
      cacheVersion = version;
    }
    const key = layer.id;
    // Cache successful metadata only; cancellation belongs to each caller.
    if (!metadataCache.has(key)) {
      const metadata = await geoServer.describeFeatureType(layer, { signal });
      if (version === catalog.getVersion()) metadataCache.set(key, metadata);
      return metadata;
    }
    return metadataCache.get(key);
  }
}

function validValue(value) {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
function errorResult(error, fallback) {
  const code =
    error?.code === 'TIMEOUT'
      ? 'TIMEOUT'
      : error?.code === 'OPERATION_CANCELLED' || error?.name === 'AbortError'
        ? 'OPERATION_CANCELLED'
        : fallback;
  return fail(code, error?.message || code, error?.details);
}

export { fail, ok, quoteValue };
