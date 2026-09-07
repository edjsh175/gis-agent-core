# GIS Capability Layer 迁移与验收计划

日期：2026-09-07。此文件保留分批迁移及完整验收要求；当前实施结果见[实施验收记录](./implementation-record.md)，尚未完成真实服务联调或部署。
前置依据：[源码审计](./capability-audit.md)、[首版 PRD](./capability-layer-prd.md)。接口、错误码和默认行为以 PRD 为准，本文不维护第二套契约。

## 1. 交付边界与实施基线

最初阶段交付本目录三份 Capability 文档，随后补充 [GIS Agent / AG-UI 集成 PRD](./agent-agui-integration-prd.md)。这两次交付仅改文档；后续代码实施单独记录结果。源码审计的 SHA-256 清单保留为原始证据快照，不随本轮代码变更重写。

后续实施开始前先复核关键哈希。目录虽有 .git，但 Git 当前无法识别仓库：如实施环境恢复了有效 Git，记录当前提交和工作区状态；否则记录变更前后文件哈希，不自行重建或覆盖既有 .git。不得把无法获取 commit 写成已完成版本同步。

首版固定使用 npm 与 package-lock.json 作为安装基线；现有 pnpm-lock.yaml 暂不删除，本期不混用包管理器。依据锁文件和 Vite 声明的 engines 选择兼容 Node，记录 Node/npm 实际版本、package-lock 哈希、配置哈希、本地 Cesium 脚本哈希。此次文档没有执行安装，不能据此声明现有 node_modules 与锁文件一致。

## 2. 分批实施与出口

每批只替换其负责的调用路径；通过出口检查后再进入下一批。不做自动部署，不通过生产数据写入验证读能力。

| 批次 | 具体工作与集成点 | 该批完成标准 |
| --- | --- | --- |
| M1 契约、目录与生命周期 | 建立 src/gis 的 Data/Client 工厂、Result/JSDoc 类型、目录转换、runtime 与 scope；从现有 XML/配置派生服务 ID 和显示绑定；在地图组件挂载/卸载 attach/detach；接入 owner.dispose；统一检查当前场景 | Data 可不传地图构造；切换使旧 scope 永久失效；目录无依赖第二份手填清单；同名不同 ID 不误合并 |
| M2 数据查询 | 整理 GeoServerService 的请求底座，使新入口配置显式且不会被异步全局刷新覆盖；提取无 UI transport，加入 DescribeFeatureType、等值条件构建、结果来源保留、limit+1 与错误解析；旧服务 API 保持兼容，委托共享底座 | 无 DOM/Pinia/地图环境完成元数据和查询测试；特殊字符、空结果、失败、截断语义通过；不复用带 ElMessage 的 request 拦截器 |
| M3 二维地图动作 | OL adapter 消费规范化 GeoJSON；拆分动画与高亮；复用 UnifiedHighlightManager 并修复初始化 Promise 合并、换图引用顺序、owner/group 清理、闪烁取消；迁移所需样式配置由组装层注入 | 查询结果可分别定位、高亮；取消/销毁期间异步回调不能提交；清某 owner 不动其他 owner 或绘制层 |
| M4 首个 UI 调用方 | FeatureQuery 在 WFS 转结果处保存 layerId/sourceFeatureId；替换行点击、全部高亮、清理编排；保留空间查询条件、表格业务字段、详情弹窗；每次新查询捕获有效工作流 scope | 现有空间特征查询结果能通过新 Client 显示；不新增编号面板；无几何失败明确；程序编号查询仍是独立 Data 入口 |
| M5 二维图层显隐 | 将 layerList.checkChange 二维分支交给统一入口；把“读树再直接写 checkedKeys”改成“动作成功后提交状态”；分组事件去重并展开叶子；程序提交同步桌面/移动树且不递归触发业务调用 | 程序和 UI 结果一致；未加载/操作失败可见；多绑定同步；三维仍走原分支 |
| M6 清理与回归 | 删除 FeatureQuery 已被替代的高亮源、定位、转换和 timer 实现；确认其他引用后才删除公共 wrapper；清除迁移触及的旧挂载延迟句柄；执行契约/浏览器/真实服务回归与构建 | 下列测试完成，变更清单与版本证据完整；无重复首版业务规则或无价值临时文件 |

M1 需要关注 layout.showStaus 与 store.isDimensionalState3 双重来源。将地图组件实际挂载/卸载作为运行时真相；场景切换开始即使 scope 失效，不能等待新地图加载结束。无需为首版新增“切换场景 Tool”，也不要求本期全面重写旧场景控制。

M2 应让新旧 GeoServer 路径共用同一个请求底座，而非复制 GeoServerService 再只改参数。已有固定 js_ln 的补查 wrapper 暂留给未迁移分析页面，不作为新能力实现。

M3 对外保留现有 UnifiedHighlightManager 默认导出及 initialize/add/clear 接口，旧调用方仍可使用。新 owner/group 扩展采用独立的命名空间；legacy 的 spatial-query、attribute-query 标签不能与新 owner 碰撞。同一活动地图只创建一个统一管理图层；地图 detach 时失效并销毁该代次，初始化中的旧代次不得再添加图层。

## 3. 首批迁移与保留清单

| 区域 | 本期改变 | 保留边界与后续处理 |
| --- | --- | --- |
| FeatureQuery | 标准化输出增补来源字段；定位/批量定位、临时/持久高亮、清理转为能力调用；删除对应组件内 OL 和 timer 重复代码 | 空间几何、feature 属性选项、双表查询继续原逻辑；不能将现有空间 OR 条件塞入首版等值 AND API |
| GeoServerService | 新契约与旧方法共享无 UI transport；配置参数不再被新路径后台刷新覆盖 | 旧 getFeatures/getPipelineDetails 等签名保留；旧调用方的截断和失败策略不悄悄批量改变 |
| MapUtils / GeoServerUtils | 新路径不再依赖其“查询 + 定位 + 高亮”组合 | 分析页面、材质/管径等仍引用时保留；后续每迁移一个调用方再删除对应旧逻辑 |
| UnifiedHighlightManager / 样式及闪烁工具 | 生命周期、owner 与并发安全改造；新路径注入配置 | 原样式视觉规则复用；旧管理器调用回归，不全局清除其他业务层 |
| SpatialQueryManager / BufferAnalysisManager / DrawManager | 只验证共享高亮改造兼容，不迁移算法 | 数据/渲染拆分 P1；不要为了新 API 复制这些 manager |
| layerList / store.checkedKeys | 二维显隐唯一状态提交路径，程序与 UI 共用 | 三维显隐、双击定位、本地文件/标绘项保持原入口；不把标绘 feature 当地图 layer |
| Openlayers/Cesium 组件 | attach/detach 与新工作流失效；清除触及的延迟初始化 | Cesium 新查询高亮不实施；旧 Viewer 完整释放及其他独立泄漏另列后续问题，不声称已修复全部历史资源管理 |
| AttributeQuery 与编辑/分析页面 | 回归共享高亮和图层变化影响 | 不整体迁移；写入测试不执行 POST/PUT/DELETE |

兼容差异必须在实施说明中列明：新定位按几何 extent，最高 zoom 18；不再从 x/y 猜坐标；行选择临时效果统一 5 秒（当前 FeatureQuery 活跃闪烁路径为 3 秒）；批量高亮采用替换避免累积；异常不再被新入口当作无结果。

## 4. 自动化与浏览器验收矩阵

已新增 Vitest（纯模块/配置注入测试）与 Playwright（浏览器交互回归），分别提供 npm run test:gis 和 npm run test:gis:e2e。测试使用固定的合成 GeoJSON 与模拟服务，不复制真实业务数据；通过数量及尚未覆盖的验收项见实施记录。

Vitest 重点验证数据边界、身份映射、条件构造和 runtime 状态机；Playwright 使用实际 OL 地图验证投影、视图、图层与组件事件，不用全部替身假装完成地图验收。e2e 的验证入口只供开发/测试环境使用，不加入生产导航或生产全局 API。

| ID | 场景与步骤 | 必须观察到的结果 | 验证方式 |
| --- | --- | --- | --- |
| D01 | 不提供 window/document/map/Pinia，构造 Data，注入目录和 transport，等值查询 | 成功返回普通可序列化数据；没有 UI 提示或引擎导入副作用 | Vitest |
| D02 | 单结果、多结果、空结果 | 原始业务属性及源 ID 保留；空结果 ok=true、count=0 | Vitest |
| D03 | pipeid 含单引号；未知字段；字段值类型不匹配；空筛选/非法 limit | 合法值正确转义；非法输入在查询请求前失败；不接受任意 CQL | Vitest |
| D04 | 相同业务号/源 ID 来自不同图层；服务省略源 ID | layerId 保持区分；缺源 ID 返回 null，不伪造业务号或序号 | Vitest |
| D05 | limit=100，响应 0/100/101 条；服务报告硬上限且总数未知 | 返回数不超 limit；额外条判断 truncated；未知为 null，UI 不声称完整 | Vitest |
| D06 | HTTP 500、200+ExceptionReport、坏 JSON/结构、元数据失败、超时和 AbortSignal | 分别显式失败；不返回假空结果；无 UI 自动重试 | Vitest |
| D07 | XML ID≠WFS typeName≠engine name；参数大小写；重复显示实例；多层 WMS | 映射正确；多层 WMS 不可单独隐藏其中一层；注册与 loaded 分离 | Vitest |
| D08 | 修改配置或重载目录 | 元数据缓存失效；旧图层 ID 不误指向新数据；无构造后配置覆盖 | Vitest |
| C01 | 二维 Point/LineString/Polygon/Multi 类型定位，高亮分别调用 | 定位无高亮；高亮无视图变化；全部几何在预期范围 | Playwright |
| C02 | EPSG:4326 输入，分别使用 4326 与 3857 view | 坐标转换后定位/覆盖正确，不把经纬度直接当米 | OL + Playwright |
| C03 | 空列表、null/空几何、NaN/越界坐标、不支持 GeometryCollection | 明确错误；已有高亮和视图不被非法输入清除 | Vitest + 浏览器 |
| C04 | 重复 replace、append 有 ID、跨图层相同 ID、清 selection/results | replace 不累积；去重不跨图层误合并；清理仅限 owner/group | OL + 浏览器 |
| C05 | 5 秒闪烁、期间 clear/dispose；同时存在别的查询与绘制图层 | timer 被取消或正常结束；其他 owner 和绘制保持 | 假时钟 + 浏览器 |
| C06 | 多次并发 initialize；初始化未完成即 detach，然后 attach 新地图 | 同图一层；旧层从旧图移除；旧 Promise 不给新图加层 | Vitest + 浏览器 |
| C07 | 查询未完成切到三维；定位动画中卸载；切回二维 | 旧 scope 返回 STALE_CONTEXT/取消；新三维 Client 报不支持；旧结果不自动重放 | Playwright |
| C08 | 地图全局变量残留但组件已卸载；容器尺寸为零；图层未加载 | 不因 window 非空误判 ready；返回明确错误 | Vitest + 浏览器 |
| V01 | 通过程序隐藏/显示图层，再由桌面/移动树勾选 | 绑定图层与 checkedKeys 一致；程序回写不循环触发 | Playwright |
| V02 | 一个数据层多显示绑定；分组一叶子失败；引擎设置抛错 | 单图层更新失败回滚；分组勾选反映成功叶子；错误可见 | Vitest + 浏览器 |
| U01 | FeatureQuery 原空间筛选后点行、全部高亮、clear、退出重开 | 同一套 Client API 被调用；表格业务字段不变；没有额外编号面板 | Playwright |
| U02 | 两次查询交错完成，旧查询返回得晚 | 已取消工作流不能覆盖新结果或触发新地图动作 | Playwright |
| U03 | AttributeQuery、SpatialQuery、BufferQuery 使用共享高亮；三维旧图层显隐 | 旧标签清理不影响新 owner；旧功能无首版引入的回归 | 浏览器只读回归 |
| B01 | npm run build | 构建成功；测试入口不进入生产交互；记录既有与新增警告 | 构建 |

精度相关只验证首版定位/显示的已知坐标样本，不把它扩张为管网空间算法精度认证。已有编辑页面仅检查 UI 可打开及共享资源未误清，不提交写请求。

### 真实服务只读联调

1. 在已加载配置的二维页面选择一个 listLayers 注册的实际管线图层。确认字段元数据有 pipeid，从只读查询或用户现有数据选取一个已知编号；文档中的“XXX”不是实际测试数据。
2. 在查询前捕获 Client scope，执行 queryFeatures，再 locateFeatures，再 highlightFeatures；记录每步成功/失败结果、返回数与截断状态。
3. 对照地图验证位置与覆盖，清除高亮，再程序切换图层显隐并观察树。测试空编号结果和一次真实可控服务失败。
4. 查询等待期间切场景，确认旧响应不移动新地图。切回后重新发起，不重放旧动作。
5. 如配置没有已加载管网或 GeoServer 不可达，标记“联调未完成”，附不含凭据的错误与条件；模拟测试仍可通过，但不能宣布首版上线验收完成。

## 5. 验收证据、发布与后续

每次实施交付记录：变更文件/提交或哈希、环境版本、配置与依赖基线、测试命令/结果、真实联调使用的图层标识、通过与未通过的矩阵 ID。日志只记录错误码和必要上下文，不复制认证头或配置凭据。

全部本期出口通过后才具备发布条件；本次不部署。未来发布应记录源码、配置、依赖、静态 Cesium 资源和服务字段契约的对应版本；产物可追溯到这次验收，不能只复制部分修改文件到运行目录。回退使用先前完整产物及对应配置，不在运行环境临时拼接不同版本。

M1–M6 完成后，紧接着进入 [GIS Agent / AG-UI 集成阶段](./agent-agui-integration-prd.md)：优先验证 AG-UI Frontend Tool + Shared State + Tool Result，通过现有 Client Scope 执行；不默认新增自研 Browser Command Bridge。该阶段有独立的协议往返、会话隔离、引用解析、取消和重复投递验收，不增加本期 M1–M6 的实现前置依赖。

能力扩展仍按 P1 三维适配、空间查询/缓冲拆分和旧生命周期整理，P2 测量/绘制契约推进；首次 AG-UI 验收只需已完成的二维能力。数据写入另行设计。MCP Adapter PRD 为之后的独立交付，本次不创建占位文件；外部地图请求也必须进入同一受控客户端执行路径。
