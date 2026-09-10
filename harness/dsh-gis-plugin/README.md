# dsh-23dmaps-gis

23dmaps 的 DeepSeek Harness GIS / Business Artifact 集成包。Harness 负责模型编排、受控 Tool 调用、等待浏览器真实 Effect 回执，并把最新 MapContext 送入后续模型 Step；GIS 视觉效果仍由 23dmaps 浏览器端的 Capability / OpenLayers 执行，业务成果由 Business Artifact 后端持久化。

## 当前范围

当前已打通两条平级能力链。

GIS：

```text
Agent
→ GIS Tool
→ gisFrontend Pending Provider
→ AG-UI Bridge
→ FrontendExecutor
→ GIS Capability
→ OpenLayers
→ Browser Effect
→ Agent continuation
```

Business Artifact：

```text
Agent
→ Business Tool
→ Business Artifact Backend
→ StatisticsSnapshot / CardRecord
→ businessArtifactFrontend Pending Provider
→ AG-UI Bridge
→ BusinessCardBoard / Renderer
→ Browser Effect
→ Agent continuation
```

Business Artifact 当前生命周期：

```text
CREATE   ✅
READ     ✅
REFRESH  ✅
UPDATE   ✅
ARCHIVE  ✅
DELETE   ✅
```

## 模型可见 Tool Catalog

GIS User Vector 共 4 个：

- `import_vector_dataset`
- `set_vector_style`
- `fit_vector_layer`
- `set_user_layer_visibility`

Business Artifact 共 7 个：

- `get_pipeline_statistics`
- `publish_business_card`
- `list_business_cards`
- `refresh_business_card`
- `update_business_card`
- `archive_business_card`
- `delete_business_card`

合计 11 个模型可见业务/GIS Tool。`gisAgentPolicy` 使用同一 Business Tool Catalog 做 allowlist；测试会校验实际注册的 Business Tools 与 Catalog 一致，避免工具已注册但 Policy 未放行或反向漂移。

## Tool Contract

GIS Tool Schema 复用 `src/gis/integration/agui/frontendTools.js` 的 `FRONTEND_TOOLS` 与参数校验，Harness 不维护第二份 GIS Frontend Schema。

Business Card 的模型可见 JSON Schema 位于 `src/business-artifacts/cardSpecSchema.js`，服务端 Validator 位于 `src/business-artifacts/contracts.js`。两者共享 `cardSpecContract.js` 中的 schema version、枚举、binding path、field/layerId lexical rule 等基础 Contract；服务端继续保留无法或不适合仅靠 JSON Schema 表达的安全校验。

`get_pipeline_statistics` 当前是零参数能力：

```text
get_pipeline_statistics({})
```

当前 PoC 的真实含义就是“读取当前工作区允许的管线统计”，模型没有选择 region、metrics、dimensions 的虚假自由度。统计服务确定性生成数量、总长度和材质分布，并返回不可变 `StatisticsSnapshot` 的 `statistics_ref`。

## Refresh / Update / Archive / Delete 语义

`refresh_business_card`：重放原 StatisticsSnapshot 的 dataset / scope / query，创建新 Snapshot，并在同一 `cardId` 上 CAS 更新 revision；不会重新生成 CardSpec 布局。

`update_business_card`：修改标题、描述、布局、block、chartType 或 GIS Action 等 CardSpec 表达；如果已有 `statistics_ref` 仍合法则直接复用，不创建新 Snapshot。

`archive_business_card`：软下架 CardRecord，`active → archived`，revision + 1；CardRecord 和 StatisticsSnapshot 都保留。

`delete_business_card`：永久删除 CardRecord，但不连带删除 StatisticsSnapshot。Snapshot 清理由未来独立 retention / GC 策略负责。

Archive/Delete 的 Browser Effect 使用 revision tombstone，迟到的旧 LIST / PRESENT 不能让已经下架的卡片重新出现。

## refreshable 所有权

“某张卡当前能否 Refresh”由后端 Statistics / Refresh Capability 判断并随卡片列表返回 `refreshable`。Agent Plugin 不再 import `pipelineStatistics.js` 或复制 replay 规则，因此以后新增 parcel / farmland / risk-analysis 等统计 Provider 时，不需要让 Agent Plugin 理解各 Provider 的内部重放协议。

## 成功语义

模型只允许依据结构化结果声明成功：

- GIS 操作：必须 `ok=true` 且 `effect.status=applied`；
- Create / Update / Refresh：分别区分 `durable` 与 `visible`；
- Archive / Delete：分别区分 `durable` 与 `removedFromView`；
- Browser 回执返回前，Harness Tool Promise 不 settle；
- 409 revision conflict 不自动重试写操作；
- 持久化已成功但页面 Effect 失败时，不回滚已提交业务成果。

## Pending 与 MapContext

GIS 和 Business Artifact 分别使用独立 Pending Provider，但通过同一个 AG-UI Bridge 进行请求/回执关联。Pending 使用 Harness 生成的稳定 `requestId` 管理 settlement；`runId/toolCallId` 只承担浏览器协议相关性。

首次 Run 在 `agent.followup()` 前注入当前 MapContext。GIS Tool 完成后使用 Harness 原生 `ToolRunContext.deferContext()` 把最新 MapContext 放到下一模型 Step，保持 Tool Call / Tool Result 邻接。

## 当前 2D PoC 限制

`createAguiWorkflow()` 当前在一轮 Agent Workflow 开始前统一要求：

```text
scene === 2d
ready === true
```

因此现阶段即使 `list_business_cards / refresh / update / archive / delete` 本身不需要 OpenLayers，仍只能在 2D GIS Agent Workflow 可运行时由该 Agent 调用。这是当前 PoC 的产品级运行限制，不是 Business Artifact 数据模型的内在依赖。

真正必须依赖 GIS ClientScope 的只有 Card `map_action` 等地图 Effect。若后续要求在 Cesium 3D 场景下也独立管理 Business Artifact，应从 Workflow 能力门禁层解耦，而不是在各 Business Tool 中增加 `if business then skip 2d check` 的特殊旁路。

## 测试分层

- `npm run test:gis`：Repository、Statistics、Tool Contract、AG-UI、revision/tombstone 等单元与集成回归；
- `npm run test:gis:e2e`：确定性 Browser / OpenLayers / Business Artifact 页面回归；
- `npm run test:gis:harness-e2e`：真实 Harness WebServer + AgentLoop + Pending Provider + Mock LLM；
- `npm run test:gis:harness-real-e2e`：真实 DeepSeek 模型自主 Tool Planning 的活体验收。

真实 GeoServer `GX:js_ln` 已完成 Statistics / Refresh 验收；不是“尚未联调”。

## 尚未完成

- 生产真实用户/项目鉴权；
- Business Artifact 在 3D 场景下的独立管理入口；
- Archive → Active 的 Restore / Unarchive；
- StatisticsSnapshot retention / GC；
- 多用户实时协同和跨标签页冲突策略；
- Harness 进程重启后的进程内 Pending 恢复。
