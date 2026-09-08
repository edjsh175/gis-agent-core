import { randomUUID } from 'node:crypto';
import { RunAgentInputSchema, EventSchemas } from '@ag-ui/core';
import { createAguiEventStream } from './aguiEventStream.js';

export const name = 'gis-agui-bridge';
export const inject = ['webServer', 'agents', 'gisFrontendPending', 'gisAgentPolicy'];

const PREFIX = '/__gis-harness';
const GIS_BRIDGE_CONFIG_VERSION = 'harness-gis-v1';
const jsonHeaders = { 'Content-Type': 'application/json' };
const failure = (code, message = code) => ({ ok: false, error: { code, message } });

function sendJson(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
}

function sendEvents(res, events) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.end(events.map((event) => `data: ${JSON.stringify(EventSchemas.parse(event))}\n\n`).join(''));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error('REQUEST_TOO_LARGE'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function makeUserMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  };
}

function makePluginContext(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: '23dmaps-map-context' },
  };
}

function findReceipt(input, pending) {
  const message = [...input.messages].reverse().find((item) => item.role === 'tool' && item.toolCallId === pending.callId);
  if (!message || typeof message.content !== 'string') return null;
  try {
    const result = JSON.parse(message.content);
    return result && typeof result === 'object' && typeof result.ok === 'boolean' ? result : null;
  } catch {
    return null;
  }
}

async function waitForBoundary(ctx, session) {
  const current = ctx.gisFrontendPending.list(session.threadId)[0];
  if (current) return { kind: 'pending', request: current };

  let unsubscribe = () => {};
  let onAbort;
  const requested = new Promise((resolve) => {
    unsubscribe = ctx.gisFrontendPending.subscribe((event) => {
      if (event.type === 'requested' && event.request.sessionId === session.threadId) {
        resolve({ kind: 'pending', request: event.request });
      }
    });
  });
  try {
    return await Promise.race([
      requested,
      session.handle.agent.whenIdle().then(() => ({ kind: 'idle' })),
      new Promise((resolve) => {
        if (session.signal.aborted) resolve({ kind: 'terminated' });
        else {
          onAbort = () => resolve({ kind: 'terminated' });
          session.signal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    unsubscribe();
    if (onAbort) session.signal.removeEventListener('abort', onAbort);
  }
}

export function apply(ctx, config = {}) {
  const sessions = new Map();
  const terminalBindings = new Map();
  const disposals = new Set();
  const TERMINAL_BINDING_LIMIT = 128;
  const leaseMs = Number.isFinite(config.leaseMs) && config.leaseMs > 0
    ? config.leaseMs
    : null;
  if (leaseMs === null) {
    throw new Error('gis-agui-bridge requires a positive finite config.leaseMs');
  }
  const rememberTerminal = (session, status) => {
    terminalBindings.delete(session.browserSessionId);
    terminalBindings.set(session.browserSessionId, {
      threadId: session.threadId,
      workflowId: session.workflowId,
      status,
    });
    while (terminalBindings.size > TERMINAL_BINDING_LIMIT) {
      terminalBindings.delete(terminalBindings.keys().next().value);
    }
  };
  const terminateSession = (session, status) => {
    if (session.terminationPromise) return session.terminationPromise;
    if (session.expiryTimer) {
      clearTimeout(session.expiryTimer);
      session.expiryTimer = null;
    }
    session.cancelled = status === 'cancelled';
    session.terminated = true;
    session.runs.clear();
    session.controller.abort();
    sessions.delete(session.browserSessionId);
    rememberTerminal(session, status);
    try { session.handle.agent.cancel(`23dmaps browser workflow ${status}`); } catch { /* disposal remains authoritative */ }
    session.terminationPromise = Promise.resolve()
      .then(() => session.handle.dispose())
      .catch(() => undefined);
    disposals.add(session.terminationPromise);
    session.terminationPromise.finally(() => disposals.delete(session.terminationPromise));
    return session.terminationPromise;
  };
  const scheduleExpiry = (session) => {
    session.expiryTimer = setTimeout(() => { void terminateSession(session, 'expired'); }, Math.max(0, session.leaseExpiresAt - Date.now()));
    session.expiryTimer.unref?.();
  };
  const resolveAgentOptions = () => {
    if (typeof config.provider === 'string' && config.provider && typeof config.model === 'string' && config.model) {
      return { provider: config.provider, model: config.model };
    }
    const selection = ctx.get?.('agentDefaultModel')?.currentSelection?.();
    if (selection && typeof selection.provider === 'string' && typeof selection.model === 'string') {
      return { provider: selection.provider, model: selection.model };
    }
    return null;
  };

  const authorize = (body, allowCancelled = false) => {
    const browserSessionId = body?.browserSessionId ?? body?.forwardedProps?.gisIntegration?.browserSessionId;
    const workflowId = body?.workflowId ?? body?.forwardedProps?.gisIntegration?.workflowId;
    const threadId = body?.threadId;
    const session = sessions.get(browserSessionId);
    if (!session) {
      const terminal = terminalBindings.get(browserSessionId);
      if (terminal && terminal.threadId === threadId && terminal.workflowId === workflowId) {
        if (allowCancelled && terminal.status === 'cancelled') return { terminal };
        return { error: failure(terminal.status === 'expired' ? 'SESSION_EXPIRED' : 'SESSION_CANCELLED') };
      }
      return { error: failure('SESSION_BINDING_FORBIDDEN') };
    }
    if (session.threadId !== threadId || session.workflowId !== workflowId) {
      return { error: failure('SESSION_BINDING_FORBIDDEN') };
    }
    if (Date.now() >= session.leaseExpiresAt) {
      void terminateSession(session, 'expired');
      return { error: failure('SESSION_EXPIRED') };
    }
    if (!allowCancelled && session.cancelled) return { error: failure('SESSION_CANCELLED') };
    return { session };
  };

  async function handle(req, res) {
    if (req.headers.origin) {
      try {
        const originUrl = new URL(req.headers.origin);
        const originHost = originUrl.host;
        const forwardHost = req.headers['x-forwarded-host'];
        const host = req.headers.host;
        const isLoopback = (hostname) => ['localhost', '127.0.0.1', '::1'].includes(hostname);
        const isAllowedLoopback = isLoopback(originUrl.hostname) && (isLoopback(host?.split(':')[0]) || isLoopback(forwardHost?.split(':')[0]));
        if (originHost !== host && originHost !== forwardHost && !isAllowedLoopback) {
          sendJson(res, 403, failure('ORIGIN_FORBIDDEN'));
          return;
        }
      } catch {
        sendJson(res, 403, failure('ORIGIN_FORBIDDEN'));
        return;
      }
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, failure('METHOD_NOT_ALLOWED'));
      return;
    }

    let body;
    try { body = await readJson(req); }
    catch {
      sendJson(res, 400, failure('INVALID_JSON'));
      return;
    }

    const pathname = new URL(req.url, 'http://gis.local').pathname;
    if (pathname === `${PREFIX}/sessions`) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
        sendJson(res, 400, failure('INVALID_ARGUMENT'));
        return;
      }
      const threadId = randomUUID();
      const agentOptions = resolveAgentOptions();
      if (!agentOptions) {
        sendJson(res, 500, failure('AGENT_MODEL_REQUIRED', 'GIS AG-UI bridge requires a configured Harness default model.'));
        return;
      }
      let handle;
      try {
        handle = await ctx.agents.create({
          sessionId: threadId,
          agentOptions,
          setup: (agentCtx) => ctx.gisAgentPolicy.setup(agentCtx),
        });
      }
      catch (error) {
        sendJson(res, 500, failure('AGENT_CREATE_FAILED', error instanceof Error ? error.message : String(error)));
        return;
      }
      const binding = {
        browserSessionId: randomUUID(),
        threadId,
        workflowId: randomUUID(),
        configVersion: GIS_BRIDGE_CONFIG_VERSION,
        leaseExpiresAt: Date.now() + leaseMs,
      };
      sessions.set(binding.browserSessionId, {
        ...binding,
        handle,
        cancelled: false,
        runs: new Map(),
        activeRuns: new Map(),
        controller: new AbortController(),
        terminationPromise: null,
        expiryTimer: null,
      });
      sessions.get(binding.browserSessionId).signal = sessions.get(binding.browserSessionId).controller.signal;
      scheduleExpiry(sessions.get(binding.browserSessionId));
      sendJson(res, 200, { ok: true, data: binding });
      return;
    }

    const auth = authorize(body, pathname === `${PREFIX}/cancel`);
    if (auth.error) {
      const code = auth.error.error.code;
      sendJson(res, code === 'SESSION_CANCELLED' ? 409 : code === 'SESSION_EXPIRED' ? 410 : 403, auth.error);
      return;
    }
    if (auth.terminal) {
      if (pathname === `${PREFIX}/cancel` && auth.terminal.status === 'cancelled') {
        sendJson(res, 200, { ok: true, data: { cancelled: true } });
      } else {
        sendJson(res, 410, failure('SESSION_EXPIRED'));
      }
      return;
    }
    const session = auth.session;

    if (pathname === `${PREFIX}/cancel`) {
      await terminateSession(session, 'cancelled');
      sendJson(res, 200, { ok: true, data: { cancelled: true } });
      return;
    }

    if (pathname === `${PREFIX}/resolve`) {
      sendJson(res, 400, failure('UNSUPPORTED_CAPABILITY', 'Feature reference resolution is not part of the H1 User Vector bridge.'));
      return;
    }

    if (pathname !== `${PREFIX}/run`) {
      sendJson(res, 404, failure('NOT_FOUND'));
      return;
    }

    const parsed = RunAgentInputSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, failure('INVALID_RUN_INPUT'));
      return;
    }
    const input = parsed.data;
    const fingerprint = JSON.stringify(input);
    const known = session.runs.get(input.runId);
    if (known) {
      if (known.fingerprint !== fingerprint) {
        sendJson(res, 409, failure('RUN_CONFLICT'));
        return;
      }
      sendEvents(res, known.events);
      return;
    }
    const activeFingerprint = session.activeRuns.get(input.runId);
    if (activeFingerprint) {
      sendJson(res, 409, failure(activeFingerprint === fingerprint ? 'RUN_IN_PROGRESS' : 'RUN_CONFLICT'));
      return;
    }
    if (session.activeRuns.size) {
      sendJson(res, 409, failure('RUN_IN_PROGRESS'));
      return;
    }
    session.activeRuns.set(input.runId, fingerprint);
    let stream;
    try {
      const pending = ctx.gisFrontendPending.list(session.threadId)[0];
    if (pending) {
      const receipt = findReceipt(input, pending);
      if (!receipt) {
        sendJson(res, 409, failure('TOOL_CALL_CORRELATION_REQUIRED'));
        return;
      }
      stream = createAguiEventStream({ ctx, session: session.handle.agent.session, input, res });
      const accepted = ctx.gisFrontendPending.resolve(pending.requestId, {
        ...receipt,
        ...(input.state?.gisObserved && typeof input.state.gisObserved === 'object' && !Array.isArray(input.state.gisObserved)
          ? { mapContext: input.state.gisObserved }
          : {}),
      });
      if (!accepted.accepted) {
        stream.finish({ kind: 'closed', error: 'TOOL_CALL_NOT_PENDING' });
        res.end();
        return;
      }
    } else {
      const user = [...input.messages].reverse().find((message) => message.role === 'user' && typeof message.content === 'string' && message.content.length > 0);
      if (!user) {
        sendJson(res, 400, failure('USER_MESSAGE_REQUIRED'));
        return;
      }
      stream = createAguiEventStream({ ctx, session: session.handle.agent.session, input, res });
      const mapContext = input.state?.gisObserved;
      if (mapContext && typeof mapContext === 'object' && !Array.isArray(mapContext)) {
        session.handle.agent.inject(makePluginContext(`Current 23dmaps MapContext:\n${JSON.stringify(mapContext)}`));
      }
      session.handle.agent.followup(makeUserMessage(user.content));
    }

    const boundary = await waitForBoundary(ctx, session);
    if (session.terminated) {
      stream.finish({ kind: 'closed', error: session.cancelled ? 'SESSION_CANCELLED' : 'SESSION_EXPIRED' });
      res.end();
      return;
    }
      const events = stream.finish(boundary);
      session.runs.set(input.runId, { fingerprint, events });
      res.end();
    } catch (error) {
      if (stream) {
        const events = stream.finish({ kind: 'closed', error });
        if (!session.terminated) session.runs.set(input.runId, { fingerprint, events });
        if (!res.destroyed && !res.writableEnded) res.end();
      } else sendJson(res, 500, failure('HARNESS_RUN_FAILED', error.message));
    } finally {
      stream?.dispose();
      session.activeRuns.delete(input.runId);
    }
  }

  const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: handle });
  ctx.effect(() => async () => {
    disposeRoute();
    for (const session of sessions.values()) {
      await terminateSession(session, 'cancelled');
    }
    await Promise.all([...disposals]);
    sessions.clear();
    terminalBindings.clear();
  }, 'gis AG-UI bridge lifecycle');
}
