import { test, expect } from '@playwright/test';

test('browser → Harness AgentLoop → GIS tools → OpenLayers → continuation', async ({ page }) => {
  await page.goto('/tests/gis/browser/agui.html?backend=harness');
  await page.waitForFunction(() => window.aguiTest?.gis.runtime.getState().ready);

  const result = await page.evaluate(() => window.aguiTest.start());
  expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
  await expect(page.getByTestId('status')).toHaveText('completed');

  const state = await page.evaluate(() => {
    const workflowState = window.aguiTest.state.value;
    const userLayer = window.aguiTest.map.getAllLayers().find((item) => item.get('gisUserLayerRef') === 'ul_roads');
    if (!userLayer) {
      return {
        backend: window.aguiTest.backend,
        receipts: workflowState.receipts,
        context: workflowState.context.data,
        messages: workflowState.messages,
        layerMissing: true,
      };
    }
    const feature = userLayer.getSource().getFeatures()[0];
    const style = userLayer.getStyleFunction()(feature, 1);
    return {
      backend: window.aguiTest.backend,
      receipts: workflowState.receipts,
      context: workflowState.context.data,
      messages: workflowState.messages,
      layerVisible: userLayer.getVisible(),
      strokeColor: style.getStroke().getColor(),
      strokeWidth: style.getStroke().getWidth(),
      center: window.aguiTest.map.getView().getCenter(),
    };
  });

  expect(state.backend).toBe('harness');
  expect(state.layerMissing, JSON.stringify({ receipts: state.receipts, messages: state.messages, context: state.context }, null, 2)).not.toBe(true);
  const realLlm = process.env.GIS_HARNESS_REAL_LLM === '1';
  if (realLlm) expect(state.receipts.length).toBeGreaterThanOrEqual(3);
  else expect(state.receipts).toHaveLength(3);
  expect(state.receipts.every((item) => item.result.effect.status === 'applied')).toBe(true);
  expect(state.receipts.every((item) => item.delivered)).toBe(true);
  expect(state.context.userLayers[0]).toMatchObject({
    layer_ref: 'ul_roads',
    name: 'roads',
    geometryTypes: ['LineString'],
    featureCount: 1,
    visible: true,
  });
  expect(state.layerVisible).toBe(true);
  expect(state.strokeColor).toBe('rgba(255, 0, 0, 0.8)');
  expect(state.strokeWidth).toBe(4);
  expect(state.center[0]).toBeCloseTo(104.005, 3);
  expect(state.center[1]).toBeCloseTo(30.005, 3);
});
