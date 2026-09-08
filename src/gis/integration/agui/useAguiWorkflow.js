import { shallowRef, onScopeDispose } from 'vue';
import { createAguiHttpTransport } from './httpTransport.js';
import { createIntegrationServiceClient } from './serviceClient.js';
import { createAguiWorkflow } from './createAguiWorkflow.js';
import { observeMapOperations } from './observeMapOperations.js';

/** Vue owns mounting/unmounting; all GIS actions stay in the capability scope. */
export function useAguiWorkflow({ gis, baseUrl }) {
  const state = shallowRef({ status: 'idle' });
  const service = createIntegrationServiceClient({ baseUrl });
  let workflow;
  let generation = 0;
  let disposed = false;
  const stop = () => { workflow?.cancel(); generation++; state.value = { ...state.value, status: 'cancelled' }; };
  onScopeDispose(() => { disposed = true; stop(); workflow?.dispose(); });
  return {
    state,
    async start(message, options = {}) {
      const current = ++generation;
      workflow?.dispose();
      state.value = { status: 'connecting' };
      const session = await service.createSession(options);
      const methods = service.forSession(session);
      if (disposed || current !== generation) {
        await methods.cancelRemote();
        return { ok: false, error: { code: 'WORKFLOW_CANCELLED', message: 'WORKFLOW_CANCELLED' } };
      }
      workflow = createAguiWorkflow({ gis, session, ...methods,
        transport: createAguiHttpTransport({ url: `${baseUrl}/run` }), observeOperations: observeMapOperations,
        onChange: (value) => { if (current === generation) state.value = { ...value, session }; },
      });
      state.value = { ...workflow.getState(), session };
      return workflow.run(message);
    },
    stop,
    clear: () => workflow?.clear(),
    getWorkflow: () => workflow,
  };
}
