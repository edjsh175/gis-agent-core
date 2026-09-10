const DEFAULT_BASE_URL =
  process.env.BUSINESS_ARTIFACT_URL ||
  'http://127.0.0.1:3189/__business-artifacts';

function backendError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw backendError(
      payload?.error?.code || 'BUSINESS_BACKEND_ERROR',
      payload?.error?.message ||
        `Business Artifact backend HTTP ${response.status}`
    );
  }
  return payload;
}

export function createBusinessArtifactBackendClient({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function')
    throw new Error('Business Artifact backend requires fetch');
  const root = String(baseUrl).replace(/\/$/, '');

  const post = (path, body, workflowId, signal) =>
    fetchImpl(`${root}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(workflowId ? { 'x-23dmaps-workflow-id': String(workflowId) } : {}),
      },
      body: JSON.stringify(body),
      signal,
    }).then(readResponse);
  const get = (path, signal) =>
    fetchImpl(`${root}${path}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      signal,
    }).then(readResponse);

  return {
    getPipelineStatistics(context = {}) {
      return post(
        '/statistics/pipeline',
        {},
        context.workflowId,
        context.signal
      );
    },
    publishCard(spec, context = {}) {
      return post('/cards', { spec }, context.workflowId, context.signal);
    },
    listCards(context = {}) {
      return get('/cards?includeArchived=1', context.signal);
    },
    getCard(cardId, context = {}) {
      return get(`/cards/${encodeURIComponent(cardId)}`, context.signal);
    },
    refreshCard(cardId, expectedRevision, context = {}) {
      return post(
        `/cards/${encodeURIComponent(cardId)}/refresh`,
        { expectedRevision },
        context.workflowId,
        context.signal
      );
    },
    updateCard(cardId, expectedRevision, spec, context = {}) {
      return post(
        `/cards/${encodeURIComponent(cardId)}/update`,
        { expectedRevision, spec },
        context.workflowId,
        context.signal
      );
    },
    archiveCard(cardId, expectedRevision, context = {}) {
      return post(
        `/cards/${encodeURIComponent(cardId)}/archive`,
        { expectedRevision },
        context.workflowId,
        context.signal
      );
    },
    deleteCard(cardId, expectedRevision, context = {}) {
      return post(
        `/cards/${encodeURIComponent(cardId)}/delete`,
        { expectedRevision },
        context.workflowId,
        context.signal
      );
    },
  };
}

export { DEFAULT_BASE_URL };
