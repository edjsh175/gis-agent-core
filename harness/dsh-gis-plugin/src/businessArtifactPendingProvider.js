import { randomUUID } from 'node:crypto';
import { businessArtifactFrontendError } from './businessArtifactFrontendService.js';

export const name = 'business-artifact-pending-provider';
export const inject = ['businessArtifactFrontend'];

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
      try { listener(structuredClone(event)); } catch {}
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
      if (!request.agent || typeof request.agent.id !== 'string')
        return Promise.reject(businessArtifactFrontendError('BUSINESS_FRONTEND_AGENT_REQUIRED'));
      if (typeof request.callId !== 'string' || !request.callId)
        return Promise.reject(businessArtifactFrontendError('BUSINESS_FRONTEND_CALL_ID_REQUIRED'));
      if (request.signal?.aborted)
        return Promise.reject(businessArtifactFrontendError('BUSINESS_FRONTEND_ABORTED'));
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
          reject(businessArtifactFrontendError('BUSINESS_FRONTEND_ABORTED'));
        };
        pendingById.set(pending.requestId, pending);
        request.signal?.addEventListener('abort', pending.onAbort, { once: true });
        notify({ type: 'requested', request: publicRequest(pending) });
      });
    },
  };

  const disposeProvider = ctx.businessArtifactFrontend.registerProvider(provider);
  ctx.effect(() => () => {
    disposeProvider();
    for (const pending of [...pendingById.values()]) {
      if (!claim(pending, 'cancelled')) continue;
      pending.reject(businessArtifactFrontendError('BUSINESS_FRONTEND_ABORTED'));
    }
    listeners.clear();
  }, 'business artifact pending provider lifecycle');

  ctx.provide('businessArtifactPending', {
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
      if (!pending || !claim(pending, 'completed'))
        return { accepted: false, reason: 'not-pending' };
      pending.resolve(structuredClone(result));
      return { accepted: true };
    },
    reject(requestId, error = businessArtifactFrontendError('BUSINESS_FRONTEND_REJECTED')) {
      const pending = pendingById.get(requestId);
      if (!pending || !claim(pending, 'failed'))
        return { accepted: false, reason: 'not-pending' };
      pending.reject(error);
      return { accepted: true };
    },
  });
}
