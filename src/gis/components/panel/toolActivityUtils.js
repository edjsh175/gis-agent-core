/**
 * Pure functions to project runtime state (receipts, messages) into user-facing Tool Timeline activities.
 * Single Source of Truth: No private activity state.
 */

const TOOL_META = {
  import_vector_dataset: {
    label: '导入矢量图层',
    describe: (_effect, data) => data?.name ? `图层: ${data.name} (${data.featureCount ?? 0} 个要素)` : '已成功加载矢量图层',
  },
  set_vector_style: {
    label: '设置图层样式',
    describe: (_effect, data) => {
      const s = data?.style;
      if (!s) return '样式已更新';
      const parts = [];
      if (s.stroke?.color) parts.push(`描边: ${s.stroke.color}`);
      if (s.stroke?.width != null) parts.push(`宽度: ${s.stroke.width}px`);
      if (s.fill?.color) parts.push(`填充: ${s.fill.color}`);
      return parts.join(' | ') || '样式已应用';
    },
  },
  fit_vector_layer: {
    label: '视口缩放到图层',
    describe: () => '视口已调整至图层范围',
  },
  set_user_layer_visibility: { label: '设置用户图层显隐', describe: (_effect, data) => data?.visible ? '图层已显示' : '图层已隐藏' },
  set_layer_visibility: { label: '设置图层显隐', describe: (_effect, data) => data?.visible ? '图层已显示' : '图层已隐藏' },
  clear_highlight: { label: '清除高亮', describe: () => '高亮已清除' },
  locate_features: {
    label: '定位目标要素',
    describe: () => '地图中心已聚焦到目标位置',
  },
  highlight_features: {
    label: '高亮目标要素',
    describe: () => '要素已应用高亮强调样式',
  },
};

export function projectToolActivities(receipts = [], currentToolCall = null) {
  const activities = [];

  for (const receipt of receipts) {
    const name = receipt.result?.toolName || receipt.toolCallName || receipt.result?.effect?.kind || receipt.toolCallId || 'gis_tool';
    const meta = TOOL_META[name] || { label: name, describe: () => '执行完成' };
    const ok = receipt.result?.ok !== false && receipt.result?.effect?.status === 'applied';
    activities.push({
      id: receipt.toolCallId || receipt.runId,
      name,
      label: meta.label,
      status: ok ? 'applied' : 'failed',
      details: ok ? meta.describe(receipt.result?.effect, receipt.result?.data) : '',
      errorMessage: !ok ? (receipt.result?.error?.message || '工具执行失败') : null,
    });
  }

  if (currentToolCall) {
    const meta = TOOL_META[currentToolCall.name] || { label: currentToolCall.name, describe: () => '正在执行...' };
    activities.push({
      id: currentToolCall.toolCallId,
      name: currentToolCall.name,
      label: meta.label,
      status: 'running',
      details: '正在操作地图...',
      errorMessage: null,
    });
  }

  return activities;
}
