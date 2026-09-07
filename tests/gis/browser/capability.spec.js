import { test, expect } from '@playwright/test';
const feature = {
  type: 'Feature',
  id: 'js_ln.1',
  properties: { pipeid: 'P001' },
  geometry: {
    type: 'LineString',
    coordinates: [
      [104, 30],
      [104.001, 30.001],
    ],
  },
};
test.beforeEach(async ({ page }) => {
  await page.route('**/fake-geoserver/**', (route) =>
    route.fulfill({
      contentType: route.request().url().includes('DescribeFeatureType')
        ? 'application/xml'
        : 'application/json',
      body: route.request().url().includes('DescribeFeatureType')
        ? '<xsd:schema><xsd:sequence><xsd:element name="pipeid" type="xsd:string"/></xsd:sequence></xsd:schema>'
        : JSON.stringify({
            type: 'FeatureCollection',
            features: [feature],
            totalFeatures: 1,
          }),
    })
  );
  await page.goto('/tests/gis/browser/harness.html');
  await page.waitForFunction(() => window.gisTest?.runtime.getState().ready);
});
test('number query → locate → highlight → clear; real OL projection and isolation', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { data, runtime, manager, map } = window.gisTest;
    const scope = runtime.createClientScope();
    const query = await data.queryFeatures({
      layerId: 'geoserver:GX:js_ln',
      filters: [{ field: 'pipeid', op: 'eq', value: 'P001' }],
    });
    const located = await scope.locateFeatures({
      features: query.data.features,
    });
    const before = manager.getHighlightSource()?.getFeatures().length || 0;
    const center = map.getView().getCenter();
    const highlighted = await scope.highlightFeatures({
      features: query.data.features,
    });
    const extent = manager.getHighlightSource().getExtent();
    const cleared = await scope.clearHighlight();
    const visibility = await scope.setLayerVisibility({
      layerId: 'geoserver:GX:js_ln',
      visible: false,
    });
    return {
      query,
      located,
      before,
      center,
      highlighted,
      extent,
      cleared,
      visibility,
      checked: window.gisTest.checkedKeys,
      layers: map.getLayers().getLength(),
    };
  });
  expect(result.query.ok).toBe(true);
  expect(result.located.ok).toBe(true);
  expect(result.before).toBe(0);
  expect(result.center[0]).toBeGreaterThan(11000000);
  expect(result.extent[0]).toBeGreaterThan(11000000);
  expect(result.highlighted.ok).toBe(true);
  expect(result.cleared.data.clearedCount).toBe(1);
  expect(result.visibility.ok).toBe(true);
  expect(result.checked).toEqual([]);
  expect(result.layers).toBe(2);
});
test('animation and query completions cannot affect replacement scene', async ({
  page,
}) => {
  const result = await page.evaluate(async (feature) => {
    const { runtime, map } = window.gisTest;
    const scope = runtime.createClientScope();
    const features = [
      {
        ...feature,
        layerId: 'geoserver:GX:js_ln',
        sourceFeatureId: feature.id,
      },
    ];
    const pending = scope.locateFeatures({ features });
    runtime.beginScene('3d');
    const old = await pending;
    const unsupported = await runtime
      .createClientScope()
      .highlightFeatures({ features });
    window.gisTest.rebuild();
    const stale = await scope.highlightFeatures({ features });
    const fresh = runtime.createClientScope();
    const located = await fresh.locateFeatures({ features });
    return {
      old,
      unsupported,
      stale,
      located,
      center: window.gisTest.map.getView().getCenter(),
    };
  }, feature);
  expect(result.old.error.code).toBe('STALE_CONTEXT');
  expect(result.unsupported.error.code).toBe('UNSUPPORTED_CAPABILITY');
  expect(result.stale.error.code).toBe('STALE_CONTEXT');
  expect(result.located.ok).toBe(true);
  expect(result.center[0]).toBeCloseTo(104.0005, 3);
});
test('query during scene switch leaves its captured scope permanently stale', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { runtime, data } = window.gisTest;
    const scope = runtime.createClientScope();
    const pending = data.queryFeatures({
      layerId: 'geoserver:GX:js_ln',
      filters: [{ field: 'pipeid', op: 'eq', value: 'P001' }],
    });
    runtime.beginScene('3d');
    const query = await pending;
    const location = await scope.locateFeatures({
      features: query.data.features,
    });
    return { query, location };
  });
  expect(result.query.ok).toBe(true);
  expect(result.location.error.code).toBe('STALE_CONTEXT');
});
test('point, line, polygon and Multi geometries render in both projections', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const ring = [
      [104, 30],
      [104.001, 30],
      [104.001, 30.001],
      [104, 30],
    ];
    const geometries = [
      { type: 'Point', coordinates: [104, 30] },
      {
        type: 'MultiPoint',
        coordinates: [
          [104, 30],
          [104.001, 30.001],
        ],
      },
      { type: 'LineString', coordinates: ring.slice(0, 2) },
      { type: 'MultiLineString', coordinates: [ring.slice(0, 2)] },
      { type: 'Polygon', coordinates: [ring] },
      { type: 'MultiPolygon', coordinates: [[ring]] },
    ];
    const results = [];
    for (const projection of ['EPSG:3857', 'EPSG:4326']) {
      window.gisTest.rebuild(projection);
      const scope = window.gisTest.runtime.createClientScope();
      const features = geometries.map((geometry, index) => ({
        type: 'Feature',
        layerId: 'geoserver:GX:js_ln',
        sourceFeatureId: index,
        properties: {},
        geometry,
      }));
      results.push(await scope.locateFeatures({ features }));
      results.push(await scope.highlightFeatures({ features }));
      scope.dispose();
    }
    return results;
  });
  expect(result.every((item) => item.ok && item.data.featureCount === 6)).toBe(
    true
  );
});

test('MapContext follows actual map actions and rebuilds without exposing payloads', async ({
  page,
}) => {
  const result = await page.evaluate(async (feature) => {
    const { runtime, mapContext } = window.gisTest;
    const scope = runtime.createClientScope();
    const features = [
      {
        ...feature,
        layerId: 'geoserver:GX:js_ln',
        sourceFeatureId: feature.id,
      },
    ];
    const before = mapContext.getSnapshot();
    await scope.locateFeatures({ features });
    await scope.highlightFeatures({ features });
    const highlighted = mapContext.getSnapshot();
    await scope.setLayerVisibility({
      layerId: 'geoserver:GX:js_ln',
      visible: false,
    });
    const hidden = mapContext.getSnapshot();
    await scope.clearHighlight();
    const cleared = mapContext.getSnapshot();
    runtime.beginScene('3d');
    const unsupported = mapContext.getSnapshot();
    window.gisTest.rebuild();
    return {
      before,
      highlighted,
      hidden,
      cleared,
      unsupported,
      rebuilt: mapContext.getSnapshot(),
    };
  }, feature);
  expect(result.highlighted.data.viewport.center[0]).toBeCloseTo(104.0005, 3);
  expect(result.highlighted.data.highlight.groups.results.identities).toEqual([
    { layerId: 'geoserver:GX:js_ln', sourceFeatureId: 'js_ln.1' },
  ]);
  expect(result.hidden.data.visibleLayers).toEqual([]);
  expect(result.cleared.data.highlight.groups).toEqual({});
  expect(result.unsupported.data.layers).toBeNull();
  expect(result.unsupported.data.supportedTools).toEqual([]);
  expect(result.rebuilt.data.revision).toBeGreaterThan(
    result.before.data.revision
  );
  expect(JSON.stringify(result)).not.toContain('coordinates');
});
