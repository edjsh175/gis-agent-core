# GIS Agent Business Artifact / Dynamic Card PRD

状态：Draft v1  
日期：2026-09-09  
目标仓库位置：`docs/gis-capability/business-artifact-card-prd.md`  
架构依据：`business-artifact-card-architecture.md`

## 1. 产品目标

在现有 23dmaps GIS Agent 基础上，接入后端真实业务统计能力，使用户可以通过自然语言要求 GIS Agent 生成业务展示卡片。

P0 必须完成：

> 用户提出业务统计 + 展示需求 → Agent 调用后端真实统计 → Agent 生成受控 CardSpec → 系统永久保存 CardRecord → 当前 GIS 页面实时展示 → 页面刷新后卡片仍存在。

首个 Gold Case 建议使用“管线业务统计卡片”。

示例用户指令：

> 统计当前区域管线数量、总长度和材质分布，生成一张概览卡片并保留在当前项目中。

预期：

1. Agent 调用真实管线统计 Tool；
2. 后端返回 `statistics_ref` 与可绑定字段；
3. Agent 生成只引用真实统计字段的 CardSpec；
4. `publish_business_card` 保存 CardRecord；
5. 当前页面实时出现卡片；
6. Agent 在收到真实 Effect 后回复成功；
7. 刷新页面后卡片自动恢复。

## 2. 用户价值

当前 GIS Agent 已能控制地图，但业务用户最终需要的往往不是“完成一次地图操作”，而是形成可复用业务成果。

Business Card P0 将 Agent 输出从一次性对话升级为：

- 可持续查看的业务摘要；
- 真实统计数据的可视化投影；
- 项目级业务成果；
- 后续地图联动与业务工作台的基础 Artifact。

## 3. 产品原则

### 3.1 真实业务数据优先

卡片中的数值、分组、表格数据必须来自后端统计 Capability。

LLM 只能决定展示结构，不作为业务事实来源。

### 3.2 固定 Schema 优先

P0 只支持受控 CardSpec 和固定组件目录，不支持任意 Generative HTML。

### 3.3 持久化优先

卡片一旦发布成功，必须具有稳定 `cardId` 并保存于服务端。Pinia / localStorage 不能作为权威持久化。

### 3.4 Effect 可验证

Agent 不能根据自己生成的文本判断 UI 已生成。

必须等待：

```text
persisted CardRecord
+
frontend effect receipt
```

### 3.5 与 GIS 能力组合，而不是混合实现

卡片的地图交互调用已有 GIS Capability，不直接控制 OpenLayers。

## 4. P0 范围

### 4.1 业务统计

首个业务域：

`pipeline`

首批指标：

- `count`
- `total_length`

首批维度：

- `material`

可选扩展指标仅在现有后端真实支持时进入 P0，不为演示伪造数据。

### 4.2 卡片 Block

P0 支持：

| Block        | 用途                        |
| ------------ | --------------------------- |
| metric_group | 展示 1–6 个核心指标         |
| text         | 展示标题下的简短业务说明    |
| chart        | bar / pie / line            |
| table        | 展示统计分组或排行          |
| map_action   | 触发受控 GIS 查询/定位/高亮 |

### 4.3 卡片操作

当前已实现：

- create / publish
- list / get
- page reload restore
- refresh
- update
- archive
- delete

其中 Refresh 只更新统计快照，Update 只更新 CardSpec 表达；Archive 为软下架，Delete 永久删除 CardRecord。Duplicate / reorder 尚未进入当前实现范围。

## 5. 非目标

P0 不实现：

- 任意 HTML/Vue/JS 代码生成；
- 自定义 CSS；
- A2UI Runtime；
- MCP Apps iframe；
- 卡片拖拽搭建器；
- 通用 BI 查询语言；
- 任意 SQL；
- 自动后台刷新；
- 多用户实时协同；
- 动态安装第三方组件；
- 卡片内执行任意 HTTP；
- 通过 Card 绕过 GIS Capability 操作地图。

当前 PoC 运行限制：`createAguiWorkflow()` 仍统一要求 2D scene ready，因此 Business Artifact 管理 Tool 目前也只能从可运行的 2D GIS Agent Workflow 发起。该限制不属于 CardRecord/StatisticsSnapshot 数据模型；未来若支持 3D 下独立管理，应在 Workflow 能力门禁层解耦。

## 6. 用户流程

### 6.1 创建

```text
用户输入业务需求
      ↓
GIS Agent 理解需求
      ↓
get_pipeline_statistics
      ↓
返回 statistics_ref + schema
      ↓
Agent 生成 CardSpec
      ↓
publish_business_card
      ↓
后端验证
      ↓
持久化 CardRecord
      ↓
AG-UI 请求当前浏览器展示
      ↓
BusinessCardRenderer
      ↓
effect.status = applied
      ↓
Agent 回复
```

### 6.2 页面恢复

```text
进入 workspace
      ↓
BusinessCardBoard mounted
      ↓
list_business_cards(workspace)
      ↓
CardRecord[]
      ↓
Renderer
```

不重新运行 LLM，不重新调用统计接口。

## 7. Agent Tool Contract

### 7.1 get_pipeline_statistics

执行位置：Backend

模型输入：

```json
{}
```

当前 PoC 只有一个确定性语义：读取当前主体 / workspace 允许的管线数量、总长度和材质分布。模型不选择 `regionId / metrics / dimensions`，避免暴露尚未真正存在的自由度。

服务端要求：

- 数据集、范围和指标集合由 Statistics Capability 决定；
- 不允许模型上传任意 SQL / geometry 绕过权限；
- 返回服务端生成的 `statistics_ref`；
- 未来只有在真实业务支持多范围/多指标选择后，才扩展 Tool 参数，并继续使用 allowlist。

输出：

```json
{
  "ok": true,
  "data": {
    "statistics_ref": "stat_xxx",
    "dataset": "pipeline",
    "calculatedAt": "...",
    "availablePaths": [
      "summary.count",
      "summary.total_length",
      "groups.material"
    ],
    "preview": {
      "summary": {
        "count": 128,
        "total_length": 23742
      }
    }
  }
}
```

`preview` 可帮助 LLM 决定展示方式，但最终 Card 渲染必须通过 `statistics_ref + path` 解析真实值。

### 7.2 publish_business_card

执行位置：Business Artifact Capability + 当前 Browser

模型输入：

```json
{
  "spec": {
    "schemaVersion": "business-card/v1",
    "title": "...",
    "layout": {},
    "blocks": []
  }
}
```

模型不能传：

- cardId
- createdBy
- workspaceId
- principal
- HTML
- JS
- component URL
- backend endpoint
- database ID not present in valid refs

服务端流程：

1. JSON schema validation；
2. 当前 workflow 引用权限校验；
3. statistics_ref 存在性校验；
4. path/type 校验；
5. CardRecord 持久化；
6. 生成 cardId；
7. 当前 Browser presentation；
8. 收到 effect；
9. 返回 Tool Result。

成功输出：

```json
{
  "ok": true,
  "data": {
    "cardId": "card_xxx",
    "durable": true,
    "visible": true,
    "revision": 1
  },
  "effect": {
    "status": "applied",
    "kind": "business_card_present"
  }
}
```

## 8. CardSpec v1

### 8.1 Root

```json
{
  "schemaVersion": "business-card/v1",
  "title": "string",
  "description": "string|null",
  "layout": {
    "type": "stack|grid",
    "columns": 1
  },
  "blocks": []
}
```

限制：

- title 1–80 字；
- description 最大 300 字；
- blocks 1–12；
- grid columns 1–3；
- 未知字段默认拒绝。

### 8.2 metric_group

```json
{
  "id": "metrics-main",
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
}
```

限制：

- items 1–6；
- unit 来自 allowlist 或服务端字段元数据；
- 数字格式由 Renderer 控制。

### 8.3 chart

```json
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
```

限制：

- chartType：`bar | pie | line`；
- 不接受 ECharts option 原始对象；
- 不接受 formatter 函数；
- 数据字段必须在 StatisticsSnapshot schema 中存在。

### 8.4 table

```json
{
  "id": "material-table",
  "type": "table",
  "source": {
    "statistics_ref": "stat_xxx",
    "path": "groups.material"
  },
  "columns": [
    { "field": "key", "label": "材质" },
    { "field": "count", "label": "数量" }
  ]
}
```

限制：

- columns 1–8；
- rows 最大 100；
- 不接受 HTML cell renderer。

### 8.5 text

仅允许纯文本 / 受控 Markdown 子集。

禁止：

- raw HTML；
- script；
- iframe；
- image URL P0。

### 8.6 map_action

```json
{
  "id": "high-risk-action",
  "type": "map_action",
  "label": "在地图上查看",
  "action": {
    "kind": "query_and_highlight",
    "layerId": "geoserver:GX:js_ln",
    "filters": []
  }
}
```

执行时重新进入 GIS Capability。

P0 不持久化过期 `feature_ref` 作为长期地图动作。

## 9. 持久化模型

最小 CardRecord 字段：

```text
card_id
workspace_id
schema_version
spec_json
statistics_refs
status
revision
created_by
created_by_agent
created_at
updated_at
```

StatisticsSnapshot 最小字段：

```text
statistics_ref
workspace_id
dataset
query_json
data_json
schema_json
calculated_at
created_by
```

要求：

- 事务性保存 CardRecord；
- CardRecord 删除/归档不立即物理删除统计快照，具体保留周期由后端策略决定；
- revision 单调递增；
- 不使用浏览器生成的 ID 作为服务端主身份。

## 10. 前端需求

新增：

```text
BusinessCardBoard
BusinessCardRenderer
MetricGroupBlock
TextBlock
ChartBlock
TableBlock
MapActionBlock
```

行为：

- Board 与 GIS 地图同页存在；
- Agent publish 后卡片无需刷新即可出现；
- 刷新后自动恢复；
- 卡片显示创建时间 / 统计时间；
- Renderer 对未知 schemaVersion fail-closed；
- 单张卡片渲染失败不阻断其他卡片；
- 错误卡片显示明确占位，不执行潜在动作；
- Agent 运行中的临时预览 P0 不做，只有持久化成功的 CardRecord 才进入正式 Board。

## 11. Harness / Agent Policy

现有 GIS Agent Tool Catalog 扩展为两组：

```text
GIS tools
Business tools
```

模型可见工具仅来自当前 profile allowlist。

Policy 新增：

- 所有业务数字以 Statistics Tool 结果为准；
- 未取得统计结果时不得生成声称真实的业务指标；
- CardSpec 只能引用当前可访问 statistics_ref；
- 用户仅要求统计时不强制生成卡片；
- 用户明确要求“生成/保存/展示卡片”时才 publish；
- publish 后依据 durable/effect 回执陈述结果；
- 卡片展示失败但 durable=true 时必须明确“已保存但当前页面展示失败”。

## 12. AG-UI / Browser Effect

P0 复用现有 AG-UI HTTP/SSE 和 Pending Browser Provider 思路。

不增加第二套 Browser Command Protocol。

前端 presentation 请求只携带受控：

```text
cardId
workflow binding
expected revision
```

浏览器根据 cardId 获取/接收已验证 CardRecord 后渲染。

不直接通过 AG-UI 传 LLM 原始 HTML。

## 13. 错误码

新增：

| code                     | 语义                                 |
| ------------------------ | ------------------------------------ |
| STATISTICS_UNAVAILABLE   | 后端统计服务不可用                   |
| INVALID_STATISTICS_QUERY | 指标/维度/范围不合法                 |
| STATISTICS_REF_EXPIRED   | 引用已失效                           |
| STATISTICS_REF_FORBIDDEN | 引用不属于当前主体/workspace         |
| INVALID_CARD_SPEC        | CardSpec 不满足 schema               |
| CARD_BINDING_INVALID     | 引用 path/type 不存在                |
| CARD_PERSIST_FAILED      | CardRecord 保存失败                  |
| CARD_NOT_FOUND           | cardId 不存在                        |
| CARD_FORBIDDEN           | 无权读取/操作卡片                    |
| CARD_PRESENT_FAILED      | 已保存但当前页面展示失败             |
| CARD_REVISION_CONFLICT   | 写操作使用的 expectedRevision 已过期 |
| CARD_STATE_CONFLICT      | 当前 Card 状态不允许目标生命周期操作 |

## 14. P0 分阶段实施

### Phase B0：Card Renderer + Persistence 基础闭环

目标：完全不依赖 LLM。

完成：

- CardSpec v1；
- Validator；
- CardRecord Repository/API；
- BusinessCardBoard；
- Renderer；
- 固定测试 CardSpec（仅存在于 tests fixture，不进入正式 BusinessCardBoard）；
- 创建 → 持久化 → 页面出现 → 刷新恢复。

出口：

> 固定 CardSpec 能稳定成为永久业务对象。

### Phase B1：真实 Pipeline Statistics

完成：

- 接一个真实后端管线统计接口；
- 建 StatisticsSnapshot；
- `statistics_ref`；
- path/type schema；
- Card binding resolver。

出口：

> 卡片数值来自真实后端，模型无法覆盖事实值。

### Phase B2：Harness Business Tools

完成：

- `get_pipeline_statistics`；
- `publish_business_card`；
- Agent Policy；
- Tool Contract；
- Pending frontend presentation；
- Effect 回执。

出口：

> Mock LLM / deterministic Agent 可完成统计 → publish → 页面展示。

### Phase B3：真实 LLM Gold Case

真实用户指令：

> 统计当前区域管线数量、总长度和材质分布，生成一张概览卡片并永久保存。

验证真实 DeepSeek：

```text
get_pipeline_statistics
→ publish_business_card
→ final answer
```

验收：

- 统计值与后端一致；
- CardRecord 已存在；
- 当前浏览器已展示；
- Tool Result effect=applied；
- 刷新后仍存在；
- Agent 最终陈述与结果一致。

### Phase B4：GIS 联动

完成至少一个 Card Map Action：

```text
点击统计项
→ queryFeatures / locate / highlight
```

不得直接访问 `window.map2d`。

## 15. 测试矩阵

### Contract

- CardSpec 合法/非法；
- 未知 block；
- HTML/JS 注入；
- statistics_ref 越权；
- path 不存在；
- 数字/数组类型不匹配；
- chart/table 字段非法；
- block 数量超限。

### Persistence

- create；
- list；
- reload；
- revision；
- workspace isolation；
- auth denial；
- persistence failure。

### Browser

- publish 后实时展示；
- render error；
- duplicate delivery 去重；
- refresh / update 后原位置更新与 reload restore；
- archive / delete 后页面移除；
- stale revision；
- tombstone 阻止迟到 LIST / PRESENT 复活已下架卡片；
- 单卡失败不影响其他卡。

### Harness

- Tool allowlist；
- statistics result → CardSpec；
- publish pending 直到 Browser receipt；
- durable success + render fail = partial；
- duplicate toolCall 不重复创建 CardRecord；
- cancel after persistence 不删除 Artifact；
- model error 不伪报完成。

### Real E2E

- 真实 DeepSeek；
- 真实统计后端；
- 真实浏览器；
- 真实 Card persistence；
- 真实 reload。

## 16. P0 完成定义

只有同时满足以下条件，才可宣称“业务卡片能力完成首个闭环”：

1. 真实后端统计 Tool 可用；
2. StatisticsSnapshot 可追溯；
3. CardSpec v1 fail-closed；
4. Agent 不能篡改统计数字；
5. CardRecord 服务端持久化；
6. 当前页面实时展示；
7. 刷新后恢复；
8. Agent 等待真实 frontend effect；
9. Durable 与 visible 失败语义分离；
10. 真实 DeepSeek 自主完成 Gold Case；
11. 至少一个 Card → GIS 联动动作通过 GIS Capability；
12. 现有 GIS Agent E2E 不回归；
13. 不修改 `D:\deepseek-harness` AgentLoop/core；
14. 文档、代码和运行 profile 保持一致。

## 17. 后续演进

P1 基础生命周期已完成：

- refresh statistics ✅
- update ✅
- archive ✅
- delete ✅

下一轮不再继续补基础 CRUD。可按真实业务需求选择：更多 Pipeline 维度、ranking / warning / trend block、Restore / Unarchive、卡片排序和布局位置持久化，或 StatisticsSnapshot retention / GC。

P2：

- 多业务数据集；
- Business Artifact 不限于 Card；
- Report / Dashboard / Workflow Artifact；
- 受控动态组件目录；
- 评估 A2UI 兼容投影。

P3：

- 多人共享；
- Artifact 权限；
- 版本历史；
- 审批；
- 导出报告；
- 业务模板与 Agent 自动组合。
