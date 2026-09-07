# Agent 集成第一批实施记录

日期：2026-09-07。范围：结果引用与 MapContext 基础契约。AG-UI SDK、HTTP/SSE 端点、远程会话鉴权和模型尚未接入，本记录不代表 Agent 往返验收通过。

## 架构决策

- CapabilityFeature 仍是定位/高亮的数据载荷。FeatureIdentity 描述 layerId + sourceFeatureId，不能替代查询快照。FeatureRef 指向不可变结果及可选下标，源 ID 缺失仍可引用。
- 引用存储是纯 JavaScript 集成模块，时钟与结果 ID 生成器可注入；默认随机 UUID。它验证传入绑定的一致性，但不负责证明调用者身份。未来服务入口必须从已认证上下文构建 binding，不能直接信任模型或浏览器提交的 userId。
- 首批快照期限取登记时页面租约与十分钟上限中较早者，读取和续租都不延长已登记快照。这是保守的固定期限策略；后续租约服务如要支持续租，须显式调整契约并补验收，不能让旧引用悄悄复活。
- MapContext 按需从当前地图读取，不维护另一份可写地图状态。相同观察保持 revision；地图代次/目录版本变化也递增 revision，但不向模型暴露 generation 或 owner。
- 可观察的高亮只覆盖能力适配器管理的资源。用户选择尚无统一权威来源，返回 null；不能以空集合假装已经完成选择状态接入。
- 三维保持 runtime readiness 的事实，但观察内容为 null、前端工具可用列表为空。能力是否可以执行仍由原 Client Scope 检查。

## 程序入口

应用内通过 `useGisCapabilities().mapContext.getSnapshot()` 取得 Result 包装的纯 JSON 观察。读取结果不能修改地图，也不包含坐标全集、属性全集或引擎对象。

引用存储模块提供 register、resolve、revokeWorkflow、dispose。register 只登记成功查询的数据并返回引用摘要；resolve 只读取原快照，不联网补查。现有 Vue 查询 UI 继续直接传递 features，不引入额外缓存路径。

## 验证与边界

`npm run test:gis`：39/39 通过，其中新增 15 项引用与观察测试。`npm run test:gis:e2e`：8/8 通过，新增真实浏览器 MapContext 回归。`npm run build` 通过，保留原有大分块及布局静态/动态导入警告。自动化使用合成查询数据与本地 OpenLayers；真实 GeoServer 仍未联调。

已覆盖不可变结果、空结果、缺源 ID/几何、下标顺序与非法下标、跨用户/页面/thread/workflow 隔离、配置失效、固定期限、撤销、配额和 ID 分配失败，以及循环/访问器等非 JSON 输入。观察测试覆盖坐标转换、父分组显隐、绑定缺失/歧义、高亮源清理、地图重建、三维未知状态和对象形式源 ID 不泄漏载荷。

独立审查发现并修复了旧调用方对象形式源 ID 可能进入共享摘要的问题；引用存储的隔离、配额、期限与复制策略经复审无新增实质问题。测试不代表远程鉴权已实现；传入绑定目前必须来自可信组装代码。

下一批完成确定性 AG-UI 服务与前端工具往返：协议事件校验、绑定到既有 scope、异步引用解析前后检查、工具回执续跑、取消与去重。MapContext 的交互结束订阅和用户操作优先策略在该批接入；本批按需读取不提供运行中的自动取消保证。

Capability 的原审计与实施快照保留历史含义，不覆盖旧哈希。第一批文件 SHA-256 见 [独立快照](./agent-integration-snapshot.json)，便于区分各阶段源码与验收结果。
