# dsh-23dmaps-gis

23dmaps 的 DeepSeek Harness GIS 集成包。GIS 业务能力继续由 23dmaps 浏览器端执行；Harness 负责模型编排、工具调用、等待前端真实效果回执，以及把最新 MapContext 送入后续模型 Step。

## 当前范围：H0-H3

默认 bundle 已形成完整 GIS Capability Seam：

```text
GIS Tool Consumer
      ↓
gisFrontend Service Definition
      ↓
Pending Browser Provider
      ↓
AG-UI Bridge
      ↓
23dmaps FrontendExecutor
      ↓
GIS Capability / OpenLayers
```

主要模块：

- `gisFrontendService.js`：Harness 内部 GIS Frontend Service Definition；
- `pendingProvider.js`：同一 Harness 进程内持有待浏览器完成的 GIS Tool Promise；
- `gisTools.js`：模型可见 GIS Tool Consumer；
- `gisAgentPolicy.js`：在 Agent 创建阶段通过 scoped `tools.restrict()` 收敛模型实际可见工具；
- `aguiBridge.js`：`/sessions /run /cancel` 的 AG-UI HTTP/SSE 运输与 Session Binding；
- `fakeProvider.js`：仅用于 H0 无浏览器回归，不进入默认 bundle；
- `mockLlmProvider.js`：仅用于 Browser Harness E2E，不进入默认 bundle。

首批模型可见 GIS 工具：

- `import_vector_dataset`
- `set_vector_style`
- `fit_vector_layer`
- `set_user_layer_visibility`
- `ask_user_question`

GIS Agent Policy 会把模型实际 Tool Catalog 限制为以上 5 个工具。测试 Adapter 会直接检查模型请求中的 `options.tools`；若 bash/web/fs/subagent 等额外工具泄漏到 GIS Agent，请求直接失败。

## 单一 Tool Contract

Tool Schema 直接复用 `src/gis/integration/agui/frontendTools.js` 的 `FRONTEND_TOOLS`，参数校验也复用同一文件的 `validateToolCall`。Harness 不维护第二份 GIS Tool Schema。

## 成功语义

模型只会收到经过归一化的 GIS 结果：

- `ok: true` 必须同时满足 `effect.status: "applied"`；
- `import_vector_dataset` 成功必须返回非空 `layer_ref`；
- Browser / AG-UI transport-only 字段不会进入模型 Tool Result；
- `ok: false` 保留结构化 `error` 与 `effect.status`，供 Agent 决定下一步；
- 浏览器真实 effect 回执返回之前，Harness Tool Promise 不 settle，Agent 不会提前进入下一模型 Step。

## Pending 生命周期

Pending Provider 使用 Harness 自己生成的稳定 `requestId` 管理一次浏览器 GIS 操作：

```text
requested
→ pending
├→ resolved
├→ aborted
└→ provider disposed
```

同一个 pending request 只有一个 settlement 点；AbortSignal、Provider dispose、重复/迟到回执都在该边界处理。AG-UI 的 `runId/toolCallId` 继续作为浏览器协议关联字段，不作为 Pending Provider 的根身份。

当前恢复边界与 Harness User Questions 一致：浏览器/HTTP 重连可在同一进程内继续，完整 Harness 进程重启后不恢复进程内 Promise，必须 fail closed。

## MapContext

首次 Run 在 `agent.followup()` 前把浏览器当前 MapContext 作为 plugin message 注入 Agent。

GIS Tool 完成后，`gisTools.js` 使用 Harness 原生 `ToolRunContext.deferContext()` 延迟最新 MapContext。Session Log 已验证顺序：

```text
assistant tool-call
→ tool/result
→ plugin MapContext user/message
→ next model step
```

因此不会破坏 Tool Call / Tool Result 邻接，也不需要用新的 `agent.followup()` 伪造 continuation。

## 测试分层

保留三条独立浏览器测试通道：

1. `npm run test:gis:e2e`：deterministic AG-UI Fixture，验证协议错误、取消、stale context 等回归；
2. `npm run test:gis:harness-e2e`：真实 Harness `WebServer + AgentLoop + Pending Provider` + Mock LLM，稳定验证 Runtime / Browser 集成；
3. `npm run test:gis:harness-real-e2e`：真实 `deepseek-official / deepseek-v4-flash`，验证模型依据 MapContext 和 Tool Result 自主连续选择 GIS Tool，并让真实 OpenLayers 产生可验证效果。

Mock Harness Browser E2E 使用 `mockLlmProvider.js` 做确定性模型决策，只为了稳定验证 Runtime / Browser 集成；默认 GIS bundle 不加载该 Adapter。H3 Real E2E 已验证真实 DeepSeek 能完成 `import_vector_dataset → set_vector_style → fit_vector_layer → final answer`。

AG-UI Session Binding 的 `configVersion` 使用独立协议版本 `harness-gis-v1`，不再与 H0-H3 项目阶段编号耦合。

## 尚未完成

- 真实 GeoServer 查询联调；
- 生产认证与跨标签页冲突策略；
- 完整租约续期；
- Harness 进程重启后的外部操作持久恢复。
