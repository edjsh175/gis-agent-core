import { describe, it, expect, vi } from 'vitest';
import { createLayerCatalog } from '../../src/gis/catalog.js';
import { createDataCapabilities } from '../../src/gis/data/createDataCapabilities.js';
import { createGeoServerTransport } from '../../src/gis/adapters/geoserverTransport.js';

const config = {
  baseUrl: '/geoserver',
  workspace: 'GX',
  pipelineLayers: { water: { line: 'js_ln', point: 'js_pt' } },
};
const schema =
  '<xsd:schema><xsd:complexType><xsd:sequence><xsd:element name="pipeid" type="xsd:string"/><xsd:element name="count" type="xsd:int"/><xsd:element name="enabled" type="xsd:boolean"/><xsd:element name="geom" type="gml:GeometryPropertyType"/></xsd:sequence></xsd:complexType><xsd:element name="js_ln" type="GX:js_lnType"/></xsd:schema>';
const feature = {
  type: 'Feature',
  id: 'js_ln.1',
  properties: { pipeid: "O'Brien" },
  geometry: { type: 'Point', coordinates: [104, 30] },
};
function setup(body = { type: 'FeatureCollection', features: [feature] }) {
  const catalog = createLayerCatalog();
  catalog.update(config, []);
  const request = vi.fn(async (url) => ({
    status: 200,
    text: url.includes('DescribeFeatureType') ? schema : JSON.stringify(body),
  }));
  const data = createDataCapabilities({
    catalog,
    config,
    transport: { request },
  });
  const query = (value = "O'Brien", extra = {}) =>
    data.queryFeatures({
      layerId: 'geoserver:GX:js_ln',
      filters: [{ field: 'pipeid', op: 'eq', value }],
      ...extra,
    });
  return { catalog, request, data, query };
}
describe('data capabilities without DOM or map', () => {
  it('returns plain source identity and escaped AND filters', async () => {
    expect(globalThis.window).toBeUndefined();
    const { data, request, query } = setup();
    const result = await query();
    expect(result.data.features[0]).toMatchObject({
      sourceFeatureId: 'js_ln.1',
      layerId: 'geoserver:GX:js_ln',
      properties: feature.properties,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    const params = new URL(request.mock.calls[1][0], 'http://test')
      .searchParams;
    expect(params.get('CQL_FILTER')).toBe("\"pipeid\" = 'O''Brien'");
    expect(params.get('maxFeatures')).toBe('101');
    expect((await data.listLayers()).data.layers[0]).not.toHaveProperty(
      'bindings'
    );
  });
  it.each([
    [],
    [{ field: 'unknown', op: 'eq', value: 'a' }],
    [{ field: 'count', op: 'eq', value: '2' }],
    [{ field: 'pipeid', op: 'eq', value: 2 }],
    [{ field: 'geom', op: 'eq', value: 'x' }],
  ])('rejects invalid metadata-backed filters %j', async (filters) => {
    const { query, request } = setup();
    expect((await query('x', { filters })).error.code).toBe('INVALID_ARGUMENT');
    expect(
      request.mock.calls.filter(([url]) => url.includes('GetFeature'))
    ).toHaveLength(0);
  });
  it.each([
    [0, undefined, false],
    [100, undefined, null],
    [101, undefined, true],
    [3, 3, false],
    [3, 20, true],
  ])(
    'reports truncation for %s items / %s total',
    async (count, totalFeatures, truncated) => {
      const { query } = setup({
        type: 'FeatureCollection',
        features: Array(count).fill(feature),
        totalFeatures,
      });
      const result = await query();
      expect(result.data.truncated).toBe(truncated);
      expect(result.data.returnedCount).toBe(Math.min(count, 100));
    }
  );
  it('preserves null source ID and separates layers', async () => {
    const { query, data } = setup({
      type: 'FeatureCollection',
      features: [{ ...feature, id: undefined }],
    });
    expect((await query()).data.features[0].sourceFeatureId).toBeNull();
    expect(
      (
        await data.queryFeatures({
          layerId: 'geoserver:GX:js_pt',
          filters: [{ field: 'pipeid', op: 'eq', value: 'x' }],
        })
      ).data.features[0].layerId
    ).toBe('geoserver:GX:js_pt');
  });
  it('does not cache failed metadata; config/catalog reload invalidates successful metadata', async () => {
    const { query, request, catalog } = setup();
    request.mockRejectedValueOnce(new Error('offline'));
    expect((await query()).error.code).toBe('METADATA_UNAVAILABLE');
    expect((await query()).ok).toBe(true);
    catalog.update({ ...config, baseUrl: '/other' }, []);
    await query();
    expect(
      request.mock.calls.filter(([url]) => url.includes('DescribeFeatureType'))
    ).toHaveLength(3);
  });
  it('distinguishes service failure and stale configuration', async () => {
    const { query, request, catalog } = setup();
    request.mockImplementation(async (url) => {
      if (url.includes('DescribeFeatureType'))
        return { status: 200, text: schema };
      return { status: 200, text: '<ExceptionReport>bad</ExceptionReport>' };
    });
    expect((await query()).error.code).toBe('SERVICE_ERROR');
    request.mockImplementation(async () => {
      catalog.update({ ...config, baseUrl: '/other' }, []);
      return {
        status: 200,
        text: JSON.stringify({ type: 'FeatureCollection', features: [] }),
      };
    });
    expect((await query()).error.code).toBe('STALE_CONTEXT');
  });
  it('transport supports timeout and caller cancellation', async () => {
    const request = (_, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason))
      );
    const transport = createGeoServerTransport({
      config: { timeoutMs: 10 },
      request,
    });
    await expect(transport.request('http://test')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    const controller = new AbortController();
    const pending = transport.request('http://test', {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: 'OPERATION_CANCELLED',
    });
  });
});
describe('catalog derives identity and bindings', () => {
  it('resolves config-only nodes and refuses a different service', () => {
    const catalog = createLayerCatalog();
    catalog.update(config, [
      { id: 'a', label: 'water', config: { layerName: 'GX:js_ln' } },
      {
        id: 'b',
        label: 'water',
        config: { baseUrl: '/geoserver', layerName: 'GX:js_ln' },
      },
      {
        id: 'c',
        label: 'water',
        config: { baseUrl: 'https://remote/geoserver', layerName: 'GX:js_ln' },
      },
    ]);
    expect(
      catalog
        .getLayer('geoserver:GX:js_ln')
        .bindings.map((binding) => binding.treeId)
    ).toEqual(['a', 'b']);
    expect(catalog.getLayer('map:c').queryable).toBe(false);
  });
  it('maps WMS case-insensitively, keeps remote/multi WMS separate and same names distinct', () => {
    const catalog = createLayerCatalog();
    catalog.update(config, [
      { id: 'a', label: 'same', url: '/geoserver/GX/wms?LAYERS=GX:js_ln' },
      { id: 'b', label: 'same', url: '/geoserver/GX/wms?layers=GX:js_ln' },
      {
        id: 'c',
        label: 'same',
        url: '/geoserver/GX/wms?layers=GX:js_ln,GX:js_pt',
      },
      {
        id: 'd',
        label: 'same',
        url: 'https://remote/geoserver/GX/wms?layers=GX:js_ln',
      },
    ]);
    expect(
      catalog.getLayer('geoserver:GX:js_ln').bindings.map((b) => b.treeId)
    ).toEqual(['a', 'b']);
    expect(catalog.getLayer('map:c').queryable).toBe(false);
    expect(catalog.getLayer('map:d').queryable).toBe(false);
  });
});
