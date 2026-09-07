/**
 * GeoServer查询工具函数
 * 用于查询GeoServer获取几何数据
 */

/**
 * 通过pipeid字段查询GeoServer获取管段几何数据
 * @param {string} pipeId - 管段ID
 * @returns {Promise<Object>} 查询结果
 */
export const queryPipeGeometryFromGeoServer = async (pipeId) => {
  try {
    const baseUrl = '/geoserver/GX/ows';
    const layerName = 'js_ln';
    const typeName = `GX:${layerName}`;

    // 仅通过pipeid字段查询
    const params = new URLSearchParams({
      service: 'WFS',
      version: '1.0.0',
      request: 'GetFeature',
      typeName: typeName,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      cql_filter: `pipeid = '${pipeId}'`,
    });

    const requestUrl = `${baseUrl}?${params}`;
    const response = await fetch(requestUrl);

    if (response.ok) {
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const feature = data.features[0];

        return {
          success: true,
          field: 'pipeid',
          feature: feature,
          geometry: feature.geometry,
        };
      }
    }

    return { success: false, error: '未找到匹配的管段' };
  } catch (error) {
    console.error(`查询管段 ${pipeId} 几何数据失败:`, error);
    return { success: false, error: error.message };
  }
};
