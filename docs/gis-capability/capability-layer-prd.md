# GIS Capability Layer 首版 PRD

状态：首版规格已实施并通过本地自动化验证；真实服务联调尚未完成。日期：2026-09-07。实际覆盖与限制见[实施验收记录](./implementation-record.md)。
依据：[能力审计](./capability-audit.md)。实施与验收：[迁移计划](./migration-and-acceptance.md)。紧接本期的后续阶段：[GIS Agent / AG-UI 集成 PRD](./agent-agui-integration-prd.md)。

## 1. 目标、范围与成功标准

面向维护现有 Vue GIS 应用的工程师，提供不依赖面板是否打开的程序化 GIS 能力。未来 Agent 只能看到普通数据与动作结果，不需要了解 WFS、GX、OL Feature、Cesium Cartesian3 或 window 地图对象。

首版交付六个能力：listLayers、queryFeatures、locateFeatures、highlightFeatures、clearHighlight、setLayerVisibility。查询限定单图层、属性等值 AND；二维支持点、线、面及其 Multi 类型。先按管线编号完成程序链路，再用现有 FeatureQuery 结果动作和图层树验证同一能力入口。

本期不新增查询面板，不迁移空间筛选/分析算法，不开放服务端或本地数据写入工具，不新增 HTTP、LLM、Agent、AG-UI 集成、MCP 或跨浏览器通信桥，不实现三维新适配器。三维旧功能保留；所有新 Client API 在三维拒绝执行，Data API 可继续使用。

成功标准是同一份查询结果可交给独立的定位和高亮动作，两个动作无隐式补查；现有 UI 使用这些动作；程序显隐与树勾选一致；关闭面板或切换地图后旧动作不能影响新场景。

## 2. 责任与组装方式

| 模块 | 责任 | 允许依赖 | 不承担 |
| --- | --- | --- | --- |
| Data capabilities | 图层描述、字段约束、等值查询、结果标准化 | 注入的目录、GeoServer transport、纯函数 | Pinia、DOM、window、地图、提示消息 |
| Client capabilities | 检查场景/就绪状态、定位、高亮、显隐与所有权 | 注入的 runtime、OL adapter、状态回写接口 | 请求几何、表单校验、直接弹消息 |
| GeoServer adapter | WFS/字段元数据、响应检查、取消和服务错误转换 | 注入的配置、HTTP transport | 读取全局配置、缓存 OL Feature |
| OpenLayers adapter | 投影、视图动画、图层绑定、高亮资源 | 明确传入的地图及管理器 | 自行选择全局地图、维护另一份业务目录 |
| 应用组装层 | 读取现有配置/Pinia，地图 attach/detach，Vue 调用编排 | 现有应用状态、上述工厂 | 承载查询业务条件 |

使用 JavaScript ES modules + JSDoc，新增模块置于 src/gis，按 contracts、data、client、adapters、runtime 划分；不为本期未支持的 Cesium 创建空壳实现。保留应用现有全局地图供旧调用方使用，新核心只接受显式依赖。

两个工厂分别创建 Data 和 Client 实例；创建 Data 不要求传入地图。应用层可把二者组合提供给 Vue，但不可通过组合入口让 Data 隐式导入地图模块。

内部运行时提供 attachMap、detachMap、createClientScope。每个地图代次只有一套能力资源；createClientScope 返回绑定当前代次和 owner 的 Client 对象，供一条工作流或一个面板使用。scope.dispose 只释放该 owner，地图 detach 释放本代次全部能力资源。它们是本地生命周期接口，不是远程工具或浏览器会话协议。后续 AG-UI Frontend Tool 必须进入已有 Client Scope，再调用 GIS Capability 和当前 Map Runtime；不得绕过它们读取 window 地图。

## 3. 图层目录与身份

### 3.1 单一来源与映射

首版支持当前配置的一个 GeoServer 服务。服务图层来源为现有 GeoServer 配置和 XML/WMS 图层引用；查询字段由该服务的 DescribeFeatureType 获取。不存在于这些来源的图层不能由调用方通过任意 URL 注入。

Data 的图层 ID 使用 `geoserver:<workspace>:<typeNameWithoutWorkspace>`；例如现有配置可生成 `geoserver:GX:js_ln`。这是公开的稳定标识，调用方通过 listLayers 选择，无须拆解。服务地址变化但逻辑数据源不变时 ID 不变；更换 workspace/typeName 则改变 ID。未来多服务支持另行升级命名规则，本期不猜测第二个服务。

可显示但不支持 WFS 查询的 XML 图层用 `map:<xmlId>`。XML 的原始 ID 与引擎 name 保留在内部绑定中，不替换已有树节点 ID；不将分组数字 ID 当业务图层 ID。注入的在线底图同样从现有节点 ID 派生，不手填重复清单。

绑定优先使用现有 config.layerName；缺失时解析 HTTPLink 的 WMS LAYERS 参数，参数名大小写不敏感。单图层引用可归并到服务图层；同一数据图层的多个显示实例记录为多个绑定。多图层 WMS 作为不可拆分的 map 图层，不把控制整个 WMS 误报为控制其中一层。不匹配当前 GeoServer 的远端 WMS 仅列为地图图层。名称相同不用于自动归并。

### 3.2 listLayers

`listLayers()` 返回 Promise<Result<{ layers: LayerDescriptor[] }>>，不读取地图。LayerDescriptor 包含 id、label、queryable；可以包含从元数据得到的字段描述。它表示“已注册的数据/显示目录”，不是“引擎已创建图层”。

查询前必须获取该图层字段元数据；按当前配置版本与图层 ID 缓存，配置或目录变化使缓存失效。元数据失败返回 METADATA_UNAVAILABLE，不从第一条要素猜字段、不绕过校验。首版 adapter 增加内部 DescribeFeatureType 读取，规范化服务端 XML 字段定义；不使用 GeoServer 管理 REST 权限获取字段。

加载、显隐等 Client 状态由 runtime 维护并提供给 UI，不混入 Data 的全局状态。没有加载图层不妨碍 WFS 查询；setLayerVisibility 必须检查真实地图绑定，未加载不得报告成功或自动加载。

## 4. 公共契约

所有六个方法返回 Promise，预期业务失败统一使用以下结构：

~~~js
// Result<T>
{ ok: true, data: T }
{ ok: false, error: { code: "SERVICE_ERROR", message: "...", details: {} } }

// CapabilityFeature：普通 GeoJSON Feature 加显式来源字段
{
  type: "Feature",
  layerId: "geoserver:GX:js_ln",
  sourceFeatureId: "js_ln.123", // 服务未提供时为 null，不能用 pipeid 或行号冒充
  geometry: { type: "LineString", coordinates: [[104, 30], [104.001, 30.001]] },
  properties: { pipeid: "示例编号" }
}
~~~

properties 保留服务原值，pipeid 是业务字段；sourceFeatureId 是服务身份。跨图层身份为 layerId + sourceFeatureId；sourceFeatureId=null 的要素仍可根据载荷显示，本期不支持凭空补查或跨次持久引用。不返回 OL/Cesium 实例、Vue proxy、凭据或请求头。geometry=null 可作为查询结果保留，但不能用于定位/高亮。

| API | 输入 | 成功 data |
| --- | --- | --- |
| listLayers | 无 | { layers } |
| queryFeatures | { layerId, filters, limit? }；第二参数 { signal? } | { features, returnedCount, truncated, crs: "EPSG:4326" } |
| locateFeatures | { features } | { featureCount }，动画完成才成功 |
| highlightFeatures | { features, group?, mode?, effect? } | { featureCount, group } |
| clearHighlight | { group? } | { clearedCount } |
| setLayerVisibility | { layerId, visible } | { layerId, visible, bindingCount } |

group 默认为 results，归当前 scope.owner 所有；调用方不能通过 group 操作其他 owner。支持 group=selection 供行选择使用。clearHighlight 不传 group 清当前 owner 所有分组，不能调用全局清除所有业务高亮。

### 4.1 queryFeatures

filters 为非空数组，元素形如 `{ field: "pipeid", op: "eq", value: "XXX" }`；仅 AND，拒绝原始 CQL/SQL、OR 和空筛选的全量查询。字段必须存在于服务元数据，类型只支持字符串、有限数值与布尔值；不做隐式字符串/数字互转，不支持 null/date/geometry 条件。字段名由元数据核对后作为标识符编码，字符串单引号统一转义；URL 编码不能代替条件值转义。

limit 默认为 100，允许 1–100 的整数。本期无分页与排序承诺。请求 limit+1 条，仅返回前 limit 条：多出一条则 truncated=true；有可信总量时用总量与返回数比较；合法空集合为 false。其余非空结果若没有可信总量，也未通过联调确认服务遵守请求上限，则 truncated=null，避免把服务端硬上限误判为完整结果。只有已确认服务遵守请求上限时，少于 limit+1 条才可判 false。UI/调用方对 true 或 null 均不声称结果完整。

transport 统一 30 秒超时，支持 AbortSignal；失败不自动重试。HTTP 成功仍检查 WFS ExceptionReport/响应结构，不能把异常 XML 当空 FeatureCollection。服务请求 srsName=EPSG:4326，输出坐标顺序为经度、纬度，实际转换正确性必须通过联调验收。

### 4.2 locateFeatures

只接受非空、合法且有几何的要素列表，不从 properties.x/y 猜坐标。用 OL GeoJSON 读取并转换到 view.getProjection()，计算合并 extent。线/面及多要素按 extent fit，padding 四边 40px、maxZoom=18、duration=1000ms；退化为一个点时以该点为中心、zoom=18、duration=1000ms，最终受现有 view 自身限制约束。

不自动打开数据图层，不清高亮，不高亮，不补查几何。地图容器没有有效尺寸返回 MAP_NOT_READY。新定位取消此前该地图能力定位；动画回调 canceled、scope 失效或场景改变时返回 OPERATION_CANCELLED/STALE_CONTEXT，不返回成功。

### 4.3 highlightFeatures 与 clearHighlight

mode 支持 replace（默认）和 append；replace 只替换当前 owner 的当前 group，先校验并完成要素转换再更新图层，失败保留已有结果。append 按非空来源身份去重；无源 ID 的要素只保证载荷显示，不承诺跨次去重。UI 的“全部高亮”使用 replace，因此反复点击不会累积结果。

effect 支持 persistent（默认）和 blink。blink 复用现有 BlinkingEffectUtils/HighlightStyleUtils 的节奏与样式规则；配置由组装层传入，新路径不在样式工具中读取 window。生命周期固定 5 秒，结束后移除本次临时高亮；dispose/clear 时立即取消其定时器。现有 startBlinkingEffect 结束后只停止闪烁并保留显示，移除资源必须由新 adapter 负责。持久结果和临时选择分组分离；行选择不清批量高亮。不从 UI 接受引擎 Style 对象。

空 features、非法/缺失几何整批失败；clearHighlight 才是清理入口。样式和 Feature 创建全部在 adapter 中；返回计数以实际该次操作结果为准。对地图 detach 的清理通过内部 dispose 执行，不依赖一个已失效 scope 再调用公共清理 API。

### 4.4 setLayerVisibility

只支持已绑定的叶子图层和布尔 visible。同一个服务图层绑定多个显示实例时一起设置；分组勾选由 UI 展开为叶子调用，分组本身不进入公共 GIS API。

二维 adapter 先核对绑定和当前代次，保存原值，设置全部对应引擎图层，然后通过注入状态接口更新对应原始树节点 checkedKeys；失败恢复本次已改绑定和状态。树渲染以已提交状态同步，程序回写不得再次触发新的业务调用。分组操作允许逐叶子失败，最终勾选反映实际成功集合，并在 UI 汇总失败叶子；不伪装跨叶子事务。

未加载不自动加载；重复设置同一状态成功且不产生额外副作用。不涉及标绘要素显隐、本地文件删除或三维旧逻辑。

### 4.5 错误与生命周期

| code | 场景 |
| --- | --- |
| INVALID_ARGUMENT | 筛选/limit/值类型/空输入不合法 |
| UNKNOWN_LAYER | ID 不在目录 |
| UNSUPPORTED_CAPABILITY | 不可查询图层、首版三维 Client 或不支持几何类型 |
| METADATA_UNAVAILABLE | 字段元数据获取/解析失败 |
| SERVICE_ERROR | HTTP、WFS 异常或结果结构错误 |
| TIMEOUT / OPERATION_CANCELLED | 请求超时/主动取消，或动画取消 |
| MAP_NOT_READY / LAYER_NOT_LOADED | 地图/容器尚未就绪，或没有有效绑定 |
| MISSING_GEOMETRY / INVALID_GEOMETRY | 无几何、非法坐标或空坐标 |
| STALE_CONTEXT | 绑定的地图代次或 owner 已失效 |
| MAP_OPERATION_FAILED | 经过校验仍发生引擎操作异常 |

Client 执行顺序：scope 有效性 → 场景 → 地图 ready → 参数/绑定 → 转换或异步操作 → 再验证代次 → 提交。所有异步 import、动画回调、闪烁回调都必须保留并检查原代次，禁止重新取“最新地图”后继续旧任务。

UI 在查询开始前创建/捕获 scope；新查询、面板退出、场景切换时取消旧工作流。Data 请求本身可独立完成，但其结果不能自动递交给新 scope。切回二维须明确发起新的地图动作，不自动重放旧动作。

## 5. UI 迁移与兼容决定

FeatureQuery 保留空间范围、点/线双表查询及 feature 属性筛选。只在 WFS 结果标准化处补存原始源 ID 和图层 ID，在行点击和“全部高亮”入口编排能力调用。直接引用已有结果载荷，不增加 FeatureQuery 的编号输入框。

行点击：locateFeatures 成功后，highlightFeatures(selection, replace, blink)。全部高亮：先 locateFeatures 全部结果，成功后 highlightFeatures(results, replace, persistent)。因此失败时不显示成功提示，也不执行后续高亮。结果表仍显示现有业务编号；MapUtils 的 x/y 回退不进入新契约，缺几何明确报告失败，这是有意收紧的兼容行为。

现有 clear/cancel/cleanup 仍清理自己绘制的内容；高亮清理改为 scope 内分组操作。面板 dispose 不得销毁其他查询 owner 的高亮。

按编号的演示通过开发验证入口调用 Data，再将 features 交给预先捕获的 Client scope；开发验证入口不挂全局生产函数、不新增生产页面。三维保留原图层树分支；新 Client 不能隐式降级为操作隐藏的二维实例。

## 6. 本期完成定义

六项 API 的契约测试、FeatureQuery 的 UI 集成、二维显隐一致性、地图生命周期与资源清理测试全部通过；构建通过；完成真实二维页面与可用 GeoServer 的只读联调。模拟响应通过只代表契约通过，不代替部署连通性、坐标和图层绑定验证。

具体测试编号、逐批迁移出口、旧实现保留清单及版本记录要求见配套迁移计划。

## 7. 后续 AG-UI 集成边界

本期继续先实施并验收 queryFeatures → locateFeatures → highlightFeatures 的本地链路。验收后优先采用 AG-UI 承载 Agent ↔ 当前浏览器交互，不默认自研命令协议。Frontend Tools、共享地图状态、工具结果、Agent Run/Browser Session 绑定与 feature_ref 在独立集成 PRD 中定义。

feature_ref 仅存在于后续集成层：由受控解析器还原 CapabilityFeature[] 后调用本期 API。本期不增加裸 feature_ids、引用缓存、AG-UI 事件类型或会话参数。AG-UI 的状态同步也不得直接修改地图；真实副作用始终经过 Client Capability。MCP 负责未来外部 Agent 接入，不改变这些责任边界。
