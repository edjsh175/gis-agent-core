import { shallowRef, onScopeDispose } from 'vue';
import { createAguiHttpTransport } from './httpTransport.js';
import { createIntegrationServiceClient } from './serviceClient.js';
import { createAguiWorkflow } from './createAguiWorkflow.js';
import { observeMapOperations } from './observeMapOperations.js';
import { isWorkflowBusy } from './workflowStatus.js';
import { getBusinessCardApplication } from '../../../business-artifacts/runtime.js';

/** Vue owns mounting/unmounting; all GIS actions stay in the capability scope. */
export function useAguiWorkflow({ gis, baseUrl, clock = () => Date.now() }) {
  const state = shallowRef({ status: 'idle', messages: [], receipts: [] });
  const service = createIntegrationServiceClient({ baseUrl });
  const businessArtifacts = getBusinessCardApplication();
  let workflow;
  let generation = 0;
  let disposed = false;
  let activeSession = null;

  const stop = () => {
    workflow?.cancel();
    generation++;
    state.value = { ...state.value, status: 'cancelled' };
  };

  const reset = () => {
    stop();
    workflow?.dispose();
    workflow = null;
    activeSession = null;
    state.value = { status: 'idle', messages: [], receipts: [] };
  };

  onScopeDispose(() => {
    disposed = true;
    stop();
    workflow?.dispose();
    workflow = null;
    activeSession = null;
  });

  async function send(message, options = {}, onAccepted = () => {}) {
    if (disposed) return { ok: false, error: { code: 'WORKFLOW_CANCELLED', message: 'WORKFLOW_CANCELLED' } };
    if (isWorkflowBusy(state.value.status)) return { ok: false, error: { code: 'WORKFLOW_ALREADY_STARTED', message: 'WORKFLOW_ALREADY_STARTED' } };
    if (typeof message !== 'string' || !message.trim()) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: '请输入指令' } };
    const current = ++generation;
    const isSessionValid = activeSession
      && clock() < activeSession.leaseExpiresAt
      && workflow
      && state.value.status !== 'cancelled'
      && state.value.status !== 'failed';

    if (!isSessionValid) {
      workflow?.dispose();
      state.value = { ...state.value, status: 'connecting', error: null };
      let session;
      try {
        session = await service.createSession(options);
      } catch (err) {
        const error = { code: err.code || 'CONNECT_FAILED', message: err.message || '连接 Agent 服务失败' };
        if (!disposed && current === generation) state.value = { ...state.value, status: 'failed', error };
        return { ok: false, error };
      }
      const methods = service.forSession(session);
      if (disposed || current !== generation) {
        await methods.cancelRemote();
        return { ok: false, error: { code: 'WORKFLOW_CANCELLED', message: 'WORKFLOW_CANCELLED' } };
      }
      activeSession = session;
      const activeWorkflow = createAguiWorkflow({
        gis, businessArtifacts, session: activeSession, ...methods,
        transport: createAguiHttpTransport({ url: `${baseUrl}/run` }),
        observeOperations: observeMapOperations,
        onChange: (value) => {
          if (!disposed && workflow === activeWorkflow) {
            state.value = { ...value, session: activeSession };
          }
        },
      });
      workflow = activeWorkflow;
      state.value = { ...workflow.getState(), session: activeSession };
    }

    return workflow.run(message, { onAccepted });
  }

  return {
    state,
    start: send,
    send,
    stop,
    reset,
    clear: () => workflow?.clear(),
    getWorkflow: () => workflow,
  };
}
