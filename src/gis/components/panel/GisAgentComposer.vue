<template>
  <div
    class="composer-container"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="handleDrop"
  >
    <!-- 拖拽高亮覆盖层 -->
    <div v-if="isDragging" class="drag-drop-overlay">
      <span class="drag-icon">📥</span>
      <span>松开以导入矢量文件 (.shp + .dbf)</span>
    </div>

    <!-- 已挂载的文件列表 -->
    <div v-if="attachedFiles.length > 0" class="attached-files-bar">
      <div
        v-for="file in attachedFiles"
        :key="file.file_ref"
        class="file-badge"
      >
        <span class="badge-icon">📄</span>
        <span class="badge-name">{{ file.name }}</span>
        <span class="badge-parts">({{ file.parts.join(' + ') }})</span>
        <button
          type="button"
          class="badge-remove"
          :disabled="isRunning"
          title="移除此附件"
          @click="removeAttachedFile(file.file_ref)"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 错误反馈 -->
    <div v-if="uploadError" class="upload-error-tip">
      <span>⚠️ {{ uploadError }}</span>
      <button type="button" class="tip-close" @click="uploadError = null">✕</button>
    </div>

    <!-- 输入操作区 -->
    <div class="input-row">
      <button
        type="button"
        class="attach-btn"
        title="上传矢量文件 (.shp + .dbf)"
        :disabled="isRunning"
        @click="triggerFileInput"
      >
        📎
      </button>
      <input
        ref="fileInputRef"
        type="file"
        multiple
        accept=".shp,.dbf"
        style="display: none"
        @change="handleFileInputChange"
      />

      <textarea
        ref="textareaRef"
        v-model="text"
        class="composer-textarea"
        placeholder="输入指令，或直接 Ctrl+V / 拖拽粘贴 .shp + .dbf 文件..."
        rows="2"
        :disabled="isRunning"
        @paste="handlePaste"
        @keydown.enter.exact.prevent="handleEnter"
      ></textarea>

      <div class="action-btn-wrap">
        <button
          v-if="isRunning"
          type="button"
          class="stop-btn"
          title="终止当前任务"
          @click="$emit('stop')"
        >
          ■ 停止
        </button>
        <button
          v-else
          type="button"
          class="send-btn"
          :disabled="!canSend"
          title="发送指令 (Enter)"
          @click="handleSend"
        >
          ▲ 发送
        </button>
      </div>
    </div>

    <div class="composer-hint">
      <span>支持粘贴或拖入 .shp + .dbf；Enter 发送</span>
      <span class="backend-badge">AG-UI &bull; DSH AgentLoop</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useGisCapabilities } from '@/gis/application.js';
import { isWorkflowBusy } from '@/gis/integration/agui/workflowStatus.js';

const props = defineProps({
  status: {
    type: String,
    default: 'idle',
  },
});

const emit = defineEmits(['send', 'stop']);

const gis = useGisCapabilities();
const text = ref('');
const textareaRef = ref(null);
const fileInputRef = ref(null);
const isDragging = ref(false);
const attachedFiles = ref([]);
const uploadError = ref(null);

const isRunning = computed(() => isWorkflowBusy(props.status));

const canSend = computed(() => {
  return (text.value.trim().length > 0 || attachedFiles.value.length > 0) && !isRunning.value;
});

const processFileList = (fileList) => {
  if (isRunning.value) return;
  if (!fileList || fileList.length === 0) return;
  const files = Array.from(fileList);
  const result = gis.fileReferences.registerVectorDataset(files);
  if (!result.ok) {
    uploadError.value = result.error?.message || 'SHP 文件必须同时包含同名的 .shp 与 .dbf 文件';
    return;
  }
  uploadError.value = null;
  attachedFiles.value.push(result.data);
  textareaRef.value?.focus();
};

const handleDragOver = () => {
  if (!isRunning.value) isDragging.value = true;
};

const handlePaste = (e) => {
  const items = e.clipboardData?.files;
  if (items && items.length > 0) {
    e.preventDefault();
    processFileList(items);
  }
};

const handleDrop = (e) => {
  isDragging.value = false;
  if (isRunning.value) return;
  const items = e.dataTransfer?.files;
  if (items && items.length > 0) {
    processFileList(items);
  }
};

const triggerFileInput = () => {
  if (isRunning.value) return;
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
    fileInputRef.value.click();
  }
};

const handleFileInputChange = (e) => {
  if (isRunning.value) return;
  const files = e.target.files;
  if (files && files.length > 0) {
    processFileList(files);
  }
};

const removeAttachedFile = (fileRef) => {
  if (isRunning.value) return;
  gis.fileReferences.revoke(fileRef);
  attachedFiles.value = attachedFiles.value.filter((item) => item.file_ref !== fileRef);
};

const handleSend = () => {
  let content = text.value.trim();
  if (!content && attachedFiles.value.length > 0) {
    content = `导入 ${attachedFiles.value.map((f) => f.name).join('、')} 矢量数据并上图显示。`;
  }
  if (!content || isRunning.value) return;
  emit('send', content, () => {
    text.value = '';
    attachedFiles.value = [];
  });
};

const handleEnter = (e) => {
  if (e.shiftKey) return;
  handleSend();
};
</script>

<style scoped lang="scss">
.composer-container {
  position: relative;
  padding: 10px 14px 12px;
  background: rgba(13, 58, 133, 0.6);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  flex-direction: column;
  gap: 8px;

  .drag-drop-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(13, 58, 133, 0.95);
    border: 2px dashed #4db8ff;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #4db8ff;
    font-size: 13px;
    font-weight: 600;
    pointer-events: none;
    backdrop-filter: blur(4px);

    .drag-icon {
      font-size: 20px;
    }
  }

  .attached-files-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    .file-badge {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(26, 105, 209, 0.45);
      border: 1px solid rgba(77, 184, 255, 0.4);
      color: #ffffff;
      font-size: 11px;

      .badge-parts {
        color: rgba(255, 255, 255, 0.65);
        font-size: 10px;
      }

      .badge-remove {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        padding: 0 2px;
        font-size: 10px;
        margin-left: 2px;

        &:hover {
          color: #ff6666;
        }
      }
    }
  }

  .upload-error-tip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    border-radius: 4px;
    background: rgba(255, 82, 82, 0.2);
    border: 1px solid rgba(255, 82, 82, 0.4);
    color: #ff9999;
    font-size: 11px;

    .tip-close {
      background: none;
      border: none;
      color: #ff9999;
      cursor: pointer;
      font-size: 10px;
    }
  }

  .input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;

    .attach-btn {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #ffffff;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s ease;

      &:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.2);
        border-color: #4db8ff;
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }

    .composer-textarea {
      flex: 1;
      resize: none;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      line-height: 1.4;
      background: rgba(9, 36, 82, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #ffffff;
      outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;

      &::placeholder {
        color: rgba(255, 255, 255, 0.4);
      }

      &:focus {
        border-color: #4db8ff;
        box-shadow: 0 0 8px rgba(77, 184, 255, 0.35);
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .action-btn-wrap {
      flex-shrink: 0;

      button {
        height: 36px;
        padding: 0 14px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        transition: all 0.2s ease;
      }

      .send-btn {
        background: linear-gradient(135deg, #1a69d1, #2b7de9);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 2px 8px rgba(26, 105, 209, 0.4);

        &:hover:not(:disabled) {
          background: linear-gradient(135deg, #2578ea, #4db8ff);
          box-shadow: 0 4px 12px rgba(77, 184, 255, 0.5);
          transform: translateY(-1px);
        }

        &:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          box-shadow: none;
        }
      }

      .stop-btn {
        background: rgba(255, 82, 82, 0.85);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.3);

        &:hover {
          background: #ff5252;
          box-shadow: 0 0 10px rgba(255, 82, 82, 0.6);
        }
      }
    }
  }

  .composer-hint {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.45);
    padding: 0 2px;

    .backend-badge {
      font-size: 10px;
      color: rgba(77, 184, 255, 0.6);
      font-family: monospace;
    }
  }
}
</style>
