import { gisError } from '../../contracts.js';

const boundedString = (maxLength = 512) => ({
  type: 'string',
  minLength: 1,
  maxLength,
});
const reference = {
  type: 'object',
  additionalProperties: false,
  required: ['resultId'],
  properties: {
    resultId: boundedString(),
    indices: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'integer', minimum: 0 },
    },
  },
};
const group = { type: 'string', enum: ['results', 'selection'] };
const color = { type: 'string', minLength: 7, maxLength: 7 };
const opacity = { type: 'number', minimum: 0, maximum: 1 };
const style = {
  type: 'object',
  additionalProperties: false,
  required: [],
  minProperties: 1,
  properties: {
    stroke: {
      type: 'object',
      additionalProperties: false,
      required: [],
      minProperties: 1,
      properties: {
        color,
        width: { type: 'number', minimum: 0, maximum: 64 },
        opacity,
      },
    },
    fill: {
      type: 'object',
      additionalProperties: false,
      required: [],
      minProperties: 1,
      properties: { color, opacity },
    },
    radius: { type: 'number', minimum: 1, maximum: 128 },
  },
};

const definitions = [
  [
    'locate_features',
    '定位查询快照中的要素，等待视图动作完成。',
    ['feature_ref'],
    { feature_ref: reference },
  ],
  [
    'highlight_features',
    '高亮查询快照中的要素。',
    ['feature_ref'],
    {
      feature_ref: reference,
      group,
      mode: { type: 'string', enum: ['replace', 'append'] },
      effect: { type: 'string', enum: ['persistent', 'blink'] },
    },
  ],
  ['clear_highlight', '清除当前工作流的高亮。', [], { group }],
  [
    'set_layer_visibility',
    '设置当前页面注册业务图层的显隐。',
    ['layerId', 'visible'],
    { layerId: boundedString(), visible: { type: 'boolean' } },
  ],
  [
    'import_vector_dataset',
    '把用户已提供的浏览器文件引用导入为独立用户矢量图层，并返回稳定 layer_ref。',
    ['file_ref'],
    { file_ref: boundedString(), name: boundedString(200) },
  ],
  [
    'set_vector_style',
    '按稳定样式契约修改用户矢量图层样式。',
    ['layer_ref', 'style'],
    { layer_ref: boundedString(), style },
  ],
  [
    'fit_vector_layer',
    '缩放地图视图以完整显示指定用户矢量图层。',
    ['layer_ref'],
    { layer_ref: boundedString() },
  ],
  [
    'set_user_layer_visibility',
    '设置用户矢量图层显隐。',
    ['layer_ref', 'visible'],
    { layer_ref: boundedString(), visible: { type: 'boolean' } },
  ],
];

export const FRONTEND_TOOLS = definitions.map(
  ([name, description, required, properties]) => ({
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required,
      properties,
    },
  })
);

function matches(value, schema) {
  if (schema.enum) return schema.enum.includes(value);
  if (schema.type === 'string')
    return (
      typeof value === 'string' &&
      (schema.minLength === undefined || value.length >= schema.minLength) &&
      (schema.maxLength === undefined || value.length <= schema.maxLength)
    );
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer')
    return (
      Number.isInteger(value) &&
      (schema.minimum === undefined || value >= schema.minimum) &&
      (schema.maximum === undefined || value <= schema.maximum)
    );
  if (schema.type === 'number')
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (schema.minimum === undefined || value >= schema.minimum) &&
      (schema.maximum === undefined || value <= schema.maximum)
    );
  if (schema.type === 'array')
    return (
      Array.isArray(value) &&
      (schema.minItems === undefined || value.length >= schema.minItems) &&
      (schema.maxItems === undefined || value.length <= schema.maxItems) &&
      (!schema.uniqueItems || new Set(value).size === value.length) &&
      value.every((item) => matches(item, schema.items))
    );
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties)
      return false;
    if (
      schema.additionalProperties === false &&
      keys.some((key) => !Object.hasOwn(schema.properties, key))
    )
      return false;
    if (
      keys.some(
        (key) => schema.properties?.[key] && !matches(value[key], schema.properties[key])
      )
    )
      return false;
    return (schema.required || []).every((key) => Object.hasOwn(value, key));
  }
  return false;
}

/** Validate against the same restricted schema vocabulary used for declarations. */
export function validateToolCall(name, args) {
  const tool = FRONTEND_TOOLS.find((item) => item.name === name);
  if (!tool || !matches(args, tool.parameters)) throw gisError('INVALID_TOOL_CALL');
  if (name === 'set_vector_style') {
    const validateColor = (value) => value === undefined || /^#[0-9a-fA-F]{6}$/.test(value);
    if (!validateColor(args.style.stroke?.color) || !validateColor(args.style.fill?.color))
      throw gisError('INVALID_TOOL_CALL');
  }
}

export function canonicalArguments(value) {
  if (Array.isArray(value))
    return '[' + value.map(canonicalArguments).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ':' + canonicalArguments(value[key])
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
