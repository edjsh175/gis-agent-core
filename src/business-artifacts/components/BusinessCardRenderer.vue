<script setup>
import { computed, reactive } from 'vue';
import { resolveCardBindings, validateCardSpec } from '../contracts.js';
import ChartBlock from './blocks/ChartBlock.vue';

const props = defineProps({
  card: { type: Object, required: true },
  snapshots: { type: Array, default: () => [] },
  executeMapAction: { type: Function, default: undefined },
  onRefresh: { type: Function, default: undefined },
  refreshState: {
    type: Object,
    default: () => ({ status: 'idle', message: '' }),
  },
});
const mapActionStates = reactive({});
const spec = computed(() => props.card?.spec);
const validation = computed(() => {
  try {
    return { ok: true, spec: validateCardSpec(spec.value) };
  } catch (error) {
    return { ok: false, error };
  }
});
const bindings = computed(() => {
  if (!validation.value?.ok) return null;
  try {
    return resolveCardBindings(spec.value, props.snapshots);
  } catch (error) {
    return { error };
  }
});
const invalid = computed(() => !validation.value?.ok || bindings.value?.error);
const valueFor = (block, index) => {
  const binding = bindings.value?.blocks?.[index] || block;
  return { ...binding, rows: binding.rows || binding.data || [] };
};
const cardSnapshots = computed(() =>
  props.snapshots.filter((snapshot) =>
    (props.card.statisticsRefs || []).includes(snapshot.statistics_ref)
  )
);
const snapshotDate = computed(() => {
  const dates = cardSnapshots.value
    .map((snapshot) => snapshot.calculatedAt)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.valueOf()));
  if (!dates.length) return null;
  const first = new Date(Math.min(...dates));
  const last = new Date(Math.max(...dates));
  return first.valueOf() === last.valueOf()
    ? date(first)
    : `${date(first)} – ${date(last)}`;
});
const date = (value) => (value ? new Date(value).toLocaleString() : '未记录');
const formatNumber = (value) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
    : value;

const mapActionState = (block) =>
  mapActionStates[block.id] || {
    status: 'idle',
    message: '点击后重新查询并高亮当前地图要素',
  };

async function runMapAction(block) {
  if (typeof props.executeMapAction !== 'function') return;
  mapActionStates[block.id] = { status: 'running', message: '正在查询并高亮…' };
  try {
    const result = await props.executeMapAction(block.action);
    if (result?.ok) {
      const count = result.data?.featureCount ?? 0;
      mapActionStates[block.id] = {
        status: 'success',
        message: `已高亮 ${count} 个要素${result.data?.truncated ? '（结果已截断）' : ''}`,
      };
    } else {
      mapActionStates[block.id] = {
        status: 'error',
        message: result?.error?.message || '地图动作执行失败',
      };
    }
  } catch (error) {
    mapActionStates[block.id] = {
      status: 'error',
      message: error?.message || '地图动作执行失败',
    };
  }
}
</script>

<template>
  <article class="artifact-card" :class="{ 'is-invalid': invalid }">
    <template v-if="invalid">
      <div class="card-fault">
        <span class="fault-mark">!</span>
        <div>
          <strong>卡片暂不可用</strong><small>数据绑定或卡片结构校验失败</small>
        </div>
      </div>
    </template>
    <template v-else>
      <header class="card-head">
        <div>
          <span class="eyebrow">BUSINESS ARTIFACT</span>
          <h3>{{ spec.title }}</h3>
          <p v-if="spec.description">{{ spec.description }}</p>
        </div>
        <span class="revision">REV {{ card.revision ?? '—' }}</span>
      </header>
      <div
        class="card-grid"
        :class="
          spec.layout?.type === 'grid'
            ? `columns-${spec.layout?.columns || 1}`
            : 'stack-layout'
        "
      >
        <section
          v-for="(block, index) in spec.blocks"
          :key="block.id"
          class="card-block"
        >
          <template v-if="block.type === 'metric_group'"
            ><div class="block-label">指标摘要</div>
            <div class="metrics">
              <div
                v-for="item in valueFor(block, index).items"
                :key="item.label"
                class="metric"
              >
                <span>{{ item.label }}</span
                ><strong
                  >{{ formatNumber(item.value)
                  }}<small>{{ item.unit }}</small></strong
                >
              </div>
            </div></template
          >
          <template v-else-if="block.type === 'text'"
            ><div class="block-label">备注</div>
            <p class="text-block">{{ block.text }}</p></template
          >
          <ChartBlock
            v-else-if="block.type === 'chart'"
            :block="block"
            :binding="valueFor(block, index)"
          />
          <template v-else-if="block.type === 'table'"
            ><div class="block-label">明细</div>
            <table>
              <thead>
                <tr>
                  <th v-for="column in block.columns" :key="column.field">
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in valueFor(block, index).rows"
                  :key="JSON.stringify(row)"
                >
                  <td v-for="column in block.columns" :key="column.field">
                    {{ row[column.field] }}
                  </td>
                </tr>
              </tbody>
            </table></template
          >
          <template v-else-if="block.type === 'map_action'"
            ><div class="block-label">地图动作</div>
            <button
              class="map-action"
              :class="`is-${mapActionState(block).status}`"
              type="button"
              :disabled="
                typeof props.executeMapAction !== 'function' ||
                mapActionState(block).status === 'running'
              "
              @click="runMapAction(block)"
            >
              {{ block.label }}<span>{{ mapActionState(block).message }}</span>
            </button></template
          >
        </section>
      </div>
      <footer class="card-meta">
        <span>创建于 {{ date(card.createdAt) }}</span
        ><span>数据快照：{{ snapshotDate || '未记录' }}</span>
        <span
          v-if="props.refreshState?.message"
          class="refresh-message"
          :class="`is-${props.refreshState.status}`"
        >
          {{ props.refreshState.message }}
        </span>
        <button
          v-if="props.onRefresh && (card.statisticsRefs || []).length"
          class="refresh-btn"
          type="button"
          :disabled="props.refreshState?.status === 'running'"
          @click="props.onRefresh(card.cardId, card.revision).catch(() => {})"
        >
          {{
            props.refreshState?.status === 'running' ? '刷新中…' : '刷新数据'
          }}
        </button>
      </footer>
    </template>
  </article>
</template>

<style scoped>
.artifact-card {
  background: linear-gradient(
    145deg,
    rgba(13, 29, 42, 0.97),
    rgba(9, 19, 29, 0.97)
  );
  border: 1px solid rgba(73, 198, 213, 0.25);
  border-radius: 10px;
  box-shadow: 0 14px 32px #02080dcc;
  color: #d5e8ed;
  overflow: hidden;
}
.card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 17px 12px;
  border-bottom: 1px solid #2a4956;
}
.eyebrow,
.block-label {
  color: #62d7df;
  font:
    10px/1.2 ui-monospace,
    monospace;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.card-head h3 {
  margin: 6px 0 3px;
  color: #effcff;
  font-size: 17px;
}
.card-head p,
.card-meta,
.text-block {
  color: #91adb5;
  font-size: 12px;
  margin: 0;
}
.revision {
  color: #6f929d;
  font:
    10px ui-monospace,
    monospace;
}
.card-grid {
  display: grid;
  gap: 9px;
  padding: 12px;
}
.columns-2,
.columns-3 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.card-block {
  background: rgba(21, 45, 58, 0.55);
  border: 1px solid rgba(101, 181, 193, 0.11);
  border-radius: 7px;
  padding: 10px;
  min-width: 0;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 8px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.metric span {
  font-size: 11px;
  color: #91adb5;
}
.metric strong {
  font-size: 22px;
  color: #f3fdff;
}
.metric small {
  font-size: 11px;
  color: #65cbd3;
  margin-left: 4px;
}
.text-block {
  line-height: 1.55;
  margin-top: 8px;
}
.chart {
  width: 100%;
  height: 100px;
  margin-top: 5px;
}
.chart line {
  stroke: #47717b;
}
.chart rect {
  fill: #42cbd1;
}
.chart text {
  fill: #9ab6bc;
  font-size: 9px;
  text-anchor: middle;
}
.card-meta {
  display: flex;
  justify-content: space-between;
  padding: 9px 14px;
  background: rgba(3, 11, 18, 0.35);
  font-size: 10px;
}
.refresh-btn {
  margin-left: auto;
  padding: 4px 7px;
  border: 1px solid #3c929b;
  border-radius: 4px;
  background: #123b46;
  color: #bceff2;
  font-size: 10px;
  cursor: pointer;
}
.refresh-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}
.refresh-message {
  color: #7fb8a5;
}
.refresh-message.is-error {
  color: #d49c9c;
}
.refresh-message.is-conflict {
  color: #e0c28c;
}
.card-fault {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  color: #ffc0ad;
}
.card-fault small {
  display: block;
  color: #ad8581;
  margin-top: 4px;
}
.fault-mark {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid #cb725f;
  border-radius: 50%;
  font-weight: bold;
}
.map-action {
  width: 100%;
  padding: 9px;
  background: #173845;
  border: 1px solid #3d8f9a;
  border-radius: 5px;
  color: #c4fbff;
  text-align: left;
}
.map-action:not(:disabled) {
  cursor: pointer;
}
.map-action:disabled {
  opacity: 0.75;
  cursor: not-allowed;
}
.map-action.is-success {
  border-color: #5ba58f;
}
.map-action.is-error {
  border-color: #cb725f;
}
.map-action span {
  display: block;
  color: #79a4ad;
  font-size: 10px;
  margin-top: 4px;
}
table {
  width: 100%;
  margin-top: 7px;
  border-collapse: collapse;
  font-size: 11px;
}
th,
td {
  padding: 5px;
  border-bottom: 1px solid #294753;
  text-align: left;
}
th {
  color: #83cbd0;
  font-weight: 500;
}
/* Keep the requested grid width on desktop and collapse on narrow screens. */
.columns-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.columns-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.chart polyline {
  fill: none;
  stroke: #42cbd1;
  stroke-width: 2;
}
@media (max-width: 700px) {
  .columns-2,
  .columns-3 {
    grid-template-columns: 1fr;
  }
}
</style>
