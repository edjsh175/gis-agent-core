import { describe, expect, it } from 'vitest';
import { projectToolActivities } from '../../src/gis/components/panel/toolActivityUtils.js';

describe('projectToolActivities', () => {
  it('projects applied receipts into timeline activities', () => {
    const receipts = [
      {
        toolCallId: 'call-1',
        toolCallName: 'import_vector_dataset',
        result: {
          ok: true,
          effect: { status: 'applied', kind: 'import' },
          data: { name: 'ul_roads', featureCount: 12 },
        },
      },
      {
        toolCallId: 'call-2',
        toolCallName: 'set_vector_style',
        result: {
          ok: true,
          effect: { status: 'applied', kind: 'style' },
          data: { style: { stroke: { color: '#ff0000', width: 4 } } },
        },
      },
    ];
    const activities = projectToolActivities(receipts);
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({
      name: 'import_vector_dataset',
      label: '导入矢量图层',
      status: 'applied',
      details: '图层: ul_roads (12 个要素)',
    });
    expect(activities[1]).toMatchObject({
      name: 'set_vector_style',
      label: '设置图层样式',
      status: 'applied',
    });
  });

  it('projects in-flight running tool call into active activity', () => {
    const activities = projectToolActivities([], {
      toolCallId: 'call-3',
      name: 'fit_vector_layer',
    });
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      name: 'fit_vector_layer',
      status: 'running',
    });
  });
});
