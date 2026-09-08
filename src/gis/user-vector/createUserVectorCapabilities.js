import { success, asFailure, gisError } from '../contracts.js';
import { readVectorDataset } from './readVectorDataset.js';
import { defaultVectorStyle, mergeVectorStyle, normalizeVectorStyle } from './styleContract.js';

const DEFAULT_ID_FACTORY = () => `ul_${crypto.randomUUID()}`;

function validName(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    throw gisError('INVALID_ARGUMENT', '图层名称无效');
  return value.trim();
}

/** Stable user-layer registry. Records survive workflow scopes but never follow a replacement map. */
export function createUserVectorCapabilities({
  adapter,
  fileReferences,
  readDataset = readVectorDataset,
  idFactory = DEFAULT_ID_FACTORY,
}) {
  const recordsByMap = new WeakMap();
  const records = (map) => {
    if (!recordsByMap.has(map)) recordsByMap.set(map, new Map());
    return recordsByMap.get(map);
  };
  const attachedLayers = (map) =>
    new Set(map?.getAllLayers?.() || map?.getLayers?.().getArray?.() || []);
  const reconcile = (map) => {
    const owned = records(map);
    const attached = attachedLayers(map);
    for (const [layerRef, record] of owned) {
      if (!attached.has(record.layer)) owned.delete(layerRef);
    }
    return owned;
  };
  const summary = (record) => ({
    layer_ref: record.layer_ref,
    name: record.name,
    geometryTypes: [...record.geometryTypes],
    featureCount: record.featureCount,
    visible: record.layer.getVisible(),
    style: structuredClone(record.style),
  });
  const getRecord = (map, layerRef) => {
    if (typeof layerRef !== 'string' || !layerRef)
      throw gisError('INVALID_ARGUMENT', '缺少 layer_ref');
    const record = reconcile(map).get(layerRef);
    if (!record) throw gisError('UNKNOWN_USER_LAYER');
    return record;
  };
  const service = {
    readMapContext(map) {
      if (!map) return [];
      return [...reconcile(map).values()].map(summary);
    },
    createScope({ map, assertActive, signal }) {
      const run = async (fn) => {
        try {
          assertActive();
          const value = await fn();
          assertActive();
          return success(value);
        } catch (error) {
          return asFailure(error);
        }
      };
      return {
        importVectorDataset(input) {
          return run(async () => {
            if (!input || typeof input.file_ref !== 'string' || !input.file_ref)
              throw gisError('INVALID_ARGUMENT', '缺少 file_ref');
            const resolved = fileReferences.resolve(input.file_ref);
            if (!resolved.ok) throw gisError(resolved.error.code, resolved.error.message);
            const requestedName = validName(input.name);
            const parsed = await readDataset(resolved.data.dataset, { signal });
            assertActive();
            if (!parsed || !Array.isArray(parsed.features) || !parsed.features.length)
              throw gisError('EMPTY_VECTOR_DATASET');
            const layerRef = idFactory();
            if (typeof layerRef !== 'string' || !layerRef || reconcile(map).has(layerRef))
              throw gisError('REFERENCE_ALLOCATION_FAILED');
            const style = input.style === undefined ? defaultVectorStyle() : normalizeVectorStyle(input.style);
            const created = adapter.createUserVectorLayer(map, parsed.features, {
              layerRef,
              name: requestedName || parsed.name || resolved.data.dataset.name || 'vector',
              style,
            });
            const record = {
              layer_ref: layerRef,
              name: requestedName || parsed.name || resolved.data.dataset.name || 'vector',
              layer: created.layer,
              geometryTypes: created.geometryTypes,
              featureCount: created.featureCount,
              style,
            };
            records(map).set(layerRef, record);
            return summary(record);
          });
        },
        setVectorStyle(input) {
          return run(() => {
            if (!input || !input.style) throw gisError('INVALID_ARGUMENT');
            const record = getRecord(map, input.layer_ref);
            const style = mergeVectorStyle(record.style, input.style);
            adapter.setUserVectorStyle(record.layer, style);
            record.style = style;
            return summary(record);
          });
        },
        fitVectorLayer(input) {
          return run(async () => {
            const record = getRecord(map, input?.layer_ref);
            await adapter.fitUserVectorLayer(map, record.layer, { signal, assertActive });
            return { layer_ref: record.layer_ref, featureCount: record.featureCount };
          });
        },
        setUserLayerVisibility(input) {
          return run(() => {
            if (!input || typeof input.visible !== 'boolean') throw gisError('INVALID_ARGUMENT');
            const record = getRecord(map, input.layer_ref);
            adapter.setUserVectorVisibility(record.layer, input.visible);
            return { layer_ref: record.layer_ref, visible: record.layer.getVisible() };
          });
        },
        removeUserLayer(input) {
          return run(() => {
            const record = getRecord(map, input?.layer_ref);
            adapter.removeUserVectorLayer(map, record.layer);
            records(map).delete(record.layer_ref);
            return { layer_ref: record.layer_ref, removed: true };
          });
        },
        listUserLayers() {
          return run(() => [...reconcile(map).values()].map(summary));
        },
        getUserLayerInfo(input) {
          return run(() => summary(getRecord(map, input?.layer_ref)));
        },
      };
    },
    disposeMap(map) {
      const owned = recordsByMap.get(map);
      if (!owned) return;
      for (const record of owned.values()) {
        try {
          adapter.removeUserVectorLayer(map, record.layer);
        } catch {
          /* Map teardown still invalidates the registry. */
        }
      }
      recordsByMap.delete(map);
    },
  };
  return service;
}
