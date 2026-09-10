import {
  CARD_BINDING_PATH_TYPES,
  CARD_BLOCK_TYPES,
  CARD_CHART_TYPES,
  CARD_FIELD_NAME_PATTERN,
  CARD_FILTER_OPS,
  CARD_GROUP_FIELDS,
  CARD_LAYER_ID_PATTERN,
  CARD_SPEC_SCHEMA_VERSION,
  CARD_UNITS,
} from './cardSpecContract.js';

const ROOT_KEYS = ['schemaVersion', 'title', 'description', 'layout', 'blocks'];
const LAYOUT_KEYS = ['type', 'columns'];
const BLOCK_TYPES = new Set(CARD_BLOCK_TYPES);
const UNITS = new Set(CARD_UNITS);
const BINDING_PATHS = CARD_BINDING_PATH_TYPES;
const CHART_TYPES = new Set(CARD_CHART_TYPES);
const FILTER_OPS = new Set(CARD_FILTER_OPS);
const GROUP_FIELDS = CARD_GROUP_FIELDS;
const FIELD_NAME_RE = new RegExp(CARD_FIELD_NAME_PATTERN);
const LAYER_ID_RE = new RegExp(CARD_LAYER_ID_PATTERN);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function plainObject(value, code, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code, `${label} must be a plain object`);
  }
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      fail(code, `${label} contains a forbidden key`);
    }
  }
  return value;
}

function exactKeys(value, keys, code, label) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${label}.${key} is not supported`);
  }
}

function string(value, code, label, min = 1, max = 200) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail(code, `${label} must be a string of length ${min}-${max}`);
  }
  return value;
}

function displayText(value, code, label, min = 1, max = 200) {
  string(value, code, label, min, max);
  if (
    /[<>]|(?:javascript|data|vbscript):|(?:https?:\/\/|www\.)|<\/?script\b/i.test(
      value
    )
  ) {
    fail(code, `${label} must be plain text without HTML, URL, or script`);
  }
  return value;
}

function fieldName(value, code, label) {
  string(value, code, label, 1, 64);
  if (!FIELD_NAME_RE.test(value))
    fail(code, `${label} is not a valid field name`);
  return value;
}

function integer(value, code, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(code, `${label} must be an integer in ${min}-${max}`);
  }
  return value;
}

function cloneJson(value, code = 'INVALID_CARD_SPEC') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, code));
  const object = plainObject(value, code, 'value');
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [key, cloneJson(item, code)])
  );
}

function validateBinding(value, code = 'INVALID_CARD_SPEC') {
  const binding = plainObject(value, code, 'binding');
  exactKeys(binding, ['statistics_ref', 'path'], code, 'binding');
  string(binding.statistics_ref, code, 'binding.statistics_ref', 1, 128);
  string(binding.path, code, 'binding.path', 1, 64);
  if (!own(BINDING_PATHS, binding.path))
    fail(code, `unsupported binding path: ${binding.path}`);
  return { statistics_ref: binding.statistics_ref, path: binding.path };
}

function validateBlock(block) {
  plainObject(block, 'INVALID_CARD_SPEC', 'block');
  string(block.id, 'INVALID_CARD_SPEC', 'block.id', 1, 64);
  string(block.type, 'INVALID_CARD_SPEC', 'block.type', 1, 32);
  if (!BLOCK_TYPES.has(block.type))
    fail('INVALID_CARD_SPEC', `unsupported block type: ${block.type}`);

  if (block.type === 'metric_group') {
    exactKeys(
      block,
      ['id', 'type', 'items'],
      'INVALID_CARD_SPEC',
      'metric_group'
    );
    if (
      !Array.isArray(block.items) ||
      block.items.length < 1 ||
      block.items.length > 6
    ) {
      fail('INVALID_CARD_SPEC', 'metric_group.items must contain 1-6 items');
    }
    return {
      id: block.id,
      type: block.type,
      items: block.items.map((item) => {
        plainObject(item, 'INVALID_CARD_SPEC', 'metric item');
        exactKeys(
          item,
          ['label', 'value', 'unit'],
          'INVALID_CARD_SPEC',
          'metric item'
        );
        displayText(
          item.label,
          'INVALID_CARD_SPEC',
          'metric item.label',
          1,
          80
        );
        const unit = item.unit;
        if (typeof unit !== 'string' || !UNITS.has(unit))
          fail('INVALID_CARD_SPEC', 'metric item.unit is not allowed');
        return { label: item.label, value: validateBinding(item.value), unit };
      }),
    };
  }

  if (block.type === 'text') {
    exactKeys(block, ['id', 'type', 'text'], 'INVALID_CARD_SPEC', 'text');
    const text = displayText(
      block.text,
      'INVALID_CARD_SPEC',
      'text.text',
      1,
      1000
    );
    return { id: block.id, type: block.type, text };
  }

  if (block.type === 'chart') {
    exactKeys(
      block,
      ['id', 'type', 'chartType', 'source', 'xField', 'yField'],
      'INVALID_CARD_SPEC',
      'chart'
    );
    if (!CHART_TYPES.has(block.chartType))
      fail('INVALID_CARD_SPEC', 'chart.chartType is not allowed');
    fieldName(block.xField, 'INVALID_CARD_SPEC', 'chart.xField');
    fieldName(block.yField, 'INVALID_CARD_SPEC', 'chart.yField');
    if (block.xField !== 'key' || block.yField !== 'count')
      fail('INVALID_CARD_SPEC', 'chart fields must be key and count');
    return {
      id: block.id,
      type: block.type,
      chartType: block.chartType,
      source: validateBinding(block.source),
      xField: block.xField,
      yField: block.yField,
    };
  }

  if (block.type === 'table') {
    exactKeys(
      block,
      ['id', 'type', 'source', 'columns'],
      'INVALID_CARD_SPEC',
      'table'
    );
    if (
      !Array.isArray(block.columns) ||
      block.columns.length < 1 ||
      block.columns.length > 8
    )
      fail('INVALID_CARD_SPEC', 'table.columns must contain 1-8 columns');
    return {
      id: block.id,
      type: block.type,
      source: validateBinding(block.source),
      columns: block.columns.map((column) => {
        plainObject(column, 'INVALID_CARD_SPEC', 'table column');
        exactKeys(
          column,
          ['field', 'label'],
          'INVALID_CARD_SPEC',
          'table column'
        );
        fieldName(column.field, 'INVALID_CARD_SPEC', 'table column.field');
        if (!own(GROUP_FIELDS, column.field))
          fail('INVALID_CARD_SPEC', 'table column field is not supported');
        return {
          field: column.field,
          label: displayText(
            column.label,
            'INVALID_CARD_SPEC',
            'table column.label',
            1,
            80
          ),
        };
      }),
    };
  }

  exactKeys(
    block,
    ['id', 'type', 'label', 'action'],
    'INVALID_CARD_SPEC',
    'map_action'
  );
  displayText(block.label, 'INVALID_CARD_SPEC', 'map_action.label', 1, 100);
  const action = plainObject(
    block.action,
    'INVALID_CARD_SPEC',
    'map_action.action'
  );
  exactKeys(
    action,
    ['kind', 'layerId', 'filters'],
    'INVALID_CARD_SPEC',
    'map_action.action'
  );
  if (action.kind !== 'query_and_highlight')
    fail('INVALID_CARD_SPEC', 'map_action.action.kind is not allowed');
  string(
    action.layerId,
    'INVALID_CARD_SPEC',
    'map_action.action.layerId',
    1,
    200
  );
  if (!LAYER_ID_RE.test(action.layerId))
    fail('INVALID_CARD_SPEC', 'map_action.action.layerId is invalid');
  if (
    !Array.isArray(action.filters) ||
    action.filters.length < 1 ||
    action.filters.length > 20
  )
    fail(
      'INVALID_CARD_SPEC',
      'map_action.action.filters must contain 1-20 filters'
    );
  return {
    id: block.id,
    type: block.type,
    label: block.label,
    action: {
      kind: action.kind,
      layerId: action.layerId,
      filters: action.filters.map((filter) => {
        plainObject(filter, 'INVALID_CARD_SPEC', 'map filter');
        exactKeys(
          filter,
          ['field', 'op', 'value'],
          'INVALID_CARD_SPEC',
          'map filter'
        );
        const isScalar = (value) =>
          typeof value === 'string' ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value));
        const filterValue = filter.value;
        if (!isScalar(filterValue))
          fail('INVALID_CARD_SPEC', 'map filter.value must be scalar');
        if (!FILTER_OPS.has(filter.op))
          fail('INVALID_CARD_SPEC', 'map filter.op is not allowed');
        return {
          field: fieldName(
            filter.field,
            'INVALID_CARD_SPEC',
            'map filter.field'
          ),
          op: filter.op,
          value: cloneJson(filterValue),
        };
      }),
    },
  };
}

export function validateCardSpec(spec) {
  const root = plainObject(spec, 'INVALID_CARD_SPEC', 'CardSpec');
  exactKeys(root, ROOT_KEYS, 'INVALID_CARD_SPEC', 'CardSpec');
  if (root.schemaVersion !== CARD_SPEC_SCHEMA_VERSION)
    fail('INVALID_CARD_SPEC', 'unsupported schemaVersion');
  const title = displayText(root.title, 'INVALID_CARD_SPEC', 'title', 1, 80);
  if (root.description !== null && root.description !== undefined)
    displayText(root.description, 'INVALID_CARD_SPEC', 'description', 0, 300);
  const layout = plainObject(root.layout, 'INVALID_CARD_SPEC', 'layout');
  exactKeys(layout, LAYOUT_KEYS, 'INVALID_CARD_SPEC', 'layout');
  if (layout.type !== 'stack' && layout.type !== 'grid')
    fail('INVALID_CARD_SPEC', 'layout.type is not allowed');
  const columns = integer(
    layout.columns,
    'INVALID_CARD_SPEC',
    'layout.columns',
    1,
    3
  );
  if (
    !Array.isArray(root.blocks) ||
    root.blocks.length < 1 ||
    root.blocks.length > 12
  )
    fail('INVALID_CARD_SPEC', 'blocks must contain 1-12 blocks');
  const blockIds = new Set();
  root.blocks.forEach((block) => {
    if (blockIds.has(block.id))
      fail('INVALID_CARD_SPEC', `duplicate block id: ${block.id}`);
    blockIds.add(block.id);
  });
  return {
    schemaVersion: root.schemaVersion,
    title,
    description: root.description === undefined ? null : root.description,
    layout: { type: layout.type, columns },
    blocks: root.blocks.map(validateBlock),
  };
}

function bindingError(message) {
  fail('CARD_BINDING_INVALID', message);
}

export function resolveCardBindings(spec, snapshots) {
  const card = validateCardSpec(spec);
  if (!Array.isArray(snapshots)) bindingError('snapshots must be an array');
  const byRef = new Map();
  for (const snapshot of snapshots) {
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      typeof snapshot.statistics_ref !== 'string'
    )
      bindingError('invalid statistics snapshot');
    if (byRef.has(snapshot.statistics_ref))
      bindingError('duplicate statistics_ref');
    byRef.set(snapshot.statistics_ref, snapshot);
  }
  const read = (binding, expected) => {
    const snapshot = byRef.get(binding.statistics_ref);
    if (!snapshot)
      bindingError(`statistics_ref not found: ${binding.statistics_ref}`);
    const data = snapshot.data;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      bindingError('snapshot.data is invalid');
    const parts = binding.path.split('.');
    let value = data;
    for (const part of parts) {
      if (!value || typeof value !== 'object' || !own(value, part))
        bindingError(`path not found: ${binding.path}`);
      value = value[part];
    }
    if (
      BINDING_PATHS[binding.path] !== expected ||
      (expected === 'number' &&
        (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) ||
      (expected === 'array' && !Array.isArray(value))
    )
      bindingError(`binding type mismatch: ${binding.path}`);
    if (expected === 'array') {
      if (value.length > 100)
        bindingError('groups.material contains too many rows');
      value.forEach((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row))
          bindingError('groups.material row is invalid');
        for (const field of Object.keys(row))
          if (!own(GROUP_FIELDS, field))
            bindingError(`unsupported groups.material field: ${field}`);
        if (
          typeof row.key !== 'string' ||
          typeof row.count !== 'number' ||
          !Number.isFinite(row.count) ||
          row.count < 0
        )
          bindingError('groups.material row has invalid field type');
      });
    }
    return cloneJson(value, 'CARD_BINDING_INVALID');
  };
  for (const block of card.blocks) {
    if (block.type === 'metric_group')
      block.items.forEach((item) => {
        item.value = read(item.value, 'number');
      });
    if (block.type === 'chart' || block.type === 'table')
      block.data = read(block.source, 'array');
  }
  return card;
}

export { BINDING_PATHS, UNITS };
