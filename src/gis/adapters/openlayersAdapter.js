import GeoJSON from 'ol/format/GeoJSON.js';
import { createEmpty, extend } from 'ol/extent.js';
import { toLonLat } from 'ol/proj.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Style from 'ol/style/Style.js';
import Stroke from 'ol/style/Stroke.js';
import Fill from 'ol/style/Fill.js';
import CircleStyle from 'ol/style/Circle.js';
import manager from '../../components/pipeline/decision/common/UnifiedHighlightManager.js';
import { getQueryResultStyle } from '../../components/pipeline/decision/common/HighlightStyleUtils.js';
import { startBlinkingEffect } from '../../components/pipeline/decision/common/BlinkingEffectUtils.js';
import { gisError } from '../contracts.js';

const rgba = (hex, opacity) => {
  const value = hex.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
};

const createUserVectorStyle = (style) => {
  const stroke = new Stroke({
    color: rgba(style.stroke.color, style.stroke.opacity),
    width: style.stroke.width,
  });
  const fill = new Fill({ color: rgba(style.fill.color, style.fill.opacity) });
  const point = new Style({
    image: new CircleStyle({ radius: style.radius, fill, stroke }),
  });
  const line = new Style({ stroke });
  const polygon = new Style({ stroke, fill });
  return (feature) => {
    const type = feature.getGeometry()?.getType();
    if (type === 'Point' || type === 'MultiPoint') return point;
    if (type === 'LineString' || type === 'MultiLineString') return line;
    return polygon;
  };
};

const boundLayers = (map, layer) => {
  const available = map.getAllLayers
    ? map.getAllLayers()
    : map.getLayers().getArray();
  return layer.bindings.map((binding) =>
    available.filter(
      (item) => String(item.get('name')) === String(binding.engineName)
    )
  );
};

export function createOpenLayersAdapter({
  highlightManager = manager,
  styleConfig = {},
} = {}) {
  const resources = new Map();
  const animations = new Map();
  const records = (map) => {
    if (!resources.has(map)) resources.set(map, new Set());
    return resources.get(map);
  };
  const remove = (map, record) => {
    clearTimeout(record.timer);
    record.blink?.destroy();
    record.source?.removeFeature(record.feature);
    resources.get(map)?.delete(record);
  };
  const clear = (map, owner, group) => {
    const matching = [...(resources.get(map) || [])].filter(
      (record) =>
        record.owner === owner &&
        (group === undefined || record.group === group)
    );
    matching.forEach((record) => remove(map, record));
    return matching.length;
  };
  const fitExtent = (map, extent, { signal, assertActive }) => {
    animations.get(map)?.();
    const view = map.getView();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (completed) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        if (animations.get(map) === cancel) animations.delete(map);
        try {
          assertActive();
          if (!completed) throw gisError('OPERATION_CANCELLED');
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      const cancel = () => {
        view.cancelAnimations();
        finish(false);
      };
      animations.set(map, cancel);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      try {
        assertActive();
        if (extent[0] === extent[2] && extent[1] === extent[3])
          view.animate(
            { center: extent.slice(0, 2), zoom: 18, duration: 1000 },
            finish
          );
        else
          view.fit(extent, {
            padding: [40, 40, 40, 40],
            maxZoom: 18,
            duration: 1000,
            callback: finish,
          });
      } catch (error) {
        settled = true;
        signal.removeEventListener('abort', cancel);
        animations.delete(map);
        reject(error);
      }
    });
  };
  return {
    readMapContext(map, catalogLayers) {
      const view = map.getView();
      const center = view.getCenter();
      const zoom = view.getZoom();
      const lonLat = center && toLonLat(center, view.getProjection());
      const viewport =
        lonLat?.every(Number.isFinite) && Number.isFinite(zoom)
          ? { center: lonLat.slice(0, 2), zoom, crs: 'EPSG:4326' }
          : null;
      // Layer states include ancestor group visibility. This reports visibility
      // flags, not whether a remote tile rendered or a feature is in the viewport.
      const states = map.getLayerGroup?.().getLayerStatesArray();
      const layers = catalogLayers.map((layer) => {
        const matches = boundLayers(map, layer);
        const loaded = matches.some((items) => items.length > 1)
          ? 'ambiguous'
          : !matches.length || matches.every((items) => !items.length)
            ? 'none'
            : matches.some((items) => !items.length)
              ? 'partial'
              : 'complete';
        const flags =
          loaded === 'complete'
            ? matches.map(
                ([item]) =>
                  states?.find((state) => state.layer === item)?.visible ??
                  item.getVisible()
              )
            : [];
        return {
          layerId: layer.id,
          loaded,
          visible: !flags.length
            ? null
            : flags.every(Boolean)
              ? true
              : flags.every((flag) => !flag)
                ? false
                : null,
        };
      });
      const groups = {};
      for (const record of resources.get(map) || []) {
        if (
          highlightManager.map !== map ||
          highlightManager.getHighlightSource() !== record.source ||
          !record.source.hasFeature(record.feature)
        )
          continue;
        const summary = (groups[record.group] ||= {
          count: 0,
          identities: [],
          unidentifiedCount: 0,
          truncated: false,
        });
        summary.count++;
        let identity;
        try {
          const pair = JSON.parse(record.feature.get('gisIdentity'));
          if (
            Array.isArray(pair) &&
            pair.length === 2 &&
            typeof pair[0] === 'string' &&
            (typeof pair[1] === 'string' ||
              (typeof pair[1] === 'number' && Number.isFinite(pair[1])))
          )
            identity = { layerId: pair[0], sourceFeatureId: pair[1] };
        } catch {
          /* External legacy mutations do not become shared payloads. */
        }
        if (!identity) summary.unidentifiedCount++;
        else if (summary.identities.length < 100) {
          summary.identities.push(identity);
        } else summary.truncated = true;
      }
      return {
        viewport,
        layers,
        highlight: { coverage: 'capability', groups },
      };
    },
    isReady(map) {
      const size = map?.getSize?.();
      return (
        !!map?.getTargetElement?.() && !!size && size[0] > 0 && size[1] > 0
      );
    },
    readFeatures(map, features) {
      return features.map((feature) => {
        validateGeometry(feature.geometry);
        const converted = new GeoJSON().readFeature(
          {
            type: 'Feature',
            geometry: feature.geometry,
            properties: feature.properties || {},
          },
          {
            dataProjection: 'EPSG:4326',
            featureProjection: map.getView().getProjection(),
          }
        );
        if (!converted.getGeometry().getExtent().every(Number.isFinite))
          throw gisError('INVALID_GEOMETRY');
        converted.set(
          'gisIdentity',
          feature.sourceFeatureId == null
            ? null
            : JSON.stringify([feature.layerId, feature.sourceFeatureId])
        );
        return converted;
      });
    },
    locate(map, features, { signal, assertActive }) {
      const extent = features.reduce(
        (bounds, feature) => extend(bounds, feature.getGeometry().getExtent()),
        createEmpty()
      );
      return fitExtent(map, extent, { signal, assertActive });
    },
    async highlight(
      map,
      features,
      { owner, group, mode, effect, assertActive }
    ) {
      await highlightManager.initialize(map);
      assertActive();
      const source = highlightManager.getHighlightSource();
      const existing = [...records(map)].filter(
        (record) => record.owner === owner && record.group === group
      );
      const identities = new Set(
        mode === 'append'
          ? existing
              .map((record) => record.feature.get('gisIdentity'))
              .filter(Boolean)
          : []
      );
      const pending = [];
      try {
        for (const feature of features) {
          const identity = feature.get('gisIdentity');
          if (identity && identities.has(identity)) continue;
          if (identity) identities.add(identity);
          feature.set('gisOwner', owner);
          feature.setStyle(
            await getQueryResultStyle(
              feature.getGeometry().getType(),
              styleConfig
            )
          );
          assertActive();
          const record = { feature, owner, group, source };
          pending.push(record);
          if (effect === 'blink')
            record.blink = await startBlinkingEffect(
              feature,
              5000,
              styleConfig,
              { alwaysVisible: true, assertActive }
            );
        }
        assertActive();
        if (
          highlightManager.map !== map ||
          highlightManager.getHighlightSource() !== source
        )
          throw gisError('STALE_CONTEXT');
        source.addFeatures(pending.map((record) => record.feature));
        if (mode === 'replace')
          existing.forEach((record) => remove(map, record));
        for (const record of pending) {
          records(map).add(record);
          if (effect === 'blink')
            record.timer = setTimeout(() => remove(map, record), 5000);
        }
        return { featureCount: pending.length, group };
      } catch (error) {
        pending.forEach((record) => remove(map, record));
        throw error;
      }
    },
    clear,
    setVisibility(map, layer, visible, state, assertActive) {
      if (!layer.bindings.length) throw gisError('LAYER_NOT_LOADED');
      const targets = boundLayers(map, layer).map((matches) => {
        if (matches.length !== 1)
          throw gisError('LAYER_NOT_LOADED', '图层绑定缺失或不唯一');
        return matches[0];
      });
      const previous = targets.map((target) => target.getVisible());
      const keys = state.getCheckedKeys().slice();
      const ids = new Set(
        layer.bindings.map((binding) => String(binding.treeId))
      );
      const updated = keys.filter((key) => !ids.has(String(key)));
      if (visible)
        updated.push(...layer.bindings.map((binding) => binding.treeId));
      try {
        assertActive();
        targets.forEach((target) => {
          if (target.getVisible() !== visible) target.setVisible(visible);
        });
        assertActive();
        state.setCheckedKeys(updated);
      } catch (error) {
        targets.forEach((target, index) => {
          try {
            target.setVisible(previous[index]);
          } catch {
            /* Preserve original failure. */
          }
        });
        state.setCheckedKeys(keys);
        throw error;
      }
      return { layerId: layer.id, visible, bindingCount: targets.length };
    },
    createUserVectorLayer(map, features, { layerRef, name, style }) {
      const formatter = new GeoJSON();
      const converted = features.map((feature) => {
        if (!feature || feature.type !== 'Feature' || !feature.geometry)
          throw gisError('INVALID_GEOMETRY');
        validateGeometry(feature.geometry);
        const item = formatter.readFeature(
          {
            type: 'Feature',
            geometry: feature.geometry,
            properties: feature.properties || {},
          },
          {
            dataProjection: 'EPSG:4326',
            featureProjection: map.getView().getProjection(),
          }
        );
        if (!item.getGeometry()?.getExtent().every(Number.isFinite))
          throw gisError('INVALID_GEOMETRY');
        return item;
      });
      if (!converted.length) throw gisError('EMPTY_VECTOR_DATASET');
      const source = new VectorSource({ features: converted });
      const layer = new VectorLayer({ source, visible: true });
      layer.set('name', `user:${layerRef}`);
      layer.set('gisUserLayerRef', layerRef);
      layer.set('gisUserLayerName', name);
      layer.setStyle(createUserVectorStyle(style));
      map.addLayer(layer);
      return {
        layer,
        featureCount: converted.length,
        geometryTypes: [...new Set(converted.map((item) => item.getGeometry().getType()))].sort(),
      };
    },
    setUserVectorStyle(layer, style) {
      layer.setStyle(createUserVectorStyle(style));
    },
    fitUserVectorLayer(map, layer, options) {
      const extent = layer.getSource()?.getExtent?.();
      if (!extent?.every(Number.isFinite))
        throw gisError('EMPTY_VECTOR_DATASET');
      return fitExtent(map, extent, options);
    },
    setUserVectorVisibility(layer, visible) {
      layer.setVisible(visible);
    },
    removeUserVectorLayer(map, layer) {
      map.removeLayer(layer);
    },
    dispose(map) {
      animations.get(map)?.();
      [...(resources.get(map) || [])].forEach((record) => remove(map, record));
      resources.delete(map);
      if (highlightManager.map === map) highlightManager.destroy();
    },
  };
}

export function validateGeometry(geometry) {
  if (!geometry) throw gisError('MISSING_GEOMETRY');
  const point = (coordinates) =>
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    coordinates.every(Number.isFinite) &&
    Math.abs(coordinates[0]) <= 180 &&
    Math.abs(coordinates[1]) <= 90;
  const list = (coordinates, test, min = 1) =>
    Array.isArray(coordinates) &&
    coordinates.length >= min &&
    coordinates.every(test);
  const line = (coordinates) => list(coordinates, point, 2);
  const ring = (coordinates) =>
    list(coordinates, point, 4) &&
    coordinates[0].length === coordinates.at(-1).length &&
    coordinates[0].every((value, index) => value === coordinates.at(-1)[index]);
  const polygon = (coordinates) => list(coordinates, ring);
  const validators = {
    Point: point,
    MultiPoint: (coordinates) => list(coordinates, point),
    LineString: line,
    MultiLineString: (coordinates) => list(coordinates, line),
    Polygon: polygon,
    MultiPolygon: (coordinates) => list(coordinates, polygon),
  };
  if (!validators[geometry.type])
    throw gisError('UNSUPPORTED_CAPABILITY', '不支持此几何类型');
  if (!validators[geometry.type](geometry.coordinates))
    throw gisError('INVALID_GEOMETRY');
}
