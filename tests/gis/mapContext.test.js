import { describe, it, expect } from 'vitest';
import View from 'ol/View.js';
import LayerGroup from 'ol/layer/Group.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { fromLonLat } from 'ol/proj.js';
import { createMapRuntime } from '../../src/gis/runtime/createMapRuntime.js';
import { createMapContext } from '../../src/gis/integration/createMapContext.js';
import { createOpenLayersAdapter } from '../../src/gis/adapters/openlayersAdapter.js';
import { UnifiedHighlightManager } from '../../src/components/pipeline/decision/common/UnifiedHighlightManager.js';

function setup() {
  const layer = new VectorLayer({ name: 'water', source: new VectorSource() });
  const group = new LayerGroup({ layers: [layer] });
  const manager = new UnifiedHighlightManager();
  const adapter = createOpenLayersAdapter({ highlightManager: manager });
  const catalog = {
    getVersion: () => 1,
    listLayers: () => [
      { id: 'water', bindings: [{ engineName: 'water', treeId: 'water' }] },
    ],
    getLayer: () => catalog.listLayers()[0],
  };
  const runtime = createMapRuntime({
    adapter,
    catalog,
    state: { getCheckedKeys: () => ['water'], setCheckedKeys() {} },
  });
  const map = {
    getTargetElement: () => ({}),
    getSize: () => [800, 600],
    getView: () => view,
    getLayerGroup: () => group,
    getAllLayers: () => group.getLayers().getArray(),
    addLayer: (item) => group.getLayers().push(item),
    removeLayer: (item) => group.getLayers().remove(item),
  };
  const view = new View({ center: fromLonLat([104, 30]), zoom: 16 });
  const context = createMapContext({
    runtime,
    catalog,
    readMap: adapter.readMapContext,
  });
  return {
    layer,
    group,
    manager,
    adapter,
    catalog,
    runtime,
    map,
    view,
    context,
  };
}

describe('browser-authoritative MapContext', () => {
  it('distinguishes unobserved, empty and unsupported state without exposing runtime internals', () => {
    const { runtime, map, context } = setup();
    const initial = context.getSnapshot().data;
    expect(initial).toMatchObject({
      ready: false,
      layers: null,
      selection: null,
      highlight: null,
    });
    runtime.attachMap(map);
    const observed = context.getSnapshot().data;
    expect(observed.highlight.groups).toEqual({});
    expect(observed.visibleLayers).toEqual(['water']);
    expect(observed).not.toHaveProperty('generation');
    runtime.attachMap({}, '3d');
    expect(context.getSnapshot().data).toMatchObject({
      dimension: '3d',
      ready: true,
      supportedTools: [],
      viewport: null,
      layers: null,
    });
  });

  it('reads actual view and ancestor visibility; revisions only change with observations', () => {
    const { runtime, map, context, group, layer, view } = setup();
    runtime.attachMap(map);
    const first = context.getSnapshot().data;
    expect(first.viewport.center[0]).toBeCloseTo(104);
    expect(first.viewport.center[1]).toBeCloseTo(30);
    expect(context.getSnapshot().data.revision).toBe(first.revision);
    group.setVisible(false);
    expect(layer.getVisible()).toBe(true);
    expect(context.getSnapshot().data.visibleLayers).toEqual([]);
    view.setCenter(fromLonLat([105, 31]));
    const moved = context.getSnapshot().data;
    expect(moved.viewport.center[0]).toBeCloseTo(105);
    expect(moved.revision).toBeGreaterThan(first.revision);
    moved.viewport.center[0] = 0;
    expect(context.getSnapshot().data.viewport.center[0]).toBeCloseTo(105);
    runtime.detachMap(map);
    runtime.attachMap(map);
    expect(context.getSnapshot().data.revision).toBeGreaterThan(moved.revision);
  });

  it('does not claim missing, partially bound or ambiguous layers are hidden', () => {
    const { adapter, map, group } = setup();
    const layers = [
      { id: 'none', bindings: [] },
      {
        id: 'partial',
        bindings: [{ engineName: 'water' }, { engineName: 'missing' }],
      },
    ];
    expect(adapter.readMapContext(map, layers).layers).toEqual([
      { layerId: 'none', loaded: 'none', visible: null },
      { layerId: 'partial', loaded: 'partial', visible: null },
    ]);
    group.getLayers().push(new VectorLayer({ name: 'water' }));
    expect(adapter.readMapContext(map, layers).layers[1]).toMatchObject({
      loaded: 'ambiguous',
      visible: null,
    });
  });

  it('observes committed highlights, missing identities and actual source cleanup', async () => {
    const { runtime, map, context, manager } = setup();
    runtime.attachMap(map);
    const scope = runtime.createClientScope();
    const features = ['one', null].map((sourceFeatureId) => ({
      type: 'Feature',
      layerId: 'water',
      sourceFeatureId,
      properties: {},
      geometry: { type: 'Point', coordinates: [104, 30] },
    }));
    expect((await scope.highlightFeatures({ features })).ok).toBe(true);
    expect(context.getSnapshot().data.highlight.groups.results).toEqual({
      count: 2,
      identities: [{ layerId: 'water', sourceFeatureId: 'one' }],
      unidentifiedCount: 1,
      truncated: false,
    });
    manager.getHighlightSource().clear();
    expect(context.getSnapshot().data.highlight.groups).toEqual({});
    scope.dispose();
    runtime.detachMap(map);
  });

  it('does not publish a snapshot from a map replaced during observation', () => {
    const { runtime, catalog, map } = setup();
    runtime.attachMap(map);
    const context = createMapContext({
      runtime,
      catalog,
      readMap() {
        runtime.beginScene('3d');
        return {};
      },
    });
    expect(context.getSnapshot().error.code).toBe('STALE_CONTEXT');
  });

  it('never forwards object-valued legacy identities into the shared summary', async () => {
    const { runtime, map, context } = setup();
    runtime.attachMap(map);
    const scope = runtime.createClientScope();
    await scope.highlightFeatures({
      features: [
        {
          type: 'Feature',
          layerId: 'water',
          sourceFeatureId: { privatePayload: 'secret' },
          properties: {},
          geometry: { type: 'Point', coordinates: [104, 30] },
        },
      ],
    });
    const result = context.getSnapshot();
    expect(result.data.highlight.groups.results.unidentifiedCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('privatePayload');
    runtime.detachMap(map);
  });
});
