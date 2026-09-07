# Capability Layer 实施与验收记录

日期：2026-09-07。结论：本地能力链路及首批 UI 迁移已实施；24 项单元测试、7 项浏览器测试和构建通过。真实 GeoServer 联调未完成，尚不满足 PRD 的全部发布条件。本轮没有接入 AG-UI、Agent、MCP，没有新增查询面板或部署。

## 实施决策

- Data 通过注入目录、配置和 transport 工作，不读取地图或 Vue。新旧 GeoServer 查询共享认证、超时与取消底座。字段来自 DescribeFeatureType；等值查询校验字段类型，统一 CQL 转义，并保留来源 ID。没有可信总量时，非空结果保守返回 `truncated: null`。
- 应用组装入口为 `src/gis/application.js`。服务注册目录从原配置和树生成；树 ID、服务 ID 与引擎名称分开保存。配置型节点、相对 WMS 地址、同服务多绑定和远端/多层 WMS 都有明确映射规则。
- runtime 以实际地图挂卸载及切换开始为依据；scope 绑定 owner 与 generation。定位只改视图，高亮只管理自己的资源。旧 scope 永久失效，不能跟随重建后的地图。
- 二维高亮复用统一管理器，修复并发初始化、旧图移除顺序和异步失效；legacy 标签与 Capability owner 分隔。闪烁按 5 秒清理。新路径注入样式配置，并允许定位至 zoom 18 后仍看见点闪烁，避免旧样式要求 zoom 21 导致不可见。
- FeatureQuery 保留空间范围、点线双表和 feature 属性 OR 筛选，改用目录取图层身份，保留每条原始要素载荷。单条及批量显示都先定位成功再高亮；关闭、新查询、切换场景取消旧工作流。清理期间的旧定位完成不会重新补高亮。
- FeatureQuery 对 SpatialQueryManager 只使用空间几何职责，通过 `manageHighlights: false` 关闭重复的高亮资源，默认值保留其他调用方行为。DrawManager 和 SpatialQueryManager 销毁释放自己的图层/交互，并防止未完成初始化在销毁后继续添加资源。
- 图层树二维只在用户 `check` 事件展开叶子并调用能力；程序回写只是投影勾选状态。单图层多绑定失败回滚；分组保留已成功叶子的真实状态并报告失败。移动端与桌面端共用提交路径。

MapUtils、GeoServerUtils、属性查询和其他分析调用方尚未整体迁移，仍保留旧接口。三维新 Client API 明确不支持，既有三维路径继续保留；未声称已修复整个 Cesium 生命周期。

## 程序入口

在应用内部通过组装入口使用六项 API。scope 必须在数据请求之前捕获；如果需保留高亮，可由面板生命周期持有 scope，退出时再 dispose。

```js
import { useGisCapabilities } from '@/gis/application.js';

async function verifyPipeline(pipeid) {
  const gis = useGisCapabilities();
  const scope = gis.createClientScope();
  try {
    const result = await gis.data.queryFeatures({
      layerId: 'geoserver:GX:js_ln',
      filters: [{ field: 'pipeid', op: 'eq', value: pipeid }],
    });
    if (!result.ok || result.data.returnedCount === 0) return result;
    const located = await scope.locateFeatures({
      features: result.data.features,
    });
    if (!located.ok) return located;
    return await scope.highlightFeatures({ features: result.data.features });
  } finally {
    // 示例结束即清理；真实面板在退出时调用。
    scope.dispose();
  }
}
```

不依赖地图的入口为 `src/gis/data/index.js` 导出的 `createDataCapabilities`。契约类型见 `src/gis/contracts.js`。测试入口位于 `tests/gis/browser`，不在生产导航或生产构建入口中，不安装生产全局命令函数。

## 验证证据与限制

| 验证                    | 结果与实际覆盖                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:gis`      | 24/24 通过：无 DOM 查询、字段类型与转义、源身份、空/多/截断、元数据失败重试及目录变化、服务失败、取消/超时、目录映射；实际 OL 对象的投影、owner/group 隔离、初始化失效、闪烁定时器和显隐回滚                  |
| `npm run test:gis:e2e`  | 7/7 通过：Edge headless 中真实 OL；编号查询链路、两种投影和六种几何、动画/查询期间切场景、FeatureQuery 真实绘制及表格动作/清理/重开、桌面与移动树同步、分组未加载叶子部分失败。服务响应使用合成数据与路由模拟 |
| `npm run build`         | 通过；仍有大 chunk 与 layout 同时静态/动态导入的既有警告                                                                                                                                                      |
| 真实应用启动            | 使用原配置启动实际首页；二维 runtime ready，观察到 27 个注册条目、16 个引擎图层，无 pageerror。该数量仅为本次运行观察值                                                                                       |
| 真实 GeoServer 只读尝试 | `queryFeatures` 返回 `METADATA_UNAVAILABLE / Failed to fetch`。原 `public/config.js` 中根地址为 `localhost:8080`，浏览器解析协议为 `localhost:`，无法作为 HTTP 服务访问。未修改或猜测部署地址                 |
| 独立审查                | 发现并修复了面板未共享 transport、销毁遗留高亮层、UI 重复解析相对 URL、无 URL 的配置型目录节点四项问题；修复后执行最终回归                                                                                    |

完整验收矩阵继续有效：尚需使用真实服务及实际管线编号核验字段 schema、坐标/轴序、服务上限、真实图层绑定；完整旧 AttributeQuery/SpatialQuery/BufferQuery 页面和 Cesium 三维回归未完成。当前测试覆盖共享管理器兼容性，但不能替代这些旧页面的完整业务回归。两个真实 UI 查询交错的专项回归尚未独立覆盖；已覆盖 Data 请求期间切场景和 UI 清理期间定位完成的失效行为。

## 环境与版本追溯

Node v24.18.0，npm 11.16.0；实际 Vite 8.0.10、Vitest 5.0.0、Playwright 1.63.0，OpenLayers 10.6.1。浏览器测试使用本机 Microsoft Edge。

沿用 npm/package-lock。既有 echarts-liquidfill 3.1.0 的 peer 要求与 ECharts 6.1.0 冲突，因此本次安装使用 `--legacy-peer-deps`；重建时使用 `npm ci --legacy-peer-deps`。未更换图表版本，也未运行自动依赖修复。npm 安装报告 9 项依赖漏洞，未在本次 GIS 改动内做无关升级。测试缓存放入系统临时目录。

Git 仍不能识别当前 `.git`，没有创建或覆盖 Git 基线。原审计 63 项中 14 项因本轮实施变化，其余 49 项保持一致。源码、锁文件、配置与静态 Cesium 资源哈希见 [实施快照](./implementation-snapshot.json)；`auditBeforeSha256` 来自原审计，仅作为历史证据，非 Git 提交。新增文件没有伪造变更前哈希。本轮未部署。
