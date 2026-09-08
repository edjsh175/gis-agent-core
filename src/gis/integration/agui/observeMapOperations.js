import { unByKey } from 'ol/Observable.js';

/** Map facts are observations, never evidence of who initiated a change. */
export function observeMapOperations({ map, onUserOperation, onObserved = () => {} }) {
  let layerKeys = [];
  let viewKeys = [];
  let disposed = false;
  const keys = [];
  const target = map.getViewport();
  const user = () => { if (!disposed) onUserOperation(); };
  const observed = () => {
    if (disposed) return;
    onObserved();
  };
  const keydown = (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '='].includes(event.key)) user();
  };
  target.addEventListener('pointerdown', user, true);
  target.addEventListener('wheel', user, { capture: true, passive: true });
  target.addEventListener('keydown', keydown, true);
  const bindLayers = () => {
    unByKey(layerKeys.flat());
    layerKeys = [];
    const visit = (layer) => {
      layerKeys.push(layer.on('change:visible', observed));
      const collection = layer.getLayers?.();
      if (collection) {
        const changed = () => {
          bindLayers();
          observed();
        };
        layerKeys.push(collection.on(['add', 'remove'], changed));
        layerKeys.push(layer.on('change:layers', changed));
        collection.forEach(visit);
      }
    };
    visit(map.getLayerGroup());
  };
  const bindView = () => {
    unByKey(viewKeys);
    viewKeys = map.getView().on(['change:center', 'change:resolution', 'change:rotation'], observed);
  };
  bindLayers();
  bindView();
  keys.push(map.on('moveend', onObserved));
  keys.push(map.on('change:view', () => { bindView(); observed(); }));
  keys.push(map.on('change:layergroup', () => { bindLayers(); observed(); }));
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener('pointerdown', user, true);
      target.removeEventListener('wheel', user, true);
      target.removeEventListener('keydown', keydown, true);
      unByKey(keys.flat());
      unByKey(viewKeys);
      unByKey(layerKeys.flat());
    },
  };
}
