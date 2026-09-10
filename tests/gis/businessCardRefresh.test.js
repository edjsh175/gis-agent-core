import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBusinessArtifactRepository } from '../../harness/business-artifacts/repository.js';
import { createBusinessCardRefreshService } from '../../harness/business-artifacts/refreshService.js';
import { createPipelineStatisticsService } from '../../harness/business-artifacts/pipelineStatistics.js';

const context = { principalId: 'principal-a', workspaceId: 'workspace-a' };
const descriptor = {
  dataset: 'pipeline',
  scope: { layerId: 'GX:js_ln' },
  query: {
    metrics: ['count', 'total_length'],
    dimensions: ['material'],
    filters: [],
  },
};
const data = (count, total_length = count) => ({
  summary: { count, total_length },
  groups: { material: [] },
});
const specFor = (refs) => ({
  schemaVersion: 'business-card/v1',
  title: '管线概览',
  layout: { type: 'stack', columns: 1 },
  blocks: refs.map((ref, index) => ({
    id: `metric-${index}`,
    type: 'metric_group',
    items: [
      {
        label: `数量${index + 1}`,
        value: { statistics_ref: ref, path: 'summary.count' },
        unit: '条',
      },
    ],
  })),
});

const resources = [];
afterEach(() => {
  while (resources.length) {
    const resource = resources.pop();
    try {
      resource.db?.close();
    } catch {}
    try {
      resource.repository?.close();
    } catch {}
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'business-card-refresh-'));
  const filename = join(dir, 'cards.sqlite');
  const repository = createBusinessArtifactRepository({ filename });
  const resource = { dir, filename, repository };
  resources.push(resource);
  return resource;
}

function snapshot(repository, value, extra = {}) {
  return repository.saveStatisticsSnapshot(context, {
    ...descriptor,
    ...extra,
    data: data(value),
  });
}

function createCard(repository, values) {
  const snapshots = values.map((value) => snapshot(repository, value));
  return {
    snapshots,
    created: repository.createCard(
      context,
      specFor(snapshots.map((s) => s.statistics_ref))
    ),
  };
}

function replacement(old, count) {
  return {
    ...descriptor,
    data: data(count),
    schema: old.schema,
  };
}

function snapshotCount(filename) {
  const db = new DatabaseSync(filename);
  try {
    return Number(
      db.prepare('SELECT COUNT(*) AS count FROM statistics_snapshots').get()
        .count
    );
  } finally {
    db.close();
  }
}

describe('Business Card P1 refresh acceptance', () => {
  it('rolls back all inserted snapshots when a replacement breaks a binding', () => {
    const { repository, filename } = fixture();
    const { snapshots, created } = createCard(repository, [708, 10]);
    expect(() =>
      repository.refreshCardAtomic(context, created.card.cardId, 1, {
        [snapshots[0].statistics_ref]: replacement(snapshots[0], 712),
        [snapshots[1].statistics_ref]: { ...descriptor, data: { summary: {} } },
      })
    ).toThrow();
    expect(snapshotCount(filename)).toBe(2);
    expect(repository.getCard(context, created.card.cardId)).toEqual(created);
  });

  it('does not insert any snapshot when the second replay fails', async () => {
    const { repository } = fixture();
    const { snapshots, created } = createCard(repository, [708, 10]);
    const replay = vi
      .fn()
      .mockResolvedValueOnce(replacement(snapshots[0], 712))
      .mockRejectedValueOnce(
        Object.assign(new Error('source failed'), {
          code: 'STATISTICS_UNAVAILABLE',
        })
      );
    const service = createBusinessCardRefreshService({
      repository,
      statistics: { replay },
    });

    await expect(
      service.refresh(context, created.card.cardId, 1)
    ).rejects.toMatchObject({ code: 'STATISTICS_UNAVAILABLE' });
    const current = repository.getCard(context, created.card.cardId);
    expect(current.card.revision).toBe(1);
    expect(current.card.statisticsRefs).toEqual(
      snapshots.map((s) => s.statistics_ref)
    );
    expect(snapshotCount(resources[resources.length - 1].filename)).toBe(2);
  });

  it('rolls back all new snapshots when insert or card update fails', () => {
    const { repository, filename } = fixture();
    const { snapshots, created } = createCard(repository, [708, 10]);
    const db = new DatabaseSync(filename);
    resources[resources.length - 1].db = db;
    db.exec(`CREATE TRIGGER reject_second_refresh_snapshot
      BEFORE INSERT ON statistics_snapshots
      WHEN json_extract(NEW.data_json, '$.summary.count') = 9
      BEGIN SELECT RAISE(FAIL, 'forced snapshot insert failure'); END;`);
    expect(() =>
      repository.refreshCardAtomic(context, created.card.cardId, 1, {
        [snapshots[0].statistics_ref]: replacement(snapshots[0], 8),
        [snapshots[1].statistics_ref]: replacement(snapshots[1], 9),
      })
    ).toThrowError(expect.objectContaining({ code: 'CARD_PERSIST_FAILED' }));
    expect(snapshotCount(filename)).toBe(2);
    expect(repository.getCard(context, created.card.cardId).card.revision).toBe(
      1
    );

    db.exec('DROP TRIGGER reject_second_refresh_snapshot');
    db.exec(`CREATE TRIGGER reject_card_refresh_update
      BEFORE UPDATE ON card_records
      WHEN NEW.revision = 2
      BEGIN SELECT RAISE(FAIL, 'forced card update failure'); END;`);
    expect(() =>
      repository.refreshCardAtomic(context, created.card.cardId, 1, {
        [snapshots[0].statistics_ref]: replacement(snapshots[0], 8),
        [snapshots[1].statistics_ref]: replacement(snapshots[1], 9),
      })
    ).toThrowError(expect.objectContaining({ code: 'CARD_PERSIST_FAILED' }));
    expect(snapshotCount(resources[resources.length - 1].filename)).toBe(2);
    expect(repository.getCard(context, created.card.cardId).card.revision).toBe(
      1
    );
  });

  it('rolls back inserted snapshots when the CAS update affects zero rows', () => {
    const { repository, filename } = fixture();
    const { snapshots, created } = createCard(repository, [708]);
    const db = new DatabaseSync(filename);
    resources[resources.length - 1].db = db;
    db.exec(`CREATE TRIGGER ignore_card_refresh_update
      BEFORE UPDATE ON card_records
      WHEN NEW.revision = 2
      BEGIN SELECT RAISE(IGNORE); END;`);
    expect(() =>
      repository.refreshCardAtomic(context, created.card.cardId, 1, {
        [snapshots[0].statistics_ref]: replacement(snapshots[0], 712),
      })
    ).toThrowError(expect.objectContaining({ code: 'CARD_REVISION_CONFLICT' }));
    expect(snapshotCount(filename)).toBe(1);
    expect(repository.getCard(context, created.card.cardId).card.revision).toBe(
      1
    );
  });

  it('times out a replay that ignores AbortSignal and never commits its late result', async () => {
    const { repository, filename } = fixture();
    const { snapshots, created } = createCard(repository, [708]);
    const replay = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(replacement(snapshots[0], 712)), 40)
        )
    );
    const service = createBusinessCardRefreshService({
      repository,
      statistics: { replay },
      timeoutMs: 5,
    });
    await expect(
      service.refresh(context, created.card.cardId, 1)
    ).rejects.toMatchObject({ code: 'STATISTICS_TIMEOUT' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(snapshotCount(filename)).toBe(1);
    expect(repository.getCard(context, created.card.cardId).card.revision).toBe(
      1
    );
  });

  it('allows exactly one winner for concurrent same-version refreshes', async () => {
    const { repository } = fixture();
    const { snapshots, created } = createCard(repository, [708]);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const replay = vi.fn(async () => {
      await gate;
      return replacement(snapshots[0], 712);
    });
    const service = createBusinessCardRefreshService({
      repository,
      statistics: { replay },
      timeoutMs: 1000,
    });
    const first = service.refresh(context, created.card.cardId, 1);
    const second = service.refresh(context, created.card.cardId, 1);
    release();
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter(
        (r) =>
          r.status === 'rejected' && r.reason.code === 'CARD_REVISION_CONFLICT'
      )
    ).toHaveLength(1);
    expect(repository.getCard(context, created.card.cardId).card.revision).toBe(
      2
    );
    expect(snapshotCount(resources[resources.length - 1].filename)).toBe(2);
  });

  it('enforces principal/workspace binding while allowing refresh across workflows', async () => {
    const { repository } = fixture();
    const old = repository.saveStatisticsSnapshot(
      { ...context, workflowId: 'yesterday' },
      { ...descriptor, data: data(708) }
    );
    const created = repository.createCard(
      { ...context, workflowId: 'yesterday' },
      specFor([old.statistics_ref])
    );
    const service = createBusinessCardRefreshService({
      repository,
      statistics: { replay: vi.fn(async () => replacement(old, 712)) },
    });
    await expect(
      service.refresh(
        { principalId: 'other', workspaceId: context.workspaceId },
        created.card.cardId,
        1
      )
    ).rejects.toMatchObject({ code: 'CARD_NOT_FOUND' });
    await expect(
      service.refresh(
        { principalId: context.principalId, workspaceId: 'other' },
        created.card.cardId,
        1
      )
    ).rejects.toMatchObject({ code: 'CARD_NOT_FOUND' });
    await expect(
      service.refresh(
        { ...context, workflowId: 'today' },
        created.card.cardId,
        1
      )
    ).resolves.toMatchObject({ card: { revision: 2 } });
  });

  it('rejects unsupported replay descriptors before any source query', async () => {
    const fetchImpl = vi.fn();
    const service = createPipelineStatisticsService({ fetchImpl });
    await expect(
      service.replay({ ...descriptor, scope: { layerId: 'GX:other' } })
    ).rejects.toMatchObject({ code: 'STATISTICS_REPLAY_UNSUPPORTED' });
    await expect(
      service.replay({
        ...descriptor,
        query: {
          ...descriptor.query,
          filters: [{ field: 'material', op: 'eq', value: 'PVC' }],
        },
      })
    ).rejects.toMatchObject({ code: 'STATISTICS_REPLAY_UNSUPPORTED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('persists the new 712 snapshot and recovers it after reopen', async () => {
    const { repository, filename, dir } = fixture();
    const { snapshots, created } = createCard(repository, [708]);
    const service = createBusinessCardRefreshService({
      repository,
      statistics: { replay: vi.fn(async () => replacement(snapshots[0], 712)) },
    });
    await service.refresh(context, created.card.cardId, 1);
    repository.close();
    resources[resources.length - 1].repository =
      createBusinessArtifactRepository({ filename });
    expect(
      resources[resources.length - 1].repository.getCard(
        context,
        created.card.cardId
      ).card.revision
    ).toBe(2);
    expect(
      resources[resources.length - 1].repository.getCard(
        context,
        created.card.cardId
      ).snapshots[0].data.summary.count
    ).toBe(712);
    expect(dir).toBeTruthy();
  });
});
