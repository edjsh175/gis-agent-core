# GIS Agent Business Artifact / Dynamic Card 架构设计

状态：Architecture Draft v1  
日期：2026-09-09  
目标仓库位置：`docs/gis-capability/business-artifact-card-architecture.md`  
关联文档：`capability-layer-prd.md`、`agent-agui-integration-prd.md`、`agent-integration-record.md`

## 1. 背景

23dmaps 已完成 GIS Capability、AG-UI 浏览器往返、DeepSeek Harness GIS Plugin、真实模型自主 Tool Planning 和 OpenLayers Effect 回执的最小闭环。当前系统已经能够让 GIS Agent 根据用户自然语言调用受控 GIS Tool，并在浏览器真实执行后继续下一模型 Step。

下一阶段业务目标不是继续证明“Agent 能操作地图”，而是让 Agent 结合后端真实业务统计能力，实时生成可展示、可复用、可持久保存的业务成果，例如：

- 当前区域管线数量、总长度、材质分布卡片；
- 风险管线概览与高风险项排名卡片；
- 某业务专题的指标 + 图表 + 表格组合卡片；
- 卡片中的业务项可进一步触发地图定位、高亮或筛选。

该能力必须成为长期业务架构，而不是聊天消息中的临时 HTML。

## 2. 核心设计结论

### 2.1 Business Card 是持久化业务对象，不是聊天 UI

新增一类一等业务对象：

`BusinessArtifact`

P0 首个 Artifact 类型：

`BusinessCard`

它拥有独立生命周期：

```text
create
  ↓
persist
  ↓
present
  ↓
reload
  ↓
update
  ↓
archive/delete
```

Conversation / Thread 仅保存 Agent 对话历史，不能作为业务卡片的权威存储。页面刷新、重新进入项目或创建新对话后，只要用户仍有权限，CardRecord 都应能从服务端恢复。

### 2.2 不允许 LLM 生成任意 HTML、Vue 或 JavaScript

模型不能输出并执行：

- HTML 字符串；
- Vue SFC；
- JavaScript；
- 任意 CSS；
- `v-html` 内容；
- iframe URL；
- 任意远程组件地址。

模型只生成受控、版本化、可校验的 `CardSpec`。前端由固定 `BusinessCardRenderer` 和组件目录渲染。

P0 Card Block 只支持：

- `metric_group`
- `text`
- `chart`
- `table`
- `map_action`

### 2.3 业务事实与展示决策分离

模型可以决定：

- 标题；
- 使用哪些已返回指标；
- 指标排列；
- 图表类型；
- 展示顺序；
- 是否提供地图联动动作。

模型不能改写后端统计事实。

统计工具返回不可猜测的 `statistics_ref`，CardSpec 通过字段绑定引用统计快照：

```json
{
  "type": "metric",
  "label": "管线总数",
  "value": {
    "statistics_ref": "stat_xxx",
    "path": "summary.count"
  },
  "unit": "条"
}
```

前端/服务端解析绑定时从权威统计快照取值，而不是相信模型复制的数字。

### 2.4 服务端 CardRecord 是权威来源，浏览器只是投影

持久化成功与浏览器展示是两个不同事实。

模型可见的“创建并展示成功”必须满足：

1. CardRecord 已持久化；
2. 当前浏览器已成功呈现；
3. 浏览器返回 `effect.status = applied`。

若服务端已保存，但浏览器展示失败：

```text
durable = true
visible = false
effect.status = partial
```

不得删除已保存成果，也不得向模型伪报完整成功。用户刷新页面后仍可重新加载该 CardRecord。

## 3. 总体架构

```text
                              ┌───────────────────────┐
                              │      User / Vue       │
                              └───────────┬───────────┘
                                          │ natural language
                                          ▼
┌────────────────────────────────────────────────────────────────────┐
│                     DeepSeek Harness Agent                         │
│                                                                    │
│  AgentLoop / Policy / MapContext / Tool Result / Business Context  │
└───────────────┬───────────────────────────────┬────────────────────┘
                │                               │
        GIS Tool Consumer              Business Tool Consumer
                │                               │
                ▼                               ▼
┌────────────────────────────┐       ┌──────────────────────────────┐
│ GIS Frontend Service       │       │ Business Capability         │
│ Pending Browser Provider   │       │                              │
│ AG-UI Bridge               │       │ Statistics Service          │
└──────────────┬─────────────┘       │ Artifact Service            │
               │                     │ CardSpec Validator          │
               │                     │ Persistence Repository      │
               │                     └──────────────┬───────────────┘
               │                                    │
               │                              card_ref / artifact_ref
               │                                    │
               └───────────────────┬────────────────┘
                                   │ AG-UI frontend effect
                                   ▼
                       ┌──────────────────────────┐
                       │ 23dmaps Browser Runtime  │
                       │                          │
                       │ FrontendExecutor         │
                       │ BusinessCardStore        │
                       │ BusinessCardRenderer     │
                       │ Map Action Adapter       │
                       └────────────┬─────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
          Card UI Projection                 GIS Capability
                                                   │
                                             OpenLayers/Cesium
```

## 4. 与现有架构的关系

现有 GIS 边界保持不变：

```text
Agent
  ↓
GIS Tool
  ↓
AG-UI
  ↓
GIS Capability
  ↓
Map Runtime / Client Scope
  ↓
OpenLayers
```

新增的是平级业务能力：

```text
Agent
  ↓
Business Statistics Tool
  ↓
Backend Statistics Capability
  ↓
statistics_ref

Agent
  ↓
publish_business_card
  ↓
Business Artifact Capability
  ├─ persist CardRecord
  └─ AG-UI present card
```

不得把 Business Card 逻辑塞进：

- `openlayersAdapter.js`
- GIS Client Scope
- GIS Data Capability
- Pinia GIS Store
- AG-UI 协议层

AG-UI 仍然只负责 Agent ↔ Browser 的运输与 Effect 往返。

## 5. 领域对象

### 5.1 StatisticsSnapshot

```json
{
  "statistics_ref": "stat_...",
  "schemaVersion": "statistics/v1",
  "dataset": "pipeline",
  "calculatedAt": "2026-09-09T01:00:00Z",
  "scope": {
    "workspaceId": "workspace_xxx",
    "regionId": "region_xxx"
  },
  "query": {
    "metrics": ["count", "total_length"],
    "dimensions": ["material"],
    "filters": []
  },
  "data": {
    "summary": {
      "count": 128,
      "total_length": 23742
    },
    "groups": {
      "material": [
        { "key": "PE", "count": 53 },
        { "key": "steel", "count": 41 }
      ]
    }
  }
}
```

要求：

- `statistics_ref` 服务端生成，不可由模型自定义；
- snapshot 默认不可变；
- 保存 Card 时关联 snapshot；
- P0 默认采用“创建时快照”语义；
- 后端真实统计接口是事实来源；
- 不允许模型提交 SQL 或任意后端 URL。

### 5.2 CardSpec

```json
{
  "schemaVersion": "business-card/v1",
  "title": "当前区域管线概览",
  "description": "基于当前业务统计快照生成",
  "layout": {
    "type": "grid",
    "columns": 2
  },
  "blocks": [
    {
      "id": "total-count",
      "type": "metric_group",
      "items": [
        {
          "label": "管线总数",
          "value": {
            "statistics_ref": "stat_xxx",
            "path": "summary.count"
          },
          "unit": "条"
        }
      ]
    },
    {
      "id": "material-chart",
      "type": "chart",
      "chartType": "bar",
      "source": {
        "statistics_ref": "stat_xxx",
        "path": "groups.material"
      },
      "xField": "key",
      "yField": "count"
    }
  ]
}
```

约束：

- `schemaVersion` 必填；
- `blocks` 数量 P0 最大 12；
- 每个 block 必须有稳定 `id`；
- 创建卡片只能引用当前 workflow 可访问的 `statistics_ref`；刷新已保存卡片以主体、工作区及版本鉴权，不要求旧快照属于当前 workflow；
- path 必须存在且类型匹配；
- chart 类型 P0 只允许 `bar | pie | line`；
- 不接受 HTML/CSS/JS；
- 所有颜色与样式由设计系统或有限枚举控制；
- 服务端必须重新校验，不相信模型 JSON。

### 5.3 CardRecord

```json
{
  "cardId": "card_...",
  "workspaceId": "workspace_...",
  "schemaVersion": "business-card/v1",
  "spec": {},
  "statisticsRefs": ["stat_..."],
  "status": "active",
  "createdBy": "principal_...",
  "createdByAgent": true,
  "createdAt": "2026-09-09T01:05:00Z",
  "updatedAt": "2026-09-09T01:05:00Z",
  "revision": 1
}
```

CardRecord 是页面恢复的权威来源。

## 6. Capability 划分

### 6.1 Backend Statistics Capability

模型面向语义业务，而非数据库。

当前真实业务入口：

`get_pipeline_statistics`

当前 PoC 的 Tool Contract 是零参数：

```json
{}
```

它只表示“读取当前主体 / workspace 已允许的管线统计”。当前阶段不向模型暴露尚未真正可选的 region、metrics、dimensions 参数；统计范围和指标集合由服务端 Capability 决定。

输出：

```json
{
  "ok": true,
  "data": {
    "statistics_ref": "stat_...",
    "dataset": "pipeline",
    "summary": {},
    "availablePaths": [
      "summary.count",
      "summary.total_length",
      "groups.material"
    ]
  }
}
```

未来只有在真实业务确实需要多数据集、多指标或多范围选择后，才扩展为更通用的 `query_business_statistics(...)`；参数必须来自服务端 allowlist，不允许任意 SQL，也不提前向模型暴露不存在的自由度。

### 6.2 Business Artifact Capability

当前模型可见 Business Artifact 能力共 7 个：

- `get_pipeline_statistics`
- `publish_business_card`
- `list_business_cards`
- `refresh_business_card`
- `update_business_card`
- `archive_business_card`
- `delete_business_card`

工具名称由 Harness 的共享 Business Tool Catalog 单一维护，并通过测试对账实际注册 Tool 与 Agent Policy allowlist，避免两处手写名称漂移。

其中 `publish_business_card` 是一个逻辑业务动作，内部协调持久化与当前浏览器展示，避免要求模型记住“保存后再调用展示工具”的实现细节。

## 7. publish_business_card 执行语义

```text
Agent Tool Call
      ↓
validate CardSpec
      ↓
validate statistics_ref / paths / permission
      ↓
persist CardRecord
      ↓
cardId created
      ↓
request current browser to present card
      ↓
AG-UI frontend effect
      ↓
BusinessCardRenderer renders
      ↓
browser receipt
      ↓
Tool Result
```

成功结果：

```json
{
  "ok": true,
  "data": {
    "cardId": "card_xxx",
    "durable": true,
    "visible": true
  },
  "effect": {
    "status": "applied",
    "kind": "business_card_present"
  }
}
```

持久化成功但当前浏览器失败：

```json
{
  "ok": false,
  "data": {
    "cardId": "card_xxx",
    "durable": true,
    "visible": false
  },
  "error": {
    "code": "CARD_PRESENT_FAILED",
    "message": "业务卡片已保存，但当前页面未能展示"
  },
  "effect": {
    "status": "partial"
  }
}
```

## 8. 页面恢复与实时展示

### 8.1 首次加载 / 刷新

```text
Vue workspace mounted
      ↓
GET business cards by workspace
      ↓
BusinessCardStore
      ↓
BusinessCardRenderer
```

恢复过程不依赖 Agent 会话，不重新运行 LLM，不重新统计。

### 8.2 Agent 创建时实时展示

当前页面通过 AG-UI 收到已验证的 `cardId`，浏览器只读取该 Artifact 并投影，不接收模型生成的任意组件代码。

### 8.3 当前 2D PoC 运行限制

当前 `createAguiWorkflow()` 在每轮 Agent Workflow 开始前统一要求 `scene === 2d` 且地图 ready。因此现阶段 Business Artifact 的 list / refresh / update / archive / delete 虽然本身不依赖 OpenLayers，仍只能在 2D GIS Agent Workflow 可运行时由该 Agent 调用。

这是当前 PoC 的产品级限制，不是 Artifact 数据模型的内在依赖。真正需要 GIS ClientScope 的只有 `map_action` 等地图 Effect。未来若要求在 Cesium 3D 下独立管理业务成果，应从 Workflow 能力门禁层解耦，而不是给各 Business Tool 增加绕过 2D 检查的特殊分支。

## 9. 地图联动

P0 `map_action` 只保存受控 GIS 意图，不直接保存 JS callback。

示例：

```json
{
  "type": "map_action",
  "label": "查看高风险管线",
  "action": {
    "kind": "query_and_highlight",
    "layerId": "geoserver:GX:js_ln",
    "filters": [
      {
        "field": "risk_level",
        "op": "eq",
        "value": "high"
      }
    ]
  }
}
```

执行时必须重新进入已有 GIS Capability / Client Scope。

Card Renderer 不允许：

- 直接 `window.map2d`；
- 直接 new OpenLayers Interaction；
- 绕过 GIS Tool Contract；
- 根据持久化旧 `feature_ref` 自动恢复过期快照。

地图 Action 的权限、数据版本与当前 Map generation 在点击时重新校验。P0 只接受现有 GIS Data Capability 已实际支持的 metadata-backed `eq` 筛选；后续若 GIS 查询能力扩展，再同步扩展 CardSpec allowlist，避免持久化当前无法执行的动作。

## 10. 数据更新语义

默认使用 Snapshot：

> 卡片展示“创建或最近一次主动刷新时得到的业务统计结果”。

原因：

- 可审计；
- 可复现；
- 不因后端数据变化而静默改写业务成果；
- 页面重载不重新消耗 LLM。

Card 须显示 `calculatedAt`。

当前生命周期已经实现 Refresh / Update / Archive / Delete，并保持职责分离：

- Refresh：数据变化，CardSpec 结构保持不变；
- Update：CardSpec 表达变化，已有合法 Snapshot 直接复用，不隐式刷新；
- Archive：`active → archived` 的软下架，保留 CardRecord 与 StatisticsSnapshot；
- Delete：永久删除 CardRecord，但不级联删除 StatisticsSnapshot。

统计来源重放归 Statistics Capability 所有。后端随卡片列表返回 `refreshable`，Agent Plugin 不读取 Statistics Provider 内部实现，也不自行复制 replay 规则。

刷新服务先在事务外完成全部统计。Repository 再在一个事务中插入全部新快照、替换绑定、校验并按预期 revision 条件更新卡片；任何失败都回滚。并发冲突只读取最新卡片恢复页面，不自动再次统计。

所有写操作使用 `expectedRevision` CAS。成功 Refresh / Update / Archive 保留原 cardId 并只增加一次 revision；Delete 返回一个 removal revision 供 Browser tombstone 使用。浏览器版本合并与 tombstone 共同保证旧 LIST / PRESENT 不能覆盖新版本，也不能让已归档/删除卡片“复活”。

旧 StatisticsSnapshot 永不覆盖。Delete 不承担 Snapshot GC；后续如需清理历史快照，应单独设计 retention / GC 策略。

跨对话查找通过主体与工作区范围内的卡片列表完成；标题不是唯一标识，同名或指代不清时 Agent 必须澄清。

## 11. 权限与安全

必须满足：

- card/statistics 引用绑定用户主体与 workspace；
- cardId / statistics_ref 不作为凭证；
- 读取、更新、删除均后端鉴权；
- 模型不能选择任意 workspaceId 越权写入；
- CardSpec 中禁止 HTML、脚本、任意 URL 和任意组件名；
- 统计 Tool 禁止任意 SQL；
- Map Action 使用现有 GIS allowlist 和参数校验；
- CardSpec、StatisticsSnapshot、Tool Result 均进入可追踪日志；
- 浏览器不得仅凭 Agent 文本声称“保存成功”。

## 12. 建议源码边界

前端新增独立业务目录，而不是塞入 `src/gis`：

```text
src/business-artifacts/
├─ cardSpecContract.js
├─ cardSpecSchema.js
├─ contracts.js
├─ application.js
├─ runtime.js
├─ integration/
│  ├─ frontendTools.js
│  ├─ frontendExecutor.js
│  └─ mapActionExecutor.js
└─ components/
   ├─ BusinessCardBoard.vue
   └─ BusinessCardRenderer.vue
```

Harness 继续使用当前 23dmaps Agent bundle，但业务能力与 GIS 能力分模块注册：

```text
harness/business-artifacts/
├─ repository.js
├─ pipelineStatistics.js
├─ refreshService.js
├─ updateService.js        # 当前承载统一 Lifecycle Service
└─ server.js

harness/dsh-gis-plugin/src/
├─ gis...
├─ businessArtifactToolCatalog.js
├─ businessArtifactTools.js
├─ businessArtifactBackendClient.js
├─ businessArtifactFrontendService.js
└─ businessArtifactPendingProvider.js
```

若后续业务 Tool 大幅扩展，再独立为新的 bundle；P0 不为未来规模提前拆包。

## 13. 观测与审计

每次业务卡片创建至少记录：

- traceId
- threadId / runId
- principal
- workspaceId
- statistics_ref
- statistics query summary
- cardId
- CardSpec schemaVersion
- CardRecord revision
- persistence result
- frontend effect result
- createdAt

这样可区分：

```text
统计失败
模型没有发卡片
CardSpec 校验失败
持久化失败
持久化成功但浏览器失败
浏览器已展示
```

## 14. P0 不做

- 任意 HTML / Vue / React 生成；
- A2UI/MCP Apps 协议迁移；
- 用户自定义 JS；
- 任意 SQL；
- 多人实时协同编辑；
- 卡片拖拽设计器；
- 自动后台刷新；
- 卡片跨 workspace 共享；
- 任意第三方 iframe；
- Cesium 专属卡片动作；
- 任意报表模板引擎。

## 15. 架构验收标准

满足以下条件，才认为 Business Artifact 基础架构成立：

1. 同一 CardSpec 在无 LLM 情况下可确定性渲染；
2. 后端统计数据不能被模型复制值覆盖；
3. publish 成功前必须完成 CardRecord 持久化；
4. 浏览器失败不能导致已保存 CardRecord 丢失；
5. 页面刷新后不依赖 Agent 即可恢复卡片；
6. Card 地图动作必须经过 GIS Capability；
7. 任意 HTML/JS/CardSpec 越界字段 fail-closed；
8. Agent 只有收到 durable=true 且 effect=applied 时才可宣称“已创建并展示”；
9. 真实后端统计值、CardRecord 和浏览器展示三方可对账；
10. 新能力不修改 DeepSeek Harness AgentLoop/core。
