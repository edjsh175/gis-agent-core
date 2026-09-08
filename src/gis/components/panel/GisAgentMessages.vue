<template>
  <div ref="scrollContainer" class="messages-container">
    <div v-if="displayMessages.length === 0" class="empty-state">
      <div class="empty-icon">🗺️</div>
      <div class="empty-title">23dmaps GIS 智能助手</div>
      <div class="empty-desc">你可以输入自然语言操作地图，例如导入矢量图层、调整样式、缩放视图或查询管网要素。</div>
    </div>

    <template v-for="msg in displayMessages" :key="msg.id">
      <!-- 用户消息 -->
      <div v-if="msg.role === 'user'" class="message-row user-row">
        <div class="message-bubble user-bubble">
          <div class="bubble-content">{{ msg.content }}</div>
        </div>
      </div>

      <!-- 助手消息 -->
      <div v-else-if="msg.role === 'assistant'" class="message-row assistant-row">
        <div class="assistant-avatar">🤖</div>
        <div class="message-bubble assistant-bubble">
          <div class="bubble-header">
            <span class="sender-name">GIS Agent</span>
            <span class="engine-tag">DeepSeek</span>
          </div>
          <div v-if="msg.content" class="bubble-content">{{ msg.content }}</div>
        </div>
      </div>
    </template>

    <!-- 工具执行时间线（直接消费运行时状态） -->
    <GisAgentToolActivity
      v-if="receipts.length > 0 || currentToolCall"
      :receipts="receipts"
      :current-call="currentToolCall"
    />

    <!-- 运行中加载动效 -->
    <div v-if="isRunning && !currentToolCall" class="running-indicator">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
      <span class="status-tip">{{ statusTip }}</span>
    </div>

    <!-- 终端错误提示 -->
    <div v-if="error" class="error-banner">
      <span class="error-icon">⚠️</span>
      <div class="error-info">
        <div class="error-title">执行异常: {{ error.code }}</div>
        <div class="error-msg">{{ error.message }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, computed } from 'vue';
import GisAgentToolActivity from './GisAgentToolActivity.vue';
import { isWorkflowBusy } from '@/gis/integration/agui/workflowStatus.js';

const props = defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
  receipts: {
    type: Array,
    default: () => [],
  },
  status: {
    type: String,
    default: 'idle',
  },
  error: {
    type: Object,
    default: null,
  },
  currentToolCall: {
    type: Object,
    default: null,
  },
  progress: { type: Object, default: null },
});

const scrollContainer = ref(null);

const displayMessages = computed(() => {
  return props.messages.filter((m) => m.role === 'user' || (
    m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length > 0
  ));
});

const isRunning = computed(() => isWorkflowBusy(props.status));

const statusTip = computed(() => {
  switch (props.status) {
    case 'connecting': return '正在连接 Agent Runtime...';
    case 'waiting_frontend': return '地图正在执行操作...';
    case 'waiting_result_submission': return '正在回传地图执行结果...';
    case 'explaining_failure': return '正在分析执行结果...';
    default: return props.progress?.phase === 'responding' ? '正在生成回复...' : '模型思考与规划中...';
  }
});

const scrollToBottom = async () => {
  await nextTick();
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
  }
};

watch(
  () => [props.messages.at(-1)?.content, props.messages.length, props.receipts.length, props.status],
  () => {
    scrollToBottom();
  },
  { deep: true }
);
</script>

<style scoped lang="scss">
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 5px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }

  .empty-state {
    margin: auto;
    text-align: center;
    padding: 30px 16px;
    max-width: 280px;

    .empty-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }
    .empty-title {
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 6px;
    }
    .empty-desc {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      line-height: 1.5;
    }
  }

  .message-row {
    display: flex;
    gap: 8px;

    &.user-row {
      justify-content: flex-end;
    }

    &.assistant-row {
      justify-content: flex-start;
      align-items: flex-start;
    }
  }

  .assistant-avatar {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgba(26, 105, 209, 0.4);
    border: 1px solid rgba(77, 184, 255, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }

  .message-bubble {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.5;
    word-break: break-word;

    &.user-bubble {
      background: linear-gradient(135deg, #1a69d1, #2b7de9);
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(26, 105, 209, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-bottom-right-radius: 2px;
    }

    &.assistant-bubble {
      background: rgba(13, 58, 133, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #e6f1ff;
      border-bottom-left-radius: 2px;

      .bubble-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;

        .sender-name {
          font-weight: 600;
          font-size: 12px;
          color: #4db8ff;
        }

        .engine-tag {
          font-size: 10px;
          padding: 1px 4px;
          border-radius: 3px;
          background: rgba(77, 184, 255, 0.18);
          color: #87ceeb;
        }
      }
    }
  }

  .running-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(26, 105, 209, 0.15);
    border-radius: 6px;
    border: 1px solid rgba(77, 184, 255, 0.2);
    font-size: 12px;
    color: #4db8ff;

    .typing-dots {
      display: flex;
      gap: 3px;

      span {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: #4db8ff;
        animation: blink 1.2s infinite ease-in-out;

        &:nth-child(2) { animation-delay: 0.2s; }
        &:nth-child(3) { animation-delay: 0.4s; }
      }
    }
  }

  .error-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 6px;
    background: rgba(255, 82, 82, 0.18);
    border: 1px solid rgba(255, 82, 82, 0.4);
    color: #ff9999;
    font-size: 12px;

    .error-icon {
      font-size: 14px;
      flex-shrink: 0;
    }

    .error-title {
      font-weight: 600;
      color: #ff6666;
    }

    .error-msg {
      margin-top: 2px;
      color: rgba(255, 255, 255, 0.85);
    }
  }
}

@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.2); }
}
</style>
