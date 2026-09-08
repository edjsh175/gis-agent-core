import { randomUUID } from 'node:crypto';
import { FRONTEND_TOOLS, validateToolCall } from '../../../src/gis/integration/agui/frontendTools.js';
import { GIS_TOOL_OUTPUT_SCHEMA, normalizeFrontendResult } from './resultContract.js';
import { GIS_USER_VECTOR_TOOL_NAMES } from './gisCapabilities.js';

export const name = 'gis-tool-consumer';
export const inject = ['tools', 'gisFrontend'];

const USER_VECTOR_TOOL_NAME_SET = new Set(GIS_USER_VECTOR_TOOL_NAMES);

export const GIS_USER_VECTOR_TOOLS = FRONTEND_TOOLS.filter((tool) => USER_VECTOR_TOOL_NAME_SET.has(tool.name));

function mapContextMessage(mapContext) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `Current 23dmaps MapContext after GIS execution:\n${JSON.stringify(mapContext)}` }],
    source: { kind: 'plugin', plugin: '23dmaps-map-context' },
  };
}

export function apply(ctx) {
  for (const tool of GIS_USER_VECTOR_TOOLS) {
    ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: {
        schema: GIS_TOOL_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        validateToolCall(tool.name, args);
        const result = await ctx.gisFrontend.execute({
          operation: tool.name,
          callId: exec.callId,
          arguments: structuredClone(args),
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          signal: exec.signal,
        });
        const normalized = normalizeFrontendResult(tool.name, result);
        if (result.mapContext && typeof result.mapContext === 'object' && !Array.isArray(result.mapContext)) {
          exec.deferContext(mapContextMessage(structuredClone(result.mapContext)));
        }
        return normalized;
      },
    });
  }
}
