import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 1440, height: 950 } });
const feature = {
  type: 'Feature',
  id: 'js_ln.1',
  properties: { pipeid: 'P001', feature: '检查井' },
  geometry: {
    type: 'LineString',
    coordinates: [
      [104, 30],
      [104.001, 30.001],
    ],
  },
};
test.beforeEach(async ({ page }) => {
  await page.route('**/serverGx/global/getStatisticalFiles**', (route) =>
    route.fulfill({ json: { code: 200, data: ['检查井'] } })
  );
  await page.route('**/fake-geoserver/**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [feature] } })
  );
  page.on('pageerror', (error) => console.error('Page error:', error.message));
  await page.goto('/tests/gis/browser/ui.html');
  await page.waitForFunction(() => window.uiTest?.gis.runtime.getState().ready);
});
test('existing FeatureQuery spatial result uses capability actions and releases resources', async ({
  page,
}) => {
  await page.locator('.feature-query .el-select').first().click();
  await page.getByRole('option', { name: '给水管线', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '特征属性查询', exact: true }).click();
  await expect(page.locator('.attribute-selector')).toBeVisible();
  await page.locator('.attribute-selector .el-select').click();
  await page.getByRole('option', { name: '检查井', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByText('多边形', { exact: true }).click();
  await page.waitForFunction(() =>
    window.uiTest.map
      .getInteractions()
      .getArray()
      .some(
        (interaction) =>
          typeof interaction.finishDrawing === 'function' &&
          interaction.getActive()
      )
  );
  await page.mouse.click(250, 200);
  await page.mouse.click(550, 200);
  await page.mouse.click(550, 450);
  await page.mouse.dblclick(250, 450);
  await page.getByRole('button', { name: '特征查询', exact: true }).click();
  await expect(page.locator('.el-table__row')).toHaveCount(2);
  await page.locator('.el-table__row').first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.uiTest.manager
            .getHighlightSource()
            ?.getFeatures()
            .filter((f) => f.get('gisOwner')).length
      )
    )
    .toBe(1);
  await page.getByRole('button', { name: '重新高亮' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.uiTest.manager
            .getHighlightSource()
            ?.getFeatures()
            .filter((f) => f.get('gisOwner')).length
      )
    )
    .toBe(3);
  await page.getByRole('button', { name: '清除所有高亮' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.uiTest.manager.getHighlightSource().getFeatures().length
      )
    )
    .toBe(0);
  await page.locator('.el-table__row').first().click();
  await page.getByRole('button', { name: '清除所有高亮' }).click();
  await page.waitForFunction(() => !window.uiTest.map.getView().getAnimating());
  expect(
    await page.evaluate(
      () => window.uiTest.manager.getHighlightSource().getFeatures().length
    )
  ).toBe(0);
  await page.getByRole('button', { name: 'Toggle query' }).click();
  expect(
    await page.evaluate(
      () =>
        window.uiTest.map
          .getLayers()
          .getArray()
          .filter((layer) => layer.get('spatialQuery')).length
    )
  ).toBe(0);
  await page.getByRole('button', { name: 'Toggle query' }).click();
  await expect(page.locator('.feature-query')).toBeVisible();
});
test('programmatic visibility and desktop tree commit the same state', async ({
  page,
}) => {
  await page.evaluate(() => window.uiTest.bus.emit('showTCLB', true));
  await expect(page.locator('.tree:visible').first()).toBeVisible();
  const hidden = await page.evaluate(async () => {
    const scope = window.uiTest.gis.createClientScope();
    const result = await scope.setLayerVisibility({
      layerId: 'geoserver:GX:js_ln',
      visible: false,
    });
    scope.dispose();
    return result;
  });
  expect(hidden.ok).toBe(true);
  await expect(
    page.locator('.tree:visible').first().locator('input[type=checkbox]').last()
  ).not.toBeChecked();
  await page
    .locator('.tree:visible')
    .first()
    .locator('.el-checkbox__inner')
    .last()
    .click();
  await expect
    .poll(() => page.evaluate(() => window.uiTest.store.checkedKeys))
    .toEqual(['water']);
  expect(
    await page.evaluate(() =>
      window.uiTest.map.getLayers().item(0).getVisible()
    )
  ).toBe(true);
  await page.setViewportSize({ width: 600, height: 950 });
  await expect(page.locator('.el-drawer .tree:visible')).toBeVisible();
  await page
    .locator('.el-drawer .tree:visible .el-checkbox__inner')
    .last()
    .click();
  await expect
    .poll(() => page.evaluate(() => window.uiTest.store.checkedKeys))
    .toEqual([]);
  expect(
    await page.evaluate(() =>
      window.uiTest.map.getLayers().item(0).getVisible()
    )
  ).toBe(false);
});
test('group visibility reports unloaded leaves and retains committed partial state', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.uiTest.store.layersList[0].children.push({
      id: 'missing',
      label: '未加载管点',
      type: 'VECTOR',
      url: '/fake-geoserver/GX/wms?layers=GX:js_pt',
    });
    window.uiTest.store.checkedKeys = [];
    window.uiTest.map.getLayers().item(0).setVisible(false);
    window.uiTest.bus.emit('showTCLB', true);
  });
  await page
    .locator('.tree:visible')
    .first()
    .locator('.el-checkbox__inner')
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => window.uiTest.store.checkedKeys))
    .toEqual(['water']);
  await expect(
    page.getByText('未加载管点: LAYER_NOT_LOADED', { exact: false })
  ).toBeVisible();
  await expect(
    page.locator('.tree:visible').first().locator('input[type=checkbox]').last()
  ).not.toBeChecked();
});
