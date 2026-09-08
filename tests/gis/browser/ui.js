import { createApp, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import FeatureQuery from '../../../src/components/pipeline/query/FeatureQuery.vue';
import LayerList from '../../../src/layout/components/layerList/index.vue';
import { useMainStore } from '../../../src/store/index.js';
import { useGisCapabilities } from '../../../src/gis/application.js';
import manager from '../../../src/components/pipeline/decision/common/UnifiedHighlightManager.js';
import bus from '../../../src/utils/mitt.js';
import GisAgentComposer from '../../../src/gis/components/panel/GisAgentComposer.vue';
import GisAgentMessages from '../../../src/gis/components/panel/GisAgentMessages.vue';
if (!import.meta.env.DEV) throw new Error('Development-only test entry');
const pinia = createPinia();
setActivePinia(pinia);
const store = useMainStore();
store.layersList = [
  {
    id: 5,
    label: '管线',
    type: 'PIPELINE',
    children: [
      {
        id: 'water',
        label: '给水管线',
        type: 'VECTOR',
        url: '/fake-geoserver/GX/wms?LAYERS=GX:js_ln',
      },
    ],
  },
];
store.checkedKeys = ['water'];
const map = new Map({
  target: 'map',
  layers: [new VectorLayer({ name: 'water', source: new VectorSource() })],
  view: new View({ projection: 'EPSG:4326', center: [104, 30], zoom: 14 }),
});
window.map2d = map;
const gis = useGisCapabilities();
gis.runtime.attachMap(map);
const agentMode = new URLSearchParams(window.location.search).has('agent');
const agentStatus = ref('idle');
const agentAcceptSend = ref(true);
const agentSent = ref([]);
const agentMessages = ref([{ id: 'blank-assistant', role: 'assistant', content: '' }]);
const open = ref(true);
const app = createApp({
  render: () => h('div', [
      h(
        'button',
        { onClick: () => (open.value = !open.value) },
        'Toggle query'
      ),
      open.value ? h(FeatureQuery) : null,
      h(LayerList),
      agentMode ? h('div', { 'data-testid': 'agent-fixture' }, [
        h(GisAgentComposer, {
          status: agentStatus.value,
          onSend: (message, acknowledge) => {
            agentSent.value.push(message);
            if (agentAcceptSend.value) acknowledge();
          },
        }),
        h(GisAgentMessages, {
          messages: agentMessages.value,
          status: agentStatus.value,
          receipts: [],
        }),
      ]) : null,
    ]),
});
app.config.warnHandler = (message) => console.warn(message);
app.use(pinia).use(ElementPlus).mount('#app');
window.uiTest = {
  gis, map, manager, store, bus, open,
  agentStatus, agentAcceptSend, agentSent, agentMessages,
};
