import { ElMessage } from 'element-plus';
import { Vector as VectorSource } from 'ol/source';
import { Vector as VectorLayer } from 'ol/layer';
import { Feature } from 'ol';
import { Point, LineString, Polygon, Circle } from 'ol/geom';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import * as turf from '@turf/turf';
import unifiedHighlightManager from './UnifiedHighlightManager.js';

/**
 * 空间查询管理器
 * 统一管理空间查询的所有功能
 */
export class SpatialQueryManager {
  constructor(map, { manageHighlights = true } = {}) {
    this.map = map;
    this.manageHighlights = manageHighlights;
    this.queryLayer = null;
    this.highlightLayer = null;
    this.resultsLayer = null;
    this.isActive = false;
    this.queryGeometry = null;
    this.queryResults = [];

    // 绑定事件处理函数
    this.handleGeometryChange = this.handleGeometryChange.bind(this);

    // 初始化统一高亮管理器
    if (manageHighlights) this.initUnifiedHighlightManager();
  }

  // ==================== 生命周期管理 ====================

  /**
   * 初始化统一高亮管理器
   */
  async initUnifiedHighlightManager() {
    try {
      await unifiedHighlightManager.initialize(this.map);
    } catch (error) {
      console.error('初始化统一高亮管理器失败:', error);
    }
  }

  /**
   * 激活空间查询模式
   */
  async activate() {
    if (this.isActive) return;

    this.isActive = true;

    // 创建查询图层
    await this.createQueryLayer();

    // 创建高亮图层
    if (this.isActive && this.manageHighlights) await this.createHighlightLayer();
  }

  /**
   * 停用空间查询模式
   */
  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;

    // 清除所有图层
    this.clearAll();
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.isActive = false;
    this.clearAllLayers();
    this.map = null;
  }

  // ==================== 图层管理 ====================

  /**
   * 创建查询图层
   */
  async createQueryLayer() {
    try {
      // 动态导入OpenLayers组件
      const { default: VectorSource } = await import('ol/source/Vector');
      const { default: VectorLayer } = await import('ol/layer/Vector');

      // 创建矢量数据源
      const querySource = new VectorSource();

      // 获取查询样式
      const queryStyle = await this.getQueryStyle();
      if (!this.map || !this.isActive) return;

      // 创建矢量图层
      this.queryLayer = new VectorLayer({
        source: querySource,
        name: 'spatial-query-layer',
        zIndex: 1000,
        style: queryStyle,
      });

      // 设置图层标识
      this.queryLayer.set('category', 'spatial-query');
      this.queryLayer.set('spatialQuery', true);

      // 添加到地图
      this.map.addLayer(this.queryLayer);
    } catch (error) {
      console.error('创建查询图层失败:', error);
      throw error;
    }
  }

  /**
   * 创建高亮图层
   */
  async createHighlightLayer() {
    try {
      // 动态导入OpenLayers组件
      const { default: VectorSource } = await import('ol/source/Vector');
      const { default: VectorLayer } = await import('ol/layer/Vector');

      // 创建矢量数据源
      const highlightSource = new VectorSource();

      // 获取高亮样式
      const highlightStyle = await this.getHighlightStyle();
      if (!this.map || !this.isActive) return;

      // 创建矢量图层
      this.highlightLayer = new VectorLayer({
        source: highlightSource,
        name: 'spatial-query-highlight',
        zIndex: 2000,
        style: highlightStyle,
      });

      // 设置图层标识
      this.highlightLayer.set('category', 'spatial-query-highlight');
      this.highlightLayer.set('spatialQuery', true);

      // 添加到地图
      this.map.addLayer(this.highlightLayer);
    } catch (error) {
      console.error('创建高亮图层失败:', error);
      throw error;
    }
  }

  // ==================== 几何体处理 ====================

  /**
   * 设置查询几何体
   */
  async setQueryGeometry(geometry, drawType) {
    if (!this.isActive) {
      throw new Error('空间查询管理器未激活');
    }

    try {
      // 清除之前的查询几何体
      this.clearQueryGeometry();

      // 处理不同类型的几何体
      const processedGeometry = await this.processGeometry(geometry, drawType);
      if (!processedGeometry) {
        throw new Error('几何体处理失败');
      }

      // 保存查询几何体
      this.queryGeometry = processedGeometry;

      // 在地图上显示查询几何体
      await this.displayQueryGeometry(processedGeometry);

      // 触发几何体变化事件
      this.handleGeometryChange(processedGeometry);

      return processedGeometry;
    } catch (error) {
      console.error('设置查询几何体失败:', error);
      throw error;
    }
  }

  /**
   * 处理几何体
   */
  async processGeometry(geometry, drawType) {
    try {
      let processedGeometry = null;

      switch (drawType) {
        case 'Polygon':
          processedGeometry = this.processPolygonGeometry(geometry);
          break;
        case 'Circle':
          processedGeometry = this.processCircleGeometry(geometry);
          break;
        default:
          throw new Error(`不支持的几何类型: ${drawType}`);
      }

      return processedGeometry;
    } catch (error) {
      console.error('处理几何体失败:', error);
      throw error;
    }
  }

  /**
   * 处理多边形几何体
   */
  processPolygonGeometry(geometry) {
    const coordinates = geometry.getCoordinates();
    const exteriorRing = coordinates[0];
    const wktCoords = exteriorRing
      .map((coord) => `${coord[0]} ${coord[1]}`)
      .join(',');

    return {
      type: 'Polygon',
      coordinates: coordinates,
      geometry: geometry,
      wkt: `POLYGON((${wktCoords}))`,
    };
  }

  /**
   * 处理圆形几何体
   */
  processCircleGeometry(geometry) {
    const center = geometry.getCenter();

    // 仅替换"半径计算"这一段
    let radiusDeg = geometry.getRadius(); // 单位：度
    if (!radiusDeg || radiusDeg <= 0) {
      console.error('getRadius 返回无效值');
      throw new Error('无法获取圆形半径');
    }

    // 精确度 → 米（按当前纬度修正）
    let lat = geometry.getCenter()[1]; // 纬度
    const mPerDegLat = 111132.954; // 经线方向常数
    const mPerDegLon =
      (Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / 180;
    const radiusM = radiusDeg * Math.min(mPerDegLon, mPerDegLat); // 取最小值，保证不会高估

    console.log('纬度:', lat, '半径(度):', radiusDeg, '→ 半径(米):', radiusM);

    // 确保坐标在正确的范围内（WGS84经纬度）
    let lon = center[0];

    // 限制坐标精度，避免浮点精度问题
    lon = parseFloat(lon.toFixed(8));
    lat = parseFloat(lat.toFixed(8));

    // 下面继续用你的 Turf 生成多边形
    const circle = turf.circle([lon, lat], radiusM, {
      units: 'meters',
      steps: 64,
    });

    return {
      type: 'Circle',
      coordinates: circle.geometry.coordinates,
      geometry: geometry,
      wkt: this.getCircleWKT(circle),
      originalGeometry: geometry,
      center: [lon, lat],
      radius: radiusM,
    };
  }

  /**
   * 获取圆形的WKT表示
   */
  getCircleWKT(circle) {
    const coordinates = circle.geometry.coordinates[0];
    const wktCoords = coordinates
      .map((coord) => {
        // 限制坐标精度，避免浮点精度问题
        const lon = parseFloat(coord[0].toFixed(8));
        const lat = parseFloat(coord[1].toFixed(8));
        return `${lon} ${lat}`;
      })
      .join(',');
    return `POLYGON((${wktCoords}))`;
  }

  /**
   * 在地图上显示查询几何体
   */
  async displayQueryGeometry(processedGeometry) {
    if (!this.queryLayer || !this.queryLayer.getSource()) return;

    try {
      // 动态导入OpenLayers组件
      const { default: Feature } = await import('ol/Feature');

      // 创建要素
      const feature = new Feature({
        geometry: processedGeometry.geometry,
        queryType: processedGeometry.type,
        wkt: processedGeometry.wkt,
      });

      // 设置样式
      const queryStyle = await this.getQueryStyle();
      feature.setStyle(queryStyle);

      // 添加到图层
      this.queryLayer.getSource().addFeature(feature);
    } catch (error) {
      console.error('显示查询几何体失败:', error);
      throw error;
    }
  }

  // ==================== 空间查询 ====================

  /**
   * 执行空间查询
   */
  async performSpatialQuery(targetLayers, getFeatureType) {
    if (!this.queryGeometry) {
      throw new Error('请先设置查询几何体');
    }

    try {
      // 获取几何体的WKT字符串
      const geometryWKT = this.queryGeometry.wkt;
      if (!geometryWKT) {
        throw new Error('无法生成几何体WKT');
      }

      const allResults = [];

      // 对每个目标图层执行WFS查询
      for (const layerKey of targetLayers) {
        try {
          const results = await this.performWFSIntersectQuery(
            layerKey,
            geometryWKT
          );
          allResults.push(...results);
        } catch (error) {
          console.warn(`查询图层 ${layerKey} 失败:`, error);
        }
      }

      // 格式化查询结果
      this.queryResults = this.formatQueryResults(allResults, getFeatureType);

      return this.queryResults;
    } catch (error) {
      console.error('执行空间查询失败:', error);
      throw error;
    }
  }

  /**
   * 执行WFS相交查询
   */
  async performWFSIntersectQuery(
    layerKey,
    geometryWKT,
    baseUrl = '/geoserver/GX/ows'
  ) {
    const layerTypes = ['_pt', '_ln'];
    const allLayerResults = [];

    // for (const layerType of layerTypes) {
    // const typeName = `GX:${layerKey}${layerType}`;
    const typeName = `GX:${layerKey}`;
    const params = new URLSearchParams({
      service: 'WFS',
      version: '1.0.0',
      request: 'GetFeature',
      typeName: typeName,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      cql_filter: `INTERSECTS(geom, ${geometryWKT})`,
    });

    const requestUrl = `${baseUrl}?${params}`;

    try {
      const response = await fetch(requestUrl);

      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
        } catch (e) {}
        console.warn(
          `WFS查询失败 (${typeName}): HTTP ${response.status}, ${errorText}`
        );
      }

      const contentType = response.headers.get('content-type');
      let data;

      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const responseText = await response.text();
        if (
          responseText.includes('ServiceException') ||
          responseText.includes('error')
        ) {
          console.warn(`服务器错误 (${typeName}): ${responseText}`);
        }
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          console.warn(`无法解析响应 (${typeName}): ${responseText}`);
        }
      }

      if (data.features && data.features.length > 0) {
        const results = data.features.map((feature) => ({
          id: feature.id,
          geometry: feature.geometry,
          properties: feature.properties,
          layerKey: layerKey,
        }));
        allLayerResults.push(...results);
      }
    } catch (error) {
      console.error(`WFS查询失败 (${typeName}):`, error);
    }
    // }

    return allLayerResults;
  }

  /**
   * 格式化查询结果数据
   */
  formatQueryResults(allResults, getFeatureType) {
    const pipelineResults = [];
    const pointResults = [];

    allResults.forEach((feature) => {
      const isPointGeometry =
        feature.geometry && feature.geometry.type === 'Point';
      const isPipelineGeometry =
        feature.geometry &&
        (feature.geometry.type === 'LineString' ||
          feature.geometry.type === 'MultiLineString');

      if (isPointGeometry) {
        const resultItem = {
          id: feature.id || feature.properties?.id || '未知',
          name:
            feature.properties?.name ||
            feature.properties?.layerName ||
            '未命名',
          type: getFeatureType(feature.layerKey),
          geometry: feature.geometry,
          properties: feature.properties,
          layerKey: feature.layerKey,
          exp_no: feature.properties?.exp_no || '无编号',
          surf_h: feature.properties?.surf_h || '',
          feature: feature.properties?.feature || '无特征',
          subsid: feature.properties?.subsid || '无设施',
          index: pointResults.length + 1,
        };
        pointResults.push(resultItem);
      } else if (isPipelineGeometry) {
        const resultItem = {
          id: feature.id || feature.properties?.id || '未知',
          name:
            feature.properties?.name ||
            feature.properties?.layerName ||
            '未命名',
          type: getFeatureType(feature.layerKey),
          geometry: feature.geometry,
          properties: feature.properties,
          layerKey: feature.layerKey,
          pipeid: feature.properties?.pipeid || '无编号',
          s_deep:
            feature.properties?.s_deep + '/' + feature.properties?.e_deep ||
            '无数据',
          s_height:
            feature.properties?.s_height + '/' + feature.properties?.e_height ||
            '无数据',
          code: feature.properties?.code || '无数据',
          d_s: feature.properties?.d_s || '无数据',
          material: feature.properties?.material || '无数据',
          flowdirect: feature.properties?.flowdirect || '',
          index: pipelineResults.length + 1,
        };
        pipelineResults.push(resultItem);
      }
    });

    return {
      pipelines: pipelineResults,
      points: pointResults,
      total: allResults.length,
    };
  }

  // ==================== 高亮功能 ====================

  /**
   * 高亮显示查询结果
   */
  async highlightResults(results) {
    // 确保统一高亮管理器已初始化
    if (!unifiedHighlightManager.isReady()) {
      await this.initUnifiedHighlightManager();
    }

    try {
      // 清除之前的高亮
      unifiedHighlightManager.clearHighlightFeatures('spatial-query');

      // 动态导入OpenLayers组件
      const { default: Feature } = await import('ol/Feature');
      const { default: GeoJSON } = await import('ol/format/GeoJSON');

      // 导入统一的高亮样式工具
      const { getQueryResultStyle } = await import('./HighlightStyleUtils.js');

      const format = new GeoJSON();

      // 处理管点结果
      if (results.points && results.points.length > 0) {
        for (const point of results.points) {
          if (point.geometry) {
            const feature = format.readFeature(point.geometry, {
              featureProjection: 'EPSG:4326',
              dataProjection: 'EPSG:4326',
            });
            feature.set('resultType', 'point');
            feature.set('resultData', point);

            // 使用统一的查询结果样式
            const style = await getQueryResultStyle('Point');
            feature.setStyle(style);

            // 添加到统一高亮图层
            unifiedHighlightManager.addHighlightFeature(
              feature,
              'spatial-query'
            );
          }
        }
      }

      // 处理管线结果
      if (results.pipelines && results.pipelines.length > 0) {
        for (const pipeline of results.pipelines) {
          if (pipeline.geometry) {
            const feature = format.readFeature(pipeline.geometry, {
              featureProjection: 'EPSG:4326',
              dataProjection: 'EPSG:4326',
            });
            feature.set('resultType', 'pipeline');
            feature.set('resultData', pipeline);

            // 使用统一的查询结果样式
            const style = await getQueryResultStyle('LineString');
            feature.setStyle(style);

            // 添加到统一高亮图层
            unifiedHighlightManager.addHighlightFeature(
              feature,
              'spatial-query'
            );
          }
        }
      }
    } catch (error) {
      console.error('高亮显示结果失败:', error);
      throw error;
    }
  }

  /**
   * 清除高亮
   */
  clearHighlight() {
    if (!this.manageHighlights) return;
    if (unifiedHighlightManager.isReady()) {
      unifiedHighlightManager.clearHighlightFeatures('spatial-query');
    }
  }

  // ==================== 清理功能 ====================

  /**
   * 清除查询几何体
   */
  clearQueryGeometry() {
    if (this.queryLayer && this.queryLayer.getSource()) {
      this.queryLayer.getSource().clear();
    }
    this.queryGeometry = null;
  }

  /**
   * 清除所有图层和状态
   */
  clearAll() {
    this.clearQueryGeometry();
    this.clearHighlight();

    if (this.queryLayer && this.map) {
      this.map.removeLayer(this.queryLayer);
      this.queryLayer = null;
    }

    // 不清除高亮图层，只清除内容，这样下次查询时可以直接使用
    // if (this.highlightLayer && this.map) {
    //   this.map.removeLayer(this.highlightLayer);
    //   this.highlightLayer = null;
    // }

    this.queryResults = [];
  }

  /**
   * 完全清理所有图层和状态（用于组件销毁）
   */
  clearAllLayers() {
    this.clearQueryGeometry();
    this.clearHighlight();

    if (this.queryLayer && this.map) {
      this.map.removeLayer(this.queryLayer);
      this.queryLayer = null;
    }

    if (this.highlightLayer && this.map) {
      this.map.removeLayer(this.highlightLayer);
      this.highlightLayer = null;
    }

    this.queryResults = [];
  }

  // ==================== 样式管理 ====================

  /**
   * 获取查询样式
   */
  async getQueryStyle() {
    // 使用统一的高亮样式配置
    const config = window.highlight_style_config || {};
    const style = config.query_result || {
      line: { color: '#0066FF', width: 4 },
      point: { fill: '#0066FF', stroke: '#FFFFFF', radius: 8, strokeWidth: 3 },
    };

    // 动态导入OpenLayers样式类
    const { default: Style } = await import('ol/style/Style');
    const { default: Stroke } = await import('ol/style/Stroke');
    const { default: Circle } = await import('ol/style/Circle');
    const { default: Fill } = await import('ol/style/Fill');

    // 使用条件样式函数，点只在缩放级别 >= 21 时显示
    return (feature, resolution) => {
      const zoom = Math.log2(156543.03392 / resolution);
      const geometry = feature.getGeometry();

      if (geometry.getType() === 'Point') {
        if (zoom < 20) {
          return null; // 点不显示
        }
      }

      return new Style({
        stroke: new Stroke({
          color: '#FF0000', // 红色边框
          width: style.line.width,
        }),
        fill: new Fill({
          color: 'rgba(255, 0, 0, 0.05)', // 半透明红色填充
        }),
        image: new CircleStyle({
          radius: style.point.radius,
          fill: new Fill({ color: style.point.fill }),
          stroke: new Stroke({
            color: style.point.stroke,
            width: style.point.strokeWidth,
          }),
        }),
        zIndex: 1000, // 查询高亮层级
      });
    };
  }

  /**
   * 获取高亮样式
   */
  async getHighlightStyle() {
    // 使用统一的高亮样式配置
    const config = window.highlight_style_config || {};
    const style = config.query_result || {
      line: { color: '#0066FF', width: 8 },
      point: { fill: '#0066FF', stroke: '#FFFFFF', radius: 10, strokeWidth: 3 },
    };

    // 动态导入OpenLayers样式类
    const { default: Style } = await import('ol/style/Style');
    const { default: Stroke } = await import('ol/style/Stroke');
    const { default: Circle } = await import('ol/style/Circle');
    const { default: Fill } = await import('ol/style/Fill');

    // 使用条件样式函数，点只在缩放级别 >= 21 时显示
    return (feature, resolution) => {
      const zoom = Math.log2(156543.03392 / resolution);
      const geometry = feature.getGeometry();

      if (geometry.getType() === 'Point') {
        if (zoom < 20) {
          return null; // 点不显示
        }
      }

      return new Style({
        stroke: new Stroke({
          color: style.line.color,
          width: style.line.width,
        }),
        fill: new Fill({
          color: 'rgba(63, 158, 255, 0.3)',
        }),
        image: new CircleStyle({
          radius: style.point.radius,
          fill: new Fill({ color: style.point.fill }),
          stroke: new Stroke({
            color: style.point.stroke,
            width: style.point.strokeWidth,
          }),
        }),
        zIndex: 1000, // 查询高亮层级
      });
    };
  }

  // ==================== 事件处理 ====================

  /**
   * 处理几何体变化事件
   */
  handleGeometryChange(geometry) {
    // 可以在这里添加几何体变化的处理逻辑
    console.log('查询几何体已更新:', geometry);
  }

  // ==================== 测试功能 ====================

  // ==================== 状态获取 ====================

  /**
   * 获取当前查询几何体
   */
  getQueryGeometry() {
    return this.queryGeometry;
  }

  /**
   * 获取查询结果
   */
  getQueryResults() {
    return this.queryResults;
  }

  /**
   * 检查是否已激活
   */
  isActivated() {
    return this.isActive;
  }
}

// 导出工厂函数
export function createSpatialQueryManager(map, options) {
  return new SpatialQueryManager(map, options);
}
