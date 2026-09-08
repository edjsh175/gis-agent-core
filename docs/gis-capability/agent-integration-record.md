# GIS Agent / AG-UI 实施记录

日期：2026-09-08。

## 当前结论

当前已经完成两条确定性技术验证链路：

1. 业务查询结果 → `feature_ref` → locate → highlight → Tool Result → AG-UI 续跑。
2. 浏览器用户文件 → `file_ref` → import vector → `layer_ref` → style → fit → visibility → Tool Result → AG-UI 续跑。

这证明了 **后端 Agent Runtime 可以通过 AG-UI 驱动当前浏览器中的 GIS Capability，并等待真实地图效果回执后继续运行**。

当前后端仍是 `tests/gis/agui/deterministicService.js` 的确定性 Fixture，不是 LLM。真实 GeoServer、真实 LLM Agent、生产认证、完整租约续期和跨标签页生产冲突仍未完成。

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

## 验收结果

2026-09-08 实测：

```text
npm run test:gis
6 files / 46 tests passed

npm run test:gis:e2e
18 tests passed

npm run build
passed
```

E2E 同时继续覆盖旧 query → locate → highlight、异常参数、多工具拒绝、RUN_ERROR、损坏 state patch、用户手势取消、用户显隐优先、引用拉取期间 scene replacement 等场景。

Build 只有既有的大 chunk 和静态/动态重复导入 warning，没有新增构建失败。

## 仍未完成

以下不能宣称完成：

- 真实 LLM 自主 Tool Planning / Orchestration。
- 真实 GeoServer 查询联调。
- 生产登录/鉴权接入。
- 30 秒租约续期和完整跨标签页 Session Binding 生命周期。
- GeoJSON/KML/CSV/ZIP 等更多用户数据格式。
- `.prj` / CRS 识别与投影转换。当前首版按 EPSG:4326 经纬度解释几何；投影坐标会被几何校验 fail-closed，避免错误落图。
- `remove_user_layer / list_user_layers / get_user_layer_info` 的 AG-UI P1 暴露（Capability 内部能力已预留）。
- 旧绘制、旧样式编辑 UI 全量迁移到 User Vector Capability。

下一阶段的进入条件已经满足：可以先做一次最终架构审查，然后接真实 LLM，把确定性 phase 规划替换成模型依据 `availableFiles / userLayers / Tool Result` 的自主工具选择。
