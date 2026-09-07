import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { createLayerCatalog } from '../../../src/gis/catalog.js';
import { createDataCapabilities } from '../../../src/gis/data/createDataCapabilities.js';
import { createOpenLayersAdapter } from '../../../src/gis/adapters/openlayersAdapter.js';
import { createMapRuntime } from '../../../src/gis/runtime/createMapRuntime.js';
import { createMapContext } from '../../../src/gis/integration/createMapContext.js';
import { UnifiedHighlightManager } from '../../../src/components/pipeline/decision/common/UnifiedHighlightManager.js';
if (!import.meta.env.DEV) throw new Error('Development-only test entry');
const config = {
  baseUrl: '/fake-geoserver',
  workspace: 'GX',
  pipelineLayers: { water: { line: 'js_ln', point: 'js_pt' } },
};
const catalog = createLayerCatalog();
catalog.update(config, [
  {
    id: 'water',
    label: 'Water',
    url: '/fake-geoserver/GX/wms?layers=GX:js_ln',
  },
]);
let checkedKeys = ['water'];
const manager = new UnifiedHighlightManager();
const adapter = createOpenLayersAdapter({
  highlightManager: manager,
  styleConfig: {},
});
const runtime = createMapRuntime({
  adapter,
  catalog,
  state: {
    getCheckedKeys: () => checkedKeys,
    setCheckedKeys: (keys) => {
      checkedKeys = keys;
    },
  },
});
const makeMap = (projection) =>
  new Map({
    target: 'map',
    layers: [new VectorLayer({ name: 'water', source: new VectorSource() })],
    view: new View({ projection, center: [0, 0], zoom: 3 }),
  });
let map = makeMap('EPSG:3857');
runtime.attachMap(map);
const data = createDataCapabilities({ catalog, config });
window.gisTest = {
  mapContext: createMapContext({
    runtime,
    catalog,
    readMap: adapter.readMapContext,
  }),
  runtime,
  data,
  manager,
  get map() {
    return map;
  },
  get checkedKeys() {
    return checkedKeys;
  },
  rebuild(projection = 'EPSG:4326') {
    runtime.detachMap(map);
    map.dispose();
    map = makeMap(projection);
    runtime.attachMap(map);
  },
};
