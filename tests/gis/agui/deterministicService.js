import { randomBytes, randomUUID } from 'node:crypto';
import { RunAgentInputSchema, EventSchemas } from '@ag-ui/core';
import { createFeatureReferenceStore } from '../../../src/gis/integration/featureReferenceStore.js';
import { canonicalArguments } from '../../../src/gis/integration/agui/frontendTools.js';

export const PREFIX = '/__gis-agui';
const COOKIE = 'gis_fixture_session';
const failure = (code) => ({ ok: false, error: { code, message: code } });
const cookie = (req) => (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const send = (res, status, value, headers = {}) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
};
const stream = (res, events) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.end(events.map((event) => `data: ${JSON.stringify(EventSchemas.parse(event))}\n\n`).join(''));
};
const read = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > 2_000_000) reject(new Error('Body limit')); });
  req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } });
  req.on('error', reject);
});

/** Synthetic authentication and data are test fixtures, never production auth. */
export function createDeterministicAguiPlugin() {
  const principals = new Map();
  const sessions = new Map();
  const timers = new Map();
  const store = createFeatureReferenceStore();
  const wait = () => new Promise((resolve) => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, 300);
    timers.set(timer, resolve);
  });
  const toBinding = (session) => ({
    userId: session.userId,
    browserSessionId: session.browserSessionId,
    threadId: session.threadId,
    workflowId: session.workflowId,
    configVersion: session.configVersion,
    leaseExpiresAt: session.leaseExpiresAt,
  });
  const authorize = (req, binding, allowClosed = false) => {
    const userId = principals.get(cookie(req));
    if (!userId) return { status: 401, error: 'AUTH_REQUIRED' };
    const session = sessions.get(binding?.browserSessionId);
    if (!session || session.userId !== userId || session.threadId !== binding.threadId || session.workflowId !== binding.workflowId)
      return { status: 403, error: 'SESSION_BINDING_FORBIDDEN' };
    if (!allowClosed && (session.cancelled || Date.now() >= session.leaseExpiresAt))
      return { status: 409, error: 'SESSION_CANCELLED' };
    return { session };
  };
  function toolEvents(pending, malformed = false) {
    const args = malformed ? '{broken' : JSON.stringify(pending.args);
    const middle = Math.ceil(args.length / 2);
    return [
      { type: 'TOOL_CALL_START', toolCallId: pending.id, toolCallName: pending.name },
      { type: 'TOOL_CALL_ARGS', toolCallId: pending.id, delta: args.slice(0, middle) },
      { type: 'TOOL_CALL_ARGS', toolCallId: pending.id, delta: args.slice(middle) },
      { type: 'TOOL_CALL_END', toolCallId: pending.id },
    ];
  }
  function textEvents(content) {
    const messageId = randomUUID();
    return [{ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: content }, { type: 'TEXT_MESSAGE_END', messageId }];
  }
  function readReceipt(input, pending) {
    if (!pending) return null;
    const tool = input.messages.at(-1);
    const assistant = [...input.messages].reverse().find((message) => message.role === 'assistant' && message.toolCalls?.some((call) => call.id === pending.id));
    const call = assistant?.toolCalls.find((item) => item.id === pending.id);
    try {
      if (tool?.role !== 'tool' || tool.toolCallId !== pending.id || call?.function.name !== pending.name ||
        canonicalArguments(JSON.parse(call.function.arguments)) !== canonicalArguments(pending.args)) return null;
      const receipt = JSON.parse(tool.content);
      if (receipt.ok === true && receipt.effect?.status === 'applied') return receipt;
      if (receipt.ok === false && typeof receipt.error?.code === 'string' &&
          ['none', 'partial', 'unknown', 'applied'].includes(receipt.effect?.status) && typeof tool.error === 'string') return receipt;
    } catch { /* Invalid correlation cannot advance the server phase. */ }
    return null;
  }

  async function handle(req, res, pathname) {
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, failure('ORIGIN_FORBIDDEN')); }
      catch { return send(res, 403, failure('ORIGIN_FORBIDDEN')); }
    }
    if (req.method !== 'POST') return send(res, 405, failure('METHOD_NOT_ALLOWED'));
    let body;
    try { body = await read(req); } catch { return send(res, 400, failure('INVALID_JSON')); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, failure('INVALID_JSON'));
    if (pathname === `${PREFIX}/fixture-login`) {
      const token = randomBytes(24).toString('hex');
      principals.set(token, randomUUID());
      return send(res, 200, { ok: true, data: { fixture: true } }, { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=${PREFIX}` });
    }
    if (pathname === `${PREFIX}/sessions`) {
      const userId = principals.get(cookie(req));
      if (!userId) return send(res, 401, failure('AUTH_REQUIRED'));
      if (Object.keys(body).some((key) => key !== 'scenario')) return send(res, 400, failure('INVALID_ARGUMENT'));
      const binding = { browserSessionId: randomUUID(), threadId: randomUUID(), workflowId: randomUUID(), configVersion: 'fixture-v1', leaseExpiresAt: Date.now() + 90_000 };
      sessions.set(binding.browserSessionId, { ...binding, userId, scenario: body.scenario || 'normal',
        cancelled: false, phase: 0, pending: null, runs: new Map(),
        observed: { receivedRunIds: [], toolResults: [], queryCount: 0, resolves: [], states: [] },
      });
      return send(res, 200, { ok: true, data: binding });
    }
    const input = pathname === `${PREFIX}/run` ? { ...body.forwardedProps?.gisIntegration, threadId: body.threadId } : body;
    const own = authorize(req, input, pathname === `${PREFIX}/inspect` || pathname === `${PREFIX}/cancel`);
    if (own.error) return send(res, own.status, failure(own.error));
    const session = own.session;
    if (pathname === `${PREFIX}/inspect`) return send(res, 200, { ok: true, data: { ...session.observed, cancelled: session.cancelled } });
    if (pathname === `${PREFIX}/cancel`) {
      session.cancelled = true;
      session.pending = null;
      store.revokeWorkflow(toBinding(session));
      return send(res, 200, { ok: true, data: { cancelled: true } });
    }
    if (pathname === `${PREFIX}/resolve`) {
      if (session.scenario === 'slow_resolve') await wait();
      if (session.cancelled) return send(res, 409, failure('SESSION_CANCELLED'));
      const result = store.resolve(body.feature_ref, toBinding(session));
      session.observed.resolves.push(result.ok);
      return send(res, result.ok ? 200 : 403, result);
    }
    if (pathname !== `${PREFIX}/run`) return send(res, 404, failure('NOT_FOUND'));
    const parsed = RunAgentInputSchema.safeParse(body);
    if (!parsed.success) return send(res, 400, failure('INVALID_RUN_INPUT'));
    const runInput = parsed.data;
    const fingerprint = canonicalArguments(runInput);
    const known = session.runs.get(runInput.runId);
    if (known) {
      if (known.fingerprint !== fingerprint) return send(res, 409, failure('TOOL_CALL_CONFLICT'));
      return stream(res, known.events);
    }
    const vectorScenario = session.scenario === 'vector';
    const toolCount = vectorScenario ? 4 : 2;
    const completedPhase = toolCount + 1;
    if (session.phase >= completedPhase) return send(res, 409, failure('WORKFLOW_COMPLETED'));
    const receipt = session.phase > 0 ? readReceipt(runInput, session.pending) : null;
    if (session.phase > 0 && !receipt) return send(res, 409, failure('TOOL_CALL_CORRELATION_REQUIRED'));
    if (session.phase === 0 && runInput.messages.some((message) => message.role === 'tool')) return send(res, 409, failure('TOOL_CALL_CORRELATION_REQUIRED'));
    if (vectorScenario && receipt?.ok && session.pending?.name === 'import_vector_dataset')
      session.userLayerRef = receipt.data?.layer_ref;
    const vectorTools = [
      'import_vector_dataset',
      'set_vector_style',
      'fit_vector_layer',
      'set_user_layer_visibility',
    ];
    const nextTool = vectorScenario
      ? vectorTools[session.phase]
      : session.phase === 0
        ? 'locate_features'
        : 'highlight_features';
    if (session.phase < toolCount && receipt?.ok !== false && !runInput.tools.some((tool) => tool.name === nextTool))
      return send(res, 409, failure('TOOL_NOT_AVAILABLE'));
    const ids = { threadId: runInput.threadId, runId: runInput.runId };
    const events = [{ type: 'RUN_STARTED', ...ids },
      { type: 'STATE_SNAPSHOT', snapshot: { agent: { phase: session.phase }, gisObserved: {} } }];
    if (session.scenario === 'state_patch') events.push({ type: 'STATE_DELTA', delta: [{ op: 'add', path: '/gisObserved/visibleLayers', value: [] }] });
    if (session.scenario === 'broken_patch') events.push({ type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/missing/nested', value: true }] });
    if (session.scenario === 'run_error') events.push({ type: 'RUN_ERROR', message: 'Deterministic failure' });
    else {
      if (receipt) session.observed.toolResults.push({ toolCallId: session.pending.id, ...receipt });
      if (receipt?.ok === false) {
        session.phase = completedPhase;
        session.pending = null;
        events.push(...textEvents('地图操作失败，流程已停止。'));
      } else if (session.phase < toolCount) {
        if (vectorScenario) {
          const fileRef = runInput.state.gisObserved?.availableFiles?.[0]?.file_ref;
          const layerRef = session.userLayerRef;
          const argsByTool = {
            import_vector_dataset: { file_ref: fileRef },
            set_vector_style: {
              layer_ref: layerRef,
              style: { stroke: { color: '#ff0000', width: 4, opacity: 0.8 } },
            },
            fit_vector_layer: { layer_ref: layerRef },
            set_user_layer_visibility: { layer_ref: layerRef, visible: false },
          };
          const args = argsByTool[nextTool];
          if (!args || Object.values(args).some((value) => value === undefined))
            return send(res, 409, failure('VECTOR_CONTEXT_REQUIRED'));
          session.pending = { id: randomUUID(), name: nextTool, args };
        } else {
          let ref = session.pending?.ref;
          if (session.phase === 0) {
            const registered = store.register({ features: [{ type: 'Feature', layerId: 'geoserver:GX:js_ln', sourceFeatureId: 'js_ln.1',
              properties: { pipeid: 'GX001' }, geometry: { type: 'LineString', coordinates: [[104, 30], [104.001, 30.001]] },
            }], truncated: false }, toBinding(session));
            if (!registered.ok) return send(res, 500, registered);
            ref = registered.data.ref;
            session.observed.queryCount++;
          }
          session.pending = { id: randomUUID(), name: nextTool, args: { feature_ref: ref }, ref };
        }
        session.phase++;
        events.push(...toolEvents(session.pending, session.scenario === 'malformed_args'));
        if (session.scenario === 'multiple_tools') events.push(...toolEvents({ ...session.pending, id: randomUUID() }));
      } else {
        session.phase = completedPhase;
        session.pending = null;
        events.push(...textEvents('完成'));
      }
      events.push({ type: 'RUN_FINISHED', ...ids });
    }
    session.runs.set(runInput.runId, { fingerprint, events });
    session.observed.receivedRunIds.push(runInput.runId);
    session.observed.states.push(runInput.state.gisObserved);
    if (session.scenario === 'slow_run') await wait();
    if (session.cancelled) return send(res, 409, failure('SESSION_CANCELLED'));
    stream(res, events);
  }
  return {
    name: 'deterministic-agui-fixture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url, 'http://fixture.local').pathname;
        if (!path.startsWith(PREFIX + '/')) return next();
        handle(req, res, path).catch(() => send(res, 500, failure('FIXTURE_INTERNAL_ERROR')));
      });
    },
    closeBundle() {
      for (const [timer, resolve] of timers) { clearTimeout(timer); resolve(); }
      timers.clear(); store.dispose(); principals.clear(); sessions.clear();
    },
    _handle: handle,
  };
}
