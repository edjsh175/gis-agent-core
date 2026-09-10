import { test, expect } from '@playwright/test';

test('a new instruction captures the replacement map while retaining its conversation', async ({
  page,
}) => {
  await page.goto('/tests/gis/browser/agui.html?backend=harness');
  await page.waitForFunction(
    () => window.aguiTest?.gis.runtime.getState().ready
  );
  expect((await page.evaluate(() => window.aguiTest.start())).ok).toBe(true);
  const result = await page.evaluate(async () => {
    const { gis, map } = window.aguiTest;
    const threadId = window.aguiTest.state.value.session.threadId;
    gis.runtime.detachMap(map);
    gis.runtime.attachMap(map);
    const result = await window.aguiTest.send('请说明当前地图状态');
    return {
      result,
      threadId,
      currentThreadId: window.aguiTest.state.value.session.threadId,
    };
  });
  expect(result.result.ok, JSON.stringify(result.result)).toBe(true);
  expect(result.currentThreadId).toBe(result.threadId);
  await expect(page.getByTestId('status')).toHaveText('completed');
});

test('Agent → statistics → persisted card → browser effect → continuation', async ({
  page,
}) => {
  await page.goto('/tests/gis/browser/agui.html?backend=harness');
  await page.waitForFunction(
    () => window.aguiTest?.gis.runtime.getState().ready
  );

  const result = await page.evaluate(() => window.aguiTest.start('business'));
  expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
  await expect(page.getByTestId('status')).toHaveText('completed');

  const state = await page.evaluate(async () => {
    const workflowState = window.aguiTest.state.value;
    const cards = await (await fetch('/__business-artifacts/cards')).json();
    return {
      receipts: workflowState.receipts,
      messages: workflowState.messages,
      cards,
    };
  });
  const realLlm = process.env.GIS_HARNESS_REAL_LLM === '1';
  expect(state.receipts.length).toBeGreaterThanOrEqual(1);
  const presentation = state.receipts.find(
    (item) => item.toolCallName === 'present_business_card'
  );
  expect(presentation).toMatchObject({
    toolCallName: 'present_business_card',
    delivered: true,
    result: {
      ok: true,
      effect: { status: 'applied', kind: 'business_card_present' },
    },
  });
  expect(state.cards.cards.length).toBeGreaterThanOrEqual(1);
  expect(state.cards.cards[0]).toMatchObject({
    schemaVersion: 'business-card/v1',
    revision: 1,
    status: 'active',
  });
  if (realLlm) {
    expect(state.cards.snapshots[0].data.summary.count).toBeGreaterThan(0);
    expect(state.cards.snapshots[0].data.summary.total_length).toBeGreaterThan(
      0
    );
  } else {
    expect(state.cards.snapshots[0].data.summary).toEqual({
      count: 12,
      total_length: 42.5,
    });
    expect(state.messages.at(-1).content).toContain(
      '已根据真实统计快照创建并展示'
    );
  }
  const cardTitle = state.cards.cards[0].spec.title;
  await expect(page.getByRole('heading', { name: cardTitle })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: cardTitle })).toBeVisible();
  if (!realLlm) await expect(page.getByText('12条')).toBeVisible();

  // Reload discards the original conversation; lookup must use persisted cards.
  const refreshed = await page.evaluate(() =>
    window.aguiTest.send('把昨天的管线业务概览刷新一下')
  );
  expect(refreshed.ok, JSON.stringify(refreshed)).toBe(true);
  const afterRefresh = await page.evaluate(async () => ({
    payload: await (await fetch('/__business-artifacts/cards')).json(),
    receipts: window.aguiTest.state.value.receipts,
    messages: window.aguiTest.state.value.messages,
  }));
  const original = state.cards.cards[0];
  const updated = afterRefresh.payload.cards.find(
    (card) => card.cardId === original.cardId
  );
  expect(updated.revision).toBe(2);
  expect(updated.statisticsRefs).not.toEqual(original.statisticsRefs);
  expect(afterRefresh.payload.cards).toHaveLength(state.cards.cards.length);
  expect(afterRefresh.receipts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toolCallName: 'present_business_card',
        result: expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            cardId: original.cardId,
            revision: 2,
          }),
          effect: expect.objectContaining({ status: 'applied' }),
        }),
      }),
    ])
  );
  const article = page
    .getByRole('heading', { name: cardTitle })
    .locator('xpath=ancestor::article');
  await expect(article.getByText('REV 2')).toBeVisible();
  await page.reload();
  await expect(article.getByText('REV 2')).toBeVisible();

  if (!realLlm) {
    const beforeUpdateSnapshotRefs = updated.statisticsRefs;
    const modified = await page.evaluate(() =>
      window.aguiTest.send('把管线业务概览的图表换成饼图，不要重新刷新统计数据')
    );
    expect(modified.ok, JSON.stringify(modified)).toBe(true);
    const afterUpdate = await page.evaluate(async () => ({
      payload: await (await fetch('/__business-artifacts/cards')).json(),
      messages: window.aguiTest.state.value.messages,
    }));
    const evolved = afterUpdate.payload.cards.find(
      (card) => card.cardId === updated.cardId
    );
    expect(evolved.cardId).toBe(updated.cardId);
    expect(evolved.revision).toBe(3);
    expect(evolved.statisticsRefs).toEqual(beforeUpdateSnapshotRefs);
    expect(
      evolved.spec.blocks.find((block) => block.type === 'chart')?.chartType
    ).toBe('pie');
    expect(afterUpdate.messages.at(-1).content).toContain(
      '已修改并更新当前页面'
    );
    await expect(article.getByText('REV 3')).toBeVisible();
    await page.reload();
    await expect(article.getByText('REV 3')).toBeVisible();

    const duplicate = await page.evaluate(async (spec) => {
      const response = await fetch('/__business-artifacts/cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec }),
      });
      return response.status;
    }, updated.spec);
    expect(duplicate).toBe(200);
    const ambiguous = await page.evaluate(() =>
      window.aguiTest.send('把昨天的管线业务概览刷新一下')
    );
    expect(ambiguous.ok, JSON.stringify(ambiguous)).toBe(true);
    const unchanged = await page.evaluate(async () => ({
      payload: await (await fetch('/__business-artifacts/cards')).json(),
      messages: window.aguiTest.state.value.messages,
    }));
    expect(unchanged.payload.cards.map((card) => card.revision).sort()).toEqual(
      [1, 3]
    );
    expect(unchanged.messages.at(-1).content).toMatch(/哪|同名|明确|多张/);

    const ambiguousUpdate = await page.evaluate(() =>
      window.aguiTest.send('把管线业务概览的图表换成饼图')
    );
    expect(ambiguousUpdate.ok, JSON.stringify(ambiguousUpdate)).toBe(true);
    const afterAmbiguousUpdate = await page.evaluate(async () => ({
      payload: await (await fetch('/__business-artifacts/cards')).json(),
      messages: window.aguiTest.state.value.messages,
    }));
    expect(
      afterAmbiguousUpdate.payload.cards.map((card) => card.revision).sort()
    ).toEqual([1, 3]);
    expect(afterAmbiguousUpdate.messages.at(-1).content).toMatch(
      /哪|同名|明确|多张/
    );
  }
});

test('Agent archives then permanently deletes the same persisted business card', async ({
  page,
}) => {
  test.skip(process.env.GIS_HARNESS_REAL_LLM === '1');
  await page.goto('/tests/gis/browser/agui.html?backend=harness');
  await page.waitForFunction(
    () => window.aguiTest?.gis.runtime.getState().ready
  );

  const created = await page.evaluate(async () => {
    const response = await fetch('/__business-artifacts/cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        spec: {
          schemaVersion: 'business-card/v1',
          title: '管线归档测试',
          layout: { type: 'stack', columns: 1 },
          blocks: [{ id: 'note', type: 'text', text: 'lifecycle' }],
        },
      }),
    });
    return response.json();
  });
  const cardId = created.card.cardId;
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '管线归档测试' })
  ).toBeVisible();

  const archived = await page.evaluate(() =>
    window.aguiTest.send('归档管线归档测试卡片')
  );
  expect(archived.ok, JSON.stringify(archived)).toBe(true);
  await expect(page.getByRole('heading', { name: '管线归档测试' })).toHaveCount(
    0
  );
  const afterArchive = await page.evaluate(async () => ({
    active: await (await fetch('/__business-artifacts/cards')).json(),
    all: await (
      await fetch('/__business-artifacts/cards?includeArchived=1')
    ).json(),
  }));
  expect(
    afterArchive.active.cards.find((card) => card.cardId === cardId)
  ).toBeUndefined();
  expect(
    afterArchive.all.cards.find((card) => card.cardId === cardId)
  ).toMatchObject({
    status: 'archived',
    revision: 2,
  });

  const deleted = await page.evaluate(() =>
    window.aguiTest.send('彻底删除管线归档测试卡片')
  );
  expect(deleted.ok, JSON.stringify(deleted)).toBe(true);
  const afterDelete = await page.evaluate(async () => ({
    all: await (
      await fetch('/__business-artifacts/cards?includeArchived=1')
    ).json(),
  }));
  expect(
    afterDelete.all.cards.find((card) => card.cardId === cardId)
  ).toBeUndefined();
  expect(
    await page.evaluate(
      async (id) => (await fetch(`/__business-artifacts/cards/${id}`)).status,
      cardId
    )
  ).toBe(404);
});

test('persisted card map action re-queries GIS capability then highlights and locates', async ({
  page,
}) => {
  await page.goto('/tests/gis/browser/agui.html?backend=harness');
  await page.waitForFunction(
    () => window.aguiTest?.gis.runtime.getState().ready
  );

  const created = await page.evaluate(async () => {
    const response = await fetch('/__business-artifacts/cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        spec: {
          schemaVersion: 'business-card/v1',
          title: '管线地图联动',
          layout: { type: 'stack', columns: 1 },
          blocks: [
            {
              id: 'highlight-cast-iron',
              type: 'map_action',
              label: '查看铸铁管线',
              action: {
                kind: 'query_and_highlight',
                layerId: 'geoserver:GX:js_ln',
                filters: [{ field: 'material', op: 'eq', value: '铸铁' }],
              },
            },
          ],
        },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);

  await page.reload();
  await page.waitForFunction(
    () => window.aguiTest?.gis.runtime.getState().ready
  );
  await expect(
    page.getByRole('heading', { name: '管线地图联动' })
  ).toBeVisible();
  await page.getByRole('button', { name: /查看铸铁管线/ }).click();
  await expect(page.getByText('已高亮 1 个要素')).toBeVisible();

  const effect = await page.evaluate(() => ({
    highlighted: window.aguiTest.manager.getHighlightSource().getFeatures()
      .length,
    center: window.aguiTest.map.getView().getCenter(),
  }));
  expect(effect.highlighted).toBe(1);
  expect(effect.center[0]).toBeCloseTo(104.025, 3);
  expect(effect.center[1]).toBeCloseTo(30.025, 3);
});

test('browser → Harness AgentLoop → GIS tools → OpenLayers → continuation', async ({
  page,
}) => {
  await page.goto('/tests/gis/browser/agui.html?backend=harness');
  await page.waitForFunction(
    () => window.aguiTest?.gis.runtime.getState().ready
  );

  const result = await page.evaluate(() => window.aguiTest.start());
  expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
  await expect(page.getByTestId('status')).toHaveText('completed');

  const state = await page.evaluate(() => {
    const workflowState = window.aguiTest.state.value;
    const userLayer = window.aguiTest.map
      .getAllLayers()
      .find((item) => item.get('gisUserLayerRef') === 'ul_roads');
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
  expect(
    state.layerMissing,
    JSON.stringify(
      {
        receipts: state.receipts,
        messages: state.messages,
        context: state.context,
      },
      null,
      2
    )
  ).not.toBe(true);
  const realLlm = process.env.GIS_HARNESS_REAL_LLM === '1';
  if (realLlm) expect(state.receipts.length).toBeGreaterThanOrEqual(3);
  else expect(state.receipts).toHaveLength(3);
  expect(
    state.receipts.every((item) => item.result.effect.status === 'applied')
  ).toBe(true);
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
