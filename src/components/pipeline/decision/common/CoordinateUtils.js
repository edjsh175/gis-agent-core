/**
 * 坐标处理工具函数
 * 用于处理各种坐标格式和几何数据
 */

/**
 * 处理坐标数据格式
 * @param {Array} coordinates - 坐标数组
 * @returns {Array|null} 处理后的坐标数组
 */
export const processCoordinates = (coordinates) => {
  if (!coordinates || !Array.isArray(coordinates)) {
    return null;
  }

  // 如果第一层是数组且第二层也是数组，说明是嵌套格式
  if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0])) {
    return coordinates[0];
  }

  return coordinates;
};

/**
 * 处理几何数据坐标格式
 * @param {Object} geometry - 几何对象
 * @returns {Array|null} 处理后的坐标数组
 */
export const processGeometryCoordinates = (geometry) => {
  if (!geometry) return null;

  switch (geometry.type) {
    case 'LineString':
      return geometry.coordinates;
    case 'MultiLineString':
      // 取第一条线的坐标
      return geometry.coordinates[0];
    default:
      console.warn('未知几何类型:', geometry.type);
      return null;
  }
};

/**
 * 计算线段的几何中点
 * @param {Array} coords - 坐标数组
 * @returns {Array|null} 几何中点坐标
 */
const calculateLineMidpoint = (coords) => {
  if (!coords || coords.length < 2) return null;

  // 计算总长度
  let totalLength = 0;
  const segmentLengths = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    const segmentLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
  }

  // 找到中点所在的线段
  const halfLength = totalLength / 2;
  let accumulatedLength = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    accumulatedLength += segmentLengths[i];
    if (accumulatedLength >= halfLength) {
      // 中点在这个线段中
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];

      // 计算在线段中的位置比例
      const segmentProgress =
        (halfLength - (accumulatedLength - segmentLengths[i])) /
        segmentLengths[i];

      // 计算中点坐标
      const midX = x1 + (x2 - x1) * segmentProgress;
      const midY = y1 + (y2 - y1) * segmentProgress;

      return [midX, midY];
    }
  }

  // 如果计算失败，返回坐标数组的中点
  const midIndex = Math.floor(coords.length / 2);
  return coords[midIndex];
};

/**
 * 获取要素的中点坐标用于定位
 * @param {Object} geometry - 几何对象
 * @returns {Array|null} 中点坐标
 */
export const getFeatureCenterCoordinates = (geometry) => {
  if (!geometry) return null;

  if (geometry.type === 'Point') {
    return geometry.coordinates;
  } else if (geometry.type === 'LineString') {
    // 直接使用LineString的坐标
    const coords = geometry.coordinates;
    if (coords && coords.length > 0) {
      // 计算几何中点，而不是简单的坐标数组中点
      return calculateLineMidpoint(coords);
    }
  } else if (geometry.type === 'MultiLineString') {
    // 对于多线要素，取第一条线的几何中点
    if (geometry.coordinates && geometry.coordinates.length > 0) {
      const firstLineCoords = geometry.coordinates[0];
      if (firstLineCoords && firstLineCoords.length > 0) {
        return calculateLineMidpoint(firstLineCoords);
      }
    }
  }

  return null;
};
