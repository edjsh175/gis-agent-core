<template>
  <div class="gis-agent-root">
    <!-- 常驻唤醒胶囊按钮 -->
    <div
      v-if="!isOpen"
      class="agent-launcher-capsule animate__animated animate__fadeInUp"
      title="打开 GIS 智能助手"
      @click="isOpen = true"
    >
      <div class="capsule-icon">
        <span class="ai-sparkle">✨</span>
      </div>
      <div class="capsule-text">
        <span class="main-title">GIS 智能助手</span>
        <span class="status-label" :class="agentStatus">
          {{ statusLabel }}
        </span>
      </div>
      <span class="capsule-dot" :class="agentStatus"></span>
    </div>

    <!-- 展开的主控制台面板 -->
    <div
      v-if="isOpen"
      class="gis-agent-panel animate__animated animate__fadeInRight"
    >
      <!-- 头部 Header -->
      <div class="panel-header">
        <div class="header-left">
          <div class="header-icon">🌐</div>
          <div class="header-title-wrap">
            <div class="title-row">
              <span class="panel-title">GIS 智能控制台</span>
              <span class="model-badge">DeepSeek</span>
            </div>
            <div class="status-indicator">
              <span class="status-dot" :class="agentStatus"></span>
              <span class="status-text">{{ statusLabel }}</span>
            </div>
          </div>
        </div>

        <div class="header-actions">
          <button
            type="button"
            class="header-btn"
            title="开启新会话 (清空历史)"
            :disabled="isRunning"
            @click="handleReset"
          >
            ↺ 新会话
          </button>
          <button
            type="button"
            class="header-btn close-btn"
            title="收起面板"
            @click="isOpen = false"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- 消息列表与工具时间线（直接消费运行时状态） -->
      <GisAgentMessages
        :messages="state.messages"
        :receipts="state.receipts"
        :status="state.status"
        :error="state.error"
        :progress="state.progress"
        :current-tool-call="state.currentToolCall"
      />

      <!-- 底部指令输入控制器 -->
      <GisAgentComposer
        :status="state.status"
        @send="handleSend"
        @stop="handleStop"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useGisCapabilities } from '@/gis/application.js';
import { useAguiWorkflow } from '@/gis/integration/agui/useAguiWorkflow.js';
import GisAgentMessages from './GisAgentMessages.vue';
import GisAgentComposer from './GisAgentComposer.vue';
import { isWorkflowBusy } from '@/gis/integration/agui/workflowStatus.js';

const props = defineProps({
  baseUrl: {
    type: String,
    default: '/__gis-harness',
  },
  defaultOpen: {
    type: Boolean,
    default: false,
  },
});

const isOpen = ref(props.defaultOpen);

const gis = useGisCapabilities();
const workflow = useAguiWorkflow({ gis, baseUrl: props.baseUrl });
const { state, send, stop, reset, clear } = workflow;

const isRunning = computed(() => isWorkflowBusy(state.value.status));

const agentStatus = computed(() => {
  if (isRunning.value) return 'running';
  if (state.value.status === 'failed' || state.value.error) return 'failed';
  if (state.value.status === 'completed') return 'completed';
  return 'idle';
});

const statusLabel = computed(() => {
  switch (state.value.status) {
    case 'connecting': return '连接中...';
    case 'running': return '思考规划中...';
    case 'waiting_frontend': return '操作地图中...';
    case 'waiting_result_submission': return '同步结果中...';
    case 'explaining_failure': return '分析执行结果...';
    case 'completed': return '就绪';
    case 'failed': return '异常';
    case 'cancelled': return '已取消';
    default: return '在线';
  }
});

const handleSend = async (message, acknowledge) => {
  if (isRunning.value) return false;
  await send(message, {}, acknowledge);
  return true;
};

const handleStop = () => {
  stop();
};

const handleReset = () => {
  reset();
  clear();
};

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.gisAgent = {
      workflow,
      open: () => { isOpen.value = true; },
      close: () => { isOpen.value = false; },
      send: handleSend,
      reset: handleReset,
      state,
    };
  }
});
</script>

<style scoped lang="scss">
.gis-agent-root {
  --theme-primary: #1a69d1;
  --theme-secondary: #4db8ff;
  --theme-dark: #0d3a85;
  --bg-panel: rgba(10, 44, 102, 0.9);
  --border-glass: 1px solid rgba(77, 184, 255, 0.35);

  position: relative;
  z-index: 1001;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

  /* 唤醒胶囊按钮 */
  .agent-launcher-capsule {
    position: fixed;
    right: 20px;
    bottom: 80px;
    height: 44px;
    padding: 0 16px 0 10px;
    border-radius: 22px;
    background: linear-gradient(135deg, rgba(13, 58, 133, 0.95), rgba(26, 105, 209, 0.95));
    backdrop-filter: blur(12px);
    border: var(--border-glass);
    box-shadow: 0 6px 20px rgba(13, 58, 133, 0.5), 0 0 12px rgba(77, 184, 255, 0.35);
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

    &:hover {
      transform: translateY(-2px) scale(1.03);
      box-shadow: 0 8px 25px rgba(26, 105, 209, 0.65), 0 0 16px rgba(77, 184, 255, 0.6);
      border-color: #4db8ff;
    }

    .capsule-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
    }

    .capsule-text {
      display: flex;
      flex-direction: column;

      .main-title {
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
        line-height: 1.2;
      }

      .status-label {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.7);

        &.running { color: #00e676; }
        &.failed { color: #ff8080; }
      }
    }

    .capsule-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #4db8ff;
      box-shadow: 0 0 6px #4db8ff;

      &.running {
        background: #00e676;
        box-shadow: 0 0 8px #00e676;
        animation: pulse 1.2s infinite ease-in-out;
      }

      &.failed {
        background: #ff5252;
        box-shadow: 0 0 8px #ff5252;
      }
    }
  }

  /* 展开的控制面板 */
  .gis-agent-panel {
    position: fixed;
    right: 24px;
    bottom: 80px;
    width: 410px;
    height: 72vh;
    max-height: 640px;
    background: var(--bg-panel);
    backdrop-filter: blur(20px);
    border: var(--border-glass);
    border-radius: 14px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55), 0 0 24px rgba(77, 184, 255, 0.2);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    pointer-events: auto;

    .panel-header {
      padding: 12px 16px;
      background: linear-gradient(135deg, rgba(13, 58, 133, 0.8), rgba(26, 105, 209, 0.65));
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      display: flex;
      align-items: center;
      justify-content: space-between;

      .header-left {
        display: flex;
        align-items: center;
        gap: 10px;

        .header-icon {
          font-size: 20px;
        }

        .header-title-wrap {
          display: flex;
          flex-direction: column;

          .title-row {
            display: flex;
            align-items: center;
            gap: 6px;

            .panel-title {
              font-size: 14px;
              font-weight: 600;
              color: #ffffff;
            }

            .model-badge {
              font-size: 10px;
              padding: 1px 5px;
              border-radius: 3px;
              background: rgba(77, 184, 255, 0.25);
              border: 1px solid rgba(77, 184, 255, 0.4);
              color: #b3d9ff;
              font-weight: 500;
            }
          }

          .status-indicator {
            display: flex;
            align-items: center;
            gap: 5px;
            margin-top: 2px;

            .status-dot {
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: #4db8ff;

              &.running {
                background: #00e676;
                box-shadow: 0 0 6px #00e676;
                animation: pulse 1.2s infinite ease-in-out;
              }

              &.failed { background: #ff5252; }
            }

            .status-text {
              font-size: 11px;
              color: rgba(255, 255, 255, 0.65);
            }
          }
        }
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 6px;

        .header-btn {
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 6px;
          color: #ffffff;
          padding: 4px 8px;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s ease;

          &:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.25);
            border-color: #4db8ff;
          }

          &:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }

          &.close-btn {
            padding: 4px 9px;
            font-size: 12px;
          }
        }
      }
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.2); }
}
</style>
