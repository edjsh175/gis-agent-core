import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createBusinessArtifactRepository } from '../../harness/business-artifacts/repository.js';
import { createBusinessArtifactServer } from '../../harness/business-artifacts/server.js';

const contexts = { principalId: 'p', workspaceId: 'w' };
const resources = [];
afterEach(async () => {
  while (resources.length) {
    const item = resources.pop();
    await new Promise((resolve) => item.server.close(resolve));
    item.repository.close();
    rmSync(item.dir, { recursive: true, force: true });
  }
});
async function fixture(resolveContext = () => contexts, pipelineStatistics) {
  const dir = mkdtempSync(join(tmpdir(), 'business-card-api-'));
  const repository = createBusinessArtifactRepository({
    filename: join(dir, 'cards.sqlite'),
  });
  const server = createBusinessArtifactServer({
    repository,
    resolveContext,
    pipelineStatistics,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  resources.push({ dir, repository, server });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    cards: `${origin}/__business-artifacts/cards`,
    statistics: `${origin}/__business-artifacts/statistics/pipeline`,
  };
}

describe('business artifact API', () => {
  it('preserves Chinese text split across incoming UTF-8 chunks', async () => {
    const { cards: base } = await fixture();
    const spec = {
      schemaVersion: 'business-card/v1',
      title: '管线概览',
      layout: { type: 'stack', columns: 1 },
      blocks: [{ id: 'note', type: 'text', text: '保存中文成果' }],
    };
    const bytes = Buffer.from(JSON.stringify({ spec }));
    const split = bytes.indexOf(Buffer.from('管')) + 1;
    const result = await new Promise((resolve, reject) => {
      const req = request(
        base,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          );
        }
      );
      req.on('error', reject);
      req.write(bytes.subarray(0, split));
      setTimeout(() => req.end(bytes.subarray(split)), 10);
    });
    expect(result.card.spec.title).toBe(spec.title);
  });

  it('rejects unauthenticated requests and unknown body fields', async () => {
    const { cards: base } = await fixture(() => null);
    expect((await fetch(base)).status).toBe(401);
    const { cards: authenticated } = await fixture();
    const response = await fetch(authenticated, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: {}, extra: true }),
    });
    expect(response.status).toBe(400);
  });

  it('creates and reads a card through the JSON API', async () => {
    const { cards: base } = await fixture();
    const repository = resources.at(-1).repository;
    const snapshot = repository.saveStatisticsSnapshot(contexts, {
      data: { summary: { count: 3 }, groups: { material: [] } },
    });
    const spec = {
      schemaVersion: 'business-card/v1',
      title: '数量',
      layout: { type: 'stack', columns: 1 },
      blocks: [
        {
          id: 'm',
          type: 'metric_group',
          items: [
            {
              label: '数量',
              value: {
                statistics_ref: snapshot.statistics_ref,
                path: 'summary.count',
              },
              unit: '条',
            },
          ],
        },
      ],
    };
    const created = await (
      await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec }),
      })
    ).json();
    expect(created.card.cardId).toMatch(/^card_/);
    const fetched = await (
      await fetch(`${base}/${created.card.cardId}`)
    ).json();
    expect(fetched.snapshots[0].data.summary.count).toBe(3);
  });

  it('rejects oversized JSON bodies with HTTP 413', async () => {
    const { cards: base } = await fixture();
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec: { description: 'x'.repeat(300_000) } }),
    });
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects non-JSON card creation with HTTP 415', async () => {
    const { cards: base } = await fixture();
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an unapproved origin with HTTP 403', async () => {
    const { cards: base } = await fixture();
    const response = await fetch(base, {
      headers: { origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('ORIGIN_FORBIDDEN');
  });

  it('creates an immutable statistics snapshot through the pipeline statistics API', async () => {
    const pipelineStatistics = {
      query: async () => ({
        schemaVersion: 'statistics/v1',
        dataset: 'pipeline',
        calculatedAt: '2026-09-09T06:00:00.000Z',
        scope: { layerId: 'GX:js_ln' },
        query: {
          metrics: ['count', 'total_length'],
          dimensions: ['material'],
          filters: [],
        },
        data: {
          summary: { count: 2, total_length: 12.5 },
          groups: { material: [{ key: 'PVC', count: 2 }] },
        },
        schema: {
          'summary.count': 'number',
          'summary.total_length': 'number',
          'groups.material': 'array<{key:string,count:number}>',
        },
      }),
    };
    const { statistics, cards } = await fixture(
      () => contexts,
      pipelineStatistics
    );
    const response = await fetch(statistics, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.statistics_ref).toMatch(/^stat_/);
    expect(payload.summary).toEqual({ count: 2, total_length: 12.5 });
    expect(payload.availablePaths).toEqual([
      'summary.count',
      'summary.total_length',
      'groups.material',
    ]);

    const cardResponse = await fetch(cards, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        spec: {
          schemaVersion: 'business-card/v1',
          title: '真实统计绑定',
          layout: { type: 'stack', columns: 1 },
          blocks: [
            {
              id: 'count',
              type: 'metric_group',
              items: [
                {
                  label: '管线数量',
                  value: {
                    statistics_ref: payload.statistics_ref,
                    path: 'summary.count',
                  },
                  unit: '条',
                },
              ],
            },
          ],
        },
      }),
    });
    expect(cardResponse.status).toBe(200);
    const cardPayload = await cardResponse.json();
    expect(cardPayload.snapshots[0].statistics_ref).toBe(
      payload.statistics_ref
    );
    expect(cardPayload.snapshots[0].data.summary.count).toBe(2);
  });

  it('rejects unsupported HTTP methods with HTTP 405', async () => {
    const { cards: base } = await fixture();
    const response = await fetch(base, { method: 'PUT' });
    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('updates an existing card in place through the JSON API', async () => {
    const { cards: base } = await fixture();
    const repository = resources.at(-1).repository;
    const snapshot = repository.saveStatisticsSnapshot(contexts, {
      data: {
        summary: { count: 3, total_length: 8 },
        groups: { material: [{ key: 'PVC', count: 3 }] },
      },
    });
    const created = repository.createCard(contexts, {
      schemaVersion: 'business-card/v1',
      title: '原卡片',
      layout: { type: 'stack', columns: 1 },
      blocks: [
        {
          id: 'm',
          type: 'metric_group',
          items: [
            {
              label: '数量',
              value: {
                statistics_ref: snapshot.statistics_ref,
                path: 'summary.count',
              },
              unit: '条',
            },
          ],
        },
      ],
    });
    const nextSpec = {
      schemaVersion: 'business-card/v1',
      title: '新卡片',
      description: '改成饼图',
      layout: { type: 'grid', columns: 2 },
      blocks: [
        {
          id: 'chart',
          type: 'chart',
          chartType: 'pie',
          source: {
            statistics_ref: snapshot.statistics_ref,
            path: 'groups.material',
          },
          xField: 'key',
          yField: 'count',
        },
      ],
    };
    const response = await fetch(`${base}/${created.card.cardId}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, spec: nextSpec }),
    });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.card.cardId).toBe(created.card.cardId);
    expect(updated.card.revision).toBe(2);
    expect(updated.card.spec.title).toBe('新卡片');
    expect(updated.card.statisticsRefs).toEqual([snapshot.statistics_ref]);

    const conflict = await fetch(`${base}/${created.card.cardId}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, spec: nextSpec }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('CARD_REVISION_CONFLICT');
  });

  it('rejects invalid update bodies and invalid CardSpec values', async () => {
    const { cards: base } = await fixture();
    const repository = resources.at(-1).repository;
    const created = repository.createCard(contexts, {
      schemaVersion: 'business-card/v1',
      title: '文本',
      layout: { type: 'stack', columns: 1 },
      blocks: [{ id: 't', type: 'text', text: 'ok' }],
    });
    const badBody = await fetch(`${base}/${created.card.cardId}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(badBody.status).toBe(400);
    expect((await badBody.json()).error.code).toBe('INVALID_BODY');

    const invalidSpec = await fetch(`${base}/${created.card.cardId}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: 1,
        spec: {
          schemaVersion: 'business-card/v1',
          title: '非法',
          layout: { type: 'stack', columns: 1 },
          blocks: [{ id: 't', type: 'text', text: '<script>x</script>' }],
        },
      }),
    });
    expect(invalidSpec.status).toBe(400);
    expect((await invalidSpec.json()).error.code).toBe('INVALID_CARD_SPEC');
  });

  it('archives and deletes cards with revision checks', async () => {
    const { cards: base } = await fixture();
    const repository = resources.at(-1).repository;
    const snapshot = repository.saveStatisticsSnapshot(contexts, {
      data: { summary: { count: 1 }, groups: { material: [] } },
    });
    const created = repository.createCard(contexts, {
      schemaVersion: 'business-card/v1',
      title: '生命周期',
      layout: { type: 'stack', columns: 1 },
      blocks: [
        {
          id: 'm',
          type: 'metric_group',
          items: [
            {
              label: '数量',
              value: {
                statistics_ref: snapshot.statistics_ref,
                path: 'summary.count',
              },
              unit: '条',
            },
          ],
        },
      ],
    });
    const archivedResponse = await fetch(
      `${base}/${created.card.cardId}/archive`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1 }),
      }
    );
    expect(archivedResponse.status).toBe(200);
    const archived = await archivedResponse.json();
    expect(archived.card).toMatchObject({ status: 'archived', revision: 2 });
    expect((await (await fetch(base)).json()).cards).toHaveLength(0);
    expect(
      (await (await fetch(`${base}?includeArchived=1`)).json()).cards[0].status
    ).toBe('archived');

    const conflict = await fetch(`${base}/${created.card.cardId}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('CARD_REVISION_CONFLICT');

    const deletedResponse = await fetch(
      `${base}/${created.card.cardId}/delete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 2 }),
      }
    );
    expect(deletedResponse.status).toBe(200);
    expect(await deletedResponse.json()).toMatchObject({
      cardId: created.card.cardId,
      status: 'deleted',
      revision: 3,
    });
    expect((await fetch(`${base}/${created.card.cardId}`)).status).toBe(404);
  });

  it('computes refreshable metadata in the backend statistics capability', async () => {
    const pipelineStatistics = {
      replay: async () => ({}),
      canReplay: (snapshot) => snapshot.dataset === 'pipeline',
    };
    const { cards: base } = await fixture(() => contexts, pipelineStatistics);
    const repository = resources.at(-1).repository;
    const snapshot = repository.saveStatisticsSnapshot(contexts, {
      dataset: 'pipeline',
      scope: { layerId: 'GX:js_ln' },
      query: {
        metrics: ['count', 'total_length'],
        dimensions: ['material'],
        filters: [],
      },
      data: {
        summary: { count: 1, total_length: 2 },
        groups: { material: [] },
      },
    });
    repository.createCard(contexts, {
      schemaVersion: 'business-card/v1',
      title: '可刷新',
      layout: { type: 'stack', columns: 1 },
      blocks: [
        {
          id: 'm',
          type: 'metric_group',
          items: [
            {
              label: '数量',
              value: {
                statistics_ref: snapshot.statistics_ref,
                path: 'summary.count',
              },
              unit: '条',
            },
          ],
        },
      ],
    });
    repository.createCard(contexts, {
      schemaVersion: 'business-card/v1',
      title: '纯文本',
      layout: { type: 'stack', columns: 1 },
      blocks: [{ id: 't', type: 'text', text: '无统计快照' }],
    });

    const listed = await (await fetch(base)).json();
    expect(
      listed.cards.find((card) => card.spec.title === '可刷新').refreshable
    ).toBe(true);
    expect(
      listed.cards.find((card) => card.spec.title === '纯文本').refreshable
    ).toBe(false);
  });

  it('refreshes an existing card through the shared statistics service', async () => {
    let count = 7;
    const pipelineStatistics = {
      replay: async () => ({
        dataset: 'pipeline',
        scope: { layerId: 'GX:js_ln' },
        query: {
          metrics: ['count', 'total_length'],
          dimensions: ['material'],
          filters: [],
        },
        data: {
          summary: { count: count++, total_length: 10 },
          groups: { material: [] },
        },
        schema: {
          'summary.count': 'number',
          'summary.total_length': 'number',
          'groups.material': 'array<{key:string,count:number}>',
        },
      }),
    };
    const { cards: base } = await fixture(() => contexts, pipelineStatistics);
    const repository = resources.at(-1).repository;
    const snapshot = repository.saveStatisticsSnapshot(contexts, {
      dataset: 'pipeline',
      scope: { layerId: 'GX:js_ln' },
      query: {
        metrics: ['count', 'total_length'],
        dimensions: ['material'],
        filters: [],
      },
      data: {
        summary: { count: 6, total_length: 10 },
        groups: { material: [] },
      },
      schema: {
        'summary.count': 'number',
        'summary.total_length': 'number',
        'groups.material': 'array<{key:string,count:number}>',
      },
    });
    const created = repository.createCard(contexts, {
      schemaVersion: 'business-card/v1',
      title: '刷新',
      layout: { type: 'stack', columns: 1 },
      blocks: [
        {
          id: 'm',
          type: 'metric_group',
          items: [
            {
              label: '数量',
              value: {
                statistics_ref: snapshot.statistics_ref,
                path: 'summary.count',
              },
              unit: '条',
            },
          ],
        },
      ],
    });
    const response = await fetch(`${base}/${created.card.cardId}/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(response.status).toBe(200);
    const refreshed = await response.json();
    expect(refreshed.card.cardId).toBe(created.card.cardId);
    expect(refreshed.card.revision).toBe(2);
    expect(refreshed.snapshots[0].data.summary.count).toBe(7);
    const conflict = await fetch(`${base}/${created.card.cardId}/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(conflict.status).toBe(409);
  });
});
