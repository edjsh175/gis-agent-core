/**
 * 公用函数导出文件
 * 统一导出所有公用工具函数
 */

// 闪烁效果工具
export { startBlinkingEffect } from './BlinkingEffectUtils.js';

// 坐标处理工具
export {
  processCoordinates,
  processGeometryCoordinates,
  getFeatureCenterCoordinates,
} from './CoordinateUtils.js';

// 高亮显示工具
export {
  createPointHighlight,
  createLineHighlight,
  createMultiLineHighlight,
  createHighlightByGeometry,
} from './HighlightUtils.js';

// 统一高亮样式工具
export {
  getStandardPipelineStyle,
  getQueryResultStyle,
  getTemporaryHighlightStyle,
  getMapInteractionStyle,
  getBlinkingConfig,
  createBlinkingStyle,
} from './HighlightStyleUtils.js';

// GeoServer查询工具
export { queryPipeGeometryFromGeoServer } from './GeoServerUtils.js';

// 地图工具
export {
  flyToFeature,
  initializeHighlightLayer,
  clearHighlight,
} from './MapUtils.js';
