import { describe, expect, it } from 'vitest';
import {
  resolveCardBindings,
  validateCardSpec,
} from '../../src/business-artifacts/contracts.js';
import { BUSINESS_CARD_SPEC_JSON_SCHEMA } from '../../src/business-artifacts/cardSpecSchema.js';
import {
  CARD_FIELD_NAME_PATTERN,
  CARD_LAYER_ID_PATTERN,
} from '../../src/business-artifacts/cardSpecContract.js';

const spec = (overrides = {}) => ({
  schemaVersion: 'business-card/v1',
  title: '管线概览',
  description: null,
  layout: { type: 'grid', columns: 2 },
  blocks: [
    {
      id: 'metrics',
      type: 'metric_group',
      items: [
        {
          label: '数量',
          value: { statistics_ref: 'stat-1', path: 'summary.count' },
          unit: '条',
        },
      ],
    },
    {
      id: 'materials',
      type: 'chart',
      chartType: 'bar',
      source: { statistics_ref: 'stat-1', path: 'groups.material' },
      xField: 'key',
      yField: 'count',
    },
    {
      id: 'note',
      type: 'text',
      text: '统计结果来自业务快照。',
    },
    {
      id: 'map',
      type: 'map_action',
      label: '在地图上查看',
      action: {
        kind: 'query_and_highlight',
        layerId: 'geoserver:GX:js_ln',
        filters: [{ field: 'material', op: 'eq', value: 'PE' }],
      },
    },
  ],
  ...overrides,
});

const snapshots = [
  {
    statistics_ref: 'stat-1',
    calculatedAt: '2026-09-09T01:00:00Z',
    data: {
      summary: { count: 12, total_length: 34.5 },
      groups: { material: [{ key: 'PE', count: 8 }] },
    },
  },
];

describe('business card contracts', () => {
  it('keeps model-visible map identifiers aligned with server lexical rules', () => {
    const mapActionSchema =
      BUSINESS_CARD_SPEC_JSON_SCHEMA.properties.blocks.items.oneOf.find(
        (block) => block.properties.type.enum.includes('map_action')
      );
    expect(mapActionSchema.properties.action.properties.layerId.pattern).toBe(
      CARD_LAYER_ID_PATTERN
    );
    expect(
      mapActionSchema.properties.action.properties.filters.items.properties
        .field.pattern
    ).toBe(CARD_FIELD_NAME_PATTERN);
    expect(() =>
      validateCardSpec(
        spec({
          blocks: [
            {
              id: 'map',
              type: 'map_action',
              label: '查看',
              action: {
                kind: 'query_and_highlight',
                layerId: 'https://example.com/layer',
                filters: [{ field: 'bad field', op: 'eq', value: 'x' }],
              },
            },
          ],
        })
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CARD_SPEC' }));
  });

  it('validates and clones a CardSpec', () => {
    const input = spec();
    const result = validateCardSpec(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.blocks).not.toBe(input.blocks);
  });

  it.each([
    ['unknown root fields', { html: '<script>alert(1)</script>' }],
    [
      'unknown block fields',
      { blocks: [{ id: 'x', type: 'text', text: 'ok', component: 'x' }] },
    ],
    ['HTML text', { blocks: [{ id: 'x', type: 'text', text: '<b>bad</b>' }] }],
    [
      'literal metric value',
      {
        blocks: [
          {
            id: 'x',
            type: 'metric_group',
            items: [{ label: '数量', value: 3, unit: '条' }],
          },
        ],
      },
    ],
  ])('rejects %s', (_, overrides) => {
    expect(() => validateCardSpec(spec(overrides))).toThrowError(
      expect.objectContaining({ code: 'INVALID_CARD_SPEC' })
    );
  });

  it('resolves authoritative metric and series bindings', () => {
    const result = resolveCardBindings(spec(), snapshots);
    expect(result.blocks[0].items[0].value).toBe(12);
    expect(result.blocks[1].data).toEqual([{ key: 'PE', count: 8 }]);
    expect(result.blocks[1].source).toEqual({
      statistics_ref: 'stat-1',
      path: 'groups.material',
    });
    expect(result).not.toBe(spec());
  });

  it.each([[{ key: 'PE', count: 8 }], []])(
    'rejects chart yField=key regardless of row count',
    (rows) => {
      const invalid = spec({
        blocks: spec().blocks.map((block) =>
          block.type === 'chart' ? { ...block, yField: 'key' } : block
        ),
      });
      const values = [
        {
          ...snapshots[0],
          data: { ...snapshots[0].data, groups: { material: rows } },
        },
      ];
      expect(() => resolveCardBindings(invalid, values)).toThrowError(
        expect.objectContaining({ code: 'INVALID_CARD_SPEC' })
      );
    }
  );

  it.each([
    ['missing ref', [{ ...snapshots[0], statistics_ref: 'other' }]],
    ['missing path', [{ ...snapshots[0], data: { summary: {}, groups: {} } }]],
    [
      'wrong metric type',
      [
        {
          ...snapshots[0],
          data: { summary: { count: '12' }, groups: { material: [] } },
        },
      ],
    ],
  ])('rejects %s during binding resolution', (_, values) => {
    expect(() => resolveCardBindings(spec(), values)).toThrowError(
      expect.objectContaining({ code: 'CARD_BINDING_INVALID' })
    );
  });

  it('rejects negative authoritative statistics', () => {
    const values = [
      {
        ...snapshots[0],
        data: {
          ...snapshots[0].data,
          summary: { count: -1, total_length: 34.5 },
        },
      },
    ];
    expect(() => resolveCardBindings(spec(), values)).toThrowError(
      expect.objectContaining({ code: 'CARD_BINDING_INVALID' })
    );
  });
});
