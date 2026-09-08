import { asFailure, gisError } from '../../contracts.js';
import { canonicalArguments, validateToolCall } from './frontendTools.js';

/** One workflow owns one scope and one deduplication ledger. No replay after disposal. */
export function createFrontendExecutor({ scope, assertActive, resolveReference, signal, mapContext, withEffect = (_, fn) => fn() }) {
  const calls = new Map();
  let queue = Promise.resolve();
  const actions = {
    locate_features: ['locate', 'locateFeatures'],
    highlight_features: ['highlight', 'highlightFeatures'],
    clear_highlight: ['clear', 'clearHighlight'],
    set_layer_visibility: ['visibility', 'setLayerVisibility'],
    import_vector_dataset: ['import', 'importVectorDataset'],
    set_vector_style: ['style', 'setVectorStyle'],
    fit_vector_layer: ['locate', 'fitVectorLayer'],
    set_user_layer_visibility: ['visibility', 'setUserLayerVisibility'],
  };
  return {
    execute(call) {
      let signature;
      try {
        validateToolCall(call.name, call.args);
        if (typeof call.runId !== 'string' || !call.runId || typeof call.toolCallId !== 'string' || !call.toolCallId) throw gisError('INVALID_TOOL_CALL');
        signature = call.name + canonicalArguments(call.args);
      } catch (error) { return Promise.resolve({ ...asFailure(error), effect: { status: 'none' } }); }
      const key = JSON.stringify([call.runId, call.toolCallId]);
      const known = calls.get(key);
      if (known) return signature === known.signature ? known.promise : Promise.resolve({ ...asFailure(gisError('TOOL_CALL_CONFLICT')), effect: { status: 'none' } });
      const args = structuredClone(call.args);
      const promise = queue.then(async () => {
        let invoked = false;
        const [kind, method] = actions[call.name];
        try {
          assertActive();
          let input = args;
          if (args.feature_ref) {
            const resolved = await resolveReference(args.feature_ref, { signal });
            assertActive();
            if (!resolved.ok) return { ...resolved, effect: { status: 'none', kind } };
            const { feature_ref, ...options } = args;
            input = { ...options, features: resolved.data.features };
          }
          assertActive();
          invoked = true;
          const result = await withEffect(kind, () => scope[method](input));
          assertActive();
          const observed = mapContext.getSnapshot();
          return { ...result, effect: {
            status: result.ok ? 'applied' : 'unknown', kind,
            ...(observed.ok ? { stateRevision: observed.data.revision } : {}),
          } };
        } catch (error) {
          return { ...asFailure(error), effect: { status: invoked ? 'unknown' : 'none', kind } };
        }
      });
      calls.set(key, { signature, promise });
      queue = promise.then(() => undefined);
      return promise;
    },
  };
}
