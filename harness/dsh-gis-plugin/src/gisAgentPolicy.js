import {
  GIS_AGENT_POLICY_PROMPT,
  GIS_AGENT_TOOL_NAMES,
  GIS_USER_VECTOR_TOOL_NAMES,
} from './gisCapabilities.js';

export const name = 'gis-agent-policy';
export const inject = ['tools', 'systemPrompt'];

export function apply(ctx) {
  const allowedTools = [...GIS_AGENT_TOOL_NAMES];
  const service = {
    allowedTools: Object.freeze([...allowedTools]),
    setup(agentCtx) {
      agentCtx.tools.restrict({ allow: allowedTools });
      agentCtx.systemPrompt.section({
        name: 'gis:policy',
        order: 90,
        text: GIS_AGENT_POLICY_PROMPT,
      });
    },
  };
  ctx.provide('gisAgentPolicy', service);
  ctx.effect(() => () => {}, 'GIS agent policy lifecycle');
}

export {
  GIS_AGENT_TOOL_NAMES,
  GIS_AGENT_TOOL_NAMES as GIS_TOOL_NAMES,
  GIS_USER_VECTOR_TOOL_NAMES,
};
