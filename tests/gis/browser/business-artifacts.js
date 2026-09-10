import { createApp, h } from 'vue';
import BusinessCardBoard from '../../../src/business-artifacts/components/BusinessCardBoard.vue';
import BusinessCardRenderer from '../../../src/business-artifacts/components/BusinessCardRenderer.vue';
import { getBusinessCardApplication } from '../../../src/business-artifacts/runtime.js';

const groups = (count) =>
  Array.from({ length: count }, (_, index) => ({
    key: `分组${index + 1}`,
    count: (index % 9) + 1,
  }));
const snapshot = {
  statistics_ref: 'fixture-statistics',
  schemaVersion: 'statistics/v1',
  dataset: 'fixture-dataset',
  calculatedAt: '2026-01-01T00:00:00.000Z',
  scope: { workspaceId: 'browser-test-workspace' },
  query: {},
  data: {
    summary: { count: 7, total_length: 12.5 },
    groups: { material: groups(2) },
  },
  schema: {},
};

const snapshotFor = (statistics_ref, rows) => ({
  ...snapshot,
  statistics_ref,
  data: { ...snapshot.data, groups: { material: rows } },
});
const chartCard = (cardId, title, chartType, statistics_ref, rows) =>
  card(
    cardId,
    title,
    [
      {
        id: cardId,
        type: 'chart',
        chartType,
        source: { statistics_ref, path: 'groups.material' },
        xField: 'key',
        yField: 'count',
      },
    ],
    statistics_ref
  );
const card = (
  cardId,
  title,
  blocks,
  statistics_ref = 'fixture-statistics'
) => ({
  cardId,
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  statisticsRefs: [statistics_ref],
  spec: {
    schemaVersion: 'business-card/v1',
    title,
    description: null,
    layout: { type: 'stack', columns: 1 },
    blocks,
  },
});

const fixtureCards = [
  chartCard(
    'fixture-bar-2',
    'bar 2 fixture',
    'bar',
    'fixture-statistics',
    groups(2)
  ),
  chartCard(
    'fixture-bar-6',
    'bar 6 fixture',
    'bar',
    'fixture-statistics-6',
    groups(6)
  ),
  chartCard(
    'fixture-bar-100',
    'bar 100 fixture',
    'bar',
    'fixture-statistics-100',
    groups(100)
  ),
  chartCard(
    'fixture-pie',
    'pie fixture',
    'pie',
    'fixture-statistics',
    groups(2)
  ),
  chartCard(
    'fixture-line',
    'line fixture',
    'line',
    'fixture-statistics',
    groups(2)
  ),
  chartCard(
    'fixture-empty',
    'empty chart fixture',
    'bar',
    'fixture-statistics-empty',
    []
  ),
  card('fixture-metric', '指标 fixture', [
    {
      id: 'metric',
      type: 'metric_group',
      items: [
        {
          label: '总数',
          value: {
            statistics_ref: 'fixture-statistics',
            path: 'summary.count',
          },
          unit: '条',
        },
      ],
    },
  ]),
  card('fixture-table', '表格 fixture', [
    {
      id: 'table',
      type: 'table',
      source: { statistics_ref: 'fixture-statistics', path: 'groups.material' },
      columns: [
        { field: 'key', label: '材质' },
        { field: 'count', label: '数量' },
      ],
    },
  ]),
  {
    cardId: 'fixture-invalid',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    statisticsRefs: [],
    spec: { schemaVersion: 'business-card/v999', title: '未知 schema' },
  },
];

const snapshots = [
  snapshot,
  snapshotFor('fixture-statistics-6', groups(6)),
  snapshotFor('fixture-statistics-100', groups(100)),
  snapshotFor('fixture-statistics-empty', []),
];

const verificationSpec = {
  schemaVersion: 'business-card/v1',
  title: 'B0 验证卡片',
  description: '用于验证业务成果持久化与页面恢复的文本卡片。',
  layout: { type: 'stack', columns: 1 },
  blocks: [
    {
      id: 'verification-text',
      type: 'text',
      text: '业务成果卡片已通过受控 CardSpec 创建。此卡片不包含业务统计数据。',
    },
  ],
};
const application = getBusinessCardApplication();

const app = createApp({
  render: () =>
    h('div', [
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'create-verification-card',
          onClick: () => application.create(verificationSpec),
        },
        '创建测试卡片'
      ),
      h(BusinessCardBoard),
      h(
        'section',
        { 'data-testid': 'renderer-fixtures' },
        fixtureCards.map((item) =>
          h(BusinessCardRenderer, { card: item, snapshots })
        )
      ),
    ]),
});
app.mount('#app');

window.businessArtifactsFixture = { fixtureCards, snapshots };
