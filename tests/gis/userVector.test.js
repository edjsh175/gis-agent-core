import { describe, it, expect } from 'vitest';
import View from 'ol/View.js';
import LayerGroup from 'ol/layer/Group.js';
import { createOpenLayersAdapter } from '../../src/gis/adapters/openlayersAdapter.js';
import { createMapRuntime } from '../../src/gis/runtime/createMapRuntime.js';
import { createMapContext } from '../../src/gis/integration/createMapContext.js';
import { createFileReferenceStore, matchShapefilePair } from '../../src/gis/user-vector/fileReferenceStore.js';
import { createUserVectorCapabilities } from '../../src/gis/user-vector/createUserVectorCapabilities.js';
import { readVectorDataset } from '../../src/gis/user-vector/readVectorDataset.js';

const file = (name) => ({ name });
const roadFeatures = [
  {
    type: 'Feature',
    properties: { name: 'A路' },
    geometry: {
      type: 'LineString',
      coordinates: [[104, 30], [104.01, 30.01]],
    },
  },
];

function setup() {
  const adapter = createOpenLayersAdapter();
  const fileReferences = createFileReferenceStore({ idFactory: () => 'vf_roads' });
  const userVectors = createUserVectorCapabilities({
    adapter,
    fileReferences,
    idFactory: () => 'ul_roads',
    readDataset: async (dataset) => ({ name: dataset.name, features: roadFeatures }),
  });
  const catalog = {
    getVersion: () => 1,
    listLayers: () => [],
    getLayer: () => null,
  };
  const group = new LayerGroup({ layers: [] });
  const view = new View({ projection: 'EPSG:4326', center: [103, 29], zoom: 10 });
  view.fit = (_extent, options) => options.callback(true);
  const map = {
    getTargetElement: () => ({}),
    getSize: () => [800, 600],
    getView: () => view,
    getLayerGroup: () => group,
    getAllLayers: () => group.getLayers().getArray(),
    addLayer: (layer) => group.getLayers().push(layer),
    removeLayer: (layer) => group.getLayers().remove(layer),
  };
  const runtime = createMapRuntime({
    adapter,
    catalog,
    userVectors,
    state: { getCheckedKeys: () => [], setCheckedKeys() {} },
  });
  const context = createMapContext({
    runtime,
    catalog,
    readMap: adapter.readMapContext,
    readUserLayers: userVectors.readMapContext,
    readAvailableFiles: () => fileReferences.list(),
  });
  runtime.attachMap(map);
  return { adapter, fileReferences, userVectors, runtime, context, map, group };
}

describe('User Vector Capability', () => {
  it('aborts file decoding before stale work can become a map effect', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readVectorDataset({
      format: 'shapefile',
      name: 'roads',
      shpFile: { arrayBuffer: async () => new ArrayBuffer(0) },
      dbfFile: { arrayBuffer: async () => new ArrayBuffer(0) },
    }, { signal: controller.signal })).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
  });

  it('creates stable file_ref and rejects invalid SHP pairs', () => {
    expect(matchShapefilePair([file('roads.SHP'), file('roads.dbf')]).name).toBe('roads');
    expect(() => matchShapefilePair([file('roads.shp')])).toThrow();
    expect(() => matchShapefilePair([file('roads.shp'), file('river.dbf')])).toThrow();

    const store = createFileReferenceStore({ idFactory: () => 'vf_roads' });
    const registered = store.registerVectorDataset([file('roads.shp'), file('roads.dbf')]);
    expect(registered).toEqual({
      ok: true,
      data: { file_ref: 'vf_roads', name: 'roads', format: 'shapefile', parts: ['shp', 'dbf'] },
    });
    expect(JSON.stringify(store.list())).not.toContain('shpFile');
    expect(store.resolve('missing').error.code).toBe('FILE_REF_EXPIRED');
  });

  it('imports one independent layer and keeps layer_ref usable across workflow scopes', async () => {
    const { fileReferences, runtime, group } = setup();
    fileReferences.registerVectorDataset([file('roads.shp'), file('roads.dbf')]);

    const first = runtime.createClientScope();
    const imported = await first.importVectorDataset({ file_ref: 'vf_roads' });
    expect(imported).toMatchObject({
      ok: true,
      data: {
        layer_ref: 'ul_roads',
        name: 'roads',
        geometryTypes: ['LineString'],
        featureCount: 1,
        visible: true,
      },
    });
    expect(group.getLayers().getLength()).toBe(1);
    expect(group.getLayers().item(0).get('name')).toBe('user:ul_roads');

    first.dispose();
    const second = runtime.createClientScope();
    expect(await second.getUserLayerInfo({ layer_ref: 'ul_roads' })).toMatchObject({
      ok: true,
      data: { layer_ref: 'ul_roads', featureCount: 1 },
    });
  });

  it('applies stable style, fit and visibility contracts to the real OpenLayers layer', async () => {
    const { fileReferences, runtime, group } = setup();
    fileReferences.registerVectorDataset([file('roads.shp'), file('roads.dbf')]);
    const scope = runtime.createClientScope();
    await scope.importVectorDataset({ file_ref: 'vf_roads' });

    const styled = await scope.setVectorStyle({
      layer_ref: 'ul_roads',
      style: { stroke: { color: '#ff0000', width: 4, opacity: 0.8 } },
    });
    expect(styled).toMatchObject({
      ok: true,
      data: { style: { stroke: { color: '#ff0000', width: 4, opacity: 0.8 } } },
    });
    const layer = group.getLayers().item(0);
    const feature = layer.getSource().getFeatures()[0];
    const style = layer.getStyleFunction()(feature, 1);
    expect(style.getStroke().getColor()).toBe('rgba(255, 0, 0, 0.8)');
    expect(style.getStroke().getWidth()).toBe(4);

    expect(await scope.fitVectorLayer({ layer_ref: 'ul_roads' })).toMatchObject({
      ok: true,
      data: { layer_ref: 'ul_roads', featureCount: 1 },
    });
    expect(await scope.setUserLayerVisibility({ layer_ref: 'ul_roads', visible: false })).toEqual({
      ok: true,
      data: { layer_ref: 'ul_roads', visible: false },
    });
    expect(layer.getVisible()).toBe(false);

    const invalid = await scope.setVectorStyle({ layer_ref: 'ul_roads', style: { lineWidth: 9 } });
    expect(invalid.error.code).toBe('INVALID_VECTOR_STYLE');
  });

  it('publishes only user-layer summaries and invalidates the registry on map replacement', async () => {
    const { fileReferences, runtime, context, group, map } = setup();
    fileReferences.registerVectorDataset([file('roads.shp'), file('roads.dbf')]);
    const scope = runtime.createClientScope();
    await scope.importVectorDataset({ file_ref: 'vf_roads' });

    const observed = context.getSnapshot();
    expect(observed.data.availableFiles).toEqual([
      { file_ref: 'vf_roads', name: 'roads', format: 'shapefile', parts: ['shp', 'dbf'] },
    ]);
    expect(observed.data.userLayers).toMatchObject([
      { layer_ref: 'ul_roads', name: 'roads', geometryTypes: ['LineString'], featureCount: 1, visible: true },
    ]);
    expect(JSON.stringify(observed)).not.toContain('coordinates');

    runtime.detachMap(map);
    expect(group.getLayers().getLength()).toBe(0);
    expect((await scope.getUserLayerInfo({ layer_ref: 'ul_roads' })).error.code).toBe('STALE_CONTEXT');
  });
});
