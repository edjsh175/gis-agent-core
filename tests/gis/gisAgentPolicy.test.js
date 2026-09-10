import { describe, expect, it } from 'vitest';
import { FRONTEND_TOOLS } from '../../src/gis/integration/agui/frontendTools.js';
import { BUSINESS_ARTIFACT_TOOL_NAMES } from '../../harness/dsh-gis-plugin/src/gisCapabilities.js';
import {
  GIS_AGENT_TOOL_NAMES,
  GIS_USER_VECTOR_TOOL_NAMES,
  apply,
} from '../../harness/dsh-gis-plugin/src/gisAgentPolicy.js';
import { GIS_USER_VECTOR_TOOLS } from '../../harness/dsh-gis-plugin/src/gisTools.js';

describe('GIS Agent capability policy', () => {
  it('keeps GIS frontend tools scoped while the agent policy also admits business tools', () => {
    expect(GIS_AGENT_TOOL_NAMES).toEqual([
      ...GIS_USER_VECTOR_TOOL_NAMES,
      ...BUSINESS_ARTIFACT_TOOL_NAMES,
    ]);
    expect(GIS_USER_VECTOR_TOOLS.map((tool) => tool.name)).toEqual(
      GIS_USER_VECTOR_TOOL_NAMES
    );
    expect(
      GIS_USER_VECTOR_TOOL_NAMES.every((name) =>
        FRONTEND_TOOLS.some((tool) => tool.name === name)
      )
    ).toBe(true);
  });

  it('registers the scoped Harness policy and restricts exactly the declared GIS and business tools', () => {
    const provided = new Map();
    const effects = [];
    const ctx = {
      provide(name, value) {
        provided.set(name, value);
      },
      effect(effect, label) {
        effects.push({ effect, label });
      },
    };
    apply(ctx);
    const restrictions = [];
    const sections = [];
    const agentCtx = {
      tools: {
        restrict(value) {
          restrictions.push(value);
        },
      },
      systemPrompt: {
        section(value) {
          sections.push(value);
        },
      },
    };

    provided.get('gisAgentPolicy').setup(agentCtx);

    expect(restrictions).toEqual([{ allow: [...GIS_AGENT_TOOL_NAMES] }]);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ name: 'gis:policy', order: 90 });
    expect(sections[0].text).toContain('最少必要操作');
    expect(sections[0].text).toContain('不得自行猜测');
    expect(sections[0].text).toContain('MapContext');
    expect(sections[0].text).toContain('工具描述');
    expect(sections[0].text).toContain('持久化成功');
    for (const toolName of BUSINESS_ARTIFACT_TOOL_NAMES) {
      expect(sections[0].text).not.toContain(toolName);
    }
    expect(provided.get('gisAgentPolicy').allowedTools).toEqual(
      GIS_AGENT_TOOL_NAMES
    );
    expect(Object.isFrozen(provided.get('gisAgentPolicy').allowedTools)).toBe(
      true
    );
    expect(effects).toHaveLength(1);
  });
});
