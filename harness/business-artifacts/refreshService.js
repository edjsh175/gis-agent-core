function serviceError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export function createBusinessCardRefreshService({
  repository,
  statistics,
  timeoutMs = 30_000,
} = {}) {
  if (!repository || !statistics || typeof statistics.replay !== 'function')
    throw new Error(
      'repository and replayable statistics service are required'
    );

  function canRefresh(current) {
    if (
      !current?.card ||
      current.card.status !== 'active' ||
      !Array.isArray(current.card.statisticsRefs) ||
      current.card.statisticsRefs.length === 0 ||
      !Array.isArray(current.snapshots) ||
      typeof statistics.canReplay !== 'function'
    )
      return false;
    const byRef = new Map(
      current.snapshots.map((snapshot) => [snapshot.statistics_ref, snapshot])
    );
    return current.card.statisticsRefs.every((ref) => {
      const snapshot = byRef.get(ref);
      return snapshot ? statistics.canReplay(snapshot) : false;
    });
  }

  async function refresh(context, cardId, expectedRevision) {
    const current = repository.getCard(context, cardId);
    if (current.card.status !== 'active')
      throw serviceError('CARD_NOT_FOUND', 'card not found');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw serviceError(
        'CARD_REVISION_INVALID',
        'expectedRevision must be a positive integer'
      );
    if (current.card.revision !== expectedRevision)
      throw serviceError('CARD_REVISION_CONFLICT', 'card revision has changed');
    if (!current.card.statisticsRefs.length)
      throw serviceError(
        'CARD_REFRESH_UNSUPPORTED',
        'card has no statistics snapshot'
      );
    const byRef = new Map(
      current.snapshots.map((snapshot) => [snapshot.statistics_ref, snapshot])
    );
    if (byRef.size !== current.card.statisticsRefs.length)
      throw serviceError(
        'CARD_BINDING_INVALID',
        'card statistics snapshot is unavailable'
      );
    const controller = new AbortController();
    let timedOut = false;
    let rejectDeadline;
    const deadline = new Promise((_, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectDeadline(
        serviceError('STATISTICS_TIMEOUT', 'statistics refresh timed out')
      );
    }, timeoutMs);
    try {
      const work = Promise.all(
        current.card.statisticsRefs.map(async (ref) => [
          ref,
          await statistics.replay(byRef.get(ref), {
            signal: controller.signal,
          }),
        ])
      );
      const entries = await Promise.race([work, deadline]);
      if (timedOut || controller.signal.aborted)
        throw serviceError(
          'STATISTICS_TIMEOUT',
          'statistics refresh timed out'
        );
      return repository.refreshCardAtomic(
        context,
        cardId,
        expectedRevision,
        Object.fromEntries(entries)
      );
    } catch (cause) {
      if (
        timedOut ||
        cause?.code === 'STATISTICS_TIMEOUT' ||
        cause?.name === 'AbortError'
      )
        throw serviceError(
          'STATISTICS_TIMEOUT',
          'statistics refresh timed out'
        );
      controller.abort();
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }
  return { refresh, canRefresh };
}
