import { describe, expect, it, vi } from 'vitest';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { useAguiWorkflow } from '../../src/gis/integration/agui/useAguiWorkflow.js';

describe('useAguiWorkflow Conversation Client', () => {
  function createMockGis() {
    const unByKeyObj = {};
    const dummyLayer = {
      on: () => unByKeyObj,
      getLayers: () => ({
        on: () => unByKeyObj,
        forEach: () => {},
      }),
    };
    const map = {
      getViewport: () => ({
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      getLayerGroup: () => dummyLayer,
      getView: () => ({
        on: () => unByKeyObj,
      }),
      on: () => unByKeyObj,
    };
    return {
      catalog: { getVersion: () => 1 },
      runtime: {
        getState: () => ({ scene: '2d', ready: true }),
        getMap: () => map,
        subscribe: () => () => {},
      },
      mapContext: {
        getSnapshot: () => ({ ok: true, data: { supportedTools: [] } }),
      },
      createClientScope: () => ({
        isActive: () => true,
        dispose: () => {},
        clearHighlight: () => {},
      }),
    };
  }

  it('reuses the same DSH session across multiple turns and accumulates messages', async () => {
    let sessionCount = 0;
    let runCount = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith('/sessions')) {
        sessionCount++;
        return new Response(JSON.stringify({
          ok: true,
          data: {
            browserSessionId: `browser-${sessionCount}`,
            threadId: `thread-${sessionCount}`,
            workflowId: `workflow-${sessionCount}`,
            leaseExpiresAt: Date.now() + 60_000,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/run')) {
        runCount++;
        const body = JSON.parse(init.body);
        const latestUser = [...body.messages].reverse().find((m) => m.role === 'user');
        const assistantMsgId = `assistant-${runCount}`;
        const sse = [
          `data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId })}\n\n`,
          `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_START', messageId: assistantMsgId, role: 'assistant' })}\n\n`,
          `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: assistantMsgId, delta: `Reply to ${latestUser.content}` })}\n\n`,
          `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_END', messageId: assistantMsgId })}\n\n`,
          `data: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId })}\n\n`,
        ].join('');
        return new Response(sse, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const gis = createMockGis();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      const client = useAguiWorkflow({ gis, baseUrl: '/test' });
      expect(client.state.value.status).toBe('idle');

      // Turn 1
      const res1 = await client.send('第一条指令');
      expect(res1.ok).toBe(true);
      expect(sessionCount).toBe(1);
      expect(runCount).toBe(1);
      expect(client.state.value.session.threadId).toBe('thread-1');
      expect(client.state.value.messages.length).toBe(2);

      // Turn 2: Should REUSE session, sessionCount stays 1!
      const res2 = await client.send('第二条指令');
      expect(res2.ok).toBe(true);
      expect(sessionCount).toBe(1);
      expect(runCount).toBe(2);
      expect(client.state.value.session.threadId).toBe('thread-1');
      expect(client.state.value.messages.length).toBe(4);

      // Reset: explicit new session
      client.reset();
      expect(client.state.value.status).toBe('idle');
      expect(client.state.value.messages).toHaveLength(0);

      // Turn 3: Should create new session
      const res3 = await client.send('新会话的第一条指令');
      expect(res3.ok).toBe(true);
      expect(sessionCount).toBe(2);
      expect(client.state.value.session.threadId).toBe('thread-2');
      expect(client.state.value.messages.length).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects a concurrent send before creating a second session or changing generation', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const originalFetch = globalThis.fetch;
    let sessions = 0;
    globalThis.fetch = async (url, init) => {
      if (url.endsWith('/sessions')) {
        sessions++;
        await gate;
        return new Response(JSON.stringify({ ok: true, data: {
          browserSessionId: 'b', threadId: 't', workflowId: 'w', leaseExpiresAt: Date.now() + 60_000,
        } }));
      }
      if (url.endsWith('/run')) {
        const { threadId, runId } = JSON.parse(init.body);
        return new Response([
          { type: 'RUN_STARTED', threadId, runId },
          { type: 'RUN_FINISHED', threadId, runId },
        ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ ok: true }));
    };
    const client = useAguiWorkflow({ gis: createMockGis(), baseUrl: '/test' });
    try {
      const accepted = vi.fn();
      const first = client.send('导入', {}, accepted);
      expect(client.state.value.status).toBe('connecting');
      expect(accepted).not.toHaveBeenCalled();
      expect((await client.send('重复发送')).error.code).toBe('WORKFLOW_ALREADY_STARTED');
      expect(sessions).toBe(1);
      release();
      expect((await first).ok).toBe(true);
      expect(accepted).toHaveBeenCalledOnce();
      expect(client.state.value.status).toBe('completed');
    } finally {
      release();
      client.reset();
      globalThis.fetch = originalFetch;
    }
  });

  it('does not consume the draft when session creation fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    const accepted = vi.fn();
    const client = useAguiWorkflow({ gis: createMockGis(), baseUrl: '/test' });
    try {
      expect((await client.send('仅导入', {}, accepted)).ok).toBe(false);
      expect(accepted).not.toHaveBeenCalled();
      expect(client.state.value.messages).toEqual([]);
    } finally {
      client.reset();
      globalThis.fetch = originalFetch;
    }
  });
});
