import { describe, expect, it, vi } from 'vitest';
import { apply } from '../../harness/dsh-gis-plugin/src/businessArtifactTools.js';
import { BUSINESS_ARTIFACT_TOOL_NAMES } from '../../harness/dsh-gis-plugin/src/businessArtifactToolCatalog.js';

function setup(
  fetchImpl,
  frontend = vi
    .fn()
    .mockResolvedValue({ ok: true, effect: { status: 'applied' } })
) {
  const registered = new Map();
  const ctx = {
    tools: {
      register(tool) {
        registered.set(tool.name, tool);
      },
    },
    businessArtifactFrontend: { execute: frontend },
  };
  apply(ctx, { baseUrl: 'http://test/__business-artifacts', fetchImpl });
  return { registered, frontend };
}

const response = (payload, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => payload,
});

describe('business artifact lifecycle agent tools', () => {
  it('registers exactly the shared Business Artifact tool catalog', () => {
    const { registered } = setup(vi.fn());
    expect([...registered.keys()].sort()).toEqual(
      [...BUSINESS_ARTIFACT_TOOL_NAMES].sort()
    );
  });

  it('exposes current pipeline statistics as a zero-argument capability', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        statistics_ref: 'stat-1',
        dataset: 'pipeline',
        calculatedAt: '2026-09-10T09:10:00Z',
        availablePaths: ['summary.count'],
        summary: { count: 1 },
        groups: { material: [] },
      })
    );
    const { registered } = setup(fetchImpl);
    const tool = registered.get('get_pipeline_statistics');
    expect(tool.parameters).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {},
    });
    const result = await tool.execute({}, { agent: { id: 'workflow-1' } });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/__business-artifacts/statistics/pipeline',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        headers: expect.objectContaining({
          'x-23dmaps-workflow-id': 'workflow-1',
        }),
      })
    );
  });

  it('lists card metadata plus current spec and derives the latest snapshot time', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        cards: [
          {
            cardId: 'card-1',
            spec: { title: '管线概览' },
            statisticsRefs: ['stat-1'],
            status: 'active',
            revision: 2,
            createdAt: '2026-09-09',
            updatedAt: '2026-09-10',
            refreshable: true,
          },
        ],
        snapshots: [
          {
            statistics_ref: 'stat-1',
            calculatedAt: '2026-09-10T09:10:00Z',
            dataset: 'pipeline',
            scope: { layerId: 'GX:js_ln' },
            query: {
              metrics: ['count', 'total_length'],
              dimensions: ['material'],
              filters: [],
            },
            data: { secret: true },
          },
        ],
      })
    );
    const { registered } = setup(fetchImpl);
    const result = await registered
      .get('list_business_cards')
      .execute({}, { signal: undefined });
    expect(result).toEqual({
      ok: true,
      data: {
        cards: [
          {
            cardId: 'card-1',
            title: '管线概览',
            revision: 2,
            status: 'active',
            createdAt: '2026-09-09',
            updatedAt: '2026-09-10',
            snapshotAt: '2026-09-10T09:10:00Z',
            refreshable: true,
            spec: { title: '管线概览' },
          },
        ],
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/__business-artifacts/cards?includeArchived=1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('archives a card durably and removes it from the current browser projection', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        card: { cardId: 'card-1', revision: 3, status: 'archived' },
        snapshots: [],
      })
    );
    const { registered, frontend } = setup(fetchImpl);
    const result = await registered
      .get('archive_business_card')
      .execute(
        { cardId: 'card-1', expectedRevision: 2 },
        { callId: 'archive-call', agent: { id: 'conversation-2' } }
      );
    expect(result).toEqual({
      ok: true,
      data: {
        cardId: 'card-1',
        durable: true,
        removedFromView: true,
        revision: 3,
        status: 'archived',
      },
      effect: { status: 'applied', kind: 'business_card_archive' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/__business-artifacts/cards/card-1/archive',
      expect.objectContaining({
        method: 'POST',
        body: '{"expectedRevision":2}',
      })
    );
    expect(frontend).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'dismiss_business_card',
        arguments: { cardId: 'card-1', revision: 3 },
      })
    );
  });

  it('permanently deletes a card while keeping browser-removal failure separate from persistence', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response({ cardId: 'card-1', revision: 4, status: 'deleted' })
      );
    const frontend = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'NO_UI' } });
    const { registered } = setup(fetchImpl, frontend);
    const result = await registered
      .get('delete_business_card')
      .execute(
        { cardId: 'card-1', expectedRevision: 3 },
        { callId: 'delete-call', agent: { id: 'conversation-2' } }
      );
    expect(result).toMatchObject({
      ok: false,
      data: {
        cardId: 'card-1',
        durable: true,
        removedFromView: false,
        revision: 4,
        status: 'deleted',
      },
      effect: { status: 'partial', kind: 'business_card_delete' },
    });
  });

  it('updates using the expected revision then presents the returned version', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response({ card: { cardId: 'card-1', revision: 3 }, snapshots: [] })
      );
    const { registered, frontend } = setup(fetchImpl);
    const spec = {
      schemaVersion: 'business-card/v1',
      title: '更新后',
      layout: { type: 'stack', columns: 1 },
      blocks: [{ id: 't', type: 'text', text: 'updated' }],
    };
    const result = await registered
      .get('update_business_card')
      .execute(
        { cardId: 'card-1', expectedRevision: 2, spec },
        { callId: 'update-call', agent: { id: 'conversation-2' } }
      );
    expect(result).toEqual({
      ok: true,
      data: { cardId: 'card-1', durable: true, visible: true, revision: 3 },
      effect: { status: 'applied', kind: 'business_card_update' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/__business-artifacts/cards/card-1/update',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 2, spec }),
      })
    );
    expect(frontend).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'present_business_card',
        arguments: { cardId: 'card-1', revision: 3 },
      })
    );
  });

  it('reports a durable update when browser presentation fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response({ card: { cardId: 'card-1', revision: 3 }, snapshots: [] })
      );
    const frontend = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'NO_UI' } });
    const { registered } = setup(fetchImpl, frontend);
    const result = await registered.get('update_business_card').execute(
      {
        cardId: 'card-1',
        expectedRevision: 2,
        spec: {
          schemaVersion: 'business-card/v1',
          title: '更新后',
          layout: { type: 'stack', columns: 1 },
          blocks: [{ id: 't', type: 'text', text: 'updated' }],
        },
      },
      { callId: 'update-call', agent: { id: 'conversation-2' } }
    );
    expect(result).toMatchObject({
      ok: false,
      data: { durable: true, visible: false, revision: 3 },
      effect: { status: 'partial', kind: 'business_card_update' },
    });
  });

  it('refreshes using the expected revision then presents the returned version', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response({ card: { cardId: 'card-1', revision: 3 }, snapshots: [] })
      );
    const { registered, frontend } = setup(fetchImpl);
    const result = await registered
      .get('refresh_business_card')
      .execute(
        { cardId: 'card-1', expectedRevision: 2 },
        { callId: 'refresh-call', agent: { id: 'conversation-2' } }
      );
    expect(result).toEqual({
      ok: true,
      data: { cardId: 'card-1', durable: true, visible: true, revision: 3 },
      effect: { status: 'applied', kind: 'business_card_refresh' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://test/__business-artifacts/cards/card-1/refresh',
      expect.objectContaining({
        method: 'POST',
        body: '{"expectedRevision":2}',
      })
    );
    expect(frontend).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'present_business_card',
        arguments: { cardId: 'card-1', revision: 3 },
      })
    );
  });

  it('reports durable persistence separately when page presentation fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response({ card: { cardId: 'card-1', revision: 3 }, snapshots: [] })
      );
    const frontend = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'BROWSER_UNAVAILABLE' } });
    const { registered } = setup(fetchImpl, frontend);
    const result = await registered
      .get('refresh_business_card')
      .execute(
        { cardId: 'card-1', expectedRevision: 2 },
        { callId: 'x', agent: { id: 'a' } }
      );
    expect(result).toMatchObject({
      ok: false,
      data: { durable: true, visible: false, revision: 3 },
      effect: { status: 'partial' },
    });
  });

  it('keeps durable refresh state when presenting the committed version reports a conflict', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response({ card: { cardId: 'card-1', revision: 3 }, snapshots: [] })
      );
    const frontend = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('stale'), { code: 'CARD_REVISION_CONFLICT' })
      );
    const { registered } = setup(fetchImpl, frontend);
    const result = await registered
      .get('refresh_business_card')
      .execute(
        { cardId: 'card-1', expectedRevision: 2 },
        { callId: 'x', agent: { id: 'a' } }
      );
    expect(result).toMatchObject({
      ok: false,
      data: { durable: true, visible: false, revision: 3 },
      effect: { status: 'partial' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('recovers a 409 by GET and present without issuing another refresh POST', async () => {
    const conflict = response(
      { error: { code: 'CARD_REVISION_CONFLICT', message: 'stale' } },
      false,
      409
    );
    const latest = response({
      card: { cardId: 'card-1', revision: 4 },
      snapshots: [],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(latest);
    const { registered, frontend } = setup(fetchImpl);
    const result = await registered
      .get('refresh_business_card')
      .execute(
        { cardId: 'card-1', expectedRevision: 2 },
        { callId: 'x', agent: { id: 'a' } }
      );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CARD_REVISION_CONFLICT' },
      data: { durable: false, visible: true, revision: 4 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain('/cards/card-1');
    expect(frontend).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: { cardId: 'card-1', revision: 4 } })
    );
  });

  it('uses backend-provided refreshability instead of replaying backend rules', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        cards: [
          {
            cardId: 'card-1',
            spec: { title: '旧卡片' },
            statisticsRefs: ['stat-1'],
            status: 'active',
            revision: 1,
            refreshable: false,
          },
        ],
        snapshots: [
          {
            statistics_ref: 'stat-1',
            calculatedAt: '2026-09-10T09:10:00Z',
            dataset: 'other',
            scope: {},
            query: {},
          },
        ],
      })
    );
    const { registered } = setup(fetchImpl);
    const result = await registered.get('list_business_cards').execute({}, {});
    expect(result.data.cards[0].refreshable).toBe(false);
  });

  it('does not infer refreshability when backend marks the card non-refreshable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        cards: [
          {
            cardId: 'card-1',
            spec: { title: '管线' },
            statisticsRefs: ['present', 'missing'],
            status: 'active',
            revision: 1,
            refreshable: false,
          },
        ],
        snapshots: [
          {
            statistics_ref: 'present',
            dataset: 'pipeline',
            scope: { layerId: 'GX:js_ln' },
            query: {
              metrics: ['count', 'total_length'],
              dimensions: ['material'],
              filters: [],
            },
          },
        ],
      })
    );
    const { registered } = setup(fetchImpl);
    const result = await registered.get('list_business_cards').execute({}, {});
    expect(result.data.cards[0].refreshable).toBe(false);
  });
});
