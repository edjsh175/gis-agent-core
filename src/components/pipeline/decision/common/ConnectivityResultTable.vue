<template>
  <div class="connectivity-result-table">
    <el-table
      :data="data"
      style="width: 100%"
      max-height="400"
      size="small"
      stripe
      border
      @row-click="handleRowClick"
      @row-mouseenter="handleRowHover"
      @row-mouseleave="handleRowLeave"
    >
      <el-table-column
        prop="序号"
        label="序号"
        width="60"
        align="center"
        fixed="left"
      >
        <template #default="scope">
          <el-tag :type="getSequenceTagType(scope.row.序号)" size="small" round>
            {{ scope.row.序号 }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        prop="管段ID"
        label="管段ID"
        width="120"
        show-overflow-tooltip
      >
        <template #default="scope">
          <el-link
            type="primary"
            :underline="false"
            @click="handleRowClick(scope.row)"
          >
            {{ scope.row.管段ID }}
          </el-link>
        </template>
      </el-table-column>

      <el-table-column
        prop="管线类型"
        label="管线类型"
        width="100"
        align="center"
      >
        <template #default="scope">
          <el-tag :type="getPipelineTypeColor(scope.row.管线类型)" size="small">
            {{ scope.row.管线类型 }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- 管段详情弹窗 -->
    <el-dialog
      v-model="detailDialogVisible"
      title="管段详细信息"
      width="60%"
      @close="handleCloseDetail"
    >
      <div v-if="currentPipeDetail" class="pipe-detail">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="管段ID">
            {{ currentPipeDetail.管段ID }}
          </el-descriptions-item>
          <el-descriptions-item label="管线名称">
            {{ currentPipeDetail.管线名称 || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="管线类型">
            <el-tag
              :type="getPipelineTypeColor(currentPipeDetail.管线类型)"
              size="small"
            >
              {{ currentPipeDetail.管线类型 }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="管径">
            {{
              currentPipeDetail.管径 && currentPipeDetail.管径 !== 'N/A'
                ? currentPipeDetail.管径 + ' mm'
                : '—'
            }}
          </el-descriptions-item>
          <el-descriptions-item label="材质">
            {{ currentPipeDetail.材质 || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="长度">
            {{
              currentPipeDetail.长度 && currentPipeDetail.长度 !== 'N/A'
                ? formatLength(currentPipeDetail.长度) + ' m'
                : '—'
            }}
          </el-descriptions-item>
          <el-descriptions-item label="起点标高">
            {{
              currentPipeDetail.起点标高 && currentPipeDetail.起点标高 !== 'N/A'
                ? formatElevation(currentPipeDetail.起点标高) + ' m'
                : '—'
            }}
          </el-descriptions-item>
          <el-descriptions-item label="终点标高">
            {{
              currentPipeDetail.终点标高 && currentPipeDetail.终点标高 !== 'N/A'
                ? formatElevation(currentPipeDetail.终点标高) + ' m'
                : '—'
            }}
          </el-descriptions-item>
          <el-descriptions-item label="在路径中的位置">
            第 {{ currentPipeDetail.序号 }} 条管段
          </el-descriptions-item>
        </el-descriptions>

        <!-- 扩展属性 -->
        <div
          v-if="currentPipeDetail._feature?.properties"
          class="extended-properties"
        >
          <h4>扩展属性</h4>
          <el-table
            :data="
              formatExtendedProperties(currentPipeDetail._feature.properties)
            "
            size="small"
            max-height="200"
          >
            <el-table-column prop="key" label="属性名" width="150" />
            <el-table-column
              prop="value"
              label="属性值"
              show-overflow-tooltip
            />
          </el-table>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="detailDialogVisible = false">关闭</el-button>
          <el-button type="primary" @click="handleLocateFromDialog">
            定位到该管段
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, defineEmits } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Location as LocationIcon,
  InfoFilled as InfoIcon,
} from '@element-plus/icons-vue';

const props = defineProps({
  data: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  'row-click',
  'row-hover',
  'row-leave',
  'locate',
  'show-details',
]);

// 响应式数据
const detailDialogVisible = ref(false);
const currentPipeDetail = ref(null);

// 获取序号标签类型
const getSequenceTagType = (sequence) => {
  if (sequence === 1) return 'success';
  if (sequence <= 3) return 'primary';
  if (sequence <= 5) return 'warning';
  return 'info';
};

// 获取管线类型颜色
const getPipelineTypeColor = (type) => {
  const colorMap = {
    电力: 'danger',
    通信: 'primary',
    给水: 'success',
    排水: 'warning',
    热力: 'danger',
    燃气: 'warning',
  };
  return colorMap[type] || 'info';
};

// 格式化长度
const formatLength = (length) => {
  if (!length || length === 'N/A') return '—';
  const numLength = parseFloat(length);
  if (isNaN(numLength)) return length;
  return numLength.toFixed(2);
};

// 格式化标高
const formatElevation = (elevation) => {
  if (!elevation || elevation === 'N/A') return '—';
  const numElevation = parseFloat(elevation);
  if (isNaN(numElevation)) return elevation;
  return numElevation.toFixed(3);
};

// 格式化扩展属性
const formatExtendedProperties = (properties) => {
  if (!properties) return [];

  const excludeKeys = [
    '管段ID',
    '管线名称',
    '管线类型',
    '管径',
    '材质',
    '长度',
    '起点标高',
    '终点标高',
  ];

  return Object.entries(properties)
    .filter(
      ([key]) => !excludeKeys.some((excludeKey) => key.includes(excludeKey))
    )
    .map(([key, value]) => ({
      key,
      value: value !== null && value !== undefined ? String(value) : '—',
    }));
};

// 处理行点击
const handleRowClick = (row, column, event) => {
  emit('row-click', row);
};

// 处理行悬停
const handleRowHover = (row, column, cell, event) => {
  emit('row-hover', row);
};

// 处理行离开
const handleRowLeave = (row, column, cell, event) => {
  emit('row-leave', row);
};

// 处理定位
const handleLocate = (row) => {
  emit('locate', row);
  ElMessage.success(`正在定位到管段: ${row.管段ID}`);
};

// 显示详情
const handleShowDetails = (row) => {
  currentPipeDetail.value = row;
  detailDialogVisible.value = true;
  emit('show-details', row);
};

// 从弹窗中定位
const handleLocateFromDialog = () => {
  if (currentPipeDetail.value) {
    handleLocate(currentPipeDetail.value);
    detailDialogVisible.value = false;
  }
};

// 关闭详情弹窗
const handleCloseDetail = () => {
  currentPipeDetail.value = null;
};
</script>

<style lang="scss" scoped>
.connectivity-result-table {
  .no-data {
    color: #c0c4cc;
    font-style: italic;
  }

  :deep(.el-table) {
    .el-table__row {
      cursor: pointer;

      &:hover {
        background-color: #f5f7fa;
      }
    }

    .el-table__cell {
      padding: 8px 0;
    }

    .el-link {
      font-weight: 500;
    }
  }

  .pipe-detail {
    .extended-properties {
      margin-top: 20px;

      h4 {
        margin-bottom: 10px;
        color: #606266;
        font-size: 14px;
      }
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: space-between;

    .el-button + .el-button {
      margin-left: auto;
    }
  }
}
</style>
