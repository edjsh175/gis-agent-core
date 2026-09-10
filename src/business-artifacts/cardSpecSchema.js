import {
  CARD_BINDING_PATH_TYPES,
  CARD_CHART_TYPES,
  CARD_FIELD_NAME_PATTERN,
  CARD_FILTER_OPS,
  CARD_GROUP_FIELDS,
  CARD_LAYER_ID_PATTERN,
  CARD_SPEC_SCHEMA_VERSION,
  CARD_UNITS,
} from './cardSpecContract.js';

const text = (maxLength) => ({
  type: 'string',
  minLength: 1,
  maxLength,
});

const binding = {
  type: 'object',
  additionalProperties: false,
  required: ['statistics_ref', 'path'],
  properties: {
    statistics_ref: text(128),
    path: {
      type: 'string',
      enum: Object.keys(CARD_BINDING_PATH_TYPES),
    },
  },
};

const metricGroup = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'items'],
  properties: {
    id: text(64),
    type: { type: 'string', enum: ['metric_group'] },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value', 'unit'],
        properties: {
          label: text(80),
          value: binding,
          unit: {
            type: 'string',
            enum: [...CARD_UNITS],
          },
        },
      },
    },
  },
};

const textBlock = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'text'],
  properties: {
    id: text(64),
    type: { type: 'string', enum: ['text'] },
    text: text(1000),
  },
};

const chart = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'chartType', 'source', 'xField', 'yField'],
  properties: {
    id: text(64),
    type: { type: 'string', enum: ['chart'] },
    chartType: { type: 'string', enum: [...CARD_CHART_TYPES] },
    source: binding,
    xField: { type: 'string', enum: ['key'] },
    yField: { type: 'string', enum: ['count'] },
  },
};

const table = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'source', 'columns'],
  properties: {
    id: text(64),
    type: { type: 'string', enum: ['table'] },
    source: binding,
    columns: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'label'],
        properties: {
          field: { type: 'string', enum: Object.keys(CARD_GROUP_FIELDS) },
          label: text(80),
        },
      },
    },
  },
};

const mapAction = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'label', 'action'],
  properties: {
    id: text(64),
    type: { type: 'string', enum: ['map_action'] },
    label: text(100),
    action: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'layerId', 'filters'],
      properties: {
        kind: { type: 'string', enum: ['query_and_highlight'] },
        layerId: { ...text(200), pattern: CARD_LAYER_ID_PATTERN },
        filters: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'op', 'value'],
            properties: {
              field: { ...text(64), pattern: CARD_FIELD_NAME_PATTERN },
              op: { type: 'string', enum: [...CARD_FILTER_OPS] },
              value: {
                oneOf: [
                  { type: 'string', maxLength: 200 },
                  { type: 'number' },
                  { type: 'boolean' },
                ],
              },
            },
          },
        },
      },
    },
  },
};

export const BUSINESS_CARD_SPEC_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'title', 'layout', 'blocks'],
  properties: {
    schemaVersion: { type: 'string', enum: [CARD_SPEC_SCHEMA_VERSION] },
    title: text(80),
    description: {
      oneOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }],
    },
    layout: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'columns'],
      properties: {
        type: { type: 'string', enum: ['stack', 'grid'] },
        columns: { type: 'integer', minimum: 1, maximum: 3 },
      },
    },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        oneOf: [metricGroup, textBlock, chart, table, mapAction],
      },
    },
  },
});
