# GIS Agent / AG-UI 实施记录

日期：2026-09-08。

> 本文保留 2026-09-08 H0–H3 的历史验收状态，不作为当前 Tool Catalog / Business Artifact 状态真源。当前实现以 `harness/dsh-gis-plugin/README.md`、`business-artifact-card-architecture.md` 和 `business-artifact-card-implementation.md` 为准。

## 当日结论

当前已经完成两条确定性技术验证链路：

1. 业务查询结果 → `feature_ref` → locate → highlight → Tool Result → AG-UI 续跑。
2. 浏览器用户文件 → `file_ref` → import vector → `layer_ref` → style → fit → visibility → Tool Result → AG-UI 续跑。

这证明了 **后端 Agent Runtime 可以通过 AG-UI 驱动当前浏览器中的 GIS Capability，并等待真实地图效果回执后继续运行**。

浏览器 AG-UI Gold Case 保留 `tests/gis/agui/deterministicService.js` 作为确定性协议回归，同时 DeepSeek Harness H0-H3 已闭环：23dmaps 内的 out-of-tree GIS bundle 通过真实 Harness `ToolRuntime + AgentLoop + WebServer` 驱动浏览器 OpenLayers，验证 `LLM step → GIS Tool → pending provider → AG-UI → Browser GIS effect → Tool Result → MapContext → 下一 step`。真实 DeepSeek Browser E2E 明确绑定 `deepseek-official / deepseek-v4-flash` 并通过 Harness `credentials-local` 读取本机凭证，真实自主 Tool Planning Gold Case 已通过。真实 GeoServer、生产认证、完整租约续期和跨标签页生产冲突仍未完成。

## 架构边界

保持以下边界不变：

```text
UI / Agent
    ↓
GIS Capability
    ↓
Map Runtime / Client Scope
    ↓
OpenLayers Adapter
```

Agent 不直接调用 Vue Component、Pinia、`window.map2d` 或 OpenLayers 实例。AG-UI 只负责 Agent ↔ 浏览器的协议往返，不承载 GIS 对象语义。

## User Vector Capability

2026-09-08 最终收口：`FeaturePanel`、`LoadShp` 与 `pipeline/index.vue` 的 SHP 导入都已统一委托 `FileReferenceStore → User Vector Capability → OpenLayers Adapter`。活动业务路径不再直接 `window.map2d` / `new VectorLayer`，不再把 SHP 写入 `plottingStore` / `MY_VECTOR_LAYER`；`shapefile` 解析只保留在 `readVectorDataset.js` 单点实现。`shapeManager.js` 仅保留委托到同一实现的旧 API 兼容门面，当前源码无活动调用方。


新增 `src/gis/user-vector/`：

- `fileReferenceStore.js`：把浏览器 File/Blob 登记为不可猜测 `file_ref`；首版只接受同名 `.shp + .dbf`。
- `readVectorDataset.js`：统一 SHP 解码入口；旧 `shapeManager` 也委托这里，避免第三套 SHP parser。
- `styleContract.js`：定义稳定的 stroke/fill/radius GIS 样式契约，不暴露旧 UI 字段。
- `createUserVectorCapabilities.js`：维护当前 Map generation 下的用户矢量对象注册表和 `layer_ref` 生命周期。

用户导入一份数据后得到独立 `VectorLayer`，而不是继续把所有 SHP Feature 塞进共享 `MY_VECTOR_LAYER`。

标准对象链：

```text
Browser File
→ file_ref
→ import_vector_dataset
→ independent VectorLayer
→ layer_ref
→ set_vector_style / fit_vector_layer / set_user_layer_visibility
```

`layer_ref` 可以跨同一地图 generation 内的多个 workflow scope 继续使用；地图 detach / scene replacement 后注册表和实际用户图层同时失效，旧 scope 返回 `STALE_CONTEXT`。

## UI 迁移

`FeaturePanel.vue` 的 SHP 入口已经改为：

```text
选择 .shp + .dbf
→ fileReferences.registerVectorDataset
→ createClientScope
→ importVectorDataset
```

不再把该 SHP 同时写入 `plottingStore → MY_VECTOR_LAYER`，避免一份数据出现两套对象身份和重复渲染。

旧绘制/GeoJSON 路径暂未整体迁移，本阶段只收敛 SHP Gold Case。

## AG-UI Frontend Tools

新增 P0 Tools：

- `import_vector_dataset(file_ref, name?)`
- `set_vector_style(layer_ref, style)`
- `fit_vector_layer(layer_ref)`
- `set_user_layer_visibility(layer_ref, visible)`

工具继续经过统一 `frontendExecutor`：参数 schema fail-closed、同 run/toolCall 去重、按 workflow 串行执行、执行前后检查 scope、动作完成后读取最新 MapContext，并返回 `effect.status`。

用户矢量导入/删除被标记为 Capability 自身图层变化，fit 复用 locate 的视图效果标记，显隐复用 visibility 标记，因此不会被“用户操作优先”监听器误取消自身 workflow。

## MapContext

MapContext schema 升级为 v2，新增：

```text
availableFiles[]
  file_ref
  name
  format
  parts

userLayers[]
  layer_ref
  name
  geometryTypes
  featureCount
  visible
  style
```

不会把浏览器 File、本机路径、Feature 全集、geometry、VectorLayer、VectorSource 或 Pinia 状态传给模型。

## 确定性 Gold Case

当前浏览器 E2E 新增场景：

```text
用户已提供 roads.shp + roads.dbf
→ MapContext 暴露 vf_roads
→ import_vector_dataset
→ ul_roads
→ set_vector_style(red, 4px, 0.8)
→ fit_vector_layer
→ set_user_layer_visibility(false)
→ 每步 receipt.effect.status = applied
→ 后端消费四个 Tool Result
→ 第五个 Run 无待执行工具
→ completed
```

浏览器测试使用真实 OpenLayers `VectorLayer/VectorSource/Style/View`；为了让测试不依赖仓库外二进制 SHP 文件，E2E 的数据解码器注入固定 GeoJSON Feature。`file_ref/layer_ref/AG-UI/OL` 链路是真实的，SHP parser 本身不是这条 E2E 的验证对象。

## DeepSeek Harness H0-H3

新增 `harness/dsh-gis-plugin/`，作为 23dmaps 自己维护的 Harness out-of-tree bundle，不修改 `D:\deepseek-harness` 的 `agent-loop` 或 core packages。

Harness GIS seam 包含以下角色：

```text
GIS Tool Consumer
      ↓
gisFrontend Service Definition
      ↓
Pending Browser Provider
      ↓
AG-UI Bridge
      ↓
23dmaps FrontendExecutor / GIS Capability

H0 的 Fake Provider 只保留为无浏览器的 Harness 回归测试 Provider。
```

首批 Consumer 只注册四个 User Vector Tool。Tool Schema 与参数校验直接复用 `src/gis/integration/agui/frontendTools.js`，没有复制第二份 GIS Tool Contract。Fake Provider 只模拟 user layer 状态，不包含 `phase === 0/1/2` 或固定 Gold Case 顺序。

Harness Tool 成功边界新增 fail-closed 约束：`ok: true` 必须同时证明 `effect.status: applied`；`import_vector_dataset` 还必须返回非空 `layer_ref`。AG-UI transport-only 字段在进入模型 Tool Result 前被剥离。

H0-H3 已通过以下验证：

1. 23dmaps 单测覆盖 Service Provider 单例/释放、Abort、四个 User Vector Tool、未知 `layer_ref`、成功 effect 门槛、transport 字段剥离、Pending Provider 单 settlement 和共享参数契约。
2. 使用 `D:\deepseek-harness` 真实 `ToolRuntime + AgentLoop + MockAdapter` 运行同一 Turn：Tool Promise 未 resolve 前 Agent 保持 running 且不会提前产生下一模型请求；Browser receipt resolve 后 Harness 自动写入 `tool/result` 并进入下一 step，没有通过 `agent.followup()` 伪造 Tool continuation。
3. H2 使用 Harness 原生 `exec.deferContext()` 回灌最新 MapContext。真实 Session Log 已验证顺序为 `assistant tool-call → tool/result → plugin MapContext user/message → next assistant step`，不破坏 Tool Call / Result 邻接。
4. 新增 GIS Agent Policy，在 Agent 创建阶段通过 scoped `tools.restrict()` 将模型实际可见工具限制为四个 User Vector Tool + `ask_user_question`。测试 Adapter 会直接检查模型收到的 `options.tools`，有 bash/web/fs/subagent 等额外工具即失败。
5. 新增独立 Browser Harness E2E lane：真实 Harness `WebServer + AgentLoop + Pending Provider` 与 23dmaps `HttpAgent + FrontendExecutor + OpenLayers` 完成 `import → style → fit → final answer` 全链路；原 18 条 deterministic E2E 保留不变。
6. 真实模型联调额外暴露并修复两层失败语义漏洞：Bridge 不再把 `agent.whenIdle()` 当成成功，而是读取 durable `turn/end.data.reason`，`reason.kind = error` 映射为 AG-UI `RUN_ERROR`；浏览器 `runEnvelope` 也不再把合法 `RUN_ERROR` 误判成 `PROTOCOL_ERROR`，而是保留为 `AGENT_RUN_FAILED`。因此模型失败时 workflow 会进入 `failed`，不会再出现“模型失败但前端假 completed”。
7. H3 真实 DeepSeek 模型自主 Tool Planning / Orchestration Gold Case 实测通过：在 `~/.dsh/.credentials.yaml` 中配置 `DEEPSEEK_API_KEY` 凭证后，`npm run test:gis:harness-real-e2e` 调用真实 `deepseek-official / deepseek-v4-flash` 模型，模型依据自然语言输入自主完成 `import_vector_dataset` → `set_vector_style` → `fit_vector_layer` 的多轮工具编排，收据流均标记为 `applied` 且 `delivered`，OpenLayers 图层与样式精确生效，最终状态成功收敛为 `completed`。

bundle 已通过 Harness profile 安装与 `--dump-config` 组装验证，默认结构为 `gis-frontend-service / gis-frontend-pending-provider / gis-user-vector-tools / gis-ask-user-tool / gis-agent-policy / gis-agui-bridge`。

## 验收结果

2026-09-08 H0-H3 收口后实测：

```text
npm run test:gis
7 files / 57 tests passed

npm run test:gis:e2e
18 tests passed

npm run test:gis:harness-e2e
1 test passed

npm run test:gis:harness-real-e2e
1 test passed (真实 DeepSeek deepseek-v4-flash 11.6s)

npm run build
passed

git diff --check
passed
```

E2E 同时继续覆盖旧 query → locate → highlight、异常参数、多工具拒绝、RUN_ERROR、损坏 state patch、用户手势取消、用户显隐优先、引用拉取期间 scene replacement 等场景。

Build 只有既有的大 chunk 和静态/动态重复导入 warning，没有新增构建失败。

## 仍未完成

以下不能宣称完成：

- 真实 GeoServer 查询联调。
- 生产登录/鉴权接入。
- 30 秒租约续期和完整跨标签页 Session Binding 生命周期。
- GeoJSON/KML/CSV/ZIP 等更多用户数据格式。
- `.prj` / CRS 识别与投影转换。当前首版按 EPSG:4326 经纬度解释几何；投影坐标会被几何校验 fail-closed，避免错误落图。
- `remove_user_layer / list_user_layers / get_user_layer_info` 的 AG-UI P1 暴露（Capability 内部能力已预留）。
- 旧绘制、旧样式编辑 UI 全量迁移到 User Vector Capability。

下一阶段的进入条件已经满足：真实 LLM 自主工具规划已闭环落地，可进行后续工程特性扩展（如更多矢量格式支持、CRS 识别转换、GeoServer 查询联调等）。
