import { reactive } from 'vue';

const DEFAULT_BASE_URL = '/__business-artifacts/cards';

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message ||
        payload?.message ||
        `业务卡片请求失败（${response.status}）`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function createBusinessCardApplication({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('需要可用的 fetch 实现');
  const state = reactive({
    cards: [],
    snapshots: [],
    loading: false,
    error: null,
    cardStates: {},
    tombstones: {},
  });
  let listRequest = null;
  const refreshRequests = new Map();

  const mergeSnapshots = (incoming) => {
    if (!Array.isArray(incoming)) return;
    const byRef = new Map(
      state.snapshots.map((snapshot) => [snapshot.statistics_ref, snapshot])
    );
    incoming.forEach((snapshot) => {
      if (snapshot?.statistics_ref)
        byRef.set(snapshot.statistics_ref, snapshot);
    });
    state.snapshots = [...byRef.values()];
  };

  const mergeCard = (incoming) => {
    if (!incoming?.cardId) return false;
    const tombstoneRevision = state.tombstones[incoming.cardId] ?? 0;
    if ((incoming.revision ?? 0) <= tombstoneRevision) return false;
    const index = state.cards.findIndex(
      (card) => card.cardId === incoming.cardId
    );
    const current = index >= 0 ? state.cards[index] : null;
    if (current && (incoming.revision ?? 0) < (current.revision ?? 0))
      return false;
    if (index < 0) state.cards = [...state.cards, incoming];
    else state.cards.splice(index, 1, incoming);
    return true;
  };

  const request = (path, init = {}) =>
    fetchImpl(`${baseUrl}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    }).then(readResponse);

  async function load() {
    if (listRequest) return listRequest;
    state.loading = true;
    state.error = null;
    listRequest = request('')
      .then((payload) => {
        const listedCards = Array.isArray(payload.cards) ? payload.cards : [];
        listedCards.forEach(mergeCard);
        mergeSnapshots(payload.snapshots);
        return payload;
      })
      .catch((error) => {
        state.error = error;
        throw error;
      })
      .finally(() => {
        state.loading = false;
        listRequest = null;
      });
    return listRequest;
  }

  async function create(spec) {
    state.error = null;
    const payload = await request('', {
      method: 'POST',
      body: JSON.stringify({ spec }),
    });
    mergeCard(payload.card);
    mergeSnapshots(payload.snapshots);
    return payload;
  }

  async function present(cardId, expectedRevision) {
    const local = state.cards.find((card) => card.cardId === cardId);
    const tombstoneRevision = state.tombstones[cardId] ?? 0;
    if (
      expectedRevision !== undefined &&
      expectedRevision <= tombstoneRevision
    ) {
      const error = new Error('业务卡片版本已变化，拒绝展示已下架版本');
      error.code = 'CARD_REVISION_CONFLICT';
      throw error;
    }
    if (
      expectedRevision !== undefined &&
      local &&
      expectedRevision < local.revision
    ) {
      const error = new Error('业务卡片版本已变化，拒绝展示过期版本');
      error.code = 'CARD_REVISION_CONFLICT';
      throw error;
    }
    const payload = await request(`/${encodeURIComponent(cardId)}`);
    if ((payload.card?.revision ?? 0) <= (state.tombstones[cardId] ?? 0)) {
      const error = new Error('业务卡片版本已变化，拒绝展示已下架版本');
      error.code = 'CARD_REVISION_CONFLICT';
      throw error;
    }
    const current = state.cards.find((card) => card.cardId === cardId);
    if (current && payload.card?.revision < current.revision) {
      const error = new Error('业务卡片版本已变化，拒绝展示过期版本');
      error.code = 'CARD_REVISION_CONFLICT';
      throw error;
    }
    if (
      expectedRevision !== undefined &&
      payload.card?.revision !== expectedRevision
    ) {
      const error = new Error('业务卡片版本已变化，拒绝展示过期版本');
      error.code = 'CARD_REVISION_CONFLICT';
      throw error;
    }
    mergeCard(payload.card);
    mergeSnapshots(payload.snapshots);
    return payload;
  }

  function dismiss(cardId, revision) {
    if (typeof cardId !== 'string' || !cardId)
      throw new Error('找不到业务卡片');
    if (!Number.isInteger(revision) || revision < 1)
      throw new Error('找不到业务卡片版本');
    const currentTombstone = state.tombstones[cardId] ?? 0;
    if (revision < currentTombstone) {
      const error = new Error('业务卡片版本已变化，拒绝应用过期移除');
      error.code = 'CARD_REVISION_CONFLICT';
      throw error;
    }
    const current = state.cards.find((card) => card.cardId === cardId);
    if (current && revision < (current.revision ?? 0)) {
      const error = new Error('业务卡片版本已变化，拒绝应用过期移除');
      error.code = 'CARD_REVISION_CONFLICT';
      throw error;
    }
    state.tombstones[cardId] = Math.max(currentTombstone, revision);
    state.cards = state.cards.filter((card) => card.cardId !== cardId);
    delete state.cardStates[cardId];
    return { cardId, revision, visible: false };
  }

  async function refresh(cardId, expectedRevision) {
    if (refreshRequests.has(cardId)) return refreshRequests.get(cardId);
    const local = state.cards.find((card) => card.cardId === cardId);
    const revision = expectedRevision ?? local?.revision;
    if (revision === undefined) throw new Error('找不到业务卡片版本');
    state.cardStates[cardId] = { status: 'running', message: '' };
    const operation = request(`/${encodeURIComponent(cardId)}/refresh`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: revision }),
    })
      .then((payload) => {
        mergeCard(payload.card);
        mergeSnapshots(payload.snapshots);
        state.cardStates[cardId] = { status: 'success', message: '数据已刷新' };
        return payload;
      })
      .catch(async (error) => {
        if (error.status === 409) {
          try {
            await present(cardId);
            state.cardStates[cardId] = {
              status: 'conflict',
              message: '卡片已被其他操作更新',
            };
          } catch (recoveryError) {
            state.cardStates[cardId] = {
              status: 'error',
              message: '卡片已被其他操作更新，最新版本恢复失败',
            };
            error.recoveryError = recoveryError;
          }
        } else {
          state.cardStates[cardId] = {
            status: 'error',
            message: error.message || '刷新失败',
          };
        }
        throw error;
      })
      .finally(() => refreshRequests.delete(cardId));
    refreshRequests.set(cardId, operation);
    return operation;
  }

  return { state, load, create, present, dismiss, refresh };
}

export { DEFAULT_BASE_URL };
