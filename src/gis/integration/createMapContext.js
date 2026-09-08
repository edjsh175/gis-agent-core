import { success, asFailure, gisError } from '../contracts.js';

/** Read on demand at run boundaries. No protocol state can write into this reader. */
export function createMapContext({
  runtime,
  catalog,
  readMap,
  readUserLayers,
  readAvailableFiles,
}) {
  let revision = 0;
  let signature;
  return {
    /** @returns {import('../contracts.js').Result<import('./contracts.js').MapContext>} */
    getSnapshot() {
      try {
        const before = runtime.getState();
        const map = runtime.getMap();
        const supported = before.ready && before.scene === '2d';
        const observed = supported ? readMap(map, catalog.listLayers()) : null;
        const userLayers = supported && readUserLayers ? readUserLayers(map) : null;
        const availableFiles = readAvailableFiles ? readAvailableFiles() : null;
        const after = runtime.getState();
        if (before.generation !== after.generation || map !== runtime.getMap())
          throw gisError('STALE_CONTEXT');
        const context = {
          schemaVersion: 2,
          dimension: before.scene,
          ready: before.ready,
          supportedTools: supported
            ? [
                'locate_features',
                'highlight_features',
                'clear_highlight',
                'set_layer_visibility',
                ...(readUserLayers
                  ? [
                      'import_vector_dataset',
                      'set_vector_style',
                      'fit_vector_layer',
                      'set_user_layer_visibility',
                    ]
                  : []),
              ]
            : [],
          viewport: observed?.viewport ?? null,
          layers: observed?.layers ?? null,
          visibleLayers:
            observed?.layers
              .filter((layer) => layer.visible === true)
              .map((layer) => layer.layerId) ?? null,
          selection: null,
          highlight: observed?.highlight ?? null,
          userLayers,
          availableFiles,
        };
        // A rebuilt but visually identical map is still a new observation.
        const nextSignature = JSON.stringify([
          before.generation,
          catalog.getVersion(),
          context,
        ]);
        if (signature !== nextSignature) {
          revision++;
          signature = nextSignature;
        }
        return success(JSON.parse(JSON.stringify({ ...context, revision })));
      } catch (error) {
        return asFailure(error, 'MAP_CONTEXT_UNAVAILABLE');
      }
    },
  };
}
