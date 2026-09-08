import { describe, expect, it } from 'vitest';
import { FRONTEND_TOOLS } from '../../src/gis/integration/agui/frontendTools.js';
import { apply as applyService } from '../../harness/dsh-gis-plugin/src/gisFrontendService.js';
import { apply as applyTools } from '../../harness/dsh-gis-plugin/src/gisTools.js';
import { apply as applyFakeProvider } from '../../harness/dsh-gis-plugin/src/fakeProvider.js';
import { apply as applyPendingProvider } from '../../harness/dsh-gis-plugin/src/pendingProvider.js';

function createTestContext() {
  const cleanups = [];
  const definitions = [];
  const ctx = {
    tools: {
      register(definition) {
        definitions.push(definition);
        let active = true;
        const dispose = () => {
          if (!active) return;
          active = false;
          const index = definitions.indexOf(definition);
          if (index >= 0) definitions.splice(index, 1);
        };
        cleanups.push(dispose);
        return dispose;
      },
    },
    provide(key, value) {
      if (Object.hasOwn(ctx, key)) throw new Error(`duplicate service: ${key}`);
      ctx[key] = value;
      let active = true;
      const dispose = () => {
        if (!active) return;
        active = false;
        if (ctx[key] === value) delete ctx[key];
      };
      cleanups.push(dispose);
      return dispose;
    },
    effect(factory) {
      const effect = factory();
      let cleanup;
      if (effect && typeof effect.next === 'function') cleanup = effect.next().value;
      else cleanup = effect;
      let active = true;
      const dispose = () => {
        if (!active) return;
        active = false;
        cleanup?.();
      };
      cleanups.push(dispose);
      return dispose;
    },
    dispose() {
      for (const cleanup of [...cleanups].reverse()) cleanup();
    },
    definitions,
  };
  return ctx;
}

const exec = () => ({ signal: new AbortController().signal, deferContext: () => {} });
const tool = (ctx, name) => ctx.definitions.find((definition) => definition.name === name);

describe('Harness GIS H0 service seam', () => {
  it('waits for one provider, rejects duplicates, and unregisters cleanly', async () => {
    const ctx = createTestContext();
    applyService(ctx);

    await expect(ctx.gisFrontend.execute({ operation: 'x', arguments: {}, signal: exec().signal }))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' });

    let resolvePending;
    const pending = new Promise((resolve) => { resolvePending = resolve; });
    const dispose = ctx.gisFrontend.registerProvider({ execute: () => pending });
    expect(() => ctx.gisFrontend.registerProvider({ execute: async () => ({}) }))
      .toThrowError(expect.objectContaining({ code: 'DUPLICATE_PROVIDER' }));

    const execution = ctx.gisFrontend.execute({ operation: 'x', arguments: {}, signal: exec().signal });
    resolvePending({ ok: true });
    await expect(execution).resolves.toEqual({ ok: true });

    dispose();
    await expect(ctx.gisFrontend.execute({ operation: 'x', arguments: {}, signal: exec().signal }))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' });
  });

  it('fails before dispatch when the owning tool signal is already aborted', async () => {
    const ctx = createTestContext();
    applyService(ctx);
    let called = false;
    ctx.gisFrontend.registerProvider({ execute: async () => { called = true; return {}; } });
    const controller = new AbortController();
    controller.abort();

    await expect(ctx.gisFrontend.execute({ operation: 'x', arguments: {}, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'GIS_FRONTEND_ABORTED' });
    expect(called).toBe(false);
  });
});

describe('Harness GIS pending frontend provider', () => {
  it('holds one tool Promise until the matching browser request is resolved', async () => {
    const ctx = createTestContext();
    applyService(ctx);
    applyPendingProvider(ctx);
    applyTools(ctx);

    const agent = { id: 'session-1' };
    const execution = tool(ctx, 'import_vector_dataset').execute(
      { file_ref: 'vf_roads' },
      { ...exec(), agent, callId: 'call-1' },
    );
    const pending = ctx.gisFrontendPending.list('session-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      sessionId: 'session-1', callId: 'call-1', operation: 'import_vector_dataset', arguments: { file_ref: 'vf_roads' },
    });

    const receipt = ctx.gisFrontendPending.resolve(pending[0].requestId, {
      ok: true,
      data: { layer_ref: 'ul_browser_1' },
      effect: { status: 'applied', kind: 'import' },
    });
    expect(receipt).toEqual({ accepted: true });
    await expect(execution).resolves.toMatchObject({ ok: true, data: { layer_ref: 'ul_browser_1' } });
    expect(ctx.gisFrontendPending.list()).toEqual([]);
    expect(ctx.gisFrontendPending.resolve(pending[0].requestId, {})).toEqual({ accepted: false, reason: 'not-pending' });
  });

  it('removes and rejects a pending browser operation when the owning tool is aborted', async () => {
    const ctx = createTestContext();
    applyService(ctx);
    applyPendingProvider(ctx);
    applyTools(ctx);
    const controller = new AbortController();
    const events = [];
    ctx.gisFrontendPending.subscribe((event) => events.push(event));

    const execution = tool(ctx, 'fit_vector_layer').execute(
      { layer_ref: 'ul_1' },
      { signal: controller.signal, agent: { id: 'session-1' }, callId: 'call-2' },
    );
    expect(ctx.gisFrontendPending.list()).toHaveLength(1);
    controller.abort();

    await expect(execution).rejects.toMatchObject({ code: 'GIS_FRONTEND_ABORTED' });
    expect(ctx.gisFrontendPending.list()).toEqual([]);
    expect(events.map((event) => [event.type, event.outcome])).toEqual([
      ['requested', undefined],
      ['resolved', 'cancelled'],
    ]);
  });

  it('defers the latest MapContext after the tool result instead of returning transport context to the model', async () => {
    const ctx = createTestContext();
    applyService(ctx);
    applyPendingProvider(ctx);
    applyTools(ctx);
    const deferred = [];

    const execution = tool(ctx, 'import_vector_dataset').execute(
      { file_ref: 'vf_roads' },
      {
        signal: new AbortController().signal,
        agent: { id: 'session-ctx' },
        callId: 'call-ctx',
        deferContext: (message) => deferred.push(message),
      },
    );
    const pending = ctx.gisFrontendPending.list('session-ctx')[0];
    ctx.gisFrontendPending.resolve(pending.requestId, {
      ok: true,
      data: { layer_ref: 'ul_browser_1' },
      effect: { status: 'applied', kind: 'import', stateRevision: 2 },
      mapContext: {
        schemaVersion: 2,
        revision: 2,
        userLayers: [{ layer_ref: 'ul_browser_1', name: 'roads', visible: true }],
      },
    });

    await expect(execution).resolves.toEqual({
      ok: true,
      data: { layer_ref: 'ul_browser_1' },
      effect: { status: 'applied', kind: 'import', stateRevision: 2 },
    });
    expect(deferred).toHaveLength(1);
    expect(deferred[0].source).toEqual({ kind: 'plugin', plugin: '23dmaps-map-context' });
    expect(deferred[0].content[0].text).toContain('"revision":2');
    expect(deferred[0].content[0].text).toContain('"layer_ref":"ul_browser_1"');
  });
});

describe('Harness GIS H0 tool consumer', () => {
  it('reuses the browser User Vector tool contracts instead of declaring a second schema set', () => {
    const ctx = createTestContext();
    applyService(ctx);
    applyTools(ctx);

    expect(ctx.definitions.map((definition) => definition.name)).toEqual([
      'import_vector_dataset',
      'set_vector_style',
      'fit_vector_layer',
      'set_user_layer_visibility',
    ]);
    for (const definition of ctx.definitions) {
      const browserTool = FRONTEND_TOOLS.find((item) => item.name === definition.name);
      expect(definition.parameters).toEqual(browserTool.parameters);
    }
  });

  it('executes import, style, fit, and visibility through the provider without a hardcoded phase machine', async () => {
    const ctx = createTestContext();
    applyService(ctx);
    applyFakeProvider(ctx);
    applyTools(ctx);

    const imported = await tool(ctx, 'import_vector_dataset').execute({ file_ref: 'vf_roads' }, exec());
    expect(imported.ok).toBe(true);
    expect(imported.effect.status).toBe('applied');
    const layerRef = imported.data.layer_ref;

    const styled = await tool(ctx, 'set_vector_style').execute({
      layer_ref: layerRef,
      style: { stroke: { color: '#ff0000', width: 4, opacity: 0.8 } },
    }, exec());
    expect(styled).toMatchObject({ ok: true, effect: { status: 'applied', kind: 'style' } });

    const fitted = await tool(ctx, 'fit_vector_layer').execute({ layer_ref: layerRef }, exec());
    expect(fitted).toMatchObject({ ok: true, effect: { status: 'applied', kind: 'locate' } });

    const hidden = await tool(ctx, 'set_user_layer_visibility').execute({ layer_ref: layerRef, visible: false }, exec());
    expect(hidden).toMatchObject({ ok: true, data: { layer_ref: layerRef, visible: false } });
    expect(ctx.gisFrontendFake.getLayer(layerRef)).toMatchObject({ visible: false, style: { stroke: { width: 4 } } });

    const calls = ctx.gisFrontendFake.getCalls();
    expect(calls.map((call) => call.operation)).toEqual([
      'import_vector_dataset',
      'set_vector_style',
      'fit_vector_layer',
      'set_user_layer_visibility',
    ]);
  });

  it('returns structured business failure for an unknown layer instead of inventing success', async () => {
    const ctx = createTestContext();
    applyService(ctx);
    applyFakeProvider(ctx);
    applyTools(ctx);

    await expect(tool(ctx, 'fit_vector_layer').execute({ layer_ref: 'ul_missing' }, exec()))
      .resolves.toEqual({
        ok: false,
        error: { code: 'UNKNOWN_LAYER_REF', message: 'The requested user vector layer does not exist.' },
        effect: { status: 'none', kind: 'locate' },
      });
  });

  it('rejects provider success without applied evidence and strips transport-only fields', async () => {
    const ctx = createTestContext();
    applyService(ctx);
    applyTools(ctx);

    let dispose = ctx.gisFrontend.registerProvider({
      execute: async () => ({
        ok: true,
        data: { layer_ref: 'ul_1' },
        effect: { status: 'unknown', workflowId: 'wf_transport_only' },
      }),
    });
    await expect(tool(ctx, 'import_vector_dataset').execute({ file_ref: 'vf_1' }, exec()))
      .rejects.toMatchObject({ code: 'GIS_FRONTEND_INVALID_RESULT' });

    dispose();
    dispose = ctx.gisFrontend.registerProvider({
      execute: async () => ({
        ok: true,
        data: { layer_ref: 'ul_2' },
        effect: { status: 'applied', kind: 'import', stateRevision: 7, workflowId: 'wf_transport_only' },
        mapContext: { revision: 7 },
      }),
    });
    const result = await tool(ctx, 'import_vector_dataset').execute({ file_ref: 'vf_2' }, exec());
    expect(result).toEqual({
      ok: true,
      data: { layer_ref: 'ul_2' },
      effect: { status: 'applied', kind: 'import', stateRevision: 7 },
    });
    dispose();
  });

  it('keeps the browser-side argument validator authoritative', async () => {
    const ctx = createTestContext();
    applyService(ctx);
    applyFakeProvider(ctx);
    applyTools(ctx);

    await expect(tool(ctx, 'set_vector_style').execute({
      layer_ref: 'ul_any',
      style: { stroke: { color: 'red' } },
    }, exec())).rejects.toMatchObject({ code: 'INVALID_TOOL_CALL' });
    expect(ctx.gisFrontendFake.getCalls()).toEqual([]);
  });
});
