import { describe, it, expect, vi, afterEach } from 'vitest';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import { createMapRuntime } from '../../src/gis/runtime/createMapRuntime.js';
import { createOpenLayersAdapter } from '../../src/gis/adapters/openlayersAdapter.js';
import { UnifiedHighlightManager } from '../../src/components/pipeline/decision/common/UnifiedHighlightManager.js';
const item = (id = 'one', layerId = 'water') => ({
  type: 'Feature',
  layerId,
  sourceFeatureId: id,
  properties: {},
  geometry: { type: 'Point', coordinates: [104, 30] },
});
function fakeMap(projection = 'EPSG:3857') {
  const layers = [];
  const view = new View({ center: [0, 0], zoom: 4, projection });
  return {
    layers,
    getView: () => view,
    getSize: () => [800, 600],
    getTargetElement: () => ({}),
    getAllLayers: () => layers,
    addLayer: (layer) => layers.push(layer),
    removeLayer: (layer) => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
    },
  };
}
function setup() {
  const manager = new UnifiedHighlightManager();
  const adapter = createOpenLayersAdapter({
    highlightManager: manager,
    styleConfig: { blinking: { interval: 100, duration: 5000 } },
  });
  const layers = [
    {
      id: 'water',
      bindings: [
        { treeId: 'a', engineName: 'a' },
        { treeId: 'b', engineName: 'b' },
      ],
    },
    { id: 'other', bindings: [] },
  ];
  let keys = ['a', 'b'];
  const state = {
    getCheckedKeys: () => keys,
    setCheckedKeys: (value) => {
      keys = value;
    },
  };
  const runtime = createMapRuntime({
    adapter,
    catalog: { getLayer: (id) => layers.find((layer) => layer.id === id) },
    state,
  });
  const map = fakeMap();
  runtime.attachMap(map);
  return {
    manager,
    adapter,
    map,
    runtime,
    scope: runtime.createClientScope(),
    state,
  };
}
afterEach(() => vi.useRealTimers());
describe('map runtime and owner-scoped actions', () => {
  it('checks readiness, unknown layers, geometry and rejects 3D explicitly', async () => {
    const { runtime, scope, map } = setup();
    expect((await scope.locateFeatures({ features: [] })).error.code).toBe(
      'INVALID_ARGUMENT'
    );
    expect(
      (await scope.highlightFeatures({ features: [item('x', 'bad')] })).error
        .code
    ).toBe('UNKNOWN_LAYER');
    expect(
      (
        await scope.highlightFeatures({
          features: [{ ...item(), geometry: null }],
        })
      ).error.code
    ).toBe('MISSING_GEOMETRY');
    expect(
      (
        await scope.highlightFeatures({
          features: [
            { ...item(), geometry: { type: 'Point', coordinates: [200, 30] } },
          ],
        })
      ).error.code
    ).toBe('INVALID_GEOMETRY');
    map.getSize = () => [0, 0];
    expect((await scope.clearHighlight()).error.code).toBe('MAP_NOT_READY');
    runtime.beginScene('3d');
    expect((await scope.clearHighlight()).error.code).toBe('STALE_CONTEXT');
    expect(
      (await runtime.createClientScope().clearHighlight()).error.code
    ).toBe('UNSUPPORTED_CAPABILITY');
  });
  it('projects GeoJSON to actual view projection without mutating payload', () => {
    const { adapter, map } = setup();
    expect(
      adapter.readFeatures(map, [item()])[0].getGeometry().getCoordinates()[0]
    ).toBeCloseTo(11577227.0425, 2);
    expect(
      adapter
        .readFeatures(fakeMap('EPSG:4326'), [item()])[0]
        .getGeometry()
        .getCoordinates()
    ).toEqual([104, 30]);
  });
  it('replace/append and group cleanup preserve other owners, legacy and drawings', async () => {
    const { scope, runtime, map, manager } = setup();
    const drawing = new VectorLayer({ source: new VectorSource() });
    map.addLayer(drawing);
    const other = runtime.createClientScope();
    await scope.highlightFeatures({ features: [item()] });
    await scope.highlightFeatures({ features: [item()] });
    await scope.highlightFeatures({
      features: [item(), item('one', 'other')],
      mode: 'append',
    });
    await other.highlightFeatures({ features: [item()] });
    await scope.highlightFeatures({ features: [item()], group: 'selection' });
    const legacy = new Feature();
    manager.addHighlightFeature(legacy, 'spatial-query');
    expect(manager.getHighlightSource().getFeatures()).toHaveLength(5);
    manager.clearAllHighlights();
    expect(manager.getHighlightSource().getFeatures()).toHaveLength(4);
    expect(
      (await scope.clearHighlight({ group: 'selection' })).data.clearedCount
    ).toBe(1);
    scope.dispose();
    expect(manager.getHighlightSource().getFeatures()).toHaveLength(1);
    expect(map.layers).toContain(drawing);
    runtime.detachMap(map);
    expect(map.layers).toEqual([drawing]);
  });
  it('coalesces initialize and does not attach obsolete asynchronous layers', async () => {
    const manager = new UnifiedHighlightManager();
    const old = fakeMap(),
      fresh = fakeMap();
    await Promise.all([manager.initialize(old), manager.initialize(old)]);
    expect(old.layers).toHaveLength(1);
    await manager.initialize(fresh);
    expect(old.layers).toHaveLength(0);
    expect(fresh.layers).toHaveLength(1);
    manager.destroy();
    const pending = manager.initialize(old);
    manager.destroy();
    await expect(pending).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    expect(old.layers).toHaveLength(0);
  });
  it('invalidates pending highlight on clear and map rebuild', async () => {
    const { scope, map, runtime, manager } = setup();
    const pending = scope.highlightFeatures({ features: [item()] });
    await scope.clearHighlight();
    expect((await pending).error.code).toBe('OPERATION_CANCELLED');
    const next = scope.highlightFeatures({ features: [item()] });
    runtime.detachMap(map);
    runtime.attachMap(fakeMap());
    expect((await next).error.code).toBe('STALE_CONTEXT');
    expect(manager.getHighlightSource()).toBeNull();
  });
  it('removes blink resources after 5 seconds or disposal', async () => {
    const { scope, manager, runtime } = setup();
    await manager.initialize(runtime.getMap());
    vi.useFakeTimers();
    await scope.highlightFeatures({ features: [item()], effect: 'blink' });
    expect(manager.getHighlightSource().getFeatures()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(manager.getHighlightSource().getFeatures()).toHaveLength(0);
    await scope.highlightFeatures({ features: [item()], effect: 'blink' });
    scope.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('visibility commits all bindings and rolls back a failed state commit', async () => {
    const { scope, map, state } = setup();
    expect(
      (await scope.setLayerVisibility({ layerId: 'water', visible: false }))
        .error.code
    ).toBe('LAYER_NOT_LOADED');
    map.addLayer(new VectorLayer({ name: 'a' }));
    map.addLayer(new VectorLayer({ name: 'b' }));
    expect(
      (await scope.setLayerVisibility({ layerId: 'water', visible: false }))
        .data.bindingCount
    ).toBe(2);
    expect(state.getCheckedKeys()).toEqual([]);
    const commit = state.setCheckedKeys;
    state.setCheckedKeys = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('commit failed');
      })
      .mockImplementation(commit);
    expect(
      (await scope.setLayerVisibility({ layerId: 'water', visible: true })).ok
    ).toBe(false);
    expect(map.layers.map((layer) => layer.getVisible())).toEqual([
      false,
      false,
    ]);
    expect(state.getCheckedKeys()).toEqual([]);
  });
});
