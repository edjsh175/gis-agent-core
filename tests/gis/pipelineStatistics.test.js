import { describe, expect, it, vi } from 'vitest';
import { createPipelineStatisticsService } from '../../harness/business-artifacts/pipelineStatistics.js';

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe('pipeline statistics service', () => {
  it('aggregates count, total length, and material groups from the controlled WFS source', async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        type: 'FeatureCollection',
        totalFeatures: 4,
        numberReturned: 4,
        features: [
          { properties: { material: '铸铁', shape_leng: 2.5 } },
          { properties: { material: 'PVC', shape_leng: 3 } },
          { properties: { material: '铸铁', shape_leng: 4.25 } },
          { properties: { material: null, shape_leng: 0.25 } },
        ],
      })
    );
    const service = createPipelineStatisticsService({ fetchImpl });
    const result = await service.query({ layerId: 'GX:js_ln' });

    expect(result.dataset).toBe('pipeline');
    expect(result.scope).toEqual({ layerId: 'GX:js_ln' });
    expect(result.data.summary).toEqual({ count: 4, total_length: 10 });
    expect(result.data.groups.material).toEqual([
      { key: '铸铁', count: 2 },
      { key: 'PVC', count: 1 },
      { key: '未标注', count: 1 },
    ]);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get('typeName')).toBe('GX:js_ln');
    expect(url.searchParams.get('propertyName')).toBe('material,shape_leng');
  });

  it('rejects non-allowlisted layers before any network request', async () => {
    const fetchImpl = vi.fn();
    const service = createPipelineStatisticsService({ fetchImpl });
    await expect(service.query({ layerId: 'GX:rq_ln' })).rejects.toMatchObject({
      code: 'STATISTICS_SCOPE_FORBIDDEN',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when WFS returns only part of the matched dataset', async () => {
    const service = createPipelineStatisticsService({
      fetchImpl: async () =>
        response({
          type: 'FeatureCollection',
          totalFeatures: 3,
          numberReturned: 2,
          features: [
            { properties: { material: 'PVC', shape_leng: 1 } },
            { properties: { material: 'PVC', shape_leng: 1 } },
          ],
        }),
    });
    await expect(service.query()).rejects.toMatchObject({
      code: 'STATISTICS_INCOMPLETE_SOURCE',
    });
  });

  it('rejects invalid source values instead of silently corrupting facts', async () => {
    const service = createPipelineStatisticsService({
      fetchImpl: async () =>
        response({
          type: 'FeatureCollection',
          totalFeatures: 1,
          numberReturned: 1,
          features: [{ properties: { material: 'PVC', shape_leng: 'bad' } }],
        }),
    });
    await expect(service.query()).rejects.toMatchObject({
      code: 'STATISTICS_INVALID_SOURCE',
    });
  });

  it('replays only the exact supported snapshot descriptor', async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        type: 'FeatureCollection',
        totalFeatures: 0,
        numberReturned: 0,
        features: [],
      })
    );
    const service = createPipelineStatisticsService({ fetchImpl });
    const descriptor = {
      dataset: 'pipeline',
      scope: { layerId: 'GX:js_ln' },
      query: {
        metrics: ['count', 'total_length'],
        dimensions: ['material'],
        filters: [],
      },
    };
    expect(service.canReplay(descriptor)).toBe(true);
    expect(service.canReplay({ ...descriptor, scope: {} })).toBe(false);
    await service.replay(descriptor);
    await expect(
      service.replay({
        dataset: 'pipeline',
        scope: {},
        query: {
          metrics: ['count', 'total_length'],
          dimensions: ['material'],
          filters: [],
        },
      })
    ).rejects.toMatchObject({ code: 'STATISTICS_REPLAY_UNSUPPORTED' });
    await expect(
      service.replay({
        dataset: 'pipeline',
        scope: { layerId: 'GX:js_ln' },
        query: { metrics: ['count'], dimensions: ['material'], filters: [] },
      })
    ).rejects.toMatchObject({ code: 'STATISTICS_REPLAY_UNSUPPORTED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
