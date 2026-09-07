/**
 * 地图工具函数
 * 用于地图定位和图层管理
 */

import { getFeatureCenterCoordinates } from './CoordinateUtils.js';
import { createHighlightByGeometry } from './HighlightUtils.js';

/**
 * 飞至指定要素
 * @param {Object} featureData - 要素数据
 * @param {Object} map - 地图实例
 * @param {Object} highlightSource - 高亮数据源
 * @param {string} analysisType - 分析类型
 * @param {Function} queryPipeGeometry - 查询管段几何数据的函数
 * @returns {Promise<void>}
 */
export const flyToFeature = async (
  featureData,
  map,
  highlightSource,
  analysisType,
  queryPipeGeometry = null
) => {
  if (!map) {
    console.warn('地图未初始化');
    return;
  }

  try {
    let coordinates = null;
    let geometry = null;

    // 处理管段数据 - 通过pipeId查询几何数据
    if (featureData.管线编号 && analysisType === 'pipe' && queryPipeGeometry) {
      const pipeId = featureData.管线编号;
      console.log(`定位管段 ${pipeId}...`);

      // 查询管段几何数据
      const queryResult = await queryPipeGeometry(pipeId);

      if (queryResult.success && queryResult.geometry) {
        geometry = queryResult.geometry;
        console.log(`成功获取管段 ${pipeId} 的几何数据`);
      } else {
        console.warn(`未找到管段 ${pipeId} 的几何数据`);
        return;
      }
    }
    // 处理阀门数据 - 使用现有逻辑
    else if (featureData._rawData && featureData._rawData.geometry) {
      geometry = featureData._rawData.geometry;
    } else if (featureData._feature && featureData._feature.geometry) {
      geometry = featureData._feature.geometry;
    } else if (featureData.geometry) {
      geometry = featureData.geometry;
    }

    // 处理几何数据获取坐标
    coordinates = getFeatureCenterCoordinates(geometry);

    if (!coordinates) {
      console.warn('无法定位：缺少坐标信息');
      return;
    }

    console.log(`定位到坐标:`, coordinates);

    // 飞至指定坐标
    map.getView().animate({
      center: coordinates,
      zoom: 22,
      duration: 1000,
    });

    // 添加临时高亮效果
    let highlightResult = null;
    if (geometry && highlightSource) {
      highlightResult = await createHighlightByGeometry(
        geometry,
        featureData,
        highlightSource,
        true
      );
    }

    // 显示成功消息
    const featureName = featureData.阀门编号 || featureData.管线编号 || '未知';
    console.log(`已定位到要素: ${featureName}`);

    // 返回高亮结果（包含闪烁控制器）
    return highlightResult;
  } catch (error) {
    console.error('定位失败:', error);
  }
};

/**
 * 初始化高亮图层
 * @param {Object} map - 地图实例
 * @param {string} layerName - 图层名称
 * @returns {Promise<Object>} 高亮图层对象
 */
export const initializeHighlightLayer = async (
  map,
  layerName = 'highlight-layer'
) => {
  if (!map) return null;

  try {
    const { default: VectorSource } = await import('ol/source/Vector');
    const { default: VectorLayer } = await import('ol/layer/Vector');

    const highlightSource = new VectorSource();
    const highlightLayer = new VectorLayer({
      source: highlightSource,
      name: layerName,
      zIndex: 1000,
    });

    highlightLayer.set('category', 'highlight');
    map.addLayer(highlightLayer);

    return { highlightLayer, highlightSource };
  } catch (error) {
    console.error('初始化高亮图层失败:', error);
    return null;
  }
};

/**
 * 清除高亮图层
 * @param {Object} highlightSource - 高亮数据源
 */
export const clearHighlight = (highlightSource) => {
  if (highlightSource) {
    highlightSource.clear();
  }
};
