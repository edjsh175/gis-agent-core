import { HttpAgent } from '@ag-ui/client';
import jsonPatch from 'fast-json-patch';
import { gisError } from '../../contracts.js';
import { createRunEnvelope } from './runEnvelope.js';

/** SDK owns SSE decoding. Its state is a protocol copy, never application state. */
export function createAguiHttpTransport({ url, fetchImpl = globalThis.fetch }) {
  return {
    async run(input, { signal }) {
      if (signal.aborted) throw gisError('WORKFLOW_CANCELLED');
      const envelope = createRunEnvelope({ ...input, allowedTools: input.tools.map((tool) => tool.name) });
      const agent = new HttpAgent({ url, threadId: input.threadId,
        initialMessages: structuredClone(input.messages), initialState: structuredClone(input.state),
        fetch: (target, init) => fetchImpl(target, { ...init, credentials: 'same-origin' }),
      });
      let protocolError;
      const abort = () => agent.abortRun();
      signal.addEventListener('abort', abort, { once: true });
      try {
        await agent.runAgent({ runId: input.runId, tools: input.tools, context: [], forwardedProps: input.forwardedProps }, {
          onEvent({ event, state }) {
            try {
              envelope.accept(event);
              // SDK 0.0.59 catches patch failures and continues. This profile must stop.
              if (event.type === 'STATE_DELTA') jsonPatch.applyPatch(structuredClone(state), structuredClone(event.delta), true, false);
              if (event.type === 'STATE_SNAPSHOT' && (!event.snapshot || typeof event.snapshot !== 'object' || Array.isArray(event.snapshot)))
                throw gisError('PROTOCOL_ERROR');
            } catch (error) {
              protocolError = error.code ? error : gisError('PROTOCOL_ERROR', error.message);
              abort();
              return { stopPropagation: true };
            }
          },
        });
        if (protocolError) throw protocolError;
        if (signal.aborted) throw gisError('WORKFLOW_CANCELLED');
        return { call: envelope.complete(), messages: structuredClone(agent.messages), state: structuredClone(agent.state) };
      } catch (error) {
        if (protocolError) throw protocolError;
        if (signal.aborted) throw gisError('WORKFLOW_CANCELLED');
        throw error.code ? error : gisError('PROTOCOL_ERROR', error.message);
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
  };
}
