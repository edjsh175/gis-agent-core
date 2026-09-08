const GIS_TOOL_NAMES = [
  'import_vector_dataset',
  'set_vector_style',
  'fit_vector_layer',
  'set_user_layer_visibility',
];
const ASK_USER_TOOL = 'ask_user_question';

export const name = 'gis-agent-policy';
export const inject = ['tools'];

export function apply(ctx) {
  const allowedTools = [...GIS_TOOL_NAMES, ASK_USER_TOOL];
  const service = {
    allowedTools: Object.freeze([...allowedTools]),
    setup(agentCtx) {
      agentCtx.tools.restrict({ allow: allowedTools });
    },
  };
  ctx.provide('gisAgentPolicy', service);
  ctx.effect(() => () => {}, 'GIS agent policy lifecycle');
}

export { GIS_TOOL_NAMES, ASK_USER_TOOL };
