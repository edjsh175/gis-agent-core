import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createBusinessArtifactRepository } from '../../harness/business-artifacts/repository.js';

const context = { principalId: 'principal-a', workspaceId: 'workspace-a' };
const specFor = (ref) => ({
  schemaVersion: 'business-card/v1',
  title: '管线',
  layout: { type: 'stack', columns: 1 },
  blocks: [
    {
      id: 'count',
      type: 'metric_group',
      items: [
        {
          label: '数量',
          value: { statistics_ref: ref, path: 'summary.count' },
          unit: '条',
        },
      ],
    },
  ],
});
const resources = [];
afterEach(() => {
  while (resources.length) {
    const resource = resources.pop();
    try {
      resource.repository.close();
    } catch {}
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'business-card-'));
  const filename = join(dir, 'cards.sqlite');
  const repository = createBusinessArtifactRepository({ filename });
  resources.push({ repository, dir });
  return { repository, filename, dir };
}

describe('business artifact repository', () => {
  it('persists cards and snapshots across reopen', () => {
    const { repository, filename } = fixture();
    const snapshot = repository.saveStatisticsSnapshot(context, {
      dataset: 'pipeline',
      data: {
        summary: { count: 7, total_length: 10 },
        groups: { material: [] },
      },
    });
    const created = repository.createCard(
      context,
      specFor(snapshot.statistics_ref)
    );
    expect(created.card.cardId).toMatch(/^card_/);
    expect(created.snapshots[0].statistics_ref).toBe(snapshot.statistics_ref);
    repository.close();
    const reopened = createBusinessArtifactRepository({ filename });
    resources[0].repository = reopened;
    expect(reopened.listCards(context).cards).toHaveLength(1);
    expect(
      reopened.getCard(context, created.card.cardId).snapshots[0].data.summary
        .count
    ).toBe(7);
  });

  it('enforces principal and workspace binding', () => {
    const { repository } = fixture();
    const snapshot = repository.saveStatisticsSnapshot(context, {
      data: { summary: { count: 1 }, groups: { material: [] } },
    });
    expect(() =>
      repository.createCard(
        { principalId: 'other', workspaceId: context.workspaceId },
        specFor(snapshot.statistics_ref)
      )
    ).toThrowError(/accessible/);
    const created = repository.createCard(
      context,
      specFor(snapshot.statistics_ref)
    );
    expect(() =>
      repository.getCard(
        { principalId: 'other', workspaceId: context.workspaceId },
        created.card.cardId
      )
    ).toThrowError(/not found/);
    expect(
      repository.listCards({
        principalId: 'other',
        workspaceId: context.workspaceId,
      }).cards
    ).toHaveLength(0);
    expect(
      repository.listCards({
        principalId: context.principalId,
        workspaceId: 'other',
      }).cards
    ).toHaveLength(0);
  });

  it('rejects a snapshot outside the current workflow', () => {
    const { repository } = fixture();
    const snapshot = repository.saveStatisticsSnapshot(
      { ...context, workflowId: 'workflow-a' },
      { data: { summary: { count: 1 }, groups: { material: [] } } }
    );
    expect(() =>
      repository.createCard(
        { ...context, workflowId: 'workflow-b' },
        specFor(snapshot.statistics_ref)
      )
    ).toThrowError(/workflow/);
  });

  it('returns CARD_PERSIST_FAILED and leaves no card when SQLite rejects the insert', () => {
    const { repository, filename } = fixture();
    const snapshot = repository.saveStatisticsSnapshot(context, {
      data: { summary: { count: 1 }, groups: { material: [] } },
    });
    const spec = specFor(snapshot.statistics_ref);
    const secondConnection = new DatabaseSync(filename);
    secondConnection.exec(`CREATE TRIGGER reject_card_insert
      BEFORE INSERT ON card_records
      BEGIN SELECT RAISE(FAIL, 'forced card insert failure'); END;`);

    try {
      expect(() => repository.createCard(context, spec)).toThrowError(
        expect.objectContaining({ code: 'CARD_PERSIST_FAILED' })
      );
      expect(
        secondConnection
          .prepare('SELECT COUNT(*) AS count FROM card_records')
          .get().count
      ).toBe(0);
    } finally {
      secondConnection.close();
    }
  });

  it('rejects a database version newer than the supported schema without changing it', () => {
    const { repository, filename } = fixture();
    repository.close();
    const secondConnection = new DatabaseSync(filename);
    secondConnection.exec('PRAGMA user_version = 2;');
    secondConnection.close();

    expect(() => createBusinessArtifactRepository({ filename })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_DB_VERSION' })
    );
    const verifier = new DatabaseSync(filename);
    expect(
      Number(verifier.prepare('PRAGMA user_version').get().user_version)
    ).toBe(2);
    verifier.close();
  });

  it('updates a card in place without creating statistics snapshots and uses CAS', () => {
    const { repository, filename } = fixture();
    const snapshot = repository.saveStatisticsSnapshot(context, {
      dataset: 'pipeline',
      data: {
        summary: { count: 7, total_length: 10 },
        groups: { material: [{ key: 'PVC', count: 4 }] },
      },
    });
    const created = repository.createCard(
      context,
      specFor(snapshot.statistics_ref)
    );
    const originalCreatedAt = created.card.createdAt;
    const originalCreatedBy = created.card.createdBy;
    const updatedSpec = {
      schemaVersion: 'business-card/v1',
      title: '管线概览（饼图）',
      description: '结构已更新',
      layout: { type: 'grid', columns: 2 },
      blocks: [
        {
          id: 'material',
          type: 'chart',
          chartType: 'pie',
          source: {
            statistics_ref: snapshot.statistics_ref,
            path: 'groups.material',
          },
          xField: 'key',
          yField: 'count',
        },
        {
          id: 'pvc',
          type: 'map_action',
          label: '查看 PVC 管线',
          action: {
            kind: 'query_and_highlight',
            layerId: 'GX:js_ln',
            filters: [{ field: 'material', op: 'eq', value: 'PVC' }],
          },
        },
      ],
    };
    const verifier = new DatabaseSync(filename);
    const beforeSnapshots = verifier
      .prepare('SELECT COUNT(*) AS count FROM statistics_snapshots')
      .get().count;
    const updated = repository.updateCardAtomic(
      context,
      created.card.cardId,
      1,
      updatedSpec
    );
    try {
      expect(updated.card.cardId).toBe(created.card.cardId);
      expect(updated.card.revision).toBe(2);
      expect(updated.card.createdAt).toBe(originalCreatedAt);
      expect(updated.card.createdBy).toBe(originalCreatedBy);
      expect(updated.card.spec.title).toBe('管线概览（饼图）');
      expect(updated.card.spec.blocks[0].chartType).toBe('pie');
      expect(updated.card.statisticsRefs).toEqual([snapshot.statistics_ref]);
      expect(
        verifier
          .prepare('SELECT COUNT(*) AS count FROM statistics_snapshots')
          .get().count
      ).toBe(beforeSnapshots);
      expect(() =>
        repository.updateCardAtomic(
          context,
          created.card.cardId,
          1,
          updatedSpec
        )
      ).toThrowError(
        expect.objectContaining({ code: 'CARD_REVISION_CONFLICT' })
      );
    } finally {
      verifier.close();
    }
  });

  it('restores the updated revision after the database is reopened', () => {
    const { repository, filename } = fixture();
    const snapshot = repository.saveStatisticsSnapshot(context, {
      data: { summary: { count: 1 }, groups: { material: [] } },
    });
    const created = repository.createCard(
      context,
      specFor(snapshot.statistics_ref)
    );
    repository.updateCardAtomic(context, created.card.cardId, 1, {
      ...specFor(snapshot.statistics_ref),
      title: '重开后仍是新版本',
    });
    repository.close();
    const reopened = createBusinessArtifactRepository({ filename });
    resources[0].repository = reopened;
    expect(reopened.getCard(context, created.card.cardId).card).toMatchObject({
      cardId: created.card.cardId,
      revision: 2,
      spec: { title: '重开后仍是新版本' },
    });
  });

  it('rejects inaccessible statistics refs during update', () => {
    const { repository } = fixture();
    const ownSnapshot = repository.saveStatisticsSnapshot(context, {
      data: { summary: { count: 1 }, groups: { material: [] } },
    });
    const otherSnapshot = repository.saveStatisticsSnapshot(
      { principalId: context.principalId, workspaceId: 'workspace-b' },
      { data: { summary: { count: 2 }, groups: { material: [] } } }
    );
    const created = repository.createCard(
      context,
      specFor(ownSnapshot.statistics_ref)
    );
    expect(() =>
      repository.updateCardAtomic(
        context,
        created.card.cardId,
        1,
        specFor(otherSnapshot.statistics_ref)
      )
    ).toThrowError(expect.objectContaining({ code: 'CARD_BINDING_INVALID' }));
  });

  it('allows reusing existing refs across conversations but rejects newly introduced refs outside the current workflow', () => {
    const { repository } = fixture();
    const original = repository.saveStatisticsSnapshot(
      { ...context, workflowId: 'workflow-a' },
      { data: { summary: { count: 1 }, groups: { material: [] } } }
    );
    const unrelated = repository.saveStatisticsSnapshot(
      { ...context, workflowId: 'workflow-b' },
      { data: { summary: { count: 2 }, groups: { material: [] } } }
    );
    const created = repository.createCard(
      { ...context, workflowId: 'workflow-a' },
      specFor(original.statistics_ref)
    );
    const reused = repository.updateCardAtomic(
      { ...context, workflowId: 'workflow-c' },
      created.card.cardId,
      1,
      { ...specFor(original.statistics_ref), title: '跨对话修改标题' }
    );
    expect(reused.card.revision).toBe(2);
    expect(() =>
      repository.updateCardAtomic(
        { ...context, workflowId: 'workflow-c' },
        created.card.cardId,
        2,
        specFor(unrelated.statistics_ref)
      )
    ).toThrowError(expect.objectContaining({ code: 'CARD_BINDING_INVALID' }));
  });

  it('archives then permanently deletes a card while preserving snapshots', () => {
    const { repository } = fixture();
    const snapshot = repository.saveStatisticsSnapshot(context, {
      data: { summary: { count: 1 }, groups: { material: [] } },
    });
    const created = repository.createCard(
      context,
      specFor(snapshot.statistics_ref)
    );
    const archived = repository.archiveCardAtomic(
      context,
      created.card.cardId,
      1
    );
    expect(archived.card).toMatchObject({
      cardId: created.card.cardId,
      status: 'archived',
      revision: 2,
      createdAt: created.card.createdAt,
      createdBy: created.card.createdBy,
    });
    expect(repository.listCards(context).cards).toHaveLength(0);
    expect(
      repository.listCards(context, { includeArchived: true }).cards[0].status
    ).toBe('archived');
    expect(() =>
      repository.archiveCardAtomic(context, created.card.cardId, 1)
    ).toThrowError(expect.objectContaining({ code: 'CARD_REVISION_CONFLICT' }));

    const deleted = repository.deleteCardAtomic(
      context,
      created.card.cardId,
      2
    );
    expect(deleted).toMatchObject({
      cardId: created.card.cardId,
      revision: 3,
      previousStatus: 'archived',
      status: 'deleted',
    });
    expect(() => repository.getCard(context, created.card.cardId)).toThrowError(
      expect.objectContaining({ code: 'CARD_NOT_FOUND' })
    );
    expect(
      repository.listCards(context, { includeArchived: true }).cards
    ).toHaveLength(0);
    const reused = repository.createCard(
      context,
      specFor(snapshot.statistics_ref)
    );
    expect(reused.snapshots[0].statistics_ref).toBe(snapshot.statistics_ref);
    expect(archived.snapshots[0].statistics_ref).toBe(snapshot.statistics_ref);
  });

  it('refreshes a card atomically while preserving old snapshots and using CAS', () => {
    const { repository } = fixture();
    const old = repository.saveStatisticsSnapshot(context, {
      dataset: 'pipeline',
      scope: { layerId: 'GX:js_ln' },
      query: {
        metrics: ['count', 'total_length'],
        dimensions: ['material'],
        filters: [],
      },
      data: {
        summary: { count: 7, total_length: 10 },
        groups: { material: [] },
      },
    });
    const created = repository.createCard(context, specFor(old.statistics_ref));
    const refreshed = repository.refreshCardAtomic(
      context,
      created.card.cardId,
      1,
      {
        [old.statistics_ref]: {
          dataset: 'pipeline',
          scope: { layerId: 'GX:js_ln' },
          query: {
            metrics: ['count', 'total_length'],
            dimensions: ['material'],
            filters: [],
          },
          data: {
            summary: { count: 8, total_length: 11 },
            groups: { material: [] },
          },
          schema: old.schema,
        },
      }
    );
    expect(refreshed.card.cardId).toBe(created.card.cardId);
    expect(refreshed.card.revision).toBe(2);
    expect(refreshed.card.statisticsRefs[0]).not.toBe(old.statistics_ref);
    expect(
      repository
        .getCard(context, created.card.cardId)
        .snapshots.map((s) => s.statistics_ref)
    ).toEqual(refreshed.card.statisticsRefs);
    expect(() =>
      repository.refreshCardAtomic(context, created.card.cardId, 1, {})
    ).toThrowError(expect.objectContaining({ code: 'CARD_REVISION_CONFLICT' }));
    expect(
      repository.getCard(context, created.card.cardId).snapshots[0].data.summary
        .count
    ).toBe(8);
  });
});
