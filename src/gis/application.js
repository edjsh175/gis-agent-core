import { useMainStore } from '../store/index.js';
import { getGeoserverConfigSync } from '../config/index.js';
import { createLayerCatalog } from './catalog.js';
import { createDataCapabilities } from './data/createDataCapabilities.js';
import { createOpenLayersAdapter } from './adapters/openlayersAdapter.js';
import { createMapRuntime } from './runtime/createMapRuntime.js';
import { createMapContext } from './integration/createMapContext.js';

const applications = new WeakMap();

/** The application boundary is the only capability module that reads Vue/config globals. */
export function useGisCapabilities() {
  const store = useMainStore();
  if (applications.has(store)) return applications.get(store);
  const catalog = createLayerCatalog();
  let config;
  let data;
  const refresh = () => {
    const next = getGeoserverConfigSync();
    catalog.update(next, store.layersList, window.location.origin);
    if (JSON.stringify(config) !== JSON.stringify(next)) {
      config = next;
      data = createDataCapabilities({ catalog, config });
    }
  };
  refresh();
  const adapter = createOpenLayersAdapter({
    styleConfig: window.highlight_style_config || {},
  });
  const runtime = createMapRuntime({
    catalog,
    adapter,
    state: {
      getCheckedKeys: () => store.checkedKeys,
      setCheckedKeys: (keys) => store.setCheckedKeys(keys),
    },
  });
  // Subscription belongs to the application, not the first component calling the factory.
  store.$subscribe(refresh, { detached: true, flush: 'sync' });
  const mapContext = createMapContext({
    runtime,
    catalog,
    readMap: adapter.readMapContext,
  });
  const application = {
    catalog,
    runtime,
    mapContext: {
      getSnapshot() {
        refresh();
        return mapContext.getSnapshot();
      },
    },
    createClientScope: () => {
      refresh();
      return runtime.createClientScope();
    },
    data: {
      listLayers: (...args) => {
        refresh();
        return data.listLayers(...args);
      },
      queryFeatures: (...args) => {
        refresh();
        return data.queryFeatures(...args);
      },
    },
    getConfig: () => {
      refresh();
      return config;
    },
  };
  applications.set(store, application);
  return application;
}
