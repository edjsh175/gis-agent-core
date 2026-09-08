import { success, asFailure, gisError } from '../../contracts.js';
import { FRONTEND_TOOLS } from './frontendTools.js';
import { createFrontendExecutor } from './frontendExecutor.js';

/** One user instruction, one captured scope, several protocol runs. */
export function createAguiWorkflow({
  gis, session, transport, resolveReference, cancelRemote,
  observeOperations, idFactory = () => crypto.randomUUID(), clock = () => Date.now(),
  onChange = () => {}, runTimeoutMs = 30_000,
}) {
  const controller = new AbortController();
  const scope = gis.createClientScope();
  const catalogVersion = gis.catalog.getVersion();
  let status = 'idle';
  let messages = [];
  let protocolState = {};
  const receipts = [];
  let observer;
  let unsubscribe = () => {};
  let leaseTimer;
  let terminalError;
  let cancellation;
  const snapshot = () => ({ status, messages: structuredClone(messages), receipts: structuredClone(receipts),
    context: gis.mapContext.getSnapshot(), ...(terminalError ? { error: terminalError } : {}) });
  const emit = () => onChange(snapshot());
  const transition = (next) => { status = next; emit(); };
  const cleanup = () => { clearTimeout(leaseTimer); unsubscribe(); observer?.dispose(); };
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
  const executor = createFrontendExecutor({ scope, assertActive, resolveReference,
    signal: controller.signal, mapContext: gis.mapContext,
    withEffect: (kind, fn) => observer ? observer.withEffect(kind, fn) : fn(),
  });
  async function run(message) {
    if (status !== 'idle') return asFailure(gisError('WORKFLOW_ALREADY_STARTED'));
    try {
      assertActive();
      const initial = gis.runtime.getState();
      if (initial.scene !== '2d') throw gisError('UNSUPPORTED_CAPABILITY');
      if (!initial.ready) throw gisError('MAP_NOT_READY');
      observer = observeOperations?.({ map: gis.runtime.getMap(), onUserOperation: () => cancel(), onObserved: emit });
      unsubscribe = gis.runtime.subscribe(() => cancel('STALE_CONTEXT'));
      leaseTimer = setTimeout(() => cancel('SESSION_LEASE_EXPIRED'), Math.max(0, session.leaseExpiresAt - clock()));
      messages = [{ id: idFactory(), role: 'user', content: message }];
      let failureReceipt = null;
      for (let iteration = 0; iteration < 8; iteration++) {
        // A failed business action gets one explanation-only run after scope cleanup.
        if (!failureReceipt) assertActive();
        const observed = gis.mapContext.getSnapshot();
        if (!observed.ok) throw gisError(observed.error.code, observed.error.message);
        const runId = idFactory();
        const tools = failureReceipt ? [] : FRONTEND_TOOLS.filter((tool) => observed.data.supportedTools.includes(tool.name));
        transition(failureReceipt ? 'explaining_failure' : 'running');
        const timeout = setTimeout(() => cancel('RUN_TIMEOUT'), runTimeoutMs);
        let response;
        try {
          response = await transport.run({ threadId: session.threadId, runId, messages,
            tools, state: { ...protocolState, gisObserved: observed.data },
            forwardedProps: { gisIntegration: { browserSessionId: session.browserSessionId, workflowId: session.workflowId } },
          }, { signal: controller.signal });
        } finally { clearTimeout(timeout); }
        if (status === 'cancelled') throw gisError(terminalError.code);
        if (!failureReceipt) assertActive();
        messages = response.messages;
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
        transition('waiting_frontend');
        const result = await executor.execute(response.call);
        const receipt = { ...result, effect: { ...result.effect, workflowId: session.workflowId } };
        receipts.push({ runId, toolCallId: response.call.toolCallId, result: receipt, delivered: false });
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
