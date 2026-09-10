import { createApp, h } from 'vue';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import 'ol/ol.css';
import { createLayerCatalog } from '../../../src/gis/catalog.js';
import { createMapRuntime } from '../../../src/gis/runtime/createMapRuntime.js';
import { createOpenLayersAdapter } from '../../../src/gis/adapters/openlayersAdapter.js';
import { createMapContext } from '../../../src/gis/integration/createMapContext.js';
import { createDataCapabilities } from '../../../src/gis/data/createDataCapabilities.js';
import { createFileReferenceStore } from '../../../src/gis/user-vector/fileReferenceStore.js';
import { createUserVectorCapabilities } from '../../../src/gis/user-vector/createUserVectorCapabilities.js';
import { UnifiedHighlightManager } from '../../../src/components/pipeline/decision/common/UnifiedHighlightManager.js';
import { useAguiWorkflow } from '../../../src/gis/integration/agui/useAguiWorkflow.js';
import BusinessCardBoard from '../../../src/business-artifacts/components/BusinessCardBoard.vue';
import { createBusinessCardMapActionExecutor } from '../../../src/business-artifacts/integration/mapActionExecutor.js';
if (!import.meta.env.DEV) throw new Error('Development-only test entry');

const backend = new URLSearchParams(window.location.search).get('backend') ?? 'deterministic';
const harnessMode = backend === 'harness';
const baseUrl = harnessMode ? '/__gis-harness' : '/__gis-agui';
if (!harnessMode) {
  await fetch('/__gis-agui/fixture-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}
const catalog = createLayerCatalog();
catalog.update({ baseUrl: '/fixture-geoserver', workspace: 'GX', pipelineLayers: { water: { line: 'js_ln' } } }, [
  { id: 'water', label: '给水', config: { layerName: 'GX:js_ln' } },
]);
const layer = new VectorLayer({ name: 'GX:js_ln', source: new VectorSource() });
const map = new Map({ target: 'map', layers: [layer], view: new View({ projection: 'EPSG:4326', center: [103, 29], zoom: 10 }) });
const manager = new UnifiedHighlightManager();
const adapter = createOpenLayersAdapter({ highlightManager: manager });
const fileReferences = createFileReferenceStore({ idFactory: () => 'vf_roads' });
fileReferences.registerVectorDataset([
  new File(['fixture-shp'], 'roads.shp'),
  new File(['fixture-dbf'], 'roads.dbf'),
]);
const userVectors = createUserVectorCapabilities({
  adapter,
  fileReferences,
  idFactory: () => 'ul_roads',
  readDataset: async (dataset) => ({
    name: dataset.name,
    features: [{
      type: 'Feature',
      properties: { name: '测试道路' },
      geometry: { type: 'LineString', coordinates: [[104, 30], [104.01, 30.01]] },
    }],
  }),
});
let checked = ['water'];
const runtime = createMapRuntime({ adapter, catalog, userVectors, state: { getCheckedKeys: () => checked, setCheckedKeys: (value) => { checked = value; } } });
runtime.attachMap(map);
const mapContext = createMapContext({
  runtime,
  catalog,
  readMap: adapter.readMapContext,
  readUserLayers: userVectors.readMapContext,
  readAvailableFiles: () => fileReferences.list(),
});
const data = createDataCapabilities({
  catalog,
  config: { respectsRequestedLimit: true },
  adapter: {
    async describeFeatureType() {
      return { fields: [{ name: 'material', type: 'string' }] };
    },
    async queryFeatures(_layer, { cqlFilter }) {
      if (cqlFilter !== '"material" = \'铸铁\'') throw new Error(`unexpected filter: ${cqlFilter}`);
      return {
        type: 'FeatureCollection',
        totalFeatures: 1,
        features: [{
          type: 'Feature',
          id: 'js_ln.1',
          geometry: { type: 'LineString', coordinates: [[104.02, 30.02], [104.03, 30.03]] },
          properties: { material: '铸铁' },
        }],
      };
    },
  },
});
const gis = {
  runtime,
  catalog,
  fileReferences,
  userVectors,
  createClientScope: () => runtime.createClientScope(),
  mapContext,
  data,
};
const businessMapActions = createBusinessCardMapActionExecutor({ gis });
const app = createApp({
  setup() {
    const controller = useAguiWorkflow({ gis, baseUrl });
    const start = (scenario = 'normal') => {
      const message = harnessMode && scenario === 'business'
        ? '统计当前项目管线数量、总长度和材质分布，生成一张概览卡片并永久保存。'
        : harnessMode || scenario === 'vector'
          ? '导入这个道路 SHP，把线改成红色 4px、80% 透明度，然后缩放到这个图层。'
          : '找到编号 GX001 的管线，定位并高亮。';
      const pending = harnessMode
        ? controller.start(message)
        : controller.start(message, { scenario });
      window.aguiTest.pending = pending;
      return pending;
    };
    window.aguiTest = { ...controller, start, gis, map, layer, manager, backend,
      unmount: () => {
        businessMapActions.dispose();
        app.unmount();
        runtime.detachMap(map);
        map.dispose();
      },
    };
    return () => h('div', [
      h('button', { onClick: () => start() }, '执行确定性流程'),
      h('button', { onClick: controller.stop }, '取消'),
      h('button', { onClick: controller.clear }, '清除高亮'),
      h('button', { onClick: async () => {
        gis.runtime.notifyUserOperation();
        await Promise.resolve();
        layer.setVisible(!layer.getVisible());
      } }, '切换图层'),
      h('output', { 'data-testid': 'status' }, controller.state.value.status),
      harnessMode && h(BusinessCardBoard, {
        executeMapAction: businessMapActions.execute,
      }),
    ]);
  },
});
app.mount('#app');
