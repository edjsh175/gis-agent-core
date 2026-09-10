function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function validateAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action))
    return failure('INVALID_CARD_MAP_ACTION', '地图动作无效');
  if (action.kind !== 'query_and_highlight')
    return failure('UNSUPPORTED_CARD_MAP_ACTION', '当前地图动作类型不受支持');
  if (typeof action.layerId !== 'string' || !action.layerId)
    return failure('INVALID_CARD_MAP_ACTION', '地图动作缺少有效图层');
  if (
    !Array.isArray(action.filters) ||
    action.filters.length < 1 ||
    action.filters.length > 20 ||
    action.filters.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        item.op !== 'eq' ||
        typeof item.field !== 'string' ||
        !item.field ||
        !['string', 'number', 'boolean'].includes(typeof item.value) ||
        (typeof item.value === 'number' && !Number.isFinite(item.value))
    )
  )
    return failure(
      'INVALID_CARD_MAP_ACTION',
      '当前版本只支持 1-20 个受控等值筛选条件'
    );
  return { ok: true };
}

/**
 * Persistent CardSpec stores only semantic GIS intent. Every click resolves
 * fresh data and opens a fresh ClientScope so stale feature references and
 * stale map generations are never replayed.
 */
export function createBusinessCardMapActionExecutor({ gis, limit = 100 } = {}) {
  if (!gis?.data || typeof gis.data.queryFeatures !== 'function')
    throw new TypeError('gis.data.queryFeatures is required');
  if (typeof gis.createClientScope !== 'function')
    throw new TypeError('gis.createClientScope is required');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError('limit must be an integer from 1 to 100');

  let activeScope;

  async function execute(action) {
    const validated = validateAction(action);
    if (!validated.ok) return validated;

    const queried = await gis.data.queryFeatures({
      layerId: action.layerId,
      filters: action.filters.map(({ field, op, value }) => ({
        field,
        op,
        value,
      })),
      limit,
    });
    if (!queried?.ok)
      return queried || failure('CARD_MAP_QUERY_FAILED', '地图查询失败');

    const features = queried.data?.features;
    if (!Array.isArray(features) || features.length === 0)
      return failure('NO_FEATURES_FOUND', '没有找到符合条件的地图要素');

    const nextScope = gis.createClientScope();
    try {
      const highlighted = await nextScope.highlightFeatures({
        features,
        group: 'results',
        mode: 'replace',
        effect: 'persistent',
      });
      if (!highlighted?.ok) {
        nextScope.dispose?.();
        return (
          highlighted || failure('CARD_MAP_HIGHLIGHT_FAILED', '地图高亮失败')
        );
      }

      const located = await nextScope.locateFeatures({ features });
      if (!located?.ok) {
        nextScope.dispose?.();
        return located || failure('CARD_MAP_LOCATE_FAILED', '地图定位失败');
      }

      activeScope?.dispose?.();
      activeScope = nextScope;
      return {
        ok: true,
        data: {
          featureCount: features.length,
          truncated: queried.data?.truncated ?? null,
        },
        effect: { status: 'applied', kind: 'query_and_highlight' },
      };
    } catch (error) {
      nextScope.dispose?.();
      return failure(
        error?.code || 'CARD_MAP_ACTION_FAILED',
        error?.message || '地图动作失败'
      );
    }
  }

  function dispose() {
    activeScope?.dispose?.();
    activeScope = undefined;
  }

  return { execute, dispose };
}
