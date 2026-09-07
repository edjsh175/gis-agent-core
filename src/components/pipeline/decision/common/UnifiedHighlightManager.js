/**
 * 统一高亮图层管理器
 * 确保所有查询结果高亮都在一个图层上绘制
 */

class UnifiedHighlightManager {
  constructor() {
    this.map = null;
    this.highlightLayer = null;
    this.highlightSource = null;
    this.isInitialized = false;
    this.generation = 0;
    this.pending = null;
  }

  /**
   * 初始化统一高亮图层
   * @param {Object} map - 地图实例
   */
  async initialize(map) {
    if (this.isInitialized && this.map === map) {
      return;
    }

    if (this.map === map && this.pending) return this.pending;
    this.destroy();
    this.map = map;
    const generation = this.generation;
    this.pending = this.initializeGeneration(map, generation);
    return this.pending;
  }

  async initializeGeneration(map, generation) {

    try {
      // 动态导入OpenLayers组件
      const { default: VectorSource } = await import('ol/source/Vector');
      const { default: VectorLayer } = await import('ol/layer/Vector');
      if (generation !== this.generation || this.map !== map) {
        throw Object.assign(new Error('Highlight map replaced'), { code: 'STALE_CONTEXT' });
      }

      // 创建矢量数据源
      this.highlightSource = new VectorSource();

      // 创建统一的高亮图层
      this.highlightLayer = new VectorLayer({
        source: this.highlightSource,
        name: 'unified-query-highlight',
        zIndex: 3000, // 最高层级，确保显示在最上层
      });

      // 设置图层标识
      this.highlightLayer.set('category', 'unified-query-highlight');
      this.highlightLayer.set('unifiedHighlight', true);

      // 添加到地图
      map.addLayer(this.highlightLayer);

      this.isInitialized = true;
    } catch (error) {
      throw error;
    } finally {
      if (generation === this.generation) this.pending = null;
    }
  }

  /**
   * 添加高亮要素
   * @param {Object} feature - OpenLayers要素对象
   * @param {string} highlightType - 高亮类型 ('spatial-query', 'attribute-query', 'material-query', 'diameter-query')
   */
  addHighlightFeature(feature, highlightType = 'spatial-query') {
    if (!this.isInitialized || !this.highlightSource) {
      console.warn('统一高亮图层未初始化');
      return;
    }

    // 设置要素属性
    feature.set('highlightType', highlightType);
    feature.set('highlightTime', Date.now());

    // 添加到统一高亮图层
    this.highlightSource.addFeature(feature);
  }

  /**
   * 清除指定类型的高亮要素
   * @param {string} highlightType - 高亮类型，如果为空则清除所有
   */
  clearHighlightFeatures(highlightType = null) {
    if (!this.isInitialized || !this.highlightSource) {
      return;
    }

    if (highlightType) {
      // 清除指定类型的高亮要素
      const features = this.highlightSource.getFeatures();
      const featuresToRemove = features.filter(
        (feature) => !feature.get('gisOwner') && feature.get('highlightType') === highlightType
      );

      featuresToRemove.forEach((feature) => {
        this.highlightSource.removeFeature(feature);
      });
    } else {
      // 清除所有高亮要素
      this.highlightSource.getFeatures().filter(feature => !feature.get('gisOwner')).forEach(feature => this.highlightSource.removeFeature(feature));
    }
  }

  /**
   * 清除所有高亮要素
   */
  clearAllHighlights() {
    this.clearHighlightFeatures();
  }

  /**
   * 获取高亮图层
   */
  getHighlightLayer() {
    return this.highlightLayer;
  }

  /**
   * 获取高亮数据源
   */
  getHighlightSource() {
    return this.highlightSource;
  }

  /**
   * 销毁高亮图层
   */
  destroy() {
    this.generation++;
    this.pending = null;
    if (this.highlightLayer && this.map) {
      this.map.removeLayer(this.highlightLayer);
    }

    this.highlightLayer = null;
    this.highlightSource = null;
    this.map = null;
    this.isInitialized = false;
  }

  /**
   * 检查是否已初始化
   */
  isReady() {
    return this.isInitialized && this.highlightLayer && this.highlightSource;
  }
}

// 创建全局单例实例
const unifiedHighlightManager = new UnifiedHighlightManager();

// 导出单例实例
export default unifiedHighlightManager;

// 导出类（用于测试）
export { UnifiedHighlightManager };
