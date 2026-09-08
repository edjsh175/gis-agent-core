import { randomUUID } from 'node:crypto';
import { RunAgentInputSchema, EventSchemas } from '@ag-ui/core';

export const name = 'gis-agui-bridge';
export const inject = ['webServer', 'agents', 'gisFrontendPending', 'gisAgentPolicy'];

const PREFIX = '/__gis-harness';
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

function latestAssistantText(agent) {
  for (let index = agent.session.events.length - 1; index >= 0; index--) {
    const event = agent.session.events[index];
    if (event.type !== 'assistant/message') continue;
    const blocks = event.data.message?.content;
    if (!Array.isArray(blocks)) return '';
    return blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('');
  }
  return '';
}

function latestTurnEndReason(agent) {
  for (let index = agent.session.events.length - 1; index >= 0; index--) {
    const event = agent.session.events[index];
    if (event.type === 'turn/end') return event.data?.reason ?? null;
  }
  return null;
}

function textEvents(text) {
  if (!text) return [];
  const messageId = randomUUID();
  return [
    { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text },
    { type: 'TEXT_MESSAGE_END', messageId },
  ];
}

function toolEvents(request) {
  const raw = JSON.stringify(request.arguments);
  return [
    { type: 'TOOL_CALL_START', toolCallId: request.callId, toolCallName: request.operation },
    { type: 'TOOL_CALL_ARGS', toolCallId: request.callId, delta: raw },
    { type: 'TOOL_CALL_END', toolCallId: request.callId },
  ];
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
    ]);
  } finally {
    unsubscribe();
  }
}

export function apply(ctx, config = {}) {
  const sessions = new Map();
  const leaseMs = Number.isFinite(config.leaseMs) && config.leaseMs > 0
    ? config.leaseMs
    : null;
  if (leaseMs === null) {
    throw new Error('gis-agui-bridge requires a positive finite config.leaseMs');
  }
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
    if (!session || session.threadId !== threadId || session.workflowId !== workflowId) {
      return { error: failure('SESSION_BINDING_FORBIDDEN') };
    }
    if (!allowCancelled && session.cancelled) return { error: failure('SESSION_CANCELLED') };
    return { session };
  };

  async function handle(req, res) {
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) {
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
        configVersion: 'harness-h2',
        leaseExpiresAt: Date.now() + leaseMs,
      };
      sessions.set(binding.browserSessionId, {
        ...binding,
        handle,
        cancelled: false,
        started: false,
        runs: new Map(),
      });
      sendJson(res, 200, { ok: true, data: binding });
      return;
    }

    const auth = authorize(body, pathname === `${PREFIX}/cancel`);
    if (auth.error) {
      sendJson(res, auth.error.error.code === 'SESSION_CANCELLED' ? 409 : 403, auth.error);
      return;
    }
    const session = auth.session;

    if (pathname === `${PREFIX}/cancel`) {
      session.cancelled = true;
      session.handle.agent.cancel('23dmaps browser workflow cancelled');
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

    const pending = ctx.gisFrontendPending.list(session.threadId)[0];
    if (pending) {
      const receipt = findReceipt(input, pending);
      if (!receipt) {
        sendJson(res, 409, failure('TOOL_CALL_CORRELATION_REQUIRED'));
        return;
      }
      const accepted = ctx.gisFrontendPending.resolve(pending.requestId, {
        ...receipt,
        ...(input.state?.gisObserved && typeof input.state.gisObserved === 'object' && !Array.isArray(input.state.gisObserved)
          ? { mapContext: input.state.gisObserved }
          : {}),
      });
      if (!accepted.accepted) {
        sendJson(res, 409, failure('TOOL_CALL_NOT_PENDING'));
        return;
      }
    } else if (!session.started) {
      const user = input.messages.find((message) => message.role === 'user');
      if (!user || typeof user.content !== 'string' || user.content.length === 0) {
        sendJson(res, 400, failure('USER_MESSAGE_REQUIRED'));
        return;
      }
      const mapContext = input.state?.gisObserved;
      if (mapContext && typeof mapContext === 'object' && !Array.isArray(mapContext)) {
        session.handle.agent.inject(makePluginContext(`Current 23dmaps MapContext:\n${JSON.stringify(mapContext)}`));
      }
      session.started = true;
      session.handle.agent.followup(makeUserMessage(user.content));
    } else {
      sendJson(res, 409, failure('TOOL_CALL_CORRELATION_REQUIRED'));
      return;
    }

    const boundary = await waitForBoundary(ctx, session);
    if (session.cancelled) {
      sendJson(res, 409, failure('SESSION_CANCELLED'));
      return;
    }

    const ids = { threadId: input.threadId, runId: input.runId };
    const events = [
      { type: 'RUN_STARTED', ...ids },
      { type: 'STATE_SNAPSHOT', snapshot: { gisObserved: input.state?.gisObserved ?? {} } },
    ];
    if (boundary.kind === 'pending') {
      events.push(...toolEvents(boundary.request));
      events.push({ type: 'RUN_FINISHED', ...ids });
    } else {
      const reason = latestTurnEndReason(session.handle.agent);
      if (reason?.kind === 'error') {
        const error = reason.error;
        const code = typeof error?.code === 'string' && error.code ? error.code : 'HARNESS_TURN_FAILED';
        const message = typeof error?.message === 'string' && error.message ? error.message : 'Harness agent turn failed.';
        events.push({ type: 'RUN_ERROR', message: `${code}: ${message}` });
      } else {
        events.push(...textEvents(latestAssistantText(session.handle.agent)));
        events.push({ type: 'RUN_FINISHED', ...ids });
      }
    }
    session.runs.set(input.runId, { fingerprint, events });
    sendEvents(res, events);
  }

  const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: handle });
  ctx.effect(() => async () => {
    disposeRoute();
    for (const session of sessions.values()) {
      session.cancelled = true;
      await session.handle.dispose();
    }
    sessions.clear();
  }, 'gis AG-UI bridge lifecycle');
}
