import { test, expect } from '@playwright/test';
import { startBusinessArtifactsFixture } from './businessArtifactsServer.js';

let api;

test.beforeEach(async ({ page }, testInfo) => {
  const seedRefresh = testInfo.title.includes('refreshes a persisted');
  api = await startBusinessArtifactsFixture({ seedRefresh });
  await page.route('**/__business-artifacts/cards**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const suffix = requestUrl.pathname.slice(
      '/__business-artifacts/cards'.length
    );
    const headers = Object.fromEntries(
      Object.entries(request.headers()).filter(
        ([name]) => !['host', 'origin'].includes(name)
      )
    );
    const response = await fetch(
      `${api.baseUrl}${suffix}${requestUrl.search}`,
      {
        method: request.method(),
        headers,
        body: ['GET', 'HEAD'].includes(request.method())
          ? undefined
          : request.postData() || undefined,
      }
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await page.goto('/tests/gis/browser/business-artifacts.html');
  if (!seedRefresh) await expect(page.getByText('暂无业务成果')).toBeVisible();
});

test.afterEach(async () => {
  await api.close();
});

test('B0 creates a card through the real API and restores it after reload', async ({
  page,
}) => {
  await page.getByTestId('create-verification-card').click();
  await expect(
    page.getByRole('heading', { name: 'B0 验证卡片' })
  ).toBeVisible();
  await expect(
    page.getByText(
      '业务成果卡片已通过受控 CardSpec 创建。此卡片不包含业务统计数据。'
    )
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'B0 验证卡片' })
  ).toBeVisible();
  await expect(page.getByText('暂无业务成果')).toHaveCount(0);
});

test('refreshes a persisted card in place and restores the new revision after reload', async ({
  page,
}) => {
  await page.reload();
  const article = page
    .getByRole('heading', { name: '管线概览' })
    .locator('xpath=ancestor::article');
  await expect(article).toBeVisible();
  await expect(article.locator('.metric strong')).toHaveText('708条');
  const refreshRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/refresh')) refreshRequests.push(request.url());
  });
  await article.getByRole('button', { name: '刷新数据' }).click();
  await expect(article.locator('.metric strong')).toHaveText('712条');
  await expect(article.locator('svg.chart rect')).toHaveCount(1);
  await expect(article.locator('tbody tr')).toHaveCount(1);
  await expect(article.getByText('REV 2')).toBeVisible();
  expect(api.cardId).toMatch(/^card_/);
  expect(refreshRequests).toEqual([
    expect.stringContaining(`/cards/${api.cardId}/refresh`),
  ]);
  await expect(article.getByText('数据快照：')).toBeVisible();
  await page.reload();
  const restored = page
    .getByRole('heading', { name: '管线概览' })
    .locator('xpath=ancestor::article');
  await expect(restored.locator('.metric strong')).toHaveText('712条');
  await expect(restored.getByText('REV 2')).toBeVisible();
});

test('renderer keeps bar geometry and labels inside the viewBox for 2, 6, and 100 groups', async ({
  page,
}) => {
  for (const [title, count] of [
    ['bar 2 fixture', 2],
    ['bar 6 fixture', 6],
    ['bar 100 fixture', 100],
  ]) {
    const article = page
      .getByRole('heading', { name: title })
      .locator('xpath=ancestor::article');
    const geometry = await article.locator('svg.chart').evaluate((svg) => {
      const width = Number(svg.getAttribute('viewBox').split(/\s+/)[2]);
      const rects = [...svg.querySelectorAll('rect')].map((rect) => ({
        x: Number(rect.getAttribute('x')),
        width: Number(rect.getAttribute('width')),
      }));
      const labels = [...svg.querySelectorAll('text')].map((text) =>
        Number(text.getAttribute('x'))
      );
      return { width, rects, labels };
    });
    expect(geometry.rects).toHaveLength(count);
    expect(
      geometry.rects.every(
        ({ x, width }) => x >= 0 && x + width <= geometry.width
      )
    ).toBe(true);
    expect(
      geometry.rects.every(
        ({ x, width }, index) =>
          Math.abs(x + width / 2 - geometry.labels[index]) < 0.001
      )
    ).toBe(true);
  }
});

test('renderer isolates chart types, empty data, and unknown-schema card errors', async ({
  page,
}) => {
  const pie = page
    .getByRole('heading', { name: 'pie fixture' })
    .locator('xpath=ancestor::article');
  await expect(pie.locator('svg.pie circle.pie-segment')).toHaveCount(2);
  expect(
    await pie
      .locator('svg.pie circle.pie-segment')
      .evaluateAll(
        (segments) =>
          new Set(segments.map((item) => item.getAttribute('stroke'))).size
      )
  ).toBeGreaterThanOrEqual(2);
  const line = page
    .getByRole('heading', { name: 'line fixture' })
    .locator('xpath=ancestor::article');
  await expect(line.locator('svg.chart polyline')).toHaveCount(1);
  await expect(
    page
      .getByRole('heading', { name: 'empty chart fixture' })
      .locator('xpath=ancestor::article')
      .getByText('暂无可绘制数据')
  ).toBeVisible();

  const fixtures = page
    .getByTestId('renderer-fixtures')
    .locator('.artifact-card');
  await expect(fixtures).toHaveCount(9);
  await expect(fixtures.nth(6).locator('.metric strong')).toHaveText('7条');
  await expect(fixtures.nth(7).locator('tbody tr')).toHaveCount(2);
  await expect(fixtures.nth(8).locator('.card-fault strong')).toHaveText(
    '卡片暂不可用'
  );
  await expect(fixtures.nth(8).locator('table, svg, .metric')).toHaveCount(0);
  await expect(fixtures.nth(0).locator('.card-fault')).toHaveCount(0);
  await expect(fixtures.nth(6).locator('.card-fault')).toHaveCount(0);
});
