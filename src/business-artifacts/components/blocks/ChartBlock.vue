<script setup>
import { computed } from 'vue';

const props = defineProps({
  block: { type: Object, required: true },
  binding: { type: Object, required: true },
});
const rows = computed(() => props.binding.data);
const maximum = computed(() =>
  Math.max(0, ...rows.value.map((row) => row[props.block.yField]))
);
const plotWidth = computed(() => Math.max(240, rows.value.length * 48 + 24));
const slotWidth = computed(
  () => (plotWidth.value - 24) / Math.max(1, rows.value.length)
);
const x = (index) => 12 + slotWidth.value * (index + 0.5);
const height = (row) =>
  maximum.value ? (row[props.block.yField] / maximum.value) * 64 : 0;
const points = computed(() =>
  rows.value.map((row, index) => `${x(index)},${78 - height(row)}`).join(' ')
);
const formatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const colors = [
  '#42cbd1',
  '#f0b95a',
  '#8ca6f1',
  '#e98d9e',
  '#94ce8c',
  '#c598d9',
];
const color = (index) => colors[index % colors.length];
const circumference = 2 * Math.PI * 30;
// Normalize first so summing large finite statistics cannot overflow.
const segments = computed(() => {
  if (!maximum.value) return [];
  const weights = rows.value.map(
    (row) => row[props.block.yField] / maximum.value
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  let offset = 0;
  return weights.map((weight) => {
    const length = (weight / total) * circumference;
    const segment = { length, offset: -offset };
    offset += length;
    return segment;
  });
});
</script>

<template>
  <div class="chart-block">
    <div class="block-label">
      {{
        { bar: '分组数量', line: '分组趋势', pie: '构成比例' }[block.chartType]
      }}
    </div>
    <div v-if="!rows.length || maximum === 0" class="chart-empty">
      暂无可绘制数据
    </div>
    <div v-else-if="block.chartType !== 'pie'" class="plot-scroll">
      <svg
        class="chart"
        :viewBox="`0 0 ${plotWidth} 104`"
        :style="{ minWidth: `${plotWidth}px` }"
        role="img"
        aria-label="统计图表"
      >
        <line x1="12" y1="78" :x2="plotWidth - 12" y2="78" />
        <template v-if="block.chartType === 'bar'">
          <rect
            v-for="(row, index) in rows"
            :key="index"
            :x="x(index) - 12"
            :y="78 - height(row)"
            width="24"
            :height="height(row)"
            rx="2"
          >
            <title>
              {{ row[block.xField] }}：{{ formatter.format(row[block.yField]) }}
            </title>
          </rect>
        </template>
        <template v-else>
          <polyline :points="points" />
          <circle
            v-for="(row, index) in rows"
            :key="index"
            :cx="x(index)"
            :cy="78 - height(row)"
            r="3"
          >
            <title>
              {{ row[block.xField] }}：{{ formatter.format(row[block.yField]) }}
            </title>
          </circle>
        </template>
        <text v-for="(row, index) in rows" :key="index" :x="x(index)" y="96">
          <title>{{ row[block.xField] }}</title>
          {{ String(row[block.xField]).slice(0, 5) }}
        </text>
      </svg>
    </div>
    <div v-else class="pie-wrap">
      <svg class="pie" viewBox="0 0 80 80" role="img" aria-label="统计饼图">
        <circle cx="40" cy="40" r="30" class="pie-track" />
        <circle
          v-for="(segment, index) in segments"
          :key="index"
          cx="40"
          cy="40"
          r="30"
          class="pie-segment"
          :stroke="color(index)"
          :stroke-dasharray="`${segment.length} ${circumference}`"
          :stroke-dashoffset="segment.offset"
        >
          <title>
            {{ rows[index][block.xField] }}：{{
              formatter.format(rows[index][block.yField])
            }}
          </title>
        </circle>
      </svg>
      <ul class="legend">
        <li v-for="(row, index) in rows" :key="index">
          <i :style="{ backgroundColor: color(index) }"></i
          >{{ row[block.xField] }}
          <strong>{{ formatter.format(row[block.yField]) }}</strong>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.block-label {
  color: #62d7df;
  font-size: 11px;
  letter-spacing: 0.08em;
}
.plot-scroll {
  overflow-x: auto;
}
.chart {
  display: block;
  width: 100%;
  height: 120px;
  margin-top: 5px;
}
.chart line {
  stroke: #47717b;
}
.chart rect,
.chart circle {
  fill: #42cbd1;
}
.chart polyline {
  fill: none;
  stroke: #42cbd1;
  stroke-width: 2;
}
.chart text {
  fill: #9ab6bc;
  font-size: 10px;
  text-anchor: middle;
}
.chart-empty {
  height: 100px;
  display: grid;
  place-items: center;
  color: #7899a1;
  font-size: 11px;
}
.pie-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.pie {
  width: 92px;
  height: 92px;
  flex-shrink: 0;
  transform: rotate(-90deg);
}
.pie-track,
.pie-segment {
  fill: none;
  stroke-width: 12;
}
.pie-track {
  stroke: #203e49;
}
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  color: #9ab6bc;
  font-size: 11px;
  max-height: 140px;
  overflow-y: auto;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  overflow-wrap: anywhere;
}
.legend i {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 2px;
}
.legend strong {
  color: #d5e8ed;
  font-weight: 500;
}
</style>
