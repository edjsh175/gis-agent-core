/**
 * 闪烁效果工具函数
 * 用于在地图上创建闪烁高亮效果
 */

import {
  createBlinkingStyle,
  getBlinkingConfig,
} from './HighlightStyleUtils.js';

/**
 * 开始闪烁效果
 * @param {Object} feature - OpenLayers要素对象
 * @param {number} duration - 闪烁持续时间（毫秒）
 * @returns {Object} 包含停止方法的对象
 */
export const startBlinkingEffect = async (feature, duration = null, styleConfig, options = {}) => {
  // 获取统一的闪烁配置
  const config = getBlinkingConfig(styleConfig);
  const actualDuration = duration || config.duration;
  const blinkInterval = config.interval;

  let isVisible = true;
  const startTime = Date.now();
  let blinkTimer = null;

  // 判断要素类型
  const geometry = feature.getGeometry();
  const geometryType = geometry.getType();

  // 使用统一的样式创建函数
  const visibleStyle = await createBlinkingStyle(geometryType, true, styleConfig, options);
  const hiddenStyle = await createBlinkingStyle(geometryType, false, styleConfig, options);
  options.assertActive?.();

  blinkTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;

    if (elapsed >= actualDuration) {
      // 时间到，停止闪烁，保持显示状态
      clearInterval(blinkTimer);
      feature.setStyle(visibleStyle); // 保持显示状态
      return;
    }

    // 切换可见性
    isVisible = !isVisible;
    feature.setStyle(isVisible ? visibleStyle : hiddenStyle);
  }, blinkInterval);

  // 返回停止方法
  return {
    stop: () => {
      if (blinkTimer) {
        clearInterval(blinkTimer);
        blinkTimer = null;
        // 停止时保持显示状态
        feature.setStyle(visibleStyle);
      }
    },
    // 添加销毁方法，完全清理资源
    destroy: () => {
      if (blinkTimer) {
        clearInterval(blinkTimer);
        blinkTimer = null;
      }
      // 清除要素的闪烁控制器引用
      feature.unset('blinkController');
    },
  };
};
