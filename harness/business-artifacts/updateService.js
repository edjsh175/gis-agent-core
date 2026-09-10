import { createBusinessCardRefreshService } from './refreshService.js';

function lifecycleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createBusinessCardLifecycleService({
  repository,
  statistics,
} = {}) {
  if (!repository) throw new Error('repository is required');
  const refreshService =
    statistics?.replay && typeof statistics.replay === 'function'
      ? createBusinessCardRefreshService({ repository, statistics })
      : null;

  return {
    canRefresh(current) {
      return refreshService?.canRefresh(current) ?? false;
    },
    refresh(context, cardId, expectedRevision) {
      if (!refreshService)
        throw lifecycleError(
          'STATISTICS_UNAVAILABLE',
          'pipeline statistics service is unavailable'
        );
      return refreshService.refresh(context, cardId, expectedRevision);
    },
    update(context, cardId, expectedRevision, spec) {
      return repository.updateCardAtomic(
        context,
        cardId,
        expectedRevision,
        spec
      );
    },
    archive(context, cardId, expectedRevision) {
      return repository.archiveCardAtomic(context, cardId, expectedRevision);
    },
    delete(context, cardId, expectedRevision) {
      return repository.deleteCardAtomic(context, cardId, expectedRevision);
    },
  };
}
