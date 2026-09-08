<template>
  <div v-if="activities.length > 0" class="tool-activity-container">
    <div class="activity-header" @click="isCollapsed = !isCollapsed">
      <div class="header-title">
        <span class="pulse-indicator" :class="{ running: hasRunningTool }"></span>
        <span class="title-text">地图操作活动 ({{ activities.length }})</span>
      </div>
      <span class="collapse-icon">{{ isCollapsed ? '▼' : '▲' }}</span>
    </div>

    <div v-show="!isCollapsed" class="activity-timeline">
      <div
        v-for="act in activities"
        :key="act.id"
        class="activity-item"
        :class="act.status"
      >
        <div class="timeline-dot">
          <span v-if="act.status === 'applied'" class="status-icon success">✓</span>
          <span v-else-if="act.status === 'running'" class="status-icon spinner">◌</span>
          <span v-else class="status-icon fail">✕</span>
        </div>
        <div class="activity-body">
          <div class="body-header">
            <span class="tool-label">{{ act.label }}</span>
            <span class="tool-name-tag">{{ act.name }}</span>
          </div>
          <div v-if="act.details" class="body-details">{{ act.details }}</div>
          <div v-if="act.errorMessage" class="body-error">{{ act.errorMessage }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { projectToolActivities } from './toolActivityUtils.js';

const props = defineProps({
  receipts: {
    type: Array,
    default: () => [],
  },
  currentCall: {
    type: Object,
    default: null,
  },
});

const isCollapsed = ref(false);

const activities = computed(() => {
  return projectToolActivities(props.receipts, props.currentCall);
});

const hasRunningTool = computed(() => {
  return activities.value.some((a) => a.status === 'running');
});
</script>

<style scoped lang="scss">
.tool-activity-container {
  margin: 10px 0;
  border-radius: 8px;
  background: rgba(13, 58, 133, 0.45);
  border: 1px solid rgba(77, 184, 255, 0.25);
  backdrop-filter: blur(8px);
  overflow: hidden;
  font-size: 13px;

  .activity-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(26, 105, 209, 0.2);
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);

    &:hover {
      background: rgba(26, 105, 209, 0.35);
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;

      .pulse-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4db8ff;
        box-shadow: 0 0 6px #4db8ff;

        &.running {
          background: #00e676;
          box-shadow: 0 0 8px #00e676;
          animation: pulse 1.2s infinite ease-in-out;
        }
      }

      .title-text {
        font-weight: 600;
        color: #e6f1ff;
      }
    }

    .collapse-icon {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.7);
    }
  }

  .activity-timeline {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;

    .activity-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      position: relative;

      .timeline-dot {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: bold;
        flex-shrink: 0;
        margin-top: 2px;
      }

      &.applied .timeline-dot {
        background: rgba(0, 230, 118, 0.2);
        color: #00e676;
        border: 1px solid #00e676;
      }

      &.running .timeline-dot {
        background: rgba(77, 184, 255, 0.2);
        color: #4db8ff;
        border: 1px solid #4db8ff;
        .spinner {
          display: inline-block;
          animation: spin 1s infinite linear;
        }
      }

      &.failed .timeline-dot {
        background: rgba(255, 82, 82, 0.2);
        color: #ff5252;
        border: 1px solid #ff5252;
      }

      .activity-body {
        flex: 1;
        min-width: 0;

        .body-header {
          display: flex;
          align-items: center;
          gap: 6px;

          .tool-label {
            color: #ffffff;
            font-weight: 500;
          }

          .tool-name-tag {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.65);
            font-family: monospace;
          }
        }

        .body-details {
          margin-top: 3px;
          color: rgba(255, 255, 255, 0.85);
          font-size: 12px;
          line-height: 1.4;
          word-break: break-word;
        }

        .body-error {
          margin-top: 3px;
          color: #ff8080;
          font-size: 12px;
        }
      }
    }
  }
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
}
</style>
