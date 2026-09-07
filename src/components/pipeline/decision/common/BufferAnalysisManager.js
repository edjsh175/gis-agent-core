import { ElMessage } from 'element-plus';
import { Vector as VectorSource } from 'ol/source';
import { Vector as VectorLayer } from 'ol/layer';
import { Feature } from 'ol';
import { Point, LineString } from 'ol/geom';
import { Style, Stroke, Fill, Text, Circle } from 'ol/style';
import * as turf from '@turf/turf';

/**
 * 缓冲区分析管理器
 * 统一管理缓冲区分析的所有图层、状态和交互
 */
export class BufferAnalysisManager {
  constructor(map) {
    this.map = map;
    this.bufferLayer = null;
    this.highlightLayer = null;
    this.resultsLayer = null;
    this.isActive = false;
    this.isSelecting = false; // 添加选择状态控制
    this.selectedPipeline = null;
    this.bufferGeometry = null;
    this.queryResults = [];

    // 绑定事件处理函数
    this.handlePipelineFeatureClick =
      this.handlePipelineFeatureClick.bind(this);
  }

  // ==================== 生命周期管理 ====================

  /**
   * 激活缓冲区分析模式
   */
  async activate() {
    if (this.isActive) return;

    this.isActive = true;
    this.isSelecting = false; // 默认不允许选择管段，需要用户点击按钮

    // 添加管线要素点击事件监听器
    window.addEventListener(
      'pipelineFeatureClick',
      this.handlePipelineFeatureClick
    );
  }

  /**
   * 停用缓冲区分析模式
   */
  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;

    // 移除事件监听器
    window.removeEventListener(
      'pipelineFeatureClick',
      this.handlePipelineFeatureClick
    );

    // 清除所有图层
    this.clearAll();
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.deactivate();
    this.map = null;
  }

  // ==================== 事件处理 ====================

  /**
   * 处理管线要素点击事件
   */
  async handlePipelineFeatureClick(event) {
    if (!this.isActive || !this.isSelecting) return;

    const featureInfo = event.detail;
    if (featureInfo && featureInfo.geometryType === 'LineString') {
      // 统一数据结构
      this.selectedPipeline = {
        name: featureInfo.properties?.name || featureInfo.id || '未命名管段',
        geometry: {
          type: 'LineString',
          coordinates: featureInfo.coordinates,
        },
        properties: featureInfo.properties,
      };

      await this.highlightSelectedPipeline(featureInfo.coordinates);

      // 选择完成后，停止继续选择
      this.isSelecting = false;

      // 触发选择事件
      this.onPipelineSelected?.(this.selectedPipeline);
    }
  }

  // ==================== 缓冲区分析功能 ====================

  /**
   * 高亮选中的管段
   */
  async highlightSelectedPipeline(coordinates) {
    if (!this.map || !coordinates || coordinates.length === 0) return;

    try {
      // 清除之前的高亮图层
      this.clearHighlight();

      // 处理坐标格式
      const processedCoordinates = this.processCoordinates(coordinates);
      if (!processedCoordinates || processedCoordinates.length < 2) {
        console.error('坐标数据无效:', coordinates);
        return;
      }

      // 动态导入OpenLayers组件
      const { default: VectorSource } = await import('ol/source/Vector');
      const { default: VectorLayer } = await import('ol/layer/Vector');
      const { default: Feature } = await import('ol/Feature');
      const { default: LineString } = await import('ol/geom/LineString');

      // 创建矢量数据源
      const vectorSource = new VectorSource();

      // 创建线要素
      const lineFeature = new Feature({
        geometry: new LineString(processedCoordinates),
      });

      // 使用统一的高亮样式配置
      const { getBufferAnalysisStyle } = await import(
        './HighlightStyleUtils.js'
      );
      const style = await getBufferAnalysisStyle(
        'selected_pipeline',
        'LineString'
      );
      lineFeature.setStyle(style);

      vectorSource.addFeature(lineFeature);

      // 创建矢量图层
      this.highlightLayer = new VectorLayer({
        source: vectorSource,
        zIndex: 1000,
      });

      // 设置图层标识
      this.highlightLayer.set('name', 'buffer-highlight-layer');
      this.highlightLayer.set('category', 'buffer-analysis');
      this.highlightLayer.set('bufferAnalysis', true);

      // 添加到地图
      this.map.addLayer(this.highlightLayer);
    } catch (error) {
      console.error('高亮管段失败:', error);
    }
  }

  /**
   * 生成缓冲区
   */
  async generateBuffer(radius, options = {}) {
    if (!this.selectedPipeline || !this.selectedPipeline.geometry) {
      throw new Error('请先选择管段');
    }

    try {
      // 处理坐标格式
      const processedCoordinates = this.processCoordinates(
        this.selectedPipeline.geometry.coordinates
      );
      if (!processedCoordinates || processedCoordinates.length < 2) {
        throw new Error('坐标数据无效，无法生成缓冲区');
      }

      // 创建线要素
      const line = turf.lineString(processedCoordinates);

      // 生成缓冲区
      this.bufferGeometry = turf.buffer(line, radius, {
        units: 'meters',
        steps: options.steps || 64,
      });

      // 显示缓冲区
      await this.displayBuffer();

      return this.bufferGeometry;
    } catch (error) {
      console.error('生成缓冲区失败:', error);
      throw error;
    }
  }

  /**
   * 在地图上显示缓冲区
   */
  async displayBuffer() {
    if (!this.map || !this.bufferGeometry) return;

    try {
      // 清除之前的缓冲区图层
      this.clearBuffer();

      // 动态导入OpenLayers组件
      const { default: GeoJSON } = await import('ol/format/GeoJSON');
      const { default: VectorSource } = await import('ol/source/Vector');
      const { default: VectorLayer } = await import('ol/layer/Vector');
      const { default: Style } = await import('ol/style/Style');
      const { default: Stroke } = await import('ol/style/Stroke');
      const { default: Fill } = await import('ol/style/Fill');

      // 创建GeoJSON格式转换器
      const format = new GeoJSON();

      // 转换Turf.js几何体为OpenLayers Feature
      const feature = format.readFeature(this.bufferGeometry, {
        featureProjection: 'EPSG:4326',
        dataProjection: 'EPSG:4326',
      });

      // 使用统一的高亮样式配置
      const { getBufferAnalysisStyle } = await import(
        './HighlightStyleUtils.js'
      );
      const style = await getBufferAnalysisStyle('buffer', 'Polygon');

      // 创建矢量数据源和图层
      const source = new VectorSource({
        features: [feature],
      });

      this.bufferLayer = new VectorLayer({
        source: source,
        style: style,
        zIndex: 1000,
      });

      // 设置图层标识
      this.bufferLayer.set('name', 'buffer-analysis-layer');
      this.bufferLayer.set('category', 'buffer-analysis');
      this.bufferLayer.set('bufferAnalysis', true);

      this.map.addLayer(this.bufferLayer);
    } catch (error) {
      console.error('显示缓冲区失败:', error);
      throw error;
    }
  }

  /**
   * 执行空间查询
   */
  async performSpatialQuery(targetLayers, getFeatureType) {
    if (!this.bufferGeometry) {
      throw new Error('请先生成缓冲区');
    }

    try {
      // 获取缓冲区的WKT字符串
      const bufferWKT = this.getBufferWKT();
      if (!bufferWKT) {
        throw new Error('无法生成缓冲区WKT');
      }

      const allResults = [];

      // 对每个目标图层执行WFS查询
      for (const layerKey of targetLayers) {
        try {
          const results = await this.performWFSIntersectQuery(
            layerKey,
            bufferWKT
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

  // ==================== 工具函数 ====================

  /**
   * 处理坐标数据格式
   */
  processCoordinates(coordinates) {
    if (!coordinates || !Array.isArray(coordinates)) {
      return null;
    }

    // 如果第一层是数组且第二层也是数组，说明是嵌套格式
    if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0])) {
      return coordinates[0];
    }

    return coordinates;
  }

  /**
   * 获取缓冲区的WKT字符串
   */
  getBufferWKT() {
    if (!this.bufferGeometry) return null;

    try {
      const coordinates = this.bufferGeometry.geometry.coordinates[0];

      // 简化坐标点，减少WKT字符串长度
      const step = Math.max(1, Math.floor(coordinates.length / 50));
      const simplifiedCoords = coordinates.filter(
        (_, index) => index % step === 0
      );

      // 确保首尾点相同（闭合多边形）
      if (
        simplifiedCoords.length > 0 &&
        (simplifiedCoords[0][0] !==
          simplifiedCoords[simplifiedCoords.length - 1][0] ||
          simplifiedCoords[0][1] !==
            simplifiedCoords[simplifiedCoords.length - 1][1])
      ) {
        simplifiedCoords.push(simplifiedCoords[0]);
      }

      const wktCoords = simplifiedCoords
        .map((coord) => `${coord[0]} ${coord[1]}`)
        .join(',');

      return `POLYGON((${wktCoords}))`;
    } catch (error) {
      console.error('生成WKT失败:', error);
      return null;
    }
  }

  /**
   * 执行WFS相交查询
   */
  async performWFSIntersectQuery(
    layerKey,
    bufferWKT,
    baseUrl = '/geoserver/GX/ows'
  ) {
    const layerTypes = ['_pt', '_ln'];
    const allLayerResults = [];
    // 支持完整图层名（'dl_ln'）和短码（'dl'）两种格式
    const shortCode = layerKey.replace(/_(ln|pt)$/, '');

    for (const layerType of layerTypes) {
      const typeName = `GX:${shortCode}${layerType}`;
      const params = new URLSearchParams({
        service: 'WFS',
        version: '1.0.0',
        request: 'GetFeature',
        typeName: typeName,
        outputFormat: 'application/json',
        srsName: 'EPSG:4326',
        cql_filter: `INTERSECTS(geom, ${bufferWKT})`,
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
          continue;
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
            continue;
          }
          try {
            data = JSON.parse(responseText);
          } catch (e) {
            console.warn(`无法解析响应 (${typeName}): ${responseText}`);
            continue;
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
        continue;
      }
    }

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

  // ==================== 清理功能 ====================

  /**
   * 清除缓冲区图层
   */
  clearBuffer() {
    if (this.bufferLayer && this.map) {
      this.map.removeLayer(this.bufferLayer);
      this.bufferLayer = null;
    }
  }

  /**
   * 清除高亮图层
   */
  clearHighlight() {
    if (this.highlightLayer && this.map) {
      this.map.removeLayer(this.highlightLayer);
      this.highlightLayer = null;
    }
  }

  /**
   * 清除结果高亮图层
   */
  clearResults() {
    if (this.resultsLayer && this.map) {
      this.map.removeLayer(this.resultsLayer);
      this.resultsLayer = null;
    }
  }

  /**
   * 清除所有图层和状态
   */
  clearAll() {
    this.clearBuffer();
    this.clearHighlight();
    this.clearResults();

    this.selectedPipeline = null;
    this.bufferGeometry = null;
    this.queryResults = [];
    this.isSelecting = false; // 重置选择状态
  }

  // ==================== 状态获取 ====================

  /**
   * 获取当前选中的管段
   */
  getSelectedPipeline() {
    return this.selectedPipeline;
  }

  /**
   * 获取当前缓冲区几何体
   */
  getBufferGeometry() {
    return this.bufferGeometry;
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

  /**
   * 重新启用管段选择模式
   */
  enableSelection() {
    if (this.isActive) {
      this.isSelecting = true;
    }
  }

  /**
   * 检查是否可以选择管段
   */
  canSelect() {
    return this.isActive && this.isSelecting;
  }
}

// 导出工厂函数，方便创建管理器
export function createBufferAnalysisManager(map) {
  return new BufferAnalysisManager(map);
}
