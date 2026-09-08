import { gisError } from '../../contracts.js';

/** Fixed application-owned routes; tool arguments never choose a URL or identity. */
export function createIntegrationServiceClient({ baseUrl, fetchImpl = globalThis.fetch }) {
  const post = async (path, body, { signal } = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal,
    });
    const result = await response.json();
    if (!result || typeof result.ok !== 'boolean') throw gisError('PROTOCOL_ERROR');
    return result;
  };
  return {
    async createSession(options = {}) {
      const result = await post('/sessions', options);
      if (!result.ok) throw gisError(result.error.code, result.error.message);
      return result.data;
    },
    forSession(session) {
      const binding = { browserSessionId: session.browserSessionId, threadId: session.threadId, workflowId: session.workflowId };
      return {
        resolveReference: (feature_ref, options) => post('/resolve', { ...binding, feature_ref }, options),
        cancelRemote: () => post('/cancel', binding),
      };
    },
  };
}
