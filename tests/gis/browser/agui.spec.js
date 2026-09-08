import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gis/browser/agui.html');
  await page.waitForFunction(() => window.aguiTest?.gis.runtime.getState().ready);
});

const inspect = (page) => page.evaluate(async () => {
  const session = window.aguiTest.state.value.session;
  return (await (await fetch('/__gis-agui/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session) })).json()).data;
});

test('SHP file_ref → import → style → fit → visibility → correlated completion', async ({ page }) => {
  const result = await page.evaluate(() => window.aguiTest.start('vector'));
  expect(result.ok).toBe(true);
  await expect(page.getByTestId('status')).toHaveText('completed');

  const browser = await page.evaluate(() => {
    const state = window.aguiTest.state.value;
    const userLayer = window.aguiTest.map.getAllLayers().find((item) => item.get('gisUserLayerRef') === 'ul_roads');
    const feature = userLayer.getSource().getFeatures()[0];
    const style = userLayer.getStyleFunction()(feature, 1);
    return {
      state,
      layerCount: state.context.data.userLayers.length,
      layer: state.context.data.userLayers[0],
      visible: userLayer.getVisible(),
      strokeColor: style.getStroke().getColor(),
      strokeWidth: style.getStroke().getWidth(),
      center: window.aguiTest.map.getView().getCenter(),
    };
  });
  expect(browser.state.receipts).toHaveLength(4);
  expect(browser.state.receipts.every((receipt) => receipt.delivered && receipt.result.ok && receipt.result.effect.status === 'applied')).toBe(true);
  expect(browser.layerCount).toBe(1);
  expect(browser.layer).toMatchObject({
    layer_ref: 'ul_roads',
    name: 'roads',
    geometryTypes: ['LineString'],
    featureCount: 1,
    visible: false,
  });
  expect(browser.visible).toBe(false);
  expect(browser.strokeColor).toBe('rgba(255, 0, 0, 0.8)');
  expect(browser.strokeWidth).toBe(4);
  expect(browser.center[0]).toBeCloseTo(104.005, 3);
  expect(browser.center[1]).toBeCloseTo(30.005, 3);

  const server = await inspect(page);
  expect(server.receivedRunIds).toHaveLength(5);
  expect(server.toolResults).toHaveLength(4);
  expect(server.queryCount).toBe(0);
  expect(server.states[0].availableFiles[0]).toMatchObject({ file_ref: 'vf_roads', name: 'roads' });
  expect(server.states.at(-1).userLayers[0]).toMatchObject({ layer_ref: 'ul_roads', visible: false });
});

test('Vue → HTTP/SSE → actual locate/highlight → correlated results → completion', async ({ page }) => {
  await page.getByText('执行确定性流程', { exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText('completed');
  const result = await page.evaluate(() => ({ state: window.aguiTest.state.value, count: window.aguiTest.manager.getHighlightSource().getFeatures().length }));
  expect(result.count).toBe(1);
  expect(result.state.context.data.viewport.center[0]).toBeCloseTo(104.0005, 3);
  expect(result.state.receipts).toHaveLength(2);
  expect(result.state.receipts.every((receipt) => receipt.delivered && receipt.result.ok && receipt.result.effect.status === 'applied')).toBe(true);
  const server = await inspect(page);
  expect(server.queryCount).toBe(1);
  expect(server.receivedRunIds).toHaveLength(3);
  expect(new Set(server.receivedRunIds).size).toBe(3);
  expect(server.toolResults).toHaveLength(2);
  expect(JSON.stringify(result.state.messages)).not.toContain('coordinates');
  await page.getByText('清除高亮', { exact: true }).click();
  expect(await page.evaluate(() => window.aguiTest.manager.getHighlightSource().getFeatures().length)).toBe(0);
});

for (const scenario of ['malformed_args', 'multiple_tools', 'run_error', 'broken_patch']) {
  test(`${scenario} never reaches map effects`, async ({ page }) => {
    const result = await page.evaluate((scenario) => window.aguiTest.start(scenario), scenario);
    expect(result.ok).toBe(false);
    expect(await page.evaluate(() => window.aguiTest.map.getView().getCenter())).toEqual([103, 29]);
    expect((await inspect(page)).toolResults).toHaveLength(0);
  });
}

test('protocol state patch cannot overwrite browser MapContext or layer flags', async ({ page }) => {
  const result = await page.evaluate(() => window.aguiTest.start('state_patch'));
  expect(result.ok).toBe(true);
  expect(await page.evaluate(() => window.aguiTest.layer.getVisible())).toBe(true);
  expect((await inspect(page)).toolResults).toHaveLength(2);
  expect(await page.evaluate(() => window.aguiTest.state.value.context.data.visibleLayers)).toEqual(['geoserver:GX:js_ln']);
});

test('user gesture cancels an in-flight run before it can move the map', async ({ page }) => {
  await page.evaluate(() => { window.aguiTest.start('slow_run'); });
  await expect(page.getByTestId('status')).toHaveText('running');
  await page.locator('#map').click({ position: { x: 300, y: 200 } });
  await expect(page.getByTestId('status')).toHaveText('cancelled');
  const result = await page.evaluate(() => window.aguiTest.pending);
  expect(result.ok).toBe(false);
  expect((await inspect(page)).toolResults).toHaveLength(0);
});

test('user layer change during locate cancels the workflow and preserves the user flag', async ({ page }) => {
  await page.evaluate(() => { window.aguiTest.start(); });
  await expect(page.getByTestId('status')).toHaveText('waiting_frontend');
  await page.getByText('切换图层', { exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText('cancelled');
  const result = await page.evaluate(() => window.aguiTest.pending);
  expect(result.ok).toBe(false);
  expect(await page.evaluate(() => window.aguiTest.layer.getVisible())).toBe(false);
  expect(await page.evaluate(() => window.aguiTest.state.value.receipts.some((item) => item.result.effect.status === 'applied'))).toBe(false);
});

test('scene replacement during reference fetch cannot run against the new map', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/__gis-agui/resolve', async (route) => { await gate; await route.continue().catch(() => {}); });
  await page.evaluate(() => { window.aguiTest.start(); });
  await expect(page.getByTestId('status')).toHaveText('waiting_frontend');
  await page.evaluate(() => window.aguiTest.gis.runtime.beginScene('3d'));
  release();
  const result = await page.evaluate(() => window.aguiTest.pending);
  expect(result.error.code).toBe('STALE_CONTEXT');
  expect((await inspect(page)).toolResults).toHaveLength(0);
});
