import { randomUUID } from 'node:crypto';
import { EventSchemas } from '@ag-ui/core';

const JSON_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

function frame(event) {
  return `data: ${JSON.stringify(EventSchemas.parse(event))}\n\n`;
}

function textFromMessage(message) {
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function latestNewAssistantText(events, startIndex) {
  for (let index = events.length - 1; index >= startIndex; index -= 1) {
    const event = events[index];
    if (event?.type !== 'assistant/message') continue;
    return textFromMessage(event.data?.message);
  }
  return '';
}

function toolEvent(request) {
  const raw = JSON.stringify(request.arguments ?? {});
  return [
    { type: 'TOOL_CALL_START', toolCallId: request.callId, toolCallName: request.operation },
    { type: 'TOOL_CALL_ARGS', toolCallId: request.callId, delta: raw },
    { type: 'TOOL_CALL_END', toolCallId: request.callId },
  ];
}

/** Convert one live Harness session event feed into replayable AG-UI SSE. */
export function createAguiEventStream({ ctx, session, input, res }) {
  const ids = { threadId: input.threadId, runId: input.runId };
  const events = [];
  const runStartIndex = session.events.length;
  const textMessages = new Map();
  const progressPhases = new Set();
  let disposed = false;
  let finished = false;

  const write = (event) => {
    if (disposed) return;
    const parsed = EventSchemas.parse(event);
    events.push(parsed);
    if (res.destroyed || res.writableEnded) return;
    res.write(frame(parsed));
  };

  if (!res.headersSent) res.writeHead(200, JSON_HEADERS);
  res.flushHeaders?.();
  write({ type: 'RUN_STARTED', ...ids });
  write({ type: 'STATE_SNAPSHOT', snapshot: { gisObserved: input.state?.gisObserved ?? {} } });

  const emitProgress = (phase) => {
    if (progressPhases.has(phase)) return;
    progressPhases.add(phase);
    write({ type: 'CUSTOM', name: 'gis.progress', value: { phase } });
  };

  const onSessionEvent = (source, event) => {
    if (disposed || finished || source !== session && source?.id !== session.id) return;
    if (event.type === 'step/start') {
      emitProgress('thinking');
      return;
    }
    // Only a validated frontend pending request may become an executable tool call.
    if (event.type !== 'assistant/chunk') return;
    const chunk = event.data?.chunk;
    const key = `${event.data?.turn ?? 0}:${event.data?.step ?? 0}:${chunk?.index ?? 0}`;
    if (chunk?.type === 'reasoning-delta') {
      emitProgress('thinking');
      return;
    }
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
      emitProgress('responding');
      let messageId = textMessages.get(key);
      if (!messageId) {
        messageId = randomUUID();
        textMessages.set(key, messageId);
        write({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
      }
      write({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: chunk.text });
      return;
    }
    if (chunk?.type === 'block-end' && chunk.block?.type === 'text') {
      const messageId = textMessages.get(key);
      if (!messageId) return;
      write({ type: 'TEXT_MESSAGE_END', messageId });
      textMessages.delete(key);
    }
  };

  const unsubscribe = ctx.on('session/event', onSessionEvent, { global: true });

  const finish = (boundary) => {
    if (finished) return events;
    finished = true;
    for (const messageId of textMessages.values()) write({ type: 'TEXT_MESSAGE_END', messageId });
    textMessages.clear();
    if (boundary?.kind === 'pending') {
      for (const event of toolEvent(boundary.request)) write(event);
      write({ type: 'RUN_FINISHED', ...ids });
    } else if (boundary?.kind === 'closed') {
      write({ type: 'RUN_ERROR', message: boundary.error instanceof Error ? boundary.error.message : String(boundary.error ?? 'GIS session closed') });
    } else {
      const turnEnd = session.events.slice(runStartIndex).findLast((event) => event.type === 'turn/end');
      if (turnEnd?.data?.reason?.kind === 'error') {
        const error = turnEnd.data.reason.error;
        write({ type: 'RUN_ERROR', message: `${error?.code || 'HARNESS_TURN_FAILED'}: ${error?.message || 'Harness agent turn failed.'}` });
        return events;
      }
      const fallback = latestNewAssistantText(session.events, runStartIndex);
      if (fallback && events.every((event) => event.type !== 'TEXT_MESSAGE_CONTENT')) {
        const messageId = randomUUID();
        write({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
        write({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: fallback });
        write({ type: 'TEXT_MESSAGE_END', messageId });
      }
      write({ type: 'RUN_FINISHED', ...ids });
    }
    return events;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
  };

  return { events, finish, dispose };
}
