import { ElMessage } from 'element-plus';
import { Vector as VectorSource } from 'ol/source';
import { Vector as VectorLayer } from 'ol/layer';
import { Feature } from 'ol';
import { Point, LineString, Polygon, Circle } from 'ol/geom';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import { Draw } from 'ol/interaction';
import { Modify } from 'ol/interaction';
import { Select } from 'ol/interaction';
import { SelectEvent } from 'ol/interaction/Select';
import { unByKey } from 'ol/Observable';

/**
 * 绘图管理器
 * 统一管理各种几何图形的绘制功能
 */
export class DrawManager {
  constructor(map) {
    this.map = map;
    this.drawLayer = null;
    this.drawSource = null;
    this.drawInteraction = null;
    this.modifyInteraction = null;
    this.selectInteraction = null;
    this.isActive = false;
    this.currentDrawType = null;
    this.onDrawComplete = null;
    this.onDrawStart = null;
    this.onDrawEnd = null;

    // 绑定事件处理函数
    this.handleDrawStart = this.handleDrawStart.bind(this);
    this.handleDrawEnd = this.handleDrawEnd.bind(this);
    this.handleModifyEnd = this.handleModifyEnd.bind(this);
  }

  // ==================== 生命周期管理 ====================

  /**
   * 激活绘图模式
   * @param {string} drawType - 绘图类型：'Polygon', 'Circle'
   * @param {Object} options - 绘图选项
   */
  async activate(drawType, options = {}) {
    // 如果已经激活，先停用
    if (this.isActive) {
      this.deactivate();
    }

    this.currentDrawType = drawType;
    this.isActive = true;

    // 创建绘图图层（如果不存在）
    if (!this.drawLayer) {
      await this.createDrawLayer();
    } else {
      // 如果图层已存在，清除其中的内容
      this.clearDrawnGeometries();
    }

    // 创建或重新配置绘图交互
    await this.setupDrawInteraction(drawType, options);

    // 创建或重新配置修改交互
    await this.setupModifyInteraction();

    // 创建或重新配置选择交互
    await this.setupSelectInteraction();

    // 启用所有交互
    this.enableAllInteractions();

    ElMessage.info(`请在地图上绘制${this.getDrawTypeName(drawType)}`);
  }

  /**
   * 停用绘图模式
   */
  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;
    this.currentDrawType = null;

    // 禁用所有交互，但不移除
    this.disableAllInteractions();

    // 触发绘图结束事件
    this.onDrawEnd?.();
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.clearAllLayers();
    for (const key of ['drawInteraction', 'modifyInteraction', 'selectInteraction']) {
      if (this[key] && this.map) this.map.removeInteraction(this[key]);
      this[key] = null;
    }
    this.map = null;
    this.onDrawComplete = null;
    this.onDrawStart = null;
    this.onDrawEnd = null;
  }

  // ==================== 绘图功能 ====================

  /**
   * 设置绘图交互
   */
  async setupDrawInteraction(drawType, options = {}) {
    // 如果交互已存在，先移除
    if (this.drawInteraction && this.map) {
      this.map.removeInteraction(this.drawInteraction);
      this.drawInteraction = null;
    }

    try {
      // 动态导入OpenLayers组件
      const { default: Draw } = await import('ol/interaction/Draw');
      if (!this.map || !this.isActive) return;

      // 创建绘图交互
      this.drawInteraction = new Draw({
        source: this.drawSource,
        type: drawType,
        style: this.getDrawStyle(),
        ...options,
      });

      // 绑定事件
      this.drawInteraction.on('drawstart', this.handleDrawStart);
      this.drawInteraction.on('drawend', this.handleDrawEnd);

      // 添加到地图
      this.map.addInteraction(this.drawInteraction);
    } catch (error) {
      console.error('设置绘图交互失败:', error);
      throw error;
    }
  }

  /**
   * 设置修改交互
   */
  async setupModifyInteraction() {
    // 如果交互已存在，先移除
    if (this.modifyInteraction && this.map) {
      this.map.removeInteraction(this.modifyInteraction);
      this.modifyInteraction = null;
    }

    try {
      // 动态导入OpenLayers组件
      const { default: Modify } = await import('ol/interaction/Modify');
      if (!this.map || !this.isActive) return;

      // 创建修改交互
      this.modifyInteraction = new Modify({
        source: this.drawSource,
        style: this.getModifyStyle(),
      });

      // 绑定修改结束事件
      this.modifyInteraction.on('modifyend', this.handleModifyEnd);

      // 添加到地图
      this.map.addInteraction(this.modifyInteraction);
    } catch (error) {
      console.error('设置修改交互失败:', error);
      throw error;
    }
  }

  /**
   * 设置选择交互
   */
  async setupSelectInteraction() {
    // 如果交互已存在，先移除
    if (this.selectInteraction && this.map) {
      this.map.removeInteraction(this.selectInteraction);
      this.selectInteraction = null;
    }

    try {
      // 动态导入OpenLayers组件
      const { default: Select } = await import('ol/interaction/Select');
      if (!this.map || !this.isActive) return;

      // 创建选择交互
      this.selectInteraction = new Select({
        layers: [this.drawLayer],
        style: this.getSelectStyle(),
      });

      // 添加到地图
      this.map.addInteraction(this.selectInteraction);
    } catch (error) {
      console.error('设置选择交互失败:', error);
      throw error;
    }
  }

  /**
   * 创建绘图图层
   */
  async createDrawLayer() {
    try {
      // 如果图层已存在，先移除
      if (this.drawLayer && this.map) {
        this.map.removeLayer(this.drawLayer);
        this.drawLayer = null;
        this.drawSource = null;
      }

      // 动态导入OpenLayers组件
      const { default: VectorSource } = await import('ol/source/Vector');
      const { default: VectorLayer } = await import('ol/layer/Vector');
      if (!this.map || !this.isActive) return;

      // 创建矢量数据源
      this.drawSource = new VectorSource();

      // 创建矢量图层
      this.drawLayer = new VectorLayer({
        source: this.drawSource,
        name: 'spatial-query-draw',
        zIndex: 1000,
        style: this.getDrawStyle(),
      });

      // 设置图层标识
      this.drawLayer.set('category', 'spatial-query');
      this.drawLayer.set('spatialQuery', true);

      // 添加到地图
      this.map.addLayer(this.drawLayer);
    } catch (error) {
      console.error('创建绘图图层失败:', error);
      throw error;
    }
  }

  // ==================== 事件处理 ====================

  /**
   * 处理绘图开始事件
   */
  handleDrawStart(event) {
    this.onDrawStart?.(event);
  }

  /**
   * 处理绘图结束事件
   */
  handleDrawEnd(event) {
    const feature = event.feature;
    const geometry = feature.getGeometry();

    // 设置要素属性
    feature.set('drawType', this.currentDrawType);
    feature.set('drawTime', new Date().toISOString());

    // 触发绘图完成事件
    this.onDrawComplete?.(feature, geometry);

    // 自动停用绘图模式
    this.deactivate();
  }

  /**
   * 处理修改结束事件
   */
  handleModifyEnd(event) {
    const features = event.features.getArray();
    if (features.length > 0) {
      const feature = features[0];
      const geometry = feature.getGeometry();

      // 触发修改完成事件
      this.onDrawComplete?.(feature, geometry);
    }
  }

  // ==================== 样式管理 ====================

  /**
   * 获取绘图样式
   */
  getDrawStyle() {
    // 同步返回样式，避免在图层初始化时使用async
    return new Style({
      stroke: new Stroke({
        color: '#ff0000',
        width: 3,
      }),
      fill: new Fill({
        color: 'rgba(255, 0, 0, 0.1)',
      }),
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: '#ff0000' }),
        stroke: new Stroke({
          color: '#ffffff',
          width: 2,
        }),
      }),
    });
  }

  /**
   * 获取修改样式
   */
  getModifyStyle() {
    return new Style({
      stroke: new Stroke({
        color: '#00ff00',
        width: 2,
      }),
      fill: new Fill({
        color: 'rgba(0, 255, 0, 0.1)',
      }),
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: '#00ff00' }),
        stroke: new Stroke({
          color: '#ffffff',
          width: 2,
        }),
      }),
    });
  }

  /**
   * 获取选择样式
   */
  getSelectStyle() {
    return new Style({
      stroke: new Stroke({
        color: '#0000ff',
        width: 2,
      }),
      fill: new Fill({
        color: 'rgba(0, 0, 255, 0.1)',
      }),
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: '#0000ff' }),
        stroke: new Stroke({
          color: '#ffffff',
          width: 2,
        }),
      }),
    });
  }

  // ==================== 几何体处理 ====================

  /**
   * 获取绘制的几何体
   */
  getDrawnGeometries() {
    if (!this.drawSource) return [];

    const features = this.drawSource.getFeatures();
    return features.map((feature) => ({
      feature: feature,
      geometry: feature.getGeometry(),
      type: feature.get('drawType'),
      time: feature.get('drawTime'),
    }));
  }

  /**
   * 获取最新的几何体
   */
  getLatestGeometry() {
    const geometries = this.getDrawnGeometries();
    return geometries.length > 0 ? geometries[geometries.length - 1] : null;
  }

  /**
   * 清除所有绘制的几何体
   */
  clearDrawnGeometries() {
    if (this.drawSource) {
      this.drawSource.clear();
    }
  }

  /**
   * 完全清除所有绘制内容
   */
  clearAllDrawings() {
    // 如果正在绘制，停止绘制
    if (this.isActive) {
      this.deactivate();
    }

    // 清除绘制的几何体
    this.clearDrawnGeometries();
  }

  /**
   * 完全清理所有图层和状态
   */
  clearAllLayers() {
    // 停止绘制
    if (this.isActive) {
      this.deactivate();
    }

    // 清除绘制的几何体
    this.clearDrawnGeometries();

    // 完全移除图层
    this.clearDrawLayer();
  }

  // ==================== 工具函数 ====================

  /**
   * 获取绘图类型名称
   */
  getDrawTypeName(drawType) {
    const typeNames = {
      Polygon: '多边形',
      Circle: '圆域',
    };
    return typeNames[drawType] || drawType;
  }

  /**
   * 禁用所有交互
   */
  disableAllInteractions() {
    if (this.drawInteraction) {
      this.drawInteraction.setActive(false);
    }

    if (this.modifyInteraction) {
      this.modifyInteraction.setActive(false);
    }

    if (this.selectInteraction) {
      this.selectInteraction.setActive(false);
    }
  }

  /**
   * 启用所有交互
   */
  enableAllInteractions() {
    if (this.drawInteraction) {
      this.drawInteraction.setActive(true);
    }

    if (this.modifyInteraction) {
      this.modifyInteraction.setActive(true);
    }

    if (this.selectInteraction) {
      this.selectInteraction.setActive(true);
    }
  }

  /**
   * 移除所有交互
   */
  removeAllInteractions() {
    if (this.drawInteraction && this.map) {
      this.map.removeInteraction(this.drawInteraction);
      this.drawInteraction = null;
    }

    if (this.modifyInteraction && this.map) {
      this.map.removeInteraction(this.modifyInteraction);
      this.modifyInteraction = null;
    }

    if (this.selectInteraction && this.map) {
      this.map.removeInteraction(this.selectInteraction);
      this.selectInteraction = null;
    }
  }

  /**
   * 清除绘图图层
   */
  clearDrawLayer() {
    if (this.drawLayer && this.map) {
      this.map.removeLayer(this.drawLayer);
      this.drawLayer = null;
      this.drawSource = null;
    }
  }

  // ==================== 状态管理 ====================

  /**
   * 检查是否已激活
   */
  isActivated() {
    return this.isActive;
  }

  /**
   * 获取当前绘图类型
   */
  getCurrentDrawType() {
    return this.currentDrawType;
  }

  /**
   * 设置绘图完成回调
   */
  setOnDrawComplete(callback) {
    this.onDrawComplete = callback;
  }

  /**
   * 设置绘图开始回调
   */
  setOnDrawStart(callback) {
    this.onDrawStart = callback;
  }

  /**
   * 设置绘图结束回调
   */
  setOnDrawEnd(callback) {
    this.onDrawEnd = callback;
  }
}

// 导出工厂函数
export function createDrawManager(map) {
  return new DrawManager(map);
}
