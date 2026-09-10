import { describe, expect, it, vi } from 'vitest';
import { createBusinessCardMapActionExecutor } from '../../src/business-artifacts/integration/mapActionExecutor.js';

const action = {
  kind: 'query_and_highlight',
  layerId: 'geoserver:GX:js_ln',
  filters: [{ field: 'material', op: 'eq', value: '铸铁' }],
};

function feature(id = 'js_ln.1') {
  return {
    type: 'Feature',
    layerId: 'geoserver:GX:js_ln',
    sourceFeatureId: id,
    geometry: { type: 'LineString', coordinates: [[117, 34], [117.01, 34.01]] },
    properties: { material: '铸铁' },
  };
}

function fixture({ features = [feature()], queryResult } = {}) {
  const scopes = [];
  const queryFeatures = vi.fn().mockResolvedValue(
    queryResult || {
      ok: true,
      data: { features, returnedCount: features.length, truncated: false },
    }
  );
  const gis = {
    data: { queryFeatures },
    createClientScope() {
      const scope = {
        highlightFeatures: vi.fn().mockResolvedValue({ ok: true, data: { featureCount: features.length } }),
        locateFeatures: vi.fn().mockResolvedValue({ ok: true, data: { featureCount: features.length } }),
        dispose: vi.fn(),
      };
      scopes.push(scope);
      return scope;
    },
  };
  return { gis, queryFeatures, scopes };
}

describe('business card map action executor', () => {
  it('re-queries authoritative GIS data then highlights and locates through a fresh client scope', async () => {
    const { gis, queryFeatures, scopes } = fixture();
    const executor = createBusinessCardMapActionExecutor({ gis });

    const result = await executor.execute(action);

    expect(result).toMatchObject({
      ok: true,
      data: { featureCount: 1, truncated: false },
      effect: { status: 'applied', kind: 'query_and_highlight' },
    });
    expect(queryFeatures).toHaveBeenCalledWith({
      layerId: action.layerId,
      filters: action.filters,
      limit: 100,
    });
    expect(scopes).toHaveLength(1);
    expect(scopes[0].highlightFeatures).toHaveBeenCalledWith({
      features: [feature()],
      group: 'results',
      mode: 'replace',
      effect: 'persistent',
    });
    expect(scopes[0].locateFeatures).toHaveBeenCalledWith({ features: [feature()] });
  });

  it('does not create a map scope when the fresh query returns no features', async () => {
    const { gis, scopes } = fixture({ features: [] });
    const executor = createBusinessCardMapActionExecutor({ gis });

    expect(await executor.execute(action)).toEqual({
      ok: false,
      error: { code: 'NO_FEATURES_FOUND', message: '没有找到符合条件的地图要素' },
    });
    expect(scopes).toHaveLength(0);
  });

  it('disposes the previous action scope only after a replacement action succeeds', async () => {
    const { gis, scopes } = fixture();
    const executor = createBusinessCardMapActionExecutor({ gis });

    expect((await executor.execute(action)).ok).toBe(true);
    expect((await executor.execute(action)).ok).toBe(true);

    expect(scopes).toHaveLength(2);
    expect(scopes[0].dispose).toHaveBeenCalledTimes(1);
    expect(scopes[1].dispose).not.toHaveBeenCalled();
    executor.dispose();
    expect(scopes[1].dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported persisted intent instead of bypassing GIS capability validation', async () => {
    const { gis, queryFeatures } = fixture();
    const executor = createBusinessCardMapActionExecutor({ gis });

    const result = await executor.execute({ ...action, filters: [{ field: 'material', op: 'in', value: ['铸铁'] }] });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_CARD_MAP_ACTION');
    expect(queryFeatures).not.toHaveBeenCalled();
  });
});
