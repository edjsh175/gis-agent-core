# 23dmaps GIS Agent Capability Audit

审计日期：2026-09-07（Asia/Shanghai）。对象：当前工作目录的源码快照。读者：GIS 前端维护者、能力层实施者及后续 Agent 集成人员。

本次交付只包含文档。配套：[首版 PRD](./capability-layer-prd.md)、[迁移与验收计划](./migration-and-acceptance.md)。后续协议设计见 [GIS Agent / AG-UI 集成 PRD](./agent-agui-integration-prd.md)。该补充是架构决策，不改变以下源码审计快照或证据等级。

## 结论与证据等级

项目已有可复用 GIS 实现，但尚不存在统一的可程序调用能力层。应先拆分“数据获取/计算”和“当前页面地图副作用”，再迁移首批调用方。二维先完成查询、定位、高亮与图层显隐；三维本期只确认边界，不承诺同等能力。

本文使用三个等级：**I** 表示存在实现；**C** 表示从 UI/调用方到实现的静态调用链已确认；**R** 表示运行验证通过。此次为源码审计，以下没有 R 级结论。静态链路存在不等于服务可达、算法正确或浏览器行为通过验收。标记“占位”的入口不能列为已实现能力。

根目录存在 `.git` 目录，但 `git rev-parse --show-toplevel` 返回“not a git repository”；因此不能提供有效 commit 基线，也不能断言目录完全没有 Git 数据。附录记录关键文件 SHA-256，不修复或初始化 Git。

## 执行边界

| 边界 | 所有者 | 合适的输入/输出 | 当前阻碍 |
| --- | --- | --- | --- |
| Data | 查询服务、纯几何计算 | 图层标识、类型化条件、GeoJSON、普通对象 | 配置读取 window；请求/转换与 UI 混合；错误语义不统一 |
| Client | 当前页面的地图运行时 | GeoJSON → 视图、图层、交互状态 | 地图全局对象、引擎类型、定时器和清理职责散布 |
| UI | Vue 组件 | 表单、选择、结果表、提示 | 组件直接持有查询、投影、高亮和请求逻辑 |
| 未来 Agent 集成（设计目标） | AG-UI 适配层 + 当前页面 Client Scope | Frontend Tool 调用、共享地图状态、Tool Result | 当前源码未集成 AG-UI；会话绑定、引用解析、取消与失效策略由应用负责 |

Data 是依赖边界，不意味着本期迁移到服务器：它仍可在浏览器执行，但必须能在没有地图、Pinia、DOM 的环境中调用。图层列表也不能笼统归为 Data：服务目录是 Data，已加载状态和显隐是 Client。

## 九类能力审计表

下表源码链接定位到文件；函数名称是本次快照的检索锚点。具体关键行号见后面的发现表。

| 能力与证据 | 实际入口 → 实现 → 下游 | 输入 → 输出 | 耦合、副作用与清理 | 复用与目标归属 | 首版 / MCP |
| --- | --- | --- | --- | --- | --- |
| 查询：特征、材质、管径、附属物（C） | [FeatureQuery](../../src/components/pipeline/query/FeatureQuery.vue) 的 performFeatureQuery → executeQuery → performWFSFeatureQuery；同目录 MaterialQuery、DiameterQuery、AccessoryQuery 各有组件内请求路径 → WFS | 选中图层、绘制几何、属性值 → 表格行与几何 | 表单、ElMessage、fetch/axios、GX 和 geom 约定夹杂；组件 cleanup 清绘制和高亮，但请求未统一取消 | 提取请求/标准化为 Data；旧空间筛选暂留；结果显示为 Client | P0 新增独立等值查询；空间/多字段特化 P1。Data 适合未来 MCP |
| 查询：点选属性（查询工具有 C；属性面板激活链未闭合） | EditPipelineLine、MappingNetwork 等调用 [queryUtils](../../src/utils/queryUtils.js) addPipelineWMSQuery → WMS GetFeatureInfo → 回调/事件；[AttributeQuery](../../src/components/pipeline/query/AttributeQuery.vue) 监听 pipelineFeatureClick 并高亮，并不直接调用其导入的 addPipelineWMSQuery | 屏幕点击、当前分辨率、可见图层 → 要素信息 | window.map2d 和全局事件句柄；查询含像素上下文；removePipelineWMSQuery 等有解绑入口；仅打开属性面板是否已有生产者绑定，仍需运行确认 | 点选保持 Client；可按 ID 重查的数据请求未来单独抽出 | 不改点选流程；不能将屏幕拾取直接包装成无会话 MCP |
| 查询：按管段编号（I；服务内有调用） | [geoserverService](../../src/utils/geoserverService.js) PipelineGeoServerService.getPipelineDetails → getFeatures；[GeoServerUtils](../../src/components/pipeline/decision/common/GeoServerUtils.js) queryPipeGeometryFromGeoServer → fetch | pipeId、layerName → GeoJSON 或首条几何 | 前者强制 maxFeatures=1；后者固定 js_ln；均拼接条件；配置异步刷新 | 复用 WFS 请求能力，重做边界；不能把固定图层补查当通用编号查询 | P0 Data；未来 MCP 可复用契约 |
| 图层目录/显隐（C） | 地图组件 → [analyzeXmlData](../../src/utils/analyzeXmlData.js) → store.layersList；[layerList](../../src/layout/components/layerList/index.vue) checkChange → setMapLayerVisibility / controlLayer3DVisible | XML ID、状态或名称、三维类型 → 图层对象状态；旧函数通常无结果 | Pinia、window 地图；UI 先写 checkedKeys；二维按图层 name 找首个，找不到静默；重载 XML 重置目录 | 服务元数据 Data；当前绑定、显隐 Client；统一 ID 映射和状态提交 | P0 二维；三维旧路径保留。显隐 MCP 必须指定页面 |
| 定位（C） | FeatureQuery.flyToFeature → locateFeature；分析结果 → [MapUtils](../../src/components/pipeline/decision/common/MapUtils.js) flyToFeature；视点/底部工具 → [cesiumUtils](../../src/utils/cesiumUtils.js) flyToBounds/flyToPosition | 行数据/几何/经纬度 → 视图变化 | MapUtils 混合补查几何与高亮；多个二维缩放策略；3D camera.flyTo；动画没有统一完成/取消语义 | Client；拆出只消费几何的定位；保留未迁移调用方 | P0 二维；3D P1。MCP 需要会话 |
| 高亮（C） | AttributeQuery、SpatialQueryManager → [UnifiedHighlightManager](../../src/components/pipeline/decision/common/UnifiedHighlightManager.js)；FeatureQuery → MapUtils.initializeHighlightLayer、组件内创建 OL Feature | OL Feature 或业务行 → VectorSource/图层、闪烁 | Unified 仅支持 OL；单例持有地图；按 highlightType 清理；组件还自建图层/定时器；destroy 移除图层 | Client；复用管理器，但修正异步初始化、换图与所有权；不能直接用于 Cesium | P0 二维；未来 MCP 只暴露动作契约 |
| 绘制（C） | SpatialQuery、FeatureQuery、CoverAnalysis → [DrawManager](../../src/components/pipeline/decision/common/DrawManager.js) activate；FeaturePanel → useToolHandlers → Cesium addHandlerPoint/Line/Polygon | 类型、用户鼠标 → 几何或回调坐标 | OL Draw/Modify/Select + ElMessage；deactivate/destroy/clearAllLayers；三维使用全局 handler，回调可能写 IndexedDB | 交互 Client；几何计算可独立 Data；不应整类搬到数据层 | P1/P2；远程启动需交互会话及取消协议 |
| 空间分析（C） | SpatialQuery → [SpatialQueryManager](../../src/components/pipeline/decision/common/SpatialQueryManager.js) performSpatialQuery → WFS INTERSECTS；BufferQuery → [BufferAnalysisManager](../../src/components/pipeline/decision/common/BufferAnalysisManager.js) generateBuffer / performSpatialQuery；CoverAnalysis.performWFSLineQuery 另有直接请求 | 圆/面/选中管线、半径米、目标图层 → GeoJSON、结果行 | OL 几何/绘制/渲染与 Turf、fetch 混合；buffer 计算后立即 displayBuffer；clearAll/destroy 管资源 | Turf 计算、空间谓词查询 Data；选线、绘制、结果着色 Client | P1；抽出纯数据后适合 MCP |
| 空间分析：连通/爆管（C） | ConnectivityAnalysis.performAnalysis → [ConnectivityService](../../src/utils/connectivityService.js) performConnectivityAnalysis；BurstAnalysis.performValveAnalysis/performPipeAnalysis → [BurstAnalysisService](../../src/utils/burstAnalysisService.js) callBurstValveAnalysisAPI/callBurstPipeAnalysisAPI | 起终管段或爆管段 → 路径、阀门/管段列表与统计 | window API 配置、axios、WFS 补查及表格转换；UI/store 保存状态并绘制；服务没有统一取消接口 | 后端分析 Data、地图呈现 Client；只确认客户端协议，不推断后端算法 | P1；未来 MCP 数据工具候选 |
| 测量（C；管网面板占位） | ToolGrid → FeaturePanel → [useToolHandlers](../../src/hooks/useToolHandlers.js) carryOut → OL addDistanceMeasure/addAreaMeasure 或 Cesium handlerDistance/handlerArea | 用户画线/面 → 数值、标签 | OL Draw、Overlay、DOM、window.drawInteraction；三维 MeasureHandler；工具切换有 removeMeasurement，不能据此认定所有资源已销毁 | Client；算法和单位规则可抽取，但不替代交互生命周期 | P2。Distance.vue/Area.vue 为“开发中”，不是测量实现 |
| 二三维切换（C） | [bottomTools](../../src/layout/components/bottomTools.vue) showChange → emit(change) + store 标志；[layout](../../src/layout/index.vue) showStaus → v-if/v-else 地图组件 | 用户切换 → Vue 卸载/挂载、地图与目录重建 | UI 局部状态和 Pinia 两份场景状态；OL 卸载清交互管理器但未见完整地图释放；Cesium 组件未声明卸载钩子 | Client 生命周期所有者负责；本期仅接入新能力失效机制 | 切换工具 P1；P0 必须处理切换使旧动作失效 |
| 数据修改（C） | [editing 组件](../../src/components/pipeline/editing/EditPipelineLine.vue) 表单/地图选择 → [PipelineAPI](../../src/config/api.js) addPoint/addLine/editPoint/editLine/deletePoint/deleteLine/mappingNetwork → request → Java API；useDataManagement 另有本地标绘增删 | tcTable、业务字段/编号 → 后端响应；本地标绘 → IndexedDB | ElMessage/确认框、地图刷新、选择状态；request 拦截器弹消息；本地持久化与服务端写入不同 | 写入 Data + 交互 Client，需独立权限/事务语义；不能按读查询直接复用 | 首版不开放写工具；MCP 后续专项设计 |

九类中的查询、分析分别展开多条路径，以免“同名功能”掩盖不同执行责任。

## 影响首版的具体发现

| 编号 | 源码证据 | 根因与判断 | 本期设计决定 |
| --- | --- | --- | --- |
| A01 | UnifiedHighlightManager.js:18 initialize，24 先赋 this.map，27 移除旧图层 | 换图时从新地图移除旧图层；异步 import 期间没有共享初始化 Promise 或失效检查。由控制流可见风险，未运行复现 | 由地图运行时拥有管理器；保留旧地图引用后清理；并发初始化合并，卸载使后续完成无效 |
| A02 | MapUtils.js:18 flyToFeature | 补查、定位、高亮耦合；异常只记录日志，上层难以判断成功 | 新定位不联网、不高亮；返回明确完成/取消结果；旧 wrapper 只为剩余调用方保留 |
| A03 | FeatureQuery.vue:545、606、688、787、811 | WFS 转行丢弃原始 feature.id 和来源图层；id 改成业务号/序号；定位失败可能仍尝试高亮；批量高亮内还 fit | 在结果转换处保留来源；动作分离，由 UI 编排；不能只替换 import |
| A04 | FeatureQuery.vue:577–639；GeoServerService.getWorkspaceLayers | 一些请求失败 continue/返回 []，服务故障和无结果混淆 | 新 Data 入口失败必须显式返回错误；旧空间查询整体错误策略另列 P1 |
| A05 | GeoServerUtils.js:13–27；geoserverService.js:514 | js_ln/GX 固定补查、未统一字符串转义、编号查询强制只返回一条 | 单图层契约，字段元数据白名单和类型化值，默认上限及截断提示 |
| A06 | layerList/index.vue:294–306；openlayersUtils.js:1295 | checkedKeys 与地图分开写；XML ID、引擎 name、WFS typeName 不等价 | Data 图层标识和地图绑定分离；显隐成功后提交状态，失败还原 UI |
| A07 | analyzeXmlData.js:25、54、末尾；pipelineConfigManager.js:19 | XML 重建 store；forEach(async ...) 不能代表子任务已完成；配置缓存 initialized 不等于图层已加载 | 目录可读与地图绑定 ready 分开；新客户端读取实际绑定，不以 finally 或缓存标志推断就绪 |
| A08 | Openlayers/index.vue:57、79；Cesium/index.vue:17；layout/index.vue:40 | 500ms 延迟初始化未保存取消句柄；场景切换重建组件，旧全局引用可能仍在 | 新能力必须用显式 attach/detach 和代次；迁移时清除触及的延迟初始化句柄 |
| A09 | geoserverService.js:12–40；config/index.js:14；request.js:18 | 构造函数异步更新配置可能覆盖调用方参数；请求配置取 window；通用 request 自带 UI 提示 | 本期 Data 使用注入配置/无 UI transport；不直接复用带提示的 request |
| A10 | geoserverService.js 全文件；src 中 DescribeFeatureType 搜索无命中 | 已有工作空间图层列表不是字段元数据；getLayerBounds 只查一条要素，不能当完整图层边界 | 补充内部字段元数据读取；不复用 getLayerBounds 推断整层范围 |
| A11 | index.html:15；cesiumUtils.js:179、222 | Cesium 从 public 脚本加载，测量/绘制调用扩展 API，不能由 npm 依赖列表证明其版本与兼容性 | 哈希记录本地脚本；三维单独验收，不宣称标准 Cesium 适配器已具备 |
| A12 | public/serverdata/data.xml 搜索 js_ln/js_pt 无命中；config/index.js 有给水配置 | 静态服务配置存在，不证明当前加载了给水图层或服务端有数据 | 联调必须选真实注册且存在字段/数据的图层；未加载数据仍可查询，但显隐返回未加载 |

## 复用边界与后续顺序

优先复用请求构建、GeoJSON/几何处理和二维高亮资源管理；必须改造依赖注入、错误语义及生命周期。不能仅在 Vue/旧 Utils 外层加六个同名函数就称为完成能力层。

首批迁移限定 FeatureQuery 的结果地图动作、二维图层树显隐、地图运行时接入，以及支持新等值查询的 Data 入口。AttributeQuery、MaterialQuery、DiameterQuery、AccessoryQuery、空间分析和写入流程继续走原路径，作为后续迁移清单，不做无关全库整理。

未来顺序：本地能力契约 → 二维闭环及验收 → GIS Agent / AG-UI 集成 → 后续 MCP Adapter。Agent 到浏览器的正式首选是 AG-UI 的 Frontend Tool + Shared State + Tool Result 模式，不默认另造 Browser Command Bridge。项目仍负责把 run 绑定到目标页面、校验引用并处理取消/失效；AG-UI 不替代 runtime、owner、generation。Frontend Tool 必须经过 Client Scope 与能力层。MCP 的数据工具复用 Data 契约；未来地图工具复用同一 AG-UI 集成路径，不能直接持有 OL/Cesium 对象。协议依据与适配验证门槛见集成 PRD。

## 验证边界

本次执行了静态调用链搜索、关键函数与清理逻辑读取、Git 状态探测和文件哈希采集。没有启动地图、调用 GeoServer/Java 接口、运行 GIS 行为测试或执行数据写入。未提交三维支持、部署一致或算法准确性的运行结论。

package.json 只有 dev/build/preview，没有自动化测试脚本；Test.vue 命名的组件不能视为自动化测试。后续测试与联调标准见迁移计划。双锁文件暂不清理；实施时显式选定安装基线并记录差异。

## 附录：源码快照 SHA-256

以下哈希用于对照审计证据是否过期，包含依赖清单、静态配置和本地 Cesium 入口；它不是完整部署资源清单，也不记录配置里的凭据内容。

| 文件 | SHA-256 |
| --- | --- |
| `index.html` | `6FABDB5F470C9992AE1688973146667EDC19186C69CF736C5B3F25E89A273457` |
| `package-lock.json` | `D32016B160208834DD7B858382BD81B0EB8967A2A9826E758D1571DDBAB2066A` |
| `package.json` | `AE7EEDE8A5DD3E6825D79F46ACE61DDCBD53D3B8A76731B4D588FE93DF8EF8F6` |
| `pnpm-lock.yaml` | `D807F80B49ABA15C9531B49D8926AB0CFB8898C73F53005B992E400EBF201762` |
| `public/cesium/Cesium.js` | `089DE4A4DFC9B39973CF3810428997CC19319ACF267105C9E7CC113AE5DE430D` |
| `public/config.js` | `5F75A517DFF52032EFE7AD2BD2BB8E4ECE18071E7FDA7946F5D67AB5AFAC15B8` |
| `public/serverdata/data.xml` | `AB039F2B1019A1407E4510E807A62AC91DE7B2AC3BF429BA3966EEE23B86C495` |
| `src/components/pipeline/decision/BufferQuery.vue` | `1EBE508B208FE19AE4B2F4342CDAB20CEDE490BCFEBCC857DDC15E805B4FADE6` |
| `src/components/pipeline/decision/BurstAnalysis.vue` | `5F6C184E316AD76DEA65137A543285ABAD010E1A7953CDE82BA78A81E1246C1A` |
| `src/components/pipeline/decision/common/BlinkingEffectUtils.js` | `BBDF4511DD6C168D3A28AB424971B572AE21CE803BBB7C46F225BE9097EA71E3` |
| `src/components/pipeline/decision/common/BufferAnalysisManager.js` | `E7EFC233A90CF0B2690D5997472DAA43614448FCC15157072260C0EE001728E9` |
| `src/components/pipeline/decision/common/BurstResultTable.vue` | `677E804D5DB56A2AF4EF2F853BBD4E8D7E63F0D6DBF01CFCE4D1F5759EF289D4` |
| `src/components/pipeline/decision/common/ConnectivityResultTable.vue` | `0954E34F07F98854F4F97BD2C83CCA2222CEB94B46555558C590C0B2CA12F9BC` |
| `src/components/pipeline/decision/common/CoordinateUtils.js` | `7D3F321C603F371406D9BEA6CB2AD3E73B7192AC5EC90FA0E6B5F087BFAB5C9C` |
| `src/components/pipeline/decision/common/DrawManager.js` | `3ACB59405398F4EC9D6259208D04B141B35DEE895B2C6A458EE2380A92C6F4E7` |
| `src/components/pipeline/decision/common/GeoServerUtils.js` | `A02E762AF8F7C302DD96E13D0E2A38AE6041979EA36B3752EBCE671D81438F92` |
| `src/components/pipeline/decision/common/HighlightStyleUtils.js` | `6CBF6A103CB2A75FA4C24D08B0C8A984221AF20ED112C93B3ECFF05E142BA8DC` |
| `src/components/pipeline/decision/common/HighlightUtils.js` | `F5C0EB5303AD7E4696F0A2AB8B8C8D6DE7B58525824CA385DE2DA9223A540FFB` |
| `src/components/pipeline/decision/common/index.js` | `EE20B23A501D959196879B0EAC3906B159BD2ACFB6F33A13E608787C22EACE03` |
| `src/components/pipeline/decision/common/MapUtils.js` | `2EC73FB0845545837D81DA38D673C6F71C8C1D576A503294F33D0FF2DB94D23B` |
| `src/components/pipeline/decision/common/SpatialQueryManager.js` | `2ABFE0656B2DE33B7C7985AF1DB97530F55B77BB6B82BB78ACE050746CA5FE7B` |
| `src/components/pipeline/decision/common/UnifiedHighlightManager.js` | `D43E9F6786218EB73CC38F7E62920AAE9E1AA26790CB3F548BD75D69A11F482D` |
| `src/components/pipeline/decision/ConnectivityAnalysis.vue` | `EC9088EADE7842FA7D886AEC7B413E0B70479A6B843590E73DCA0B8FCC7A1BED` |
| `src/components/pipeline/decision/CoverAnalysis.vue` | `0B8A17EEAAAD1732C8A0DA2DD8DF98C2E8FDE208966426FCBE55038B4DA307B9` |
| `src/components/pipeline/editing/AddPipelineLine.vue` | `8BACE3AD7AFDFC9A6FE4BBA4F8D42412BB8612BA4B57045B605591E18B8A4EDA` |
| `src/components/pipeline/editing/AddPipelinePoint.vue` | `A0A6CBD4F5297CF8D0E3CE9F373177070FE160FCD8E66397DFDE7B9417DA34B0` |
| `src/components/pipeline/editing/AddPipelinePointTest.vue` | `9250B6637E5D75659E7F93233A9C87F05903C2A5D24C3604A8A245DE6DD70BCF` |
| `src/components/pipeline/editing/EditPipelineLine.vue` | `B495AC35ECDB95C2B41419B3910AB94B15B9BCE13C82DDCEBFF698BC92A7EAFC` |
| `src/components/pipeline/editing/EditPipelinePoint.vue` | `371B705387E633695928727647970AE62193A0B83032A45DD3A7346C2F1CA84B` |
| `src/components/pipeline/editing/MappingNetwork.vue` | `E103E46EE5F00EBB8B2EA83815DBA4EA7AE36B699420AEB033D1B4CDC16577F7` |
| `src/components/pipeline/measurement/Area.vue` | `DA4183B51DA2BA5FA8ABF0879EE36B1CBF2817C6D099F3892FC7E495F6C3F7A4` |
| `src/components/pipeline/measurement/Distance.vue` | `601A4D79765A6B2E838A613C1D8A1DB3DA360924F5F2B5A481A3240DF31B5E75` |
| `src/components/pipeline/query/AccessoryQuery.vue` | `A7F04E22A3E4E29A5015F852CA45D06E938F6C6FB5E9F3A78DEF351946C8FA3E` |
| `src/components/pipeline/query/AttributeQuery.vue` | `7E2964CF4487E6A9F300B0BBB9F26770B3742C93FAFAB9C5BFB530897E3E283B` |
| `src/components/pipeline/query/DiameterQuery.vue` | `29059D8842D6813861BCC5ADB0266DDE2BC3FAF5B1E49C83A3ACE21093203CF1` |
| `src/components/pipeline/query/FeatureQuery.vue` | `961BE2242AB0039D3546A5FC39FB895A3301D488E4B68A47A432CAA2C9381558` |
| `src/components/pipeline/query/MaterialQuery.vue` | `45443827B7B22D91BEF0B7DB0141BCF36B1627064BEA58C9CCAD894AAC8F3EDD` |
| `src/components/pipeline/query/SpatialQuery.vue` | `C06D851A7CDE0C95D2558B6F6400C9E369F5DED041E7DAF49BD589F754ED7BE7` |
| `src/config/api.js` | `0309036F2B928FF16945DAFAE9338D0C8FE18AFD5E92748F91CD87248A428B4D` |
| `src/config/index.js` | `C1E7B059C11DD9CAF2700ECD5A5597E4CCFFFCDA66758E6501D17DCF808DC36B` |
| `src/hooks/useDataManagement.js` | `8DD5D81BEF7E10E2547CEF97140D3FC3E798E7FC495EF66EBAF6D60BA2E9B25A` |
| `src/hooks/useToolHandlers.js` | `7E682E25767C83276E80838D63E92B4D0D3499CDF037E7F93D1B6A20FD0F5371` |
| `src/layout/components/bottomTools.vue` | `F70AE8B49F5028A576CA62A5C71CDE9B7F5B034C908E4A8F879E51AE287B4571` |
| `src/layout/components/Cesium/index.vue` | `1D169B377339DBDD12B205042A666088A72CBCA19CE022D23F331D837DD0651A` |
| `src/layout/components/FeaturePanel.vue` | `BFC8BE72DF5DE791D2ED551265D3A90540875E1EDA559A25E85009F1FCE9098C` |
| `src/layout/components/layerList/index.vue` | `30696436D1CC624B6EF144D28876577CF7F803E3E2FE3CE5DB0164A8A1EF0B63` |
| `src/layout/components/Openlayers/index.vue` | `8F743BEB7A20E544EF0365F3BC5B8EEF00EF201CF1ADB973F4C0B1D32DFAD845` |
| `src/layout/components/ToolGrid.vue` | `1A9C90EEA6DA21CAFF5B2633E596E4EA67D2A0D18B7F65A60428F05AEC238913` |
| `src/layout/index.vue` | `5EDA5C87A0CDB1ADB95555416171B0BA19591241C4D58937AFEEFA6BCEE223DF` |
| `src/store/index.js` | `61D91BB51C94A698B6403C3C134C13488955C6928C8144E973BC23BA7F88EC7C` |
| `src/store/pipelineStore.js` | `E4D28B6BC8C4704F98A87A0E5EAD3877FE611481F5251C8E2397F86AED923ABF` |
| `src/utils/analyzeXmlData.js` | `117B5993D78799B08DAF2B35637FABCE16CE309CED7576AE615D4713A2B4F152` |
| `src/utils/burstAnalysisService.js` | `03CC3E5FA4A69AB4DE36E886F4630DD27DEEEC65AD9AFACE4E3474F26010629C` |
| `src/utils/cesiumUtils.js` | `6A066B983E607149A09A674642DA608AAE119E6263DF5B5EF65A58F045E8282A` |
| `src/utils/connectivityService.js` | `84BC82E96D4C3EEC57A8C425B8F2518828054114E52D0F681102D14A8D2532F2` |
| `src/utils/geoserverService.js` | `E538B613A6B3EC4DCBD166DB56106D77EBAC340603574E1DFAE794B1F6E85215` |
| `src/utils/mapInteractionManager.js` | `CC532DB177C7AB583AF16B484C1B281F25E68EEFEA746E1749C2B45DD0DDC85E` |
| `src/utils/openlayersUtils.js` | `251893C63A1A4ADAB36367A6D90F63D56C80AC49AE50DCA54C3B7853C2EF5CF6` |
| `src/utils/pipelineConfigManager.js` | `85E9BB22E6E293BA71F9D3B7E50D6783FDE445616C2289BB4E458B8C82AAEEA4` |
| `src/utils/pipelineDataUtils.js` | `AC1A69AB05D0ED552FC6E8652DAA608B784A150A370ADB8A657B5E302859C77F` |
| `src/utils/queryUtils.js` | `327ADC9F36F5987E89E345A6AE97FF7947A84EA23A4701D772C02D803D4D62E8` |
| `src/utils/request.js` | `D7B63B999468B065A368B11CB7AC1CAB49E22FBDE5AD77090089472BAFB94EE5` |
| `vite.config.js` | `766F01CD2FC16EFD17C1717E1A1E1D53F5B45621BC9F67BEDABB0641FB051ED7` |
