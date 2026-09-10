<script setup>
import { computed, onMounted, ref } from 'vue';
import { getBusinessCardApplication } from '../runtime.js';
import BusinessCardRenderer from './BusinessCardRenderer.vue';

const props = defineProps({
  baseUrl: { type: String, default: undefined },
  executeMapAction: { type: Function, default: undefined },
});
const application = getBusinessCardApplication({ baseUrl: props.baseUrl });
const { state } = application;
const expanded = ref(true);
const cards = computed(() => state.cards);

onMounted(() => application.load().catch(() => {}));
</script>

<template>
  <aside
    class="artifact-board"
    :class="{ collapsed: !expanded }"
    aria-label="业务成果卡片"
  >
    <button class="board-tab" type="button" @click="expanded = !expanded">
      <span class="tab-dot"></span>{{ expanded ? '业务成果' : '成果'
      }}<span class="chevron">{{ expanded ? '›' : '‹' }}</span>
    </button>
    <div v-if="expanded" class="board-body">
      <header class="board-head">
        <div>
          <span class="kicker">PROJECT ARTIFACTS</span>
          <h2>业务成果</h2>
        </div>
        <span class="count">{{
          cards.length.toString().padStart(2, '0')
        }}</span>
      </header>
      <div v-if="state.loading" class="board-state">
        <span class="spinner"></span>正在恢复卡片…
      </div>
      <div v-else-if="state.error" class="board-state error">
        <strong>暂时无法加载业务成果</strong
        ><span>{{ state.error.message }}</span
        ><button type="button" @click="application.load().catch(() => {})">
          重试
        </button>
      </div>
      <div v-else-if="!cards.length" class="board-state empty">
        <span class="empty-icon">＋</span><strong>暂无业务成果</strong
        ><span>持久化后的卡片会显示在这里</span>
      </div>
      <div v-else class="cards">
        <BusinessCardRenderer
          v-for="card in cards"
          :key="card.cardId"
          :card="card"
          :snapshots="state.snapshots"
          :refresh-state="state.cardStates[card.cardId]"
          :on-refresh="application.refresh"
          :execute-map-action="props.executeMapAction"
        />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.artifact-board {
  position: fixed;
  z-index: 900;
  top: 108px;
  left: 20px;
  right: auto;
  width: min(390px, calc(100vw - 40px));
  max-height: calc(100vh - 220px);
  color: #d8eef1;
  font-family: Inter, 'Microsoft YaHei', sans-serif;
  pointer-events: none;
}
.board-body,
.board-tab {
  pointer-events: auto;
}
.board-body {
  max-height: calc(100vh - 220px);
  overflow: auto;
  padding: 13px;
  background: rgba(7, 18, 27, 0.94);
  border: 1px solid rgba(76, 205, 214, 0.3);
  border-radius: 0 0 11px 11px;
  box-shadow: 0 18px 45px #0009;
  backdrop-filter: blur(13px);
}
.board-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 8px 11px;
  border: 1px solid rgba(76, 205, 214, 0.35);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: #0b2430;
  color: #d7fbff;
  cursor: pointer;
  font-size: 12px;
}
.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #42d4d9;
  box-shadow: 0 0 9px #42d4d9;
}
.chevron {
  font-size: 17px;
  line-height: 10px;
  color: #71abb3;
}
.board-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.kicker {
  color: #5ecbd3;
  font:
    10px ui-monospace,
    monospace;
  letter-spacing: 0.14em;
}
.board-head h2 {
  font-size: 19px;
  margin: 5px 0 0;
  color: #f1feff;
}
.count {
  color: #6a939c;
  font:
    18px ui-monospace,
    monospace;
}
.cards {
  display: grid;
  gap: 11px;
}
.board-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 28px 12px;
  color: #8eabb2;
  font-size: 12px;
  text-align: center;
}
.board-state strong {
  color: #d9eff1;
  font-size: 13px;
}
.board-state.error {
  align-items: flex-start;
  text-align: left;
  background: #2a1b20;
  border-radius: 7px;
  color: #d49c9c;
}
.board-state.error button {
  padding: 5px 11px;
  background: #6e3440;
  border: 1px solid #b65a67;
  color: #ffe7e5;
  border-radius: 4px;
  cursor: pointer;
}
.empty-icon {
  font-size: 26px;
  color: #4caeb7;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #285763;
  border-top-color: #62dbe0;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 700px) {
  .artifact-board {
    top: 70px;
    left: 10px;
    right: auto;
    width: calc(100vw - 20px);
  }
}
</style>
