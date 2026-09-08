# GIS Agent Integration / AG-UI PRD

状态：AG-UI SDK + HTTP/SSE + Vue Frontend Tool 往返的 G0 已完成确定性验证；G1-lite（scope/generation/cancel/stale/去重/用户操作优先）已具备。当前 PoC 已新增 User Vector Capability，并通过 `file_ref → layer_ref → style → fit → visibility` 的确定性浏览器 Gold Case。真实 LLM Agent、真实 GeoServer 与生产级 auth/lease 仍未完成。更新：2026-09-08。实施范围及验证见 [实施记录](./agent-integration-record.md)。本文只新增集成层，不推翻 [Capability Layer PRD](./capability-layer-prd.md)。

## 1. 阶段与架构决策

本地 queryFeatures → locateFeatures → highlightFeatures 已完成，AG-UI Frontend Tool + Shared State + Tool Result 的浏览器真实往返也已完成 G0。当前技术验证优先级转为 User Vector Capability：先让 UI 与 Agent 共用同一套用户矢量对象模型，再接真实 LLM；不默认另造 Browser Command Bridge，也不让生产级认证阻塞 PoC。

“首选协议已确定”不等于“项目已接入”：正式集成前须通过本文的 Vue/Agent 适配验证。若选用的 Agent 框架无法完成标准前端工具往返，先修正或更换适配器；只有记录明确协议缺口及替代方案后才重新评审，不静默退回自研协议。

~~~text
                           GIS Agent
                         /           \
             Backend GIS Tools    Frontend GIS Tools
                     |                  |
              Data Capability         AG-UI
                     |                  |
             GeoServer / Backend   23dmaps Vue Adapter
                                        |
                                   Client Scope
                                        |
                               GIS Client Capability
                                        |
                                 Map Runtime
                                 /         \
                           OpenLayers     Cesium
~~~

首次 Agent 闭环只接已完成的二维能力；Cesium 是后续能力适配方向。AG-UI 不使尚不支持的三维能力自动可用。Backend GIS Tools 在服务端运行，复用 Data 契约和业务规则；不能把依赖 Pinia/window 的浏览器单例搬入后端。后端语言、Agent 框架和模型不由本 PRD 指定，须以协议验证门槛筛选，不作为 Capability 本地实施的前置条件。

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| GIS Capability | 图层、查询、定位、高亮等能力的语义、错误和生命周期 | Agent 事件、对话、远程引用 |
| AG-UI 集成 | 工具声明/事件/结果适配、共享状态投影、当前页面绑定 | 绕过能力层操作地图、实现另一套 GIS |
| 本地 runtime / scope | 哪个地图代次、哪个 owner 仍有执行资格 | 网络会话与鉴权 |
| 未来 MCP Adapter | 向外部 Agent 暴露受控数据/工具 | 替代浏览器身份、绕过 AG-UI 或 scope |

文档顺序：01 capability-audit → 02 capability-layer-prd → 03 migration-and-acceptance → **04 本文** → 05 mcp-adapter-prd（后续，不创建空文件）。Capability 本地闭环已通过模拟服务测试；真实 GeoServer 联调仍是发布欠项，与集成层开发并行。

## 2. 官方协议事实与项目约定

核实日期为本文更新日，来源是官方动态文档；实施时锁定版本并重新验证，不依赖文档 main 分支永远不变。

- AG-UI 提供 Agent 与用户应用间的事件协议，Frontend Tool 可把动作交给应用执行。它与面向工具/数据的 MCP 处在不同连接边界。[官方概述](https://docs.ag-ui.com/introduction)
- 客户端提供的工具在 RunAgentInput.tools 声明；后端工具由 Agent 配置。TOOL_CALL_START/ARGS/END 用于接收工具名与参数，前端完成实际执行后返回关联 toolCallId 的 role=tool 消息。工具失败使用 ToolMessage.error，同时保留业务结构化结果。[官方 Tools](https://docs.ag-ui.com/concepts/tools)
- STATE_SNAPSHOT 是协议状态的整体替换，STATE_DELTA 是有序 JSON Patch。协议状态不是 OL 地图或 Pinia 实例；如何与业务状态协调由项目决定。[官方 State](https://docs.ag-ui.com/concepts/state)
- threadId/runId 标识对话和一次执行；不把它们当浏览器标签页身份。TOOL_CALL_RESULT 与工具调用结束事件分离。不能从 RUN_FINISHED 推断本地地图动作已经完成。[官方类型](https://docs.ag-ui.com/sdk/js/core/types)、[官方事件](https://docs.ag-ui.com/sdk/js/core/events)
- 官方 JS HttpAgent 提供 HTTP 事件流客户端；React helper 不是协议要求。Vue 使用独立的 composable/适配器连接客户端与现有 store，不引入 React 容器。[HttpAgent](https://docs.ag-ui.com/sdk/js/client/http-agent)

以下 session/workflow 绑定、feature_ref、effect、去重、超时、状态所有权均为 **23dmaps 集成约定**，不是 AG-UI 的内置 GIS 类型或交付保证。不新增名为 GIS_EFFECT 的标准事件，不给标准 TOOL_CALL_ARGS/END 擅自添加必填的浏览器字段。

## 3. Frontend Tools 与完整往返

### 3.1 工具边界

| 工具名 | 执行处 | 模型可见参数 | 对应能力 |
| --- | --- | --- | --- |
| list_layers | 后端 | 无 | listLayers，返回服务目录；loaded 状态从共享地图快照取得 |
| query_features | 后端 | layerId、filters、limit（遵循原 PRD） | queryFeatures；集成层登记结果并返回引用与摘要 |
| locate_features | 当前浏览器 | feature_ref | 解析结果后 scope.locateFeatures({features}) |
| highlight_features | 当前浏览器 | feature_ref、group?、mode?、effect? | scope.highlightFeatures，默认值沿用原 PRD |
| clear_highlight | 当前浏览器 | group? | scope.clearHighlight，仅当前 Agent workflow owner |
| set_layer_visibility | 当前浏览器 | layerId、visible | scope.setLayerVisibility |
| import_vector_dataset | 当前浏览器 | file_ref、name? | scope.importVectorDataset；创建独立用户 VectorLayer 并返回 layer_ref |
| set_vector_style | 当前浏览器 | layer_ref、style | scope.setVectorStyle；使用稳定 GIS Style Contract |
| fit_vector_layer | 当前浏览器 | layer_ref | scope.fitVectorLayer；等待视图动作完成 |
| set_user_layer_visibility | 当前浏览器 | layer_ref、visible | scope.setUserLayerVisibility |

只把本次允许且当前场景支持的 Frontend Tools 放入 RunAgentInput.tools。后端仍核对工具白名单；收到未知工具、额外参数或不合法 JSON 不执行。工具 schema 不接收 JavaScript、任意请求 URL、sessionId、owner 或“选择最新地图”的参数。

共享状态展示当前二维就绪、已加载业务图层、用户图层摘要、浏览器已登记文件引用和能力可用性；三维或地图未就绪时不宣称二维操作可用。`availableFiles` 只包含 `file_ref/name/format/parts`，`userLayers` 只包含 `layer_ref/name/geometryTypes/featureCount/visible/style`，不向模型暴露 File、完整 Feature、geometry、VectorLayer/VectorSource 或 Pinia。声明之后发生场景切换，执行前仍按 runtime 检查，不能依赖旧工具列表当作授权。

### 3.2 默认传输与续跑

本阶段默认使用同源 HTTP POST + SSE 响应流，由 AG-UI JS 客户端解码；不要求 WebSocket 或跨标签页广播。服务端接口归 Agent 集成服务，具体路由在适配验证时确定，不影响 GIS 公共 API。

为使首条链路易于验收，本集成 profile 规定一次协议 run 最多产生一个 Frontend Tool 调用，后端产生它后结束本次 run。Vue 收齐 START/ARGS/END 并观察 RUN_FINISHED 后，验证只有一个完整前端调用再执行。中途断流、RUN_ERROR、不完整参数或多个前端调用均拒绝本批执行。后端数据工具事件可以展示，但不能在浏览器工具注册表中执行。

执行结果追加为 role=tool 消息；客户端带更新的消息记录、状态和同一 threadId 发起下一次 run，使用新的 runId，服务端核验它对应前一个待返回调用。原 assistant tool-call 消息和 toolCallId 必须保留。此续跑是项目选定模式，官方集成也给出了前端执行后下一次请求回传结果的例子。[官方前端工具往返示例](https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/claude-managed-agents/typescript/README.md#frontend-tools-human-in-the-loop)

模型要依次 query → locate → highlight：先取得后端数据引用，发出 locate 前端调用；收到真实定位成功结果后才在后续 run 发出 highlight。TOOL_CALL_END、RUN_FINISHED、输出“正在定位”均不能被 UI 或 Agent 记录为地图已完成。定位失败后不得自动执行高亮。

## 4. Browser Session、Run 与 Client Scope

| 标识 | 来源与寿命 | 用途 |
| --- | --- | --- |
| browserSessionId | 集成服务为已鉴权的单次页面实例登记；刷新/新标签页新建 | 隔离浏览器实例；不放 localStorage 跨页面复用 |
| threadId | AG-UI 对话；可有多个 run | 保存对话，不授权任何地图 |
| runId | 每次协议执行新建，包括工具结果续跑 | 关联单次事件流 |
| workflowId | 应用为一条用户指令及其多次续跑创建 | 绑定一个 scope.owner，支持取消及结果清理 |
| generation | 本地 runtime attach/detach 维护 | 拒绝旧地图/已销毁实例 |
| toolCallId | 当前 run 中的工具关联 ID | 结果关联、去重 |

集成服务保存“已鉴权主体 + browserSessionId + threadId + workflowId + runId”的绑定，客户端适配器保存同一 workflow 对应的本地 scope/generation。页面首次 run 时登记绑定；自定义绑定信息放在 RunAgentInput.forwardedProps 的项目命名空间 gisIntegration，由服务端校验，不能仅相信请求里自报的 ID。[RunAgentInput](https://docs.ag-ui.com/sdk/js/core/types#runagentinput)

标准工具事件不都携带 runId；适配器从当前已验证连接上下文关联，不能凭工具参数里的 run/session 字符串路由。接收 RUN_STARTED 时核对预期 threadId/runId。相同 threadId 在首版只允许一个页面作为地图执行者；另一个标签页尝试绑定时返回 SESSION_BINDING_CONFLICT，不广播给“最近活动”页面。

每页一次只执行一个活跃 Agent workflow；新用户指令先结束旧 workflow。续跑沿用原 workflow/scope，不为每个 run 创建新 owner。正常 run 结束不 dispose scope，因为可能等待前端执行及下一次 run。整个 workflow 完成后保留其结果高亮，直到用户明确清除、发起新 workflow 或地图 detach；结束后拒绝新的远程动作，保留本地清理入口。

完成判据由集成执行器负责：一个正常结束且含完整前端调用的 run 进入 waiting_frontend，执行后进入 waiting_result_submission，再进入下一次 run。只有后续 run 正常结束且没有前端调用、没有待执行动作、没有待提交结果或待发起续跑时，workflow 才进入 completed。无工具的初始 run 同样可直接完成；RUN_ERROR、协议错误或业务链路失败进入 failed，显式取消进入 cancelled。failed/cancelled 均停止后续地图动作并清理本 owner；completed 只关闭远程执行资格、保留高亮及本地清理。网络中断有未确认结果时不能进入 completed。这个完成判据是应用规则，不依赖模型文本或状态 patch 声称“完成”。

业务工具失败后的 failed 状态只关闭效果执行资格，不禁止结果交付：保留原 pending toolCallId，将失败 ToolMessage 回传，并允许一次仅用于解释失败的续跑（Frontend tools 为空，后端禁用新的 GIS 工具）；该续跑不得创建新 scope 或执行地图动作，结束后仍为 failed。协议已损坏、用户取消或连接不可用时不强制续跑，只记录未交付结果。结果交付记录与 scope 生命周期分离，避免 dispose 导致 Agent 永远收不到定位失败的原因。

生产目标仍采用服务端 90 秒租约并计划由活跃页面周期续租；这是项目会话管理，不是 AG-UI 新事件。当前技术验证只保留 G1-lite 所需的 scope/generation/cancel/stale/去重/用户操作优先，完整续租、跨标签页生产冲突与真实认证降为后续 P1，不作为 User Vector PoC 阻塞项。服务端返回到期时间，客户端用不晚于服务端期限的本地单调时钟预算检查（从续租请求发出时起计时，扣除往返耗时），在执行前/回调提交前检查并在到期时取消旧 scope。正常退出/刷新尽力撤销绑定；异常退出不承诺服务端瞬时感知，最迟在最后一次成功续租后 90 秒失效。新页面只能在旧绑定已撤销或租约过期后重新绑定；等待期间显示冲突，不自动抢占。过期 session 不得续租复活，需新建；旧 pending call、引用和迟到结果同时失效。此规则防止旧标签页失联后永久占用 thread，也禁止新页面接管旧动作。

会话 ID 不是凭证；后端对 run、引用解析、取消和结果提交统一鉴权。重连/刷新不自动重新授权旧地图动作。已有 UI owner 与 Agent owner 分离，Agent 不能清除 UI 的查询或绘制资源。

## 5. feature_ref：跨边界数据引用

### 5.1 只加在集成层

原 Capability API 继续接收完整 CapabilityFeature[]。feature_ref 是后续 Agent 集成的显式结果句柄，既不是裸 feature_ids，也不是业务 pipeid，更不是 OL Feature 地址。引用解析与网络请求发生在 AG-UI 适配层进入 Client Capability 之前；locate/highlight 核心仍不联网。

默认结构：

~~~json
{
  "resultId": "服务端生成的不可猜测结果句柄",
  "indices": [0, 2]
}
~~~

indices 可省略表示该快照全部要素；提供时须为非空、无重复、合法下标数组。下标仅针对不可变结果快照，不等于源要素 ID，不会随表格排序改变。一次引用只指向一个查询结果，保留原 layerId/sourceFeatureId/geometry/properties；缺源 ID 按原契约仍可显示。

### 5.2 生产、解析和失效

后端 query_features 在 Data 查询成功后，把结果登记为不可变快照，绑定用户、页面、thread、workflow 与配置版本；模型只收到 resultId、要素计数、有限的业务编号摘要、truncated 与 expiresAt，不接收整份几何。空结果返回零条摘要，不生成可执行引用，也不发定位调用。

Vue 工具解析器通过同源、已鉴权的结果读取接口按 resultId 拉取快照，校验绑定与数据格式后缓存于当前 workflow。Agent 不能传入下载 URL。解析器先验证 scope，再拉取，完成后再次验证 generation；旧请求完成也不能绑定到新 scope。

默认快照绝对寿命 10 分钟，不因读取延期；每个 workflow 最多保留 10 个快照，每个沿用 Data 上限 100 要素，序列化后最多 5 MiB。达到上限返回 RESULT_LIMIT_EXCEEDED，不悄悄删旧引用或裁剪几何。workflow 取消、页面刷新/退出或配置变化时本地立即停止接受该引用；服务端收到撤销/配置更新则立即拒绝，未收到退出通知时由页面租约或快照寿命中更早的到期时间兜底。正常完成后不接受新 Agent 动作，已显示结果不依赖后续引用存活。

引用不存在/过期返回 FEATURE_REF_EXPIRED；绑定不匹配返回 FEATURE_REF_FORBIDDEN；配置版本变化返回 STALE_CONTEXT，要求新查询。不能拿旧 ID 悄悄重新查询当前数据代替原快照。

## 6. Shared Map State 的所有权

共享状态是可序列化的观察投影，不是 Pinia 全量镜像、不包含几何全集或引擎对象。

MapContext 是浏览器面向 Agent 的语义观察，绑定信息属于集成执行器的传输元数据。第一批使用按需 getSnapshot，在运行开始/工具回执续跑边界读取最新值；尚未实现运行中的事件订阅与用户操作取消。generation、owner 不进入面向模型的 MapContext，执行器仍须保留它们完成权限与失效检查，不能以公开 revision 替代 scope。

观察契约区分 null（未接入或不可观察）与空数组/空对象（已观察且为空）。selection 暂为 null，不从名为 selection 的高亮分组推断用户选择。highlight 标记 coverage=capability，只汇总能力适配器实际持有且仍存在于源中的高亮，包含计数、有限对象身份和缺失身份计数；不宣称覆盖旧业务高亮。身份用于描述，不提供通过身份自动补查的解析入口。

layers 的 loaded 为 complete/partial/none/ambiguous；仅完整唯一绑定且所有实例一致时 visible 为布尔值，其余为 null。显隐包含父分组开关，表示配置显隐，不保证瓦片已加载或要素在当前视野。viewport 首批提供 EPSG:4326 center 与 zoom，三维/未就绪为 null；范围 extent 留待后续观察适配扩展。

| 区域 | 权威来源 | 共享字段 |
| --- | --- | --- |
| gisObserved | 当前浏览器观察适配器 | MapContext：schemaVersion、revision、dimension、ready、supportedTools、layers、visibleLayers、viewport、selection、highlight、availableFiles、userLayers |
| agent | 后端 Agent | 当前 workflow 状态、步骤、提示、结果引用摘要 |
| 执行元数据 | 浏览器执行器与受信服务 | browserSessionId、generation、workflow/run 关联、lastEffect；不作为模型动作参数 |
| 本地私有 | 浏览器执行器 | scope/owner 实例、地图对象、引用缓存、执行队列、去重记录 |

浏览器在 run 开始与工具结果续跑时，把最新 gisObserved 放入 RunAgentInput.state；动作结束后即时更新本地投影，用户平移/显隐变化在交互结束时更新 revision。首版不增加浏览器向正在进行中的 SSE 连接反向推送自定义事件的假通道；运行期间的外部地图变化采用下一段说明的取消策略，下一次 run 携带最新状态。

AG-UI STATE_SNAPSHOT/DELTA 仅更新独立的协议状态副本，按标准整体替换/有序 patch；**不直接 patch Pinia、图层或相机**。agent 区域可渲染；其中回显的 gisObserved 只是旧观察值，不能盖过浏览器权威状态。下一次提交以本地新投影覆盖该区域。检查观察 schema/revision 及执行器保存的 session/generation；旧回显保留为历史上下文，不当成当前事实。

JSON Patch 校验失败或连接丢失时，停止当前工作流并使其 scope 失效；下次用户发起运行时发送完整状态基线，要求服务端发新 snapshot。不自动恢复未执行完的地图命令。Agent 如需地图变化必须调用 Frontend Tool，而非把 visible=false 写入共享状态造成隐式动作。

同页用户手动改变视图、显隐或切换场景时，首版采用“用户操作优先”：取消正在进行的 Agent workflow、停止排队动作并更新状态；由能力自身动作产生的变化用本地执行关联标记识别，不误判为用户操作。不以每帧动画同步状态，也不设计双写冲突合并。

## 7. Tool Result / Effect、取消与重复投递

### 7.1 结果语义

保留 Capability 的 ok/data 或 ok/error，外包集成元信息。effect 是项目结果内容中的字段，不是 AG-UI 新事件。示例是 content 内的 JSON 对象：

~~~json
{
  "ok": true,
  "data": { "featureCount": 2 },
  "effect": {
    "status": "applied",
    "kind": "locate",
    "workflowId": "wf-1",
    "generation": 4,
    "stateRevision": 18
  }
}
~~~

工具消息 id 由应用生成，role=tool，toolCallId 为原调用 ID，content 为上述结果的 JSON 字符串；失败时同时设置 ToolMessage.error 为简短错误，content 保留具体 code 和 effect 状态。不要把仅本地合成一个 TOOL_CALL_RESULT 事件当作已送回后端；结果仍通过上一节的续跑请求回传。后端再次回显同一 tool 结果时按消息 ID 去重，只显示，不重执行。

effect.status 使用 applied / none / partial / unknown：applied 表示能力已实际提交；none 表示未造成地图效果；partial 表示例如取消动画前视图已移动；unknown 表示断开后无法确认先前提交。成功定位须等待动画完成；高亮成功表示图层已添加，并非等五秒临时效果结束；显隐成功表示地图及树状态均已提交。现有 Capability 错误不能证明无副作用时保守记录 unknown，不伪造 none。

Agent 只有收到 ok=true 且 applied 后才可说相应动作完成。已提交的定位/显隐不因后续取消自动回滚；取消会清理该 workflow 的高亮/计时器，保留其他 UI owner。工具结果是执行时回执，后续用户操作或清理可改变状态，最新 gisObserved 为当前观察。

### 7.2 取消与 stale context

用户停止、换页、detach、新指令、用户主动地图操作：先使本地 workflow 无效，停止动画、闪烁和排队动作，取消引用拉取；再 abort 客户端运行请求并通知后端取消该绑定。后端须实现绑定下的取消处理和迟到结果拒绝；断开 HTTP 不能当作后端工作已停止的证明。JS 客户端有 abortRun，但服务端是否停止取决于适配实现。[官方客户端 API](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/sdk/js/client/abstract-agent.mdx#abortrun)

参数收齐、引用解析后、排队出队、动态 import 后、动画完成/状态提交前，都必须检查原 scope。STALE_CONTEXT 原样透传，不自动 createClientScope 选择新地图再试。已在本地取消而无法回传的结果只记本地未交付状态，不恢复旧动作来“补发成功”。

### 7.3 幂等与错误

每页执行器以 (browserSessionId, workflowId, runId, toolCallId) 去重并记录规范化参数摘要。同 key 相同参数：若执行中共享同一个 Promise，完成则复用原结果；同 key 不同参数返回 TOOL_CALL_CONFLICT。服务端保存 pending call、已提交结果与续跑记录，拒绝伪造的结果关联；复用结果不能触发又一次续跑。默认一个会话内串行执行前端动作。

去重只保证当前受控会话内不重复执行，不声称 AG-UI 提供 exactly-once。页面刷新丢失本地记录时创建新 session，旧调用不得迁移重放；自动断线重试默认关闭。任何“效果可能已提交但回执未达”的情况显示 unknown，等待用户发起新指令，而非自动重做定位。

附加集成错误：SESSION_BINDING_CONFLICT、FEATURE_REF_EXPIRED、FEATURE_REF_FORBIDDEN、RESULT_LIMIT_EXCEEDED、TOOL_CALL_CONFLICT、INVALID_TOOL_CALL、PROTOCOL_ERROR、WORKFLOW_CANCELLED。Capability 原有错误码不重新翻译；网络不可确认效果时记录 effect=unknown。AG-UI 未为本项目提供身份、去重或恢复实现，这些由适配层承担。

## 8. 实施出口、测试与 MCP 后续

| 阶段 | 工作 | 出口 |
| --- | --- | --- |
| G0 协议适配验证 | `@ag-ui/client/core`、HTTP/SSE、Vue Frontend Tool、role=tool 续跑、snapshot/delta、abort | **已完成确定性浏览器验收** |
| G1-lite 绑定与状态 | workflow/scope/generation、取消、STALE_CONTEXT、toolCall 去重、用户操作优先 | **已完成 PoC 所需部分**；完整生产 auth/lease/多标签页冲突后置 |
| G2a 查询与二维工具 | 结果引用解析；定位/高亮等前端工具委托已有 Capability | **已完成确定性往返**；真实 GeoServer 未完成 |
| G2b User Vector | file_ref、独立用户 VectorLayer、layer_ref、Style Contract、fit、visibility、MapContext userLayers | **已完成确定性 Gold Case** |
| G3 Agent 编排与真实集成 | 接真实 LLM，自主根据 Tool Result 决定下一步；真实服务与异常验收 | **未开始/未完成**；不得用 deterministic fixture 冒充 LLM Agent |

必须验收的场景：

- 参数跨多个 ARGS 分片，END 前不执行；RUN_FINISHED 早于本地动作完成不能显示已完成；多个前端调用或半截 JSON 不执行。
- 前端返回成功/失败 tool message，后端按原 toolCallId 续跑；重复消息/重复请求不重复效果或重复续跑。
- 两标签页同 thread、其他用户的 resultId、错误 workflow、刷新后旧 run：不能操作当前地图。
- 前端调用 run 结束后保持 waiting，结果续跑后无待办才 completed；错误/未交付回执不能伪报 completed。正常退出可重绑，异常退出最多等待剩余 90 秒租期，旧页面恢复后不能续租复活或执行。
- query 返回零条、限量/未知截断、缺几何、引用过期、配置变化、超限快照：明确报告，不偷偷重查/裁剪。
- 引用拉取中、动态初始化中、动画中、工具排队时切图：旧 scope 不执行；局部效果与取消回执一致。
- Agent state delta 尝试更改 gisObserved.visible；旧 snapshot 到达；patch 损坏：均不直接改变真实地图。
- 用户主动缩放优先于 Agent；工具自己的动画不误取消自身；高亮清理不影响 UI 绘制和其他 owner。
- 地图动作已完成但结果回传断网：不重复动作，标记未交付/unknown；刷新不恢复旧动作。
- 三维未支持时没有新能力误执行，也不偷偷移动残留二维地图。
- G0 模拟端点通过、G2 真实 GeoServer 失败时分别报告，不能把协议验证写成业务联调通过。

MCP Adapter 为独立后续阶段：只读数据工具调用 Data；面向外部 Agent 的地图工具在显式绑定目标会话后进入同一 AG-UI 前端工具与 scope 执行链，并等待真实结果。没有在线且获授权的执行页面就返回客户端不可用，不把数据工具“查询成功”当成地图工具成功。MCP 与 AG-UI 互补，均不替代本地能力语义与生命周期。
