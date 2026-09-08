import { success, asFailure, gisError } from '../contracts.js';

/** @returns {import('../contracts.js').ClientCapabilities} */
export function createClientCapabilities({
  map,
  scene,
  adapter,
  catalog,
  state,
  userVectors = null,
  isCurrent,
  onDispose,
}) {
  const owner = Symbol('gis-owner');
  const controller = new AbortController();
  let disposed = false;
  const revisions = new Map();
  const nextRevision = (group) => {
    const revision = (revisions.get(group) || 0) + 1;
    revisions.set(group, revision);
    return revision;
  };
  const assertActive = () => {
    if (disposed || !isCurrent()) throw gisError('STALE_CONTEXT');
    if (scene !== '2d')
      throw gisError('UNSUPPORTED_CAPABILITY', '首版地图能力仅支持二维');
    if (!map || !adapter.isReady(map)) throw gisError('MAP_NOT_READY');
  };
  const run = async (fn) => {
    try {
      assertActive();
      return success(await fn());
    } catch (error) {
      return asFailure(error);
    }
  };
  const vectorScope = userVectors?.createScope({
    map,
    signal: controller.signal,
    assertActive,
  });
  const checkFeatures = (features) => {
    if (!Array.isArray(features) || !features.length)
      throw gisError('INVALID_ARGUMENT', 'features 必须为非空数组');
    for (const feature of features) {
      if (!feature || feature.type !== 'Feature')
        throw gisError('INVALID_ARGUMENT');
      if (!catalog.getLayer(feature.layerId)) throw gisError('UNKNOWN_LAYER');
      if (!feature.geometry) throw gisError('MISSING_GEOMETRY');
    }
  };
  return {
    isActive: () => !disposed && isCurrent(),
    locateFeatures(input) {
      return run(async () => {
        checkFeatures(input?.features);
        const features = adapter.readFeatures(map, input.features);
        await adapter.locate(map, features, {
          signal: controller.signal,
          assertActive,
        });
        assertActive();
        return { featureCount: features.length };
      });
    },
    highlightFeatures(input) {
      return run(async () => {
        const {
          features,
          group = 'results',
          mode = 'replace',
          effect = 'persistent',
        } = input || {};
        if (
          !['results', 'selection'].includes(group) ||
          !['replace', 'append'].includes(mode) ||
          !['persistent', 'blink'].includes(effect)
        )
          throw gisError('INVALID_ARGUMENT');
        checkFeatures(features);
        const converted = adapter.readFeatures(map, features);
        const operation = nextRevision(group);
        const assertOperation = () => {
          assertActive();
          if (revisions.get(group) !== operation)
            throw gisError('OPERATION_CANCELLED');
        };
        return await adapter.highlight(map, converted, {
          owner,
          group,
          mode,
          effect,
          assertActive: assertOperation,
        });
      });
    },
    clearHighlight(input = {}) {
      return run(() => {
        if (
          !input ||
          (input.group !== undefined &&
            !['results', 'selection'].includes(input.group))
        )
          throw gisError('INVALID_ARGUMENT');
        (input.group ? [input.group] : ['results', 'selection']).forEach(
          nextRevision
        );
        return { clearedCount: adapter.clear(map, owner, input.group) };
      });
    },
    setLayerVisibility(input) {
      return run(() => {
        if (!input || typeof input.visible !== 'boolean')
          throw gisError('INVALID_ARGUMENT');
        const layer = catalog.getLayer(input.layerId);
        if (!layer) throw gisError('UNKNOWN_LAYER');
        return adapter.setVisibility(
          map,
          layer,
          input.visible,
          state,
          assertActive
        );
      });
    },
    importVectorDataset(input) {
      return vectorScope
        ? vectorScope.importVectorDataset(input)
        : Promise.resolve(asFailure(gisError('UNSUPPORTED_CAPABILITY')));
    },
    setVectorStyle(input) {
      return vectorScope
        ? vectorScope.setVectorStyle(input)
        : Promise.resolve(asFailure(gisError('UNSUPPORTED_CAPABILITY')));
    },
    fitVectorLayer(input) {
      return vectorScope
        ? vectorScope.fitVectorLayer(input)
        : Promise.resolve(asFailure(gisError('UNSUPPORTED_CAPABILITY')));
    },
    setUserLayerVisibility(input) {
      return vectorScope
        ? vectorScope.setUserLayerVisibility(input)
        : Promise.resolve(asFailure(gisError('UNSUPPORTED_CAPABILITY')));
    },
    removeUserLayer(input) {
      return vectorScope
        ? vectorScope.removeUserLayer(input)
        : Promise.resolve(asFailure(gisError('UNSUPPORTED_CAPABILITY')));
    },
    listUserLayers() {
      return vectorScope
        ? vectorScope.listUserLayers()
        : Promise.resolve(asFailure(gisError('UNSUPPORTED_CAPABILITY')));
    },
    getUserLayerInfo(input) {
      return vectorScope
        ? vectorScope.getUserLayerInfo(input)
        : Promise.resolve(asFailure(gisError('UNSUPPORTED_CAPABILITY')));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      if (map && scene === '2d') adapter.clear(map, owner);
      onDispose();
    },
  };
}
