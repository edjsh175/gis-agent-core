import { success, asFailure, gisError } from '../../contracts.js';
import { FRONTEND_TOOLS } from './frontendTools.js';
import { createFrontendExecutor } from './frontendExecutor.js';
import { BUSINESS_ARTIFACT_FRONTEND_TOOLS } from '../../../business-artifacts/integration/frontendTools.js';
import { createBusinessArtifactFrontendExecutor } from '../../../business-artifacts/integration/frontendExecutor.js';

/** A conversation reuses its live scope; a replacement map is captured only between instructions. */
export function createAguiWorkflow({
  gis, businessArtifacts, session, transport, resolveReference, cancelRemote,
  observeOperations, idFactory = () => crypto.randomUUID(), clock = () => Date.now(),
  onChange = () => {}, runTimeoutMs = 30_000,
}) {
  const controller = new AbortController();
  let scope = gis.createClientScope();
  let catalogVersion = gis.catalog.getVersion();
  let status = 'idle';
  let messages = [];
  let liveMessages = null;
  let progress = null;
  let currentToolCall = null;
  let protocolState = {};
  const receipts = [];
  let observer;
  let unsubscribe = () => {};
  let unsubscribeUser = () => {};
  let leaseTimer;
  let terminalError;
  let cancellation;
  const snapshot = () => ({ status, messages: structuredClone(liveMessages ?? messages), receipts: structuredClone(receipts), progress, currentToolCall,
    context: gis.mapContext.getSnapshot(), ...(terminalError ? { error: terminalError } : {}) });
  const emit = () => onChange(snapshot());
  const transition = (next) => { status = next; emit(); };
  const cleanup = () => { clearTimeout(leaseTimer); unsubscribe(); unsubscribeUser(); observer?.dispose(); progress = null; currentToolCall = null; };
  const notifyCancellation = () => {
    cancellation ||= Promise.resolve().then(() => cancelRemote()).catch(() => undefined);
    return cancellation;
  };
  const cancel = (code = 'WORKFLOW_CANCELLED') => {
    if (['cancelled', 'failed', 'completed'].includes(status)) return;
    terminalError = { code, message: code };
    status = 'cancelled';
    cleanup();
    controller.abort();
    scope.dispose();
    void notifyCancellation();
    emit();
  };
  const assertActive = () => {
    if (status === 'cancelled' || controller.signal.aborted) throw gisError(terminalError?.code || 'WORKFLOW_CANCELLED');
    if (!scope.isActive() || gis.catalog.getVersion() !== catalogVersion) throw gisError('STALE_CONTEXT');
    if (clock() >= session.leaseExpiresAt) throw gisError('SESSION_LEASE_EXPIRED');
  };
  async function run(message, { onAccepted = () => {} } = {}) {
    if (status !== 'idle' && status !== 'completed') return asFailure(gisError('WORKFLOW_ALREADY_STARTED'));
    try {
      // A completed instruction must not pin the next one to an obsolete map/catalog.
      if (status === 'completed' && (!scope.isActive() || gis.catalog.getVersion() !== catalogVersion)) {
        scope.dispose();
        scope = gis.createClientScope();
        catalogVersion = gis.catalog.getVersion();
      }
      assertActive();
      const initial = gis.runtime.getState();
      if (initial.scene !== '2d') throw gisError('UNSUPPORTED_CAPABILITY');
      if (!initial.ready) throw gisError('MAP_NOT_READY');
      cleanup();
      const gisExecutor = createFrontendExecutor({ scope, assertActive, resolveReference,
        signal: controller.signal, mapContext: gis.mapContext,
      });
      const businessExecutor = createBusinessArtifactFrontendExecutor({ application: businessArtifacts });
      const executor = {
        execute(call) {
          return BUSINESS_ARTIFACT_FRONTEND_TOOLS.some((tool) => tool.name === call.name)
            ? businessExecutor.execute(call)
            : gisExecutor.execute(call);
        },
      };
      observer = observeOperations?.({ map: gis.runtime.getMap(), onUserOperation: () => cancel(), onObserved: emit });
      unsubscribe = gis.runtime.subscribe(() => cancel('STALE_CONTEXT'));
      unsubscribeUser = gis.runtime.subscribeUserOperations?.(() => cancel()) ?? (() => {});
      leaseTimer = setTimeout(() => cancel('SESSION_LEASE_EXPIRED'), Math.max(0, session.leaseExpiresAt - clock()));
      messages.push({ id: idFactory(), role: 'user', content: message });
      liveMessages = null;
      onAccepted();
      let failureReceipt = null;
      for (let iteration = 0; iteration < 8; iteration++) {
        // A failed business action gets one explanation-only run after scope cleanup.
        if (!failureReceipt) assertActive();
        const observed = gis.mapContext.getSnapshot();
        if (!observed.ok) throw gisError(observed.error.code, observed.error.message);
        const runId = idFactory();
        const tools = failureReceipt
          ? []
          : [
              ...FRONTEND_TOOLS.filter((tool) => observed.data.supportedTools.includes(tool.name)),
              ...BUSINESS_ARTIFACT_FRONTEND_TOOLS,
            ];
        progress = { phase: 'thinking' };
        transition(failureReceipt ? 'explaining_failure' : 'running');
        const timeout = setTimeout(() => cancel('RUN_TIMEOUT'), runTimeoutMs);
        let response;
        try {
          response = await transport.run({ threadId: session.threadId, runId, messages,
            tools, state: { ...protocolState, gisObserved: observed.data },
            forwardedProps: { gisIntegration: { browserSessionId: session.browserSessionId, workflowId: session.workflowId } },
          }, { signal: controller.signal, onProgress(update) {
            if (controller.signal.aborted) return;
            if (update.messages) liveMessages = update.messages;
            if (update.progress) progress = update.progress;
            if (update.currentToolCall) currentToolCall = update.currentToolCall;
            emit();
          } });
        } finally { clearTimeout(timeout); }
        if (status === 'cancelled') throw gisError(terminalError.code);
        if (!failureReceipt) assertActive();
        messages = response.messages;
        liveMessages = null;
        protocolState = response.state;
        if (receipts.length) receipts.at(-1).delivered = true;
        if (!response.call) {
          cleanup();
          if (failureReceipt) {
            terminalError = failureReceipt.error;
            transition('failed');
            await notifyCancellation();
            return failureReceipt;
          }
          transition('completed');
          return success(snapshot());
        }
        if (failureReceipt) throw gisError('PROTOCOL_ERROR');
        currentToolCall = { name: response.call.name, toolCallId: response.call.toolCallId };
        transition('waiting_frontend');
        const result = await executor.execute(response.call);
        const receipt = { ...result, effect: { ...result.effect, workflowId: session.workflowId } };
        receipts.push({ runId, toolCallId: response.call.toolCallId, toolCallName: response.call.name, result: receipt, delivered: false });
        currentToolCall = null;
        if (status === 'cancelled') throw gisError(terminalError.code);
        messages.push({ id: idFactory(), role: 'tool', toolCallId: response.call.toolCallId,
          content: JSON.stringify(receipt), ...(!receipt.ok ? { error: receipt.error.message } : {}) });
        transition('waiting_result_submission');
        // Actual server consumption is evidenced by a successful continuation,
        // not by constructing this message locally.
        if (!receipt.ok) {
          failureReceipt = receipt;
          observer?.dispose();
          scope.dispose();
        }
      }
      throw gisError('PROTOCOL_ERROR', 'Exceeded bounded continuation count');
    } catch (error) {
      cleanup();
      controller.abort();
      scope.dispose();
      terminalError ||= { code: error.code || 'PROTOCOL_ERROR', message: error.message };
      if (status !== 'cancelled') transition('failed');
      await notifyCancellation();
      return asFailure(gisError(terminalError.code, terminalError.message));
    }
  }
  return {
    run,
    cancel,
    getState: snapshot,
    clear() { return scope.clearHighlight(); },
    dispose() {
      cancel();
      cleanup();
      scope.dispose();
      void notifyCancellation();
    },
  };
}
