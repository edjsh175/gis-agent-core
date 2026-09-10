# Business Artifact 分轮实施记录

依据：[PRD](./business-artifact-card-prd.md) 与 [架构](./business-artifact-card-architecture.md)。

状态：B0–B4 + P1 基础生命周期收口完成  
日期：2026-09-10

## 1. 轮次与出口

| 轮次 | 目标                             | 当前状态   | 出口                                                               |
| ---- | -------------------------------- | ---------- | ------------------------------------------------------------------ |
| B0   | 契约、验证、持久化 API、卡片面板 | ✅ 完成    | 无 LLM 创建并在页面重载/服务重启后恢复                             |
| B1   | 真实管线统计与快照               | ✅ 完成    | 数值通过服务端 StatisticsSnapshot 绑定，模型不能覆盖               |
| B2   | Harness 业务工具与浏览器回执     | ✅ 完成    | 确定性 Agent 完成统计、保存、展示、回执续跑                        |
| B3   | 真实 DeepSeek Gold Case          | ✅ 完成    | high reasoning 下真实统计、持久化与页面展示闭环                    |
| B4   | 卡片地图动作                     | ✅ 完成 P0 | 点击时重新经过 GIS Data Capability + Client Scope 查询、高亮、定位 |

## 2. 最终业务链路

```text
用户：统计当前项目管线数量、总长度和材质分布，生成概览卡片并永久保存
        ↓
DeepSeek Harness AgentLoop
        ↓
get_pipeline_statistics
        ↓
Business Statistics Capability
        ↓
真实 GeoServer WFS: GX:js_ln
        ↓
服务端聚合 + StatisticsSnapshot 持久化
        ↓
statistics_ref + availablePaths
        ↓
Agent 根据完整 CardSpec v1 JSON Schema 生成受控 spec
        ↓
publish_business_card
        ↓
服务端 Validator + statistics_ref/path/workflow 校验
        ↓
SQLite CardRecord 持久化
        ↓
Business Artifact Frontend Pending
        ↓
AG-UI Browser Effect: present_business_card
        ↓
BusinessCardBoard / BusinessCardRenderer
        ↓
effect.status = applied
        ↓
Agent continuation / final answer
```

页面刷新后的恢复链路不依赖 Agent：

```text
BusinessCardBoard mounted
        ↓
GET /__business-artifacts/cards
        ↓
CardRecord[] + StatisticsSnapshot[]
        ↓
Renderer
```

不会重新运行 LLM，也不会重新统计。

## 3. B0：Card Renderer + Persistence

### 已实现

- `CardSpec v1` 严格 Validator；
- 未知字段 fail-closed；
- HTML / URL / script 注入拒绝；
- 统计指标只接受 `{ statistics_ref, path }`，不接受模型直接给数值；
- SQLite `CardRecord` / `StatisticsSnapshot` Repository；
- JSON API：创建、列表、读取；
- principal + workspace 隔离；
- 默认无可信上下文时拒绝访问；
- `BusinessCardBoard` 页面投影；
- `BusinessCardRenderer`；
- `metric_group / text / chart / table / map_action` 受控 block；
- 柱状图、折线图、饼图；
- 单卡渲染失败隔离；
- 页面刷新、服务重启恢复；
- 列表响应与创建并发时的 revision/去重保护。

### 关键边界

- 卡片不进入 GIS Adapter、聊天消息存储或 Pinia GIS Store；
- CardRecord 是服务端权威对象，浏览器只是投影；
- 不允许模型生成 HTML、Vue、JS、CSS、iframe、远程组件 URL；
- 不修改 DeepSeek Harness core。

## 4. B1：真实 Pipeline Statistics

### 数据源

实际可工作的业务数据源是：

```text
GeoServer WFS
http://192.168.10.208:8080/geoserver/GX/ows
TypeName: GX:js_ln
```

仓库中原先声明的 `/serverGx/apiLine/getLines` 实测为 404，因此未围绕失效接口继续设计。

`GX:js_ln` WFS 当前可读取：

- `material`
- `shape_leng`
- 管线 Feature

服务端 `pipelineStatistics.js` 负责确定性聚合：

```text
summary.count
summary.total_length
groups.material
```

2026-09-09 本轮实测：

- 管线数：708
- 总长度：9500.842679917463
- 材质分布：铸铁 704、PVC 2、`1` 1、砼 1

这些值是当时真实 WFS 数据的验证结果，会随后端数据变化；不是测试夹具或写死业务值。

### StatisticsSnapshot

统计结果先保存为服务端不可变快照，再返回 `statistics_ref`。CardSpec 只能引用：

- `summary.count`
- `summary.total_length`
- `groups.material`

Renderer 最终显示值通过快照绑定解析，模型文本中的任意数字不能替代权威统计值。

## 5. B2：Harness Business Tools + AG-UI

当前模型可见 Business Artifact 工具：

- `get_pipeline_statistics`
- `publish_business_card`
- `list_business_cards`
- `refresh_business_card`
- `update_business_card`
- `archive_business_card`
- `delete_business_card`

工具名称由共享 `businessArtifactToolCatalog.js` 单一维护；契约测试会对账实际注册 Tool 与 Agent Policy allowlist。

新增独立业务前端边界：

- `businessArtifactFrontend`
- `businessArtifactPendingProvider`
- `present_business_card`

该通道与 `gisFrontend` 平级，不把业务卡片伪装成 GIS Tool。

`publish_business_card` 是一个逻辑原子业务动作：

1. 校验并持久化 CardRecord；
2. 获得 `cardId + revision`；
3. 请求当前 Browser 展示；
4. 等待 Browser Effect；
5. 返回 `durable / visible / effect`。

若持久化成功但浏览器失败，卡片仍保留，Tool Result 必须表达 `durable=true, visible=false`，不能丢失已保存业务成果。

确定性 Harness E2E 已验证：

```text
get_pipeline_statistics
→ publish_business_card
→ present_business_card
→ effect.status=applied
→ Agent continuation
```

其中确定性测试统计值 `12 / 42.5` 只用于验证编排与协议，不代表真实业务数据；B1/B3 使用真实 WFS。

## 6. B3：真实 DeepSeek Gold Case

真实指令：

> 统计当前项目管线数量、总长度和材质分布，生成一张概览卡片并永久保存。

### 暴露并修复的问题

最初 `publish_business_card` 只向模型声明：

```text
spec: object
```

但服务端实际要求严格 `business-card/v1`。真实 DeepSeek 在取得统计结果后只能猜 CardSpec 结构，连续生成不同字段并被服务端正确拒绝。

根因不是模型、SQLite、统计服务或 AG-UI，而是：

> 模型可见 Tool Schema 与服务端真实 Contract 不一致。

修复：新增 `src/business-artifacts/cardSpecSchema.js`，将完整受控 CardSpec v1 JSON Schema 暴露给 Harness Tool，同时服务端仍执行独立 Validator 二次校验。提交前收口又把 schema version、enum、binding path、field/layerId lexical rule 等基础约束抽到 `cardSpecContract.js` 共享，避免模型 Schema 与 Server Validator 再次手写漂移；服务端只额外保留安全性收紧校验。

模型现在明确可见：

```text
schemaVersion
title
description
layout
blocks
├─ metric_group
├─ text
├─ chart
├─ table
└─ map_action
```

以及每个统计 binding 的 `statistics_ref + path` 契约。

同时 Agent Policy 明确：当用户要求统计并生成/保存业务卡片时，必须调用业务工具完成事实获取和持久化，不能用自然语言回答替代执行。

### 实测结果

恢复原真实验收配置：

```text
DeepSeek: deepseek-v4-flash
thinking: enabled
reasoningEffort: high
```

Gold Case 通过，单次实测约 19.6 秒。

因此不需要通过关闭 reasoning 或不断提高超时来绕过根因。

## 7. B4：Card Map Action

P0 `map_action` 使用：

```json
{
  "type": "map_action",
  "label": "查看铸铁管线",
  "action": {
    "kind": "query_and_highlight",
    "layerId": "geoserver:GX:js_ln",
    "filters": [{ "field": "material", "op": "eq", "value": "铸铁" }]
  }
}
```

点击时执行：

```text
BusinessCardRenderer
        ↓
Map Action Adapter
        ↓
gis.data.queryFeatures
        ↓
重新读取当前 GeoServer / metadata
        ↓
fresh ClientScope
        ↓
highlightFeatures
        ↓
locateFeatures
        ↓
OpenLayers
```

关键约束：

- 不直接访问 `window.map2d`；
- 不在 Renderer 中 new OpenLayers Interaction；
- 不保存并复用旧 `feature_ref`；
- 每次点击重新查询当前要素；
- 每次执行创建 fresh ClientScope，因此 Map generation / scene / readiness 会重新校验；
- 当前 GIS Data Capability 只实际支持 metadata-backed `eq`，所以 CardSpec P0 同步只允许 `eq`，不宣称尚未实现的 `neq/in/gt/...`；
- 查询最大 100 条，超过时返回截断状态。

浏览器 E2E 已实际验证：持久化卡片点击后重新查询，OpenLayers 高亮 1 个要素并定位到该要素范围。

## 8. 2026-09-10 最终验证结果

### Unit / Service

```text
npm run test:gis
22 test files passed
152 tests passed
```

### Harness deterministic browser E2E

```text
npm run test:gis:harness-e2e
5 passed
```

覆盖：

- 会话重用与 Map replacement；
- statistics → persist → Browser Effect → continuation；
- Create → Refresh → Update → reload；
- Archive → 页面移除 → Delete；
- Card Map Action → GIS query → highlight → locate；
- 原有 SHP import → style → fit → continuation。

### Business Artifact browser E2E

```text
4 passed
```

覆盖：

- 创建与刷新恢复；
- 2 / 6 / 100 分组图表边界；
- chart 类型、空数据、未知 schema、单卡故障隔离。

### Real DeepSeek Gold Case

此前已通过：

```text
1 passed
DeepSeek high reasoning
约 19.6s
```

### Production build

```text
npm run build
PASS
```

仍存在原项目已有的 bundle size / dynamic import 构建 warning，不影响本轮成功构建。

## 9. 生产部署前置条件

当前功能闭环已经成立，但以下事项仍属于生产部署前置条件，而不是本轮伪造完成项：

1. 仓库仍没有可直接复用的生产用户/项目鉴权；生产必须提供真实 `resolveContext(req)`。
2. 本地 `--local-dev` 固定身份模式只能监听本机，不能作为多用户生产认证。
3. 生产需提供持久磁盘保存 SQLite，或将 Repository 替换为正式数据库实现。
4. Statistics Capability 必须继续绑定 principal + workspace 权限，不能把 GeoServer namespace 当作用户权限模型。
5. 若后续扩展 Map Action filter 操作符，必须先让 GIS Data Capability 真正支持，再同步扩展 CardSpec Schema。
6. P1 生命周期能力现已补齐：Refresh、Update、Archive、Delete 均已实现。Archive 仅软下架 CardRecord（status=archived、revision+1），Delete 永久删除 CardRecord；两者都不会删除 StatisticsSnapshot。
7. 浏览器投影对 Archive/Delete 使用 revision tombstone，避免迟到的旧 LIST/PRESENT 把已下架卡片重新显示。
8. `refreshable` 由后端 Statistics / Lifecycle Service 判定并随 Card 列表返回，Harness Agent Plugin 不再依赖 `pipelineStatistics.js` 内部 replay 规则。
9. 当前 `createAguiWorkflow()` 仍统一要求 2D scene ready，因此 Business Artifact 管理 Tool 目前也只能从可运行的 2D GIS Agent Workflow 发起；这是 PoC 运行限制，不是 Artifact 数据模型的内在依赖。
10. 正式 `BusinessCardBoard` 已移除 B0 验证按钮/测试 CardSpec；验证 fixture 只存在于 browser tests。

## 10. 当前结论

B0–B4 的首个业务闭环已经完成：

> 真实业务统计可以被 Agent 获取为受控快照，真实 DeepSeek 可以基于快照生成受控业务卡片，CardRecord 可以永久保存并在页面刷新后恢复，浏览器展示结果通过 AG-UI 回执给 Agent；持久化卡片中的受控地图动作也可以在点击时重新经过现有 GIS Capability 查询、高亮和定位。

当前 Business Artifact 生命周期已经具备 CREATE / READ / REFRESH / UPDATE / ARCHIVE / DELETE。下一阶段不再需要继续补基础生命周期，应转向真实权限、更多业务统计能力、Artifact 检索/恢复策略或更高层业务工作流。
