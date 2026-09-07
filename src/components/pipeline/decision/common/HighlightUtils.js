/**
 * 高亮显示工具函数
 * 用于在地图上创建各种高亮效果
 */

import { startBlinkingEffect } from './BlinkingEffectUtils.js';
import {
  processGeometryCoordinates,
  processCoordinates,
} from './CoordinateUtils.js';

/**
 * 创建点要素高亮
 * @param {Array} coordinates - 坐标数组
 * @param {Object} featureData - 要素数据
 * @param {Object} highlightSource - 高亮数据源
 * @param {boolean} enableBlinking - 是否启用闪烁效果
 * @returns {Promise<Object>} 创建的要素对象
 */
export const createPointHighlight = async (
  coordinates,
  featureData,
  highlightSource,
  enableBlinking = true
) => {
  // 动态导入OpenLayers组件
  const { default: Feature } = await import('ol/Feature');
  const { default: Point } = await import('ol/geom/Point');
  const { default: Style } = await import('ol/style/Style');
  const { default: Circle } = await import('ol/style/Circle');
  const { default: Fill } = await import('ol/style/Fill');
  const { default: Stroke } = await import('ol/style/Stroke');

  // 创建点要素
  const pointFeature = new Feature({
    geometry: new Point(coordinates),
    data: featureData,
  });

  // 设置初始样式
  const style = new Style({
    image: new Circle({
      radius: 12,
      fill: new Fill({
        color: 'rgba(255, 0, 0, 0.7)',
      }),
      stroke: new Stroke({
        color: '#FF0000',
        width: 3,
      }),
    }),
  });

  pointFeature.setStyle(style);
  highlightSource.addFeature(pointFeature);

  // 开始闪烁效果
  let blinkController = null;
  if (enableBlinking) {
    blinkController = await startBlinkingEffect(pointFeature, 5000);
    // 将闪烁控制器存储到要素中，便于后续清除
    pointFeature.set('blinkController', blinkController);
  }

  return { feature: pointFeature, blinkController };
};

/**
 * 创建线要素高亮
 * @param {Array} coordinates - 坐标数组
 * @param {Object} featureData - 要素数据
 * @param {Object} highlightSource - 高亮数据源
 * @param {boolean} enableBlinking - 是否启用闪烁效果
 * @returns {Promise<Object>} 创建的要素对象
 */
export const createLineHighlight = async (
  coordinates,
  featureData,
  highlightSource,
  enableBlinking = true
) => {
  // 动态导入OpenLayers组件
  const { default: Feature } = await import('ol/Feature');
  const { default: LineString } = await import('ol/geom/LineString');
  const { default: Style } = await import('ol/style/Style');
  const { default: Stroke } = await import('ol/style/Stroke');

  // 创建线要素
  const lineFeature = new Feature({
    geometry: new LineString(coordinates),
    data: featureData,
  });

  // 设置初始样式
  const style = new Style({
    stroke: new Stroke({
      color: '#FF0000',
      width: 8,
    }),
  });

  lineFeature.setStyle(style);
  highlightSource.addFeature(lineFeature);

  // 开始闪烁效果
  let blinkController = null;
  if (enableBlinking) {
    blinkController = await startBlinkingEffect(lineFeature, 5000);
    // 将闪烁控制器存储到要素中，便于后续清除
    lineFeature.set('blinkController', blinkController);
  }

  return { feature: lineFeature, blinkController };
};

/**
 * 创建多线要素高亮
 * @param {Array} coordinates - 坐标数组
 * @param {Object} featureData - 要素数据
 * @param {Object} highlightSource - 高亮数据源
 * @param {boolean} enableBlinking - 是否启用闪烁效果
 * @returns {Promise<Object>} 创建的要素对象
 */
export const createMultiLineHighlight = async (
  coordinates,
  featureData,
  highlightSource,
  enableBlinking = true
) => {
  // 动态导入OpenLayers组件
  const { default: Feature } = await import('ol/Feature');
  const { default: MultiLineString } = await import('ol/geom/MultiLineString');
  const { default: Style } = await import('ol/style/Style');
  const { default: Stroke } = await import('ol/style/Stroke');

  // 创建多线要素
  const multiLineFeature = new Feature({
    geometry: new MultiLineString(coordinates),
    data: featureData,
  });

  // 设置初始样式
  const style = new Style({
    stroke: new Stroke({
      color: '#FF0000',
      width: 8,
    }),
  });

  multiLineFeature.setStyle(style);
  highlightSource.addFeature(multiLineFeature);

  // 开始闪烁效果
  let blinkController = null;
  if (enableBlinking) {
    blinkController = await startBlinkingEffect(multiLineFeature, 5000);
    // 将闪烁控制器存储到要素中，便于后续清除
    multiLineFeature.set('blinkController', blinkController);
  }

  return { feature: multiLineFeature, blinkController };
};

/**
 * 根据几何类型创建相应的高亮
 * @param {Object} geometry - 几何对象
 * @param {Object} featureData - 要素数据
 * @param {Object} highlightSource - 高亮数据源
 * @param {boolean} enableBlinking - 是否启用闪烁效果
 * @returns {Promise<Object>} 创建的要素对象
 */
export const createHighlightByGeometry = async (
  geometry,
  featureData,
  highlightSource,
  enableBlinking = true
) => {
  if (!geometry) return null;

  if (geometry.type === 'Point') {
    return await createPointHighlight(
      geometry.coordinates,
      featureData,
      highlightSource,
      enableBlinking
    );
  } else if (geometry.type === 'LineString') {
    const processedCoords = processCoordinates(geometry.coordinates);
    if (processedCoords && processedCoords.length > 0) {
      return await createLineHighlight(
        processedCoords,
        featureData,
        highlightSource,
        enableBlinking
      );
    }
  } else if (geometry.type === 'MultiLineString') {
    return await createMultiLineHighlight(
      geometry.coordinates,
      featureData,
      highlightSource,
      enableBlinking
    );
  }

  return null;
};
