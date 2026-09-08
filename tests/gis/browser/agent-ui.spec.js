import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 950 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/gis/browser/ui.html?agent=1');
  await page.waitForFunction(() => window.uiTest?.gis.runtime.getState().ready);
  await expect(page.getByTestId('agent-fixture')).toBeVisible();
});

const uploadPair = async (page, name = 'roads') => {
  await page.locator('input[type="file"]').setInputFiles([
    { name: `${name}.shp`, mimeType: 'application/octet-stream', buffer: Buffer.from('shp') },
    { name: `${name}.dbf`, mimeType: 'application/octet-stream', buffer: Buffer.from('dbf') },
  ]);
};

test('upload keeps the user prompt unchanged and accepted send clears only the draft UI', async ({ page }) => {
  await uploadPair(page);
  await expect(page.locator('.composer-textarea')).toHaveValue('');
  await expect(page.locator('.file-badge')).toHaveCount(1);

  const before = await page.evaluate(() => window.uiTest.gis.fileReferences.list()[0].file_ref);
  await page.locator('.send-btn').click();
  await expect(page.locator('.file-badge')).toHaveCount(0);
  expect(await page.evaluate((fileRef) => window.uiTest.gis.fileReferences.resolve(fileRef).ok, before)).toBe(true);
  expect(await page.evaluate(() => window.uiTest.agentSent.value)).toEqual(['导入 roads 矢量数据并上图显示。']);
});

test('rejected send preserves text and attachment draft', async ({ page }) => {
  await uploadPair(page, 'pipes');
  await page.locator('.composer-textarea').fill('把这个图层改成红色');
  await page.evaluate(() => { window.uiTest.agentAcceptSend.value = false; });
  await page.locator('.send-btn').click();
  await expect(page.locator('.composer-textarea')).toHaveValue('把这个图层改成红色');
  await expect(page.locator('.file-badge')).toHaveCount(1);
});

test('explaining_failure disables all composer input and file controls', async ({ page }) => {
  await uploadPair(page);
  await page.evaluate(() => { window.uiTest.agentStatus.value = 'explaining_failure'; });
  await expect(page.locator('.composer-textarea')).toBeDisabled();
  await expect(page.locator('.attach-btn')).toBeDisabled();
  await expect(page.locator('.badge-remove')).toBeDisabled();
  await expect(page.getByRole('button', { name: '停止' })).toBeVisible();
});

test('blank assistant tool messages do not render an assistant bubble', async ({ page }) => {
  await expect(page.locator('.assistant-row')).toHaveCount(0);
  await page.evaluate(() => {
    window.uiTest.agentMessages.value = [
      { id: 'blank', role: 'assistant', content: '   ' },
      { id: 'real', role: 'assistant', content: '已完成' },
    ];
  });
  await expect(page.locator('.assistant-row')).toHaveCount(1);
  await expect(page.locator('.assistant-bubble')).toContainText('已完成');
});
