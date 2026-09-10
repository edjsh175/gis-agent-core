import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBusinessArtifactRepository } from '../../../harness/business-artifacts/repository.js';
import { createBusinessArtifactServer } from '../../../harness/business-artifacts/server.js';
import { createPipelineStatisticsService } from '../../../harness/business-artifacts/pipelineStatistics.js';

const context = {
  principalId: 'browser-test-user',
  workspaceId: 'browser-test-workspace',
};

export async function startBusinessArtifactsFixture({
  seedRefresh = false,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'business-artifacts-browser-'));
  const repository = createBusinessArtifactRepository({
    filename: join(directory, 'cards.sqlite'),
  });
  let statistics;
  let calls = 0;
  let cardId;
  if (seedRefresh) {
    const featureCollection = (count) => ({
      type: 'FeatureCollection',
      numberMatched: count,
      numberReturned: count,
      features: Array.from({ length: count }, () => ({
        properties: { material: 'PVC', shape_leng: 1 },
      })),
    });
    statistics = createPipelineStatisticsService({
      endpoint: 'http://fixture.invalid/geoserver',
      fetchImpl: async () => ({
        ok: true,
        json: async () => featureCollection(calls++ ? 712 : 708),
      }),
    });
    const initial = await statistics.query({ layerId: 'GX:js_ln' });
    const snapshot = repository.saveStatisticsSnapshot(context, initial);
    const spec = {
      schemaVersion: 'business-card/v1',
      title: '管线概览',
      description: '可刷新管线统计',
      layout: { type: 'stack', columns: 1 },
      blocks: [
        {
          id: 'metric',
          type: 'metric_group',
          items: [
            {
              label: '管线数量',
              value: { statistics_ref: snapshot.statistics_ref },
              unit: '条',
            },
          ],
        },
      ],
    };
    spec.blocks[0].items[0].value.path = 'summary.count';
    spec.blocks.push(
      {
        id: 'chart',
        type: 'chart',
        chartType: 'bar',
        source: {
          statistics_ref: snapshot.statistics_ref,
          path: 'groups.material',
        },
        xField: 'key',
        yField: 'count',
      },
      {
        id: 'table',
        type: 'table',
        source: {
          statistics_ref: snapshot.statistics_ref,
          path: 'groups.material',
        },
        columns: [
          { field: 'key', label: '材质' },
          { field: 'count', label: '数量' },
        ],
      }
    );
    cardId = repository.createCard(context, spec).card.cardId;
  }
  const server = createBusinessArtifactServer({
    repository,
    pipelineStatistics: statistics,
    resolveContext: () => context,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/__business-artifacts/cards`;
  return {
    baseUrl,
    cardId,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      repository.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
