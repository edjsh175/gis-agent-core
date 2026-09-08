import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { apply } from '../../harness/dsh-gis-plugin/src/aguiBridge.js';

function context(agentFactory = () => ({
  agent: { cancel: vi.fn(), whenIdle: () => Promise.resolve(), session: { id: 'session', events: [] } },
  dispose: vi.fn(),
})) {
  let route;
  let cleanup;
  const agentHandles = [];
  const ctx = {
    webServer: { register: ({ handler }) => { route = handler; return vi.fn(); } },
    agents: { create: async () => { const handle = agentFactory(); agentHandles.push(handle); return handle; } },
    gisAgentPolicy: { setup: vi.fn() },
    gisFrontendPending: { list: () => [], subscribe: () => () => {}, resolve: vi.fn() },
    on: () => () => {},
    effect: (factory) => { cleanup = factory(); return cleanup; },
    get: () => ({ currentSelection: () => ({ provider: 'test', model: 'test' }) }),
  };
  apply(ctx, { leaseMs: 20 });
  return { route, dispose: () => cleanup?.(), agentHandles };
}

async function request(route, pathname, body = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.url = pathname;
  req.headers = { host: 'gis.local' };
  const result = { status: null, body: '' };
  const res = {
    destroyed: false,
    writableEnded: false,
    writeHead(status) { result.status = status; },
    headersSent: false,
    flushHeaders() { this.headersSent = true; },
    write(value = '') { result.body += String(value); },
    end(value = '') { result.body += String(value); this.writableEnded = true; },
  };
  await route(req, res);
  const events = [...result.body.matchAll(/data: (.*)\n/g)].map((match) => JSON.parse(match[1]));
  return { ...result, events, json: events.length ? undefined : JSON.parse(result.body || '{}') };
}

function runInput(binding, runId = 'run-1', message = 'hello') {
  return {
    threadId: binding.threadId, runId, messages: [{ id: `message-${runId}`, role: 'user', content: message }],
    tools: [{ name: 'fit_vector_layer', description: 'fit', parameters: { type: 'object' } }], context: [], state: {},
    forwardedProps: { gisIntegration: { browserSessionId: binding.browserSessionId, workflowId: binding.workflowId } },
  };
}

describe('GIS AG-UI bridge session lifecycle', () => {
  it('expires, disposes, and removes a session exactly once', async () => {
    vi.useFakeTimers();
    const handle = { agent: { cancel: vi.fn(), whenIdle: () => new Promise(() => {}), followup: vi.fn(), session: { id: 'session', events: [] } }, dispose: vi.fn() };
    const test = context(() => handle);
    const created = await request(test.route, '/__gis-harness/sessions');
    const binding = created.json.data;
    const activeRun = request(test.route, '/__gis-harness/run', runInput(binding));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);
    expect(handle.agent.cancel).toHaveBeenCalledTimes(1);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect((await request(test.route, '/__gis-harness/cancel', binding)).status).toBe(410);
    expect((await activeRun).events.some((event) => event.type === 'RUN_ERROR')).toBe(true);
    await test.dispose();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('makes cancellation idempotent and terminates an active run wait', async () => {
    const idle = new Promise(() => {});
    const handle = { agent: { cancel: vi.fn(), whenIdle: () => idle, followup: vi.fn(), session: { id: 'session', events: [] } }, dispose: vi.fn() };
    const test = context(() => handle);
    const binding = (await request(test.route, '/__gis-harness/sessions')).json.data;
    const run = request(test.route, '/__gis-harness/run', runInput(binding));
    await Promise.resolve();
    const replay = await request(test.route, '/__gis-harness/run', runInput(binding));
    expect(replay.status).toBe(409);
    expect(replay.json.error.code).toBe('RUN_IN_PROGRESS');
    expect((await request(test.route, '/__gis-harness/cancel', binding)).status).toBe(200);
    expect((await request(test.route, '/__gis-harness/cancel', binding)).status).toBe(200);
    expect((await run).events.some((event) => event.type === 'RUN_ERROR')).toBe(true);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    await test.dispose();
  });

  it('rejects a distinct concurrent run and a mismatched binding', async () => {
    const idle = new Promise(() => {});
    const handle = { agent: { cancel: vi.fn(), whenIdle: () => idle, followup: vi.fn(), session: { id: 'session', events: [] } }, dispose: vi.fn() };
    const test = context(() => handle);
    const binding = (await request(test.route, '/__gis-harness/sessions')).json.data;
    const first = request(test.route, '/__gis-harness/run', runInput(binding, 'run-1'));
    await Promise.resolve();
    const concurrent = await request(test.route, '/__gis-harness/run', runInput(binding, 'run-2'));
    expect(concurrent.status).toBe(409);
    expect(concurrent.json.error.code).toBe('RUN_IN_PROGRESS');
    const forbidden = await request(test.route, '/__gis-harness/run', {
      ...runInput(binding, 'run-3'), forwardedProps: { gisIntegration: { browserSessionId: binding.browserSessionId, workflowId: 'wrong' } },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.json.error.code).toBe('SESSION_BINDING_FORBIDDEN');
    await test.dispose();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect((await first).events.some((event) => event.type === 'RUN_ERROR')).toBe(true);
  });
});
