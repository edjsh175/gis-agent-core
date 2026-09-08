import { unByKey } from 'ol/Observable.js';

/** Local attribution for capability effects; physical user gestures always win. */
export function observeMapOperations({ map, onUserOperation, onObserved = () => {} }) {
  let ownEffect = null;
  let layerKeys = [];
  const keys = [];
  const target = map.getViewport();
  const user = () => onUserOperation();
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
      layerKeys.push(layer.on('change:visible', () => {
        if (ownEffect !== 'visibility') user();
        onObserved();
      }));
      const collection = layer.getLayers?.();
      if (collection) {
        const changed = () => {
          if (!['highlight', 'clear', 'import', 'remove'].includes(ownEffect)) user();
          bindLayers();
          onObserved();
        };
        layerKeys.push(collection.on(['add', 'remove'], changed));
        layerKeys.push(layer.on('change:layers', changed));
        collection.forEach(visit);
      }
    };
    visit(map.getLayerGroup());
  };
  bindLayers();
  keys.push(map.getView().on(['change:center', 'change:resolution', 'change:rotation'], () => {
    if (ownEffect !== 'locate') user();
  }));
  keys.push(map.on('moveend', onObserved));
  keys.push(map.on(['change:view', 'change:layergroup'], user));
  let disposed = false;
  return {
    async withEffect(kind, fn) {
      ownEffect = kind;
      try { return await fn(); } finally { ownEffect = null; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener('pointerdown', user, true);
      target.removeEventListener('wheel', user, true);
      target.removeEventListener('keydown', keydown, true);
      unByKey(keys.flat());
      unByKey(layerKeys.flat());
    },
  };
}
