import { describe, expect, it } from 'vitest';
import { FRONTEND_TOOLS } from '../../src/gis/integration/agui/frontendTools.js';
import { GIS_USER_VECTOR_TOOLS } from '../../harness/dsh-gis-plugin/src/gisTools.js';
import {
  GIS_AGENT_TOOL_NAMES,
  GIS_USER_VECTOR_TOOL_NAMES,
  apply,
} from '../../harness/dsh-gis-plugin/src/gisAgentPolicy.js';

describe('GIS Agent capability policy', () => {
  it('uses one registry for model policy and frontend tool registration', () => {
    expect(GIS_AGENT_TOOL_NAMES).toEqual(GIS_USER_VECTOR_TOOL_NAMES);
    expect(GIS_USER_VECTOR_TOOLS.map((tool) => tool.name)).toEqual(GIS_USER_VECTOR_TOOL_NAMES);
    expect(GIS_USER_VECTOR_TOOL_NAMES.every((name) => FRONTEND_TOOLS.some((tool) => tool.name === name))).toBe(true);
  });

  it('registers the scoped Harness system prompt and restricts exactly four tools', () => {
    const provided = new Map();
    const effects = [];
    const ctx = {
      provide(name, value) { provided.set(name, value); },
      effect(effect, label) { effects.push({ effect, label }); },
    };
    apply(ctx);
    const restrictions = [];
    const sections = [];
    const agentCtx = {
      tools: { restrict(value) { restrictions.push(value); } },
      systemPrompt: { section(value) { sections.push(value); } },
    };

    provided.get('gisAgentPolicy').setup(agentCtx);

    expect(restrictions).toEqual([{ allow: [...GIS_USER_VECTOR_TOOL_NAMES] }]);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ name: 'gis:policy', order: 90 });
    expect(sections[0].text).toContain('minimum actions');
    expect(sections[0].text).toContain('does not imply zooming');
    expect(sections[0].text).toContain('MapContext');
    expect(provided.get('gisAgentPolicy').allowedTools).toEqual(GIS_USER_VECTOR_TOOL_NAMES);
    expect(Object.isFrozen(provided.get('gisAgentPolicy').allowedTools)).toBe(true);
    expect(effects).toHaveLength(1);
  });
});

