import { describe, it, expect } from 'vitest';
import { createBusinessCardApplication } from '../../src/business-artifacts/application.js';

const card = (id, revision = 1) => ({ cardId: id, revision });
const response = (payload, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => payload,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('business card projection', () => {
  it('recovers from the server in a new application instance', async () => {
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return response({ cards: [card('saved')], snapshots: [] });
    };
    const app = createBusinessCardApplication({ fetchImpl });
    await app.load();
    expect(app.state.cards.map((item) => item.cardId)).toEqual(['saved']);
    const reloaded = createBusinessCardApplication({ fetchImpl });
    await reloaded.load();
    expect(reloaded.state.cards).toEqual(app.state.cards);
    expect(
      requests.every(({ options }) => options.credentials === 'same-origin')
    ).toBe(true);
  });

  it('preserves other card snapshots and deduplicates repeated presentations', async () => {
    const app = createBusinessCardApplication({
      fetchImpl: async (url) =>
        response(
          url.endsWith('/next')
            ? {
                card: card('next'),
                snapshots: [{ statistics_ref: 'stat_next' }],
              }
            : {
                cards: [card('existing')],
                snapshots: [{ statistics_ref: 'stat_existing' }],
              }
        ),
    });
    await app.load();
    await app.present('next', 1);
    await app.present('next', 1);
    expect(app.state.cards).toHaveLength(2);
    expect(
      app.state.snapshots.map((item) => item.statistics_ref).sort()
    ).toEqual(['stat_existing', 'stat_next']);
  });

  it('accepts a newer revision and rejects stale delivery', async () => {
    const app = createBusinessCardApplication({
      fetchImpl: async (url) =>
        response(
          url.endsWith('/saved')
            ? { card: card('saved', 2), snapshots: [] }
            : { cards: [card('saved')], snapshots: [] }
        ),
    });
    await app.load();
    await app.present('saved', 2);
    expect(app.state.cards[0].revision).toBe(2);
    await expect(app.present('saved', 1)).rejects.toMatchObject({
      code: 'CARD_REVISION_CONFLICT',
    });
    expect(app.state.cards[0].revision).toBe(2);
  });

  it('does not let an older list response erase a card just presented', async () => {
    const pending = deferred();
    const app = createBusinessCardApplication({
      fetchImpl: (url) =>
        url.endsWith('/new')
          ? Promise.resolve(response({ card: card('new'), snapshots: [] }))
          : pending.promise,
    });
    const loading = app.load();
    const presenting = app.present('new', 1);
    pending.resolve(response({ cards: [card('previous')], snapshots: [] }));
    await Promise.all([loading, presenting]);
    expect(app.state.cards.map((item) => item.cardId).sort()).toEqual([
      'new',
      'previous',
    ]);
  });

  it('does not allow a late older response to downgrade a newer presentation', async () => {
    const older = deferred();
    let calls = 0;
    const app = createBusinessCardApplication({
      fetchImpl: () =>
        ++calls === 1
          ? older.promise
          : Promise.resolve(
              response({ card: card('saved', 2), snapshots: [] })
            ),
    });
    const first = app.present('saved', 1);
    await app.present('saved', 2);
    older.resolve(response({ card: card('saved', 1), snapshots: [] }));
    await expect(first).rejects.toMatchObject({
      code: 'CARD_REVISION_CONFLICT',
    });
    expect(app.state.cards[0].revision).toBe(2);
  });

  it('exposes load errors without replacing the existing projection', async () => {
    let available = true;
    const app = createBusinessCardApplication({
      fetchImpl: async () =>
        available
          ? response({ cards: [card('saved')], snapshots: [] })
          : response({ error: { message: '服务不可用' } }, 503),
    });
    await app.load();
    available = false;
    await expect(app.load()).rejects.toThrow('服务不可用');
    expect(app.state.cards).toHaveLength(1);
    expect(app.state.error.message).toBe('服务不可用');
    expect(app.state.loading).toBe(false);
  });

  it('refreshes in place, deduplicates clicks, and preserves snapshots', async () => {
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/saved/refresh'))
        return response({
          card: { ...card('saved', 2), statisticsRefs: ['stat_new'] },
          snapshots: [
            {
              statistics_ref: 'stat_new',
              calculatedAt: '2026-09-10T01:00:00Z',
            },
          ],
        });
      return response({
        cards: [{ ...card('saved', 1), statisticsRefs: ['stat_old'] }],
        snapshots: [{ statistics_ref: 'stat_old' }],
      });
    };
    const app = createBusinessCardApplication({ fetchImpl });
    await app.load();
    await Promise.all([app.refresh('saved', 1), app.refresh('saved', 1)]);
    expect(
      requests.filter(({ url }) => url.endsWith('/saved/refresh'))
    ).toHaveLength(1);
    expect(app.state.cards[0]).toMatchObject({ cardId: 'saved', revision: 2 });
    expect(
      app.state.snapshots.map((item) => item.statistics_ref).sort()
    ).toEqual(['stat_new', 'stat_old']);
  });

  it('recovers only by GET after a refresh conflict and keeps the message', async () => {
    const requests = [];
    const app = createBusinessCardApplication({
      fetchImpl: async (url) => {
        requests.push(url);
        if (url.endsWith('/saved/refresh'))
          return response({ error: { message: '版本冲突' } }, 409);
        return response({ card: card('saved', 2), snapshots: [] });
      },
    });
    app.state.cards = [card('saved', 1)];
    await expect(app.refresh('saved', 1)).rejects.toMatchObject({
      status: 409,
    });
    expect(requests).toEqual([
      '/__business-artifacts/cards/saved/refresh',
      '/__business-artifacts/cards/saved',
    ]);
    expect(app.state.cards[0].revision).toBe(2);
    expect(app.state.cardStates.saved).toMatchObject({
      status: 'conflict',
      message: '卡片已被其他操作更新',
    });
  });

  it('does not let a late list or stale presentation downgrade a refreshed card', async () => {
    const list = deferred();
    const stale = deferred();
    const app = createBusinessCardApplication({
      fetchImpl: (url) => {
        if (url.endsWith('/saved/refresh'))
          return Promise.resolve(
            response({ card: card('saved', 2), snapshots: [] })
          );
        if (url.endsWith('/saved')) return stale.promise;
        return list.promise;
      },
    });
    app.state.cards = [card('saved', 1)];
    const loading = app.load();
    await app.refresh('saved', 1);
    list.resolve(response({ cards: [card('saved', 1)], snapshots: [] }));
    await loading;
    const presentation = app.present('saved', 1);
    stale.resolve(response({ card: card('saved', 1), snapshots: [] }));
    await expect(presentation).rejects.toMatchObject({
      code: 'CARD_REVISION_CONFLICT',
    });
    expect(app.state.cards[0].revision).toBe(2);
  });

  it('keeps old content when conflict recovery GET fails', async () => {
    const app = createBusinessCardApplication({
      fetchImpl: async (url) =>
        url.endsWith('/refresh')
          ? response({ error: { message: '冲突' } }, 409)
          : response({ error: { message: '恢复失败' } }, 503),
    });
    app.state.cards = [{ ...card('saved', 1), spec: { title: '旧内容' } }];
    await expect(app.refresh('saved', 1)).rejects.toMatchObject({
      status: 409,
    });
    expect(app.state.cards[0]).toMatchObject({
      revision: 1,
      spec: { title: '旧内容' },
    });
    expect(app.state.cardStates.saved.message).toContain('恢复失败');
  });

  it('uses revision tombstones so archived or deleted cards cannot be resurrected by stale responses', async () => {
    const app = createBusinessCardApplication({
      fetchImpl: async () => response({ cards: [], snapshots: [] }),
    });
    app.state.cards = [card('saved', 2)];
    expect(app.dismiss('saved', 3)).toEqual({
      cardId: 'saved',
      revision: 3,
      visible: false,
    });
    expect(app.state.cards).toHaveLength(0);
    expect(app.state.tombstones.saved).toBe(3);

    const stale = createBusinessCardApplication({
      fetchImpl: async () =>
        response({ card: card('saved', 2), snapshots: [] }),
    });
    stale.dismiss('saved', 3);
    await expect(stale.present('saved', 2)).rejects.toMatchObject({
      code: 'CARD_REVISION_CONFLICT',
    });
    expect(stale.state.cards).toHaveLength(0);
  });

  it('tracks refresh state independently for cards', async () => {
    const first = deferred();
    const second = deferred();
    const app = createBusinessCardApplication({
      fetchImpl: (url) =>
        url.includes('/one/') ? first.promise : second.promise,
    });
    app.state.cards = [card('one'), card('two')];
    const one = app.refresh('one', 1);
    const two = app.refresh('two', 1);
    expect(app.state.cardStates.one.status).toBe('running');
    expect(app.state.cardStates.two.status).toBe('running');
    first.resolve(response({ card: card('one', 2), snapshots: [] }));
    await one;
    expect(app.state.cardStates.one.status).toBe('success');
    expect(app.state.cardStates.two.status).toBe('running');
    second.resolve(response({ card: card('two', 2), snapshots: [] }));
    await two;
  });
});
