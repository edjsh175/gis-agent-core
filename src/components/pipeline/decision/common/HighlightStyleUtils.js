/**
 * 统一高亮样式工具函数
 * 从 public/config.js 中读取高亮样式配置，确保整个系统样式一致性
 */

/**
 * 解析样式配置，支持字符串引用和直接配置
 * @param {any} styleConfig - 样式配置
 * @param {Object} config - 完整配置对象
 * @returns {Object} 解析后的样式配置
 */
const resolveStyleConfig = (styleConfig, config) => {
  if (typeof styleConfig === 'string') {
    // 字符串引用，从基础样式中获取
    return config.geometry_styles?.[styleConfig] || styleConfig;
  } else if (typeof styleConfig === 'object' && styleConfig !== null) {
    // 对象配置，递归解析
    const resolved = {};
    for (const [key, value] of Object.entries(styleConfig)) {
      resolved[key] = resolveStyleConfig(value, config);
    }
    return resolved;
  }
  return styleConfig;
};

/**
 * 获取标准管段高亮样式（双层样式：白色边框+蓝色内层）
 * @returns {Array} OpenLayers样式数组
 */
export const getStandardPipelineStyle = async () => {
  const config = window.highlight_style_config || {};
  const styleRef = config.standard_pipeline;
  const style = resolveStyleConfig(styleRef, config);

  if (!style) {
    console.warn('标准管段高亮样式配置未找到，使用默认配置');
    // 提供默认配置
    const defaultStyle = {
      outer: { color: '#FFFFFF', width: 10 },
      inner: { color: '#48A2FF', width: 6 },
    };
    return await createStandardPipelineStyle(defaultStyle);
  }

  return await createStandardPipelineStyle(style);
};

// 创建标准管段样式的辅助函数
const createStandardPipelineStyle = async (style) => {
  // 动态导入OpenLayers样式类
  const { default: Style } = await import('ol/style/Style');
  const { default: Stroke } = await import('ol/style/Stroke');

  return [
    // 外层白色边框
    new Style({
      stroke: new Stroke({
        color: style.outer.color,
        width: style.outer.width,
      }),
    }),
    // 内层蓝色线条
    new Style({
      stroke: new Stroke({
        color: style.inner.color,
        width: style.inner.width,
      }),
    }),
  ];
};

/**
 * 获取查询结果高亮样式
 * @param {string} geometryType - 几何体类型 ('Point' | 'LineString' | 'MultiLineString')
 * @returns {Object} OpenLayers样式对象
 */
export const getQueryResultStyle = async (geometryType, config = window.highlight_style_config || {}) => {
  const styleRef = config.query_result;
  const style = resolveStyleConfig(styleRef, config);

  if (!style) {
    console.warn('查询结果高亮样式配置未找到，使用默认配置');
    // 提供默认配置
    const defaultStyle = {
      line: { color: '#0066FF', width: 4 },
      point: { fill: '#0066FF', stroke: '#FFFFFF', radius: 8, strokeWidth: 3 },
    };
    return await createQueryResultStyle(geometryType, defaultStyle);
  }

  return await createQueryResultStyle(geometryType, style);
};

// 创建查询结果样式的辅助函数
const createQueryResultStyle = async (geometryType, style) => {
  // 动态导入OpenLayers样式类
  const { default: Style } = await import('ol/style/Style');
  const { default: Stroke } = await import('ol/style/Stroke');
  const { default: Circle } = await import('ol/style/Circle');
  const { default: Fill } = await import('ol/style/Fill');

  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    // 使用条件样式函数，只在缩放级别 >= 21 时显示
    return (feature, resolution) => {
      return new Style({
        image: new Circle({
          radius: style.point.radius,
          fill: new Fill({
            color: style.point.fill,
          }),
          stroke: new Stroke({
            color: style.point.stroke,
            width: style.point.strokeWidth,
          }),
        }),
      });
    };
  } else {
    // LineString 或 MultiLineString - 线条不受缩放级别限制
    return [
      // 外层白色边框
      new Style({
        stroke: new Stroke({
          color: '#FFFFFF',
          width: style.line.width + 4, // 比内层线条宽4像素
        }),
      }),
      // 内层彩色线条
      new Style({
        stroke: new Stroke({
          color: style.line.color,
          width: style.line.width,
        }),
      }),
    ];
  }
};

/**
 * 获取临时高亮样式（用于定位闪烁等）
 * @param {string} geometryType - 几何体类型 ('Point' | 'LineString' | 'MultiLineString')
 * @returns {Object} OpenLayers样式对象
 */
export const getTemporaryHighlightStyle = async (geometryType) => {
  const config = window.highlight_style_config || {};
  const style = config.temporary_highlight;

  if (!style) {
    console.warn('临时高亮样式配置未找到，使用默认配置');
    return null;
  }

  // 动态导入OpenLayers样式类
  const { default: Style } = await import('ol/style/Style');
  const { default: Stroke } = await import('ol/style/Stroke');
  const { default: Circle } = await import('ol/style/Circle');
  const { default: Fill } = await import('ol/style/Fill');

  if (geometryType === 'Point') {
    // 使用条件样式函数，只在缩放级别 >= 21 时显示
    return (feature, resolution) => {
      const zoom = Math.log2(156543.03392 / resolution);
      if (zoom < 21) {
        return null; // 不显示
      }

      return new Style({
        image: new Circle({
          radius: style.point.radius,
          fill: new Fill({
            color: style.point.fill,
          }),
          stroke: new Stroke({
            color: style.point.stroke,
            width: style.point.strokeWidth,
          }),
        }),
        zIndex: 2000, // 临时高亮层级，高于查询高亮
      });
    };
  } else {
    // LineString 或 MultiLineString - 线条不受缩放级别限制
    return new Style({
      stroke: new Stroke({
        color: style.line.color,
        width: style.line.width,
      }),
      zIndex: 2000, // 临时高亮层级，高于查询高亮
    });
  }
};

/**
 * 获取地图交互高亮样式
 * @param {string} geometryType - 几何体类型 ('Point' | 'LineString' | 'MultiLineString')
 * @returns {Object} OpenLayers样式对象
 */
export const getMapInteractionStyle = async (geometryType) => {
  const config = window.highlight_style_config || {};
  const style = config.map_interaction;

  if (!style) {
    console.warn('地图交互高亮样式配置未找到，使用默认配置');
    return null;
  }

  // 动态导入OpenLayers样式类
  const { default: Style } = await import('ol/style/Style');
  const { default: Stroke } = await import('ol/style/Stroke');
  const { default: Circle } = await import('ol/style/Circle');
  const { default: Fill } = await import('ol/style/Fill');

  if (geometryType === 'Point') {
    // 使用条件样式函数，只在缩放级别 >= 21 时显示
    return (feature, resolution) => {
      const zoom = Math.log2(156543.03392 / resolution);
      if (zoom < 21) {
        return null; // 不显示
      }

      return new Style({
        image: new Circle({
          radius: style.point.radius,
          fill: new Fill({
            color: style.point.fill,
          }),
          stroke: new Stroke({
            color: style.point.stroke,
            width: style.point.strokeWidth,
          }),
        }),
      });
    };
  } else {
    // LineString 或 MultiLineString - 线条不受缩放级别限制
    return new Style({
      stroke: new Stroke({
        color: style.line.color,
        width: style.line.width,
        lineCap: 'round',
        lineJoin: 'round',
      }),
    });
  }
};

/**
 * 获取闪烁效果配置
 * @returns {Object} 闪烁配置对象
 */
export const getBlinkingConfig = (config = window.highlight_style_config || {}) => {
  const blinkingConfig = config.blinking;

  if (!blinkingConfig) {
    console.warn('闪烁效果配置未找到，使用默认配置');
    return {
      interval: 500,
      duration: 5000,
    };
  }

  return blinkingConfig;
};

/**
 * 创建闪烁样式（用于闪烁效果）
 * @param {string} geometryType - 几何体类型
 * @param {boolean} visible - 是否可见
 * @returns {Object} OpenLayers样式对象
 */
export const createBlinkingStyle = async (geometryType, visible = true, config = window.highlight_style_config || {}, options = {}) => {
  const style = config.blinking_highlight;

  console.log('🎨 创建闪烁样式 - 配置:', style);
  console.log('🎨 几何类型:', geometryType, '可见性:', visible);

  if (!style) {
    console.warn('闪烁高亮样式配置未找到，使用默认配置');
    // 提供默认配置
    const defaultStyle = {
      line: { color: '#FF0000', width: 10 },
      point: {
        fill: 'rgba(255, 0, 0, 0.7)',
        stroke: '#FF0000',
        radius: 15,
        strokeWidth: 4,
      },
    };
    return await createBlinkingStyleInternal(
      geometryType,
      visible,
      defaultStyle,
      options
    );
  }

  return await createBlinkingStyleInternal(geometryType, visible, style, options);
};

// 创建闪烁样式的内部辅助函数
const createBlinkingStyleInternal = async (geometryType, visible, style, options = {}) => {
  // 动态导入OpenLayers样式类
  const { default: Style } = await import('ol/style/Style');
  const { default: Stroke } = await import('ol/style/Stroke');
  const { default: Circle } = await import('ol/style/Circle');
  const { default: Fill } = await import('ol/style/Fill');

  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    // 使用条件样式函数，只在缩放级别 >= 21 时显示
    return (feature, resolution) => {
      const zoom = Math.log2(156543.03392 / resolution);
      if (!options.alwaysVisible && zoom < 21) {
        return null; // 不显示
      }

      return new Style({
        image: new Circle({
          radius: style.point.radius,
          fill: new Fill({
            color: visible ? style.point.fill : 'rgba(255, 0, 0, 0)',
          }),
          stroke: new Stroke({
            color: visible ? style.point.stroke : 'rgba(255, 0, 0, 0)',
            width: style.point.strokeWidth,
          }),
        }),
        zIndex: 4000, // 闪烁高亮层级，最高
      });
    };
  } else {
    // LineString 或 MultiLineString - 线条不受缩放级别限制
    return [
      // 外层白色边框
      new Style({
        stroke: new Stroke({
          color: visible ? '#FFFFFF' : 'rgba(255, 255, 255, 0)',
          width: style.line.width + 4, // 比内层线条宽4像素
        }),
        zIndex: 4000, // 闪烁高亮层级，最高
      }),
      // 内层彩色线条
      new Style({
        stroke: new Stroke({
          color: visible ? style.line.color : 'rgba(255, 0, 0, 0)',
          width: style.line.width,
        }),
        zIndex: 4000, // 闪烁高亮层级，最高
      }),
    ];
  }
};

/**
 * 获取辅助决策模块样式
 * @param {string} analysisType - 分析类型 ('buffer_analysis', 'burst_analysis', 'connectivity_analysis', 'drawing', 'spatial_query')
 * @param {string} geometryType - 几何体类型 ('Point' | 'LineString' | 'MultiLineString')
 * @param {string} subType - 子类型 (如 'start', 'end', 'selected_pipeline', 'buffer')
 * @returns {Object} OpenLayers样式对象
 */
export const getDecisionAnalysisStyle = async (
  analysisType,
  geometryType,
  subType = null
) => {
  const config = window.highlight_style_config || {};
  let styleRef = config.decision?.[analysisType] || {};

  // 处理子类型（如连通分析的开始/结束，缓冲区分析的选中管段/缓冲区）
  if (subType && styleRef[subType]) {
    styleRef = styleRef[subType];
  }

  // 解析样式配置
  const styleConfig = resolveStyleConfig(styleRef, config);

  // 动态导入OpenLayers样式类
  const { default: Style } = await import('ol/style/Style');
  const { default: Stroke } = await import('ol/style/Stroke');
  const { default: Circle } = await import('ol/style/Circle');
  const { default: Fill } = await import('ol/style/Fill');

  if (geometryType === 'Point') {
    return new Style({
      image: new Circle({
        radius: styleConfig.point?.radius || 12,
        fill: new Fill({
          color: styleConfig.point?.fill || '#FF0000',
        }),
        stroke: new Stroke({
          color: styleConfig.point?.stroke || '#FF0000',
          width: styleConfig.point?.strokeWidth || 3,
        }),
      }),
    });
  } else {
    // LineString 或 MultiLineString
    // 检查是否有双层样式配置（outer + inner）
    if (styleConfig.outer && styleConfig.inner) {
      // 双层样式：外层白色边框 + 内层彩色线条
      return [
        // 外层白色边框
        new Style({
          stroke: new Stroke({
            color: styleConfig.outer.color,
            width: styleConfig.outer.width,
          }),
        }),
        // 内层彩色线条
        new Style({
          stroke: new Stroke({
            color: styleConfig.inner.color,
            width: styleConfig.inner.width,
          }),
        }),
      ];
    } else {
      // 单层样式
      return new Style({
        stroke: new Stroke({
          color:
            styleConfig.line?.color || styleConfig.stroke?.color || '#FF0000',
          width: styleConfig.line?.width || styleConfig.stroke?.width || 8,
        }),
        fill: styleConfig.fill
          ? new Fill({
              color: styleConfig.fill.color,
            })
          : undefined,
      });
    }
  }
};

/**
 * 获取缓冲区分析样式
 * @param {string} styleType - 样式类型 ('selected_pipeline', 'buffer')
 * @param {string} geometryType - 几何体类型 ('Point' | 'LineString' | 'MultiLineString')
 * @returns {Object} OpenLayers样式对象
 */
export const getBufferAnalysisStyle = async (styleType, geometryType) => {
  return await getDecisionAnalysisStyle(
    'buffer_analysis',
    geometryType,
    styleType
  );
};
