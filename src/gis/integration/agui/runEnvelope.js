import { gisError } from '../../contracts.js';
import { validateToolCall } from './frontendTools.js';

/** G0 profile: one complete frontend call, committed only after clean stream end. */
export function createRunEnvelope({ threadId, runId, allowedTools }) {
  let started = false;
  let finished = false;
  let call = null;
  let eventBytes = 0;
  const fail = () => { throw gisError('PROTOCOL_ERROR'); };
  return {
    accept(event) {
      eventBytes += JSON.stringify(event).length;
      if (eventBytes > 2_000_000 || finished) fail();
      if (event.type === 'RUN_STARTED') {
        if (started || event.threadId !== threadId || event.runId !== runId) fail();
        started = true;
        return;
      }
      if (!started) fail();
      switch (event.type) {
        case 'RUN_ERROR': throw gisError('AGENT_RUN_FAILED', event.message || 'Agent run failed.');
        case 'TOOL_CALL_START':
          if (call || !allowedTools.includes(event.toolCallName) || !event.toolCallId) fail();
          call = { toolCallId: event.toolCallId, name: event.toolCallName, rawArguments: '', ended: false };
          break;
        case 'TOOL_CALL_ARGS':
          if (!call || call.ended || call.toolCallId !== event.toolCallId || typeof event.delta !== 'string') fail();
          call.rawArguments += event.delta;
          if (call.rawArguments.length > 16384) fail();
          break;
        case 'TOOL_CALL_END':
          if (!call || call.ended || call.toolCallId !== event.toolCallId) fail();
          call.ended = true;
          break;
        case 'RUN_FINISHED':
          if (event.threadId !== threadId || event.runId !== runId || (call && !call.ended) || event.outcome === 'interrupt') fail();
          finished = true;
          break;
        case 'STATE_SNAPSHOT': case 'STATE_DELTA':
        case 'TEXT_MESSAGE_START': case 'TEXT_MESSAGE_CONTENT': case 'TEXT_MESSAGE_END':
          break;
        case 'CUSTOM':
          if (event.name !== 'gis.progress' || !['thinking', 'responding'].includes(event.value?.phase)) fail();
          break;
        default: fail();
      }
    },
    complete() {
      if (!started || !finished) fail();
      if (!call) return null;
      let args;
      try { args = JSON.parse(call.rawArguments); } catch { fail(); }
      validateToolCall(call.name, args);
      return { runId, toolCallId: call.toolCallId, name: call.name, args, rawArguments: call.rawArguments };
    },
  };
}
