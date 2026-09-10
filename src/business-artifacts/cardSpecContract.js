export const CARD_SPEC_SCHEMA_VERSION = 'business-card/v1';

export const CARD_BLOCK_TYPES = Object.freeze([
  'metric_group',
  'text',
  'chart',
  'table',
  'map_action',
]);

export const CARD_UNITS = Object.freeze([
  '',
  '条',
  '米',
  'm',
  'km',
  '千米',
  '%',
]);
export const CARD_BINDING_PATH_TYPES = Object.freeze({
  'summary.count': 'number',
  'summary.total_length': 'number',
  'groups.material': 'array',
});
export const CARD_CHART_TYPES = Object.freeze(['bar', 'pie', 'line']);
export const CARD_FILTER_OPS = Object.freeze(['eq']);
export const CARD_GROUP_FIELDS = Object.freeze({
  key: 'string',
  count: 'number',
});

// Keep model-visible JSON Schema and server validation on the same lexical rules.
export const CARD_FIELD_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$';
export const CARD_LAYER_ID_PATTERN = '^[A-Za-z0-9_.:-]+$';
