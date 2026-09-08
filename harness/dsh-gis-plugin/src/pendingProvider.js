import { randomUUID } from 'node:crypto';
import { gisFrontendError } from './gisFrontendService.js';

export const name = 'gis-frontend-pending-provider';
export const inject = ['gisFrontend'];

function publicRequest(pending) {
  return {
    requestId: pending.requestId,
    sessionId: pending.sessionId,
    callId: pending.callId,
    operation: pending.operation,
    arguments: structuredClone(pending.arguments),
  };
}

export function apply(ctx) {
  const pendingById = new Map();
  const listeners = new Set();

  const notify = (event) => {
    for (const listener of listeners) {
      try { listener(structuredClone(event)); }
      catch { /* Observers cannot break provider lifecycle. */ }
    }
  };

  const claim = (pending, outcome) => {
    if (pendingById.get(pending.requestId) !== pending) return false;
    pendingById.delete(pending.requestId);
    pending.signal?.removeEventListener('abort', pending.onAbort);
    notify({ type: 'resolved', outcome, request: publicRequest(pending) });
    return true;
  };

  const provider = {
    execute(request) {
      if (!request.agent || typeof request.agent.id !== 'string') {
        return Promise.reject(gisFrontendError('GIS_FRONTEND_AGENT_REQUIRED', 'Browser GIS execution requires a live agent-owned session.'));
      }
      if (typeof request.callId !== 'string' || request.callId.length === 0) {
        return Promise.reject(gisFrontendError('GIS_FRONTEND_CALL_ID_REQUIRED', 'Browser GIS execution requires the originating Harness tool call id.'));
      }
      if (request.signal?.aborted) {
        return Promise.reject(gisFrontendError('GIS_FRONTEND_ABORTED', 'GIS frontend execution was aborted before dispatch.'));
      }

      return new Promise((resolve, reject) => {
        const pending = {
          requestId: randomUUID(),
          sessionId: request.agent.id,
          callId: request.callId,
          operation: request.operation,
          arguments: structuredClone(request.arguments),
          signal: request.signal,
          resolve,
          reject,
          onAbort: undefined,
        };
        pending.onAbort = () => {
          if (!claim(pending, 'cancelled')) return;
          reject(gisFrontendError('GIS_FRONTEND_ABORTED', 'GIS frontend execution was aborted before the browser completed it.'));
        };
        pendingById.set(pending.requestId, pending);
        request.signal?.addEventListener('abort', pending.onAbort, { once: true });
        notify({ type: 'requested', request: publicRequest(pending) });
      });
    },
  };

  const disposeProvider = ctx.gisFrontend.registerProvider(provider);
  ctx.effect(() => () => {
    disposeProvider();
    for (const pending of [...pendingById.values()]) {
      if (!claim(pending, 'cancelled')) continue;
      pending.reject(gisFrontendError('GIS_FRONTEND_ABORTED', 'GIS frontend pending provider was disposed.'));
    }
    listeners.clear();
  }, 'gis pending provider lifecycle');

  ctx.provide('gisFrontendPending', {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    list(sessionId) {
      return [...pendingById.values()]
        .filter((pending) => sessionId === undefined || pending.sessionId === sessionId)
        .map(publicRequest);
    },
    resolve(requestId, result) {
      const pending = pendingById.get(requestId);
      if (!pending) return { accepted: false, reason: 'not-pending' };
      if (!claim(pending, 'completed')) return { accepted: false, reason: 'not-pending' };
      pending.resolve(structuredClone(result));
      return { accepted: true };
    },
    reject(requestId, error = gisFrontendError('GIS_FRONTEND_REJECTED')) {
      const pending = pendingById.get(requestId);
      if (!pending) return { accepted: false, reason: 'not-pending' };
      if (!claim(pending, 'failed')) return { accepted: false, reason: 'not-pending' };
      pending.reject(error);
      return { accepted: true };
    },
  });
}
