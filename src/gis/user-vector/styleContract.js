import { gisError } from '../contracts.js';

const DEFAULT_STYLE = Object.freeze({
  stroke: Object.freeze({ color: '#409eff', width: 3, opacity: 1 }),
  fill: Object.freeze({ color: '#409eff', opacity: 0.25 }),
  radius: 6,
});

const ownKeys = (value) => Object.keys(value || {});
const assertObject = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw gisError('INVALID_VECTOR_STYLE', `${name} 必须是对象`);
};
const assertKnown = (value, allowed, name) => {
  const unknown = ownKeys(value).find((key) => !allowed.includes(key));
  if (unknown) throw gisError('INVALID_VECTOR_STYLE', `${name} 不支持字段 ${unknown}`);
};
const numberInRange = (value, min, max, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw gisError('INVALID_VECTOR_STYLE', `${name} 超出允许范围`);
  return value;
};
const color = (value, name) => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw gisError('INVALID_VECTOR_STYLE', `${name} 必须为 #RRGGBB`);
  return value.toLowerCase();
};

export function normalizeVectorStyle(input = DEFAULT_STYLE) {
  assertObject(input, 'style');
  assertKnown(input, ['stroke', 'fill', 'radius'], 'style');
  const stroke = input.stroke ?? DEFAULT_STYLE.stroke;
  const fill = input.fill ?? DEFAULT_STYLE.fill;
  assertObject(stroke, 'stroke');
  assertObject(fill, 'fill');
  assertKnown(stroke, ['color', 'width', 'opacity'], 'stroke');
  assertKnown(fill, ['color', 'opacity'], 'fill');
  return {
    stroke: {
      color: color(stroke.color ?? DEFAULT_STYLE.stroke.color, 'stroke.color'),
      width: numberInRange(stroke.width ?? DEFAULT_STYLE.stroke.width, 0, 64, 'stroke.width'),
      opacity: numberInRange(stroke.opacity ?? DEFAULT_STYLE.stroke.opacity, 0, 1, 'stroke.opacity'),
    },
    fill: {
      color: color(fill.color ?? DEFAULT_STYLE.fill.color, 'fill.color'),
      opacity: numberInRange(fill.opacity ?? DEFAULT_STYLE.fill.opacity, 0, 1, 'fill.opacity'),
    },
    radius: numberInRange(input.radius ?? DEFAULT_STYLE.radius, 1, 128, 'radius'),
  };
}

export function mergeVectorStyle(current, patch) {
  assertObject(patch, 'style');
  if (!ownKeys(patch).length)
    throw gisError('INVALID_VECTOR_STYLE', 'style 至少包含一个修改项');
  assertKnown(patch, ['stroke', 'fill', 'radius'], 'style');
  if (patch.stroke !== undefined) {
    assertObject(patch.stroke, 'stroke');
    if (!ownKeys(patch.stroke).length)
      throw gisError('INVALID_VECTOR_STYLE', 'stroke 至少包含一个修改项');
    assertKnown(patch.stroke, ['color', 'width', 'opacity'], 'stroke');
  }
  if (patch.fill !== undefined) {
    assertObject(patch.fill, 'fill');
    if (!ownKeys(patch.fill).length)
      throw gisError('INVALID_VECTOR_STYLE', 'fill 至少包含一个修改项');
    assertKnown(patch.fill, ['color', 'opacity'], 'fill');
  }
  return normalizeVectorStyle({
    ...current,
    ...patch,
    stroke: { ...current.stroke, ...(patch.stroke || {}) },
    fill: { ...current.fill, ...(patch.fill || {}) },
  });
}

export function defaultVectorStyle() {
  return normalizeVectorStyle(DEFAULT_STYLE);
}
