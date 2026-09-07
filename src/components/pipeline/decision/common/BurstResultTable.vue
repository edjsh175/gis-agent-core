<template>
  <div class="burst-result-table">
    <!-- 阀门分析结果表格 -->
    <el-table
      v-if="analysisType === 'valve'"
      :data="data"
      style="width: 100%"
      max-height="400"
      size="default"
      stripe
      border
      @row-click="handleRowClick"
      @row-mouseenter="handleRowHover"
      @row-mouseleave="handleRowLeave"
    >
      <el-table-column
        prop="序号"
        label="序号"
        width="80"
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
        prop="阀门编号"
        label="阀门编号"
        width="150"
        show-overflow-tooltip
        align="center"
      >
        <template #default="scope">
          <el-link
            type="primary"
            :underline="false"
            @click="handleRowClick(scope.row)"
          >
            {{ scope.row.阀门编号 }}
          </el-link>
        </template>
      </el-table-column>

      <el-table-column prop="类型" label="类型" width="165" align="center">
        <template #default="scope">
          <el-tag type="primary" size="default"> 阀门井 </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- 管段分析结果表格 -->
    <el-table
      v-if="analysisType === 'pipe'"
      :data="data"
      style="width: 100%"
      max-height="400"
      size="default"
      stripe
      border
      @row-click="handleRowClick"
      @row-mouseenter="handleRowHover"
      @row-mouseleave="handleRowLeave"
    >
      <el-table-column
        prop="序号"
        label="序号"
        width="80"
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
        prop="管线编号"
        label="管线编号"
        width="150"
        show-overflow-tooltip
        align="center"
      >
        <template #default="scope">
          <el-link
            type="primary"
            :underline="false"
            @click="handleRowClick(scope.row)"
          >
            {{ scope.row.管线编号 }}
          </el-link>
        </template>
      </el-table-column>

      <el-table-column prop="类型" label="类型" width="165" align="center">
        <template #default="scope">
          <el-tag type="success" size="default"> 管线 </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- 详情弹窗 -->
    <el-dialog
      v-model="detailDialogVisible"
      :title="getDetailDialogTitle()"
      width="60%"
      @close="handleCloseDetail"
    >
      <div v-if="currentFeatureDetail" class="feature-detail">
        <el-descriptions :column="2" size="small" border>
          <!-- 阀门详情 -->
          <template v-if="analysisType === 'valve'">
            <el-descriptions-item label="阀门编号">
              {{ currentFeatureDetail.阀门编号 }}
            </el-descriptions-item>
            <el-descriptions-item label="阀门名称">
              {{ currentFeatureDetail.阀门名称 || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="设施类型">
              <el-tag
                :type="getFacilityTypeColor(currentFeatureDetail.设施类型)"
                size="small"
              >
                {{ currentFeatureDetail.设施类型 }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="管线类型">
              <el-tag
                :type="getPipelineTypeColor(currentFeatureDetail.管线类型)"
                size="small"
              >
                {{ currentFeatureDetail.管线类型 }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="阀门状态">
              <el-tag
                :type="getStatusTagType(currentFeatureDetail.阀门状态)"
                size="small"
              >
                {{ currentFeatureDetail.阀门状态 || '正常' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="安装日期">
              {{ formatDate(currentFeatureDetail.安装日期) || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="维护状态">
              {{ currentFeatureDetail.维护状态 || '—' }}
            </el-descriptions-item>
            <el-descriptions-item label="位置描述">
              {{ currentFeatureDetail.位置描述 || '—' }}
            </el-descriptions-item>
          </template>

          <!-- 管段详情 -->
          <template v-if="analysisType === 'pipe'">
            <el-descriptions-item label="管线编号">
              {{ currentFeatureDetail.管线编号 }}
            </el-descriptions-item>
            <el-descriptions-item label="类型">
              <el-tag type="success" size="small"> 管线 </el-tag>
            </el-descriptions-item>
          </template>

          <el-descriptions-item :label="`在结果中的位置`">
            第 {{ currentFeatureDetail.序号 }}
            {{ analysisType === 'valve' ? '个阀门' : '条管段' }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 扩展属性 -->
        <div
          v-if="currentFeatureDetail._feature?.properties"
          class="extended-properties"
        >
          <h4>扩展属性</h4>
          <el-table
            :data="
              formatExtendedProperties(currentFeatureDetail._feature.properties)
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
            {{ `定位到该${analysisType === 'valve' ? '阀门' : '管段'}` }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, defineEmits } from 'vue';
import { ElMessage } from 'element-plus';

const props = defineProps({
  data: {
    type: Array,
    default: () => [],
  },
  analysisType: {
    type: String,
    default: 'valve', // 'valve' or 'pipe'
    validator: (value) => ['valve', 'pipe'].includes(value),
  },
});

const emit = defineEmits([
  'row-click',
  'row-hover',
  'row-leave',
  'locate',
  'show-details',
]);

// 获取详情弹窗标题
const getDetailDialogTitle = () => {
  return props.analysisType === 'valve' ? '阀门详细信息' : '管段详细信息';
};

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

// 获取设施类型颜色
const getFacilityTypeColor = (type) => {
  const colorMap = {
    阀门: 'primary',
    消火栓: 'danger',
    检查井: 'info',
    泵站: 'success',
    水表: 'warning',
  };
  return colorMap[type] || 'info';
};

// 获取状态标签类型
const getStatusTagType = (status) => {
  const statusMap = {
    正常: 'success',
    良好: 'success',
    故障: 'danger',
    维修: 'warning',
    停用: 'info',
  };
  return statusMap[status] || 'success';
};

// 获取影响程度颜色
const getImpactLevelColor = (level) => {
  const levelMap = {
    轻微: 'success',
    中等: 'warning',
    严重: 'danger',
    极严重: 'danger',
  };
  return levelMap[level] || 'warning';
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

// 格式化日期
const formatDate = (date) => {
  if (!date || date === 'N/A') return '—';

  // 如果已经是格式化后的日期字符串，直接返回
  if (typeof date === 'string' && date.includes('-')) {
    return date;
  }

  // 尝试解析日期
  try {
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) return date;

    return parsedDate.toLocaleDateString('zh-CN');
  } catch (error) {
    return date;
  }
};

// 格式化扩展属性
const formatExtendedProperties = (properties) => {
  if (!properties) return [];

  // 根据分析类型定义要排除的键
  const excludeKeys =
    props.analysisType === 'valve'
      ? [
          '阀门编号',
          '阀门名称',
          '设施类型',
          '管线类型',
          '阀门状态',
          '安装日期',
          '维护状态',
          '位置描述',
        ]
      : ['管线编号', '类型'];

  return Object.entries(properties)
    .filter(
      ([key]) =>
        !excludeKeys.some((excludeKey) => key.includes(excludeKey)) &&
        !key.startsWith('_')
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

// 关闭详情弹窗
const handleCloseDetail = () => {
  currentFeatureDetail.value = null;
};
</script>

<style lang="scss" scoped>
.burst-result-table {
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

  .feature-detail {
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
