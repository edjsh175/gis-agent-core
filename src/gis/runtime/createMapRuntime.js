import { createClientCapabilities } from '../client/createClientCapabilities.js';

/** Map instances enter only here. A scope never follows a replacement map. */
export function createMapRuntime({ adapter, catalog, state, userVectors = null }) {
  let map = null;
  let scene = '2d';
  let generation = 0;
  const scopes = new Set();
  const listeners = new Set();
  const emit = () =>
    listeners.forEach((listener) => listener(runtime.getState()));
  const invalidate = () => {
    generation++;
    for (const scope of [...scopes]) scope.dispose();
    if (map && scene === '2d') {
      userVectors?.disposeMap(map);
      adapter.dispose(map);
    }
    map = null;
  };
  const runtime = {
    attachMap(nextMap, nextScene = '2d') {
      if (map === nextMap && scene === nextScene) return;
      invalidate();
      map = nextMap;
      scene = nextScene;
      emit();
    },
    detachMap(expectedMap = map) {
      if (expectedMap !== map) return;
      invalidate();
      emit();
    },
    beginScene(nextScene) {
      invalidate();
      scene = nextScene;
      emit();
    },
    getMap: () => map,
    getState: () => ({
      scene,
      generation,
      ready: !!map && (scene !== '2d' || adapter.isReady(map)),
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    createClientScope() {
      const capturedMap = map;
      const capturedGeneration = generation;
      const scope = createClientCapabilities({
        map: capturedMap,
        scene,
        adapter,
        catalog,
        state,
        userVectors,
        isCurrent: () =>
          capturedGeneration === generation && capturedMap === map,
        onDispose: () => scopes.delete(scope),
      });
      scopes.add(scope);
      return scope;
    },
  };
  return runtime;
}
