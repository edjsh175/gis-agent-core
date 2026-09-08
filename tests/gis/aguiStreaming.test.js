import { describe, expect, it } from 'vitest';
import { createAguiHttpTransport } from '../../src/gis/integration/agui/httpTransport.js';

const frame = (event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

describe('AG-UI realtime presentation', () => {
  it('publishes incremental text before the run finishes without committing a tool', async () => {
    let writer;
    const body = new ReadableStream({ start(controller) { writer = controller; } });
    const transport = createAguiHttpTransport({ url: '/test', fetchImpl: async () => new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    }) });
    let sawText;
    const textArrived = new Promise((resolve) => { sawText = resolve; });
    const updates = [];
    let finished = false;
    const pending = transport.run({ threadId: 'thread', runId: 'run', messages: [], tools: [], state: {} }, {
      signal: new AbortController().signal,
      onProgress(update) {
        updates.push(update);
        if (update.messages?.some((message) => message.content === '正在')) sawText();
      },
    }).then((result) => { finished = true; return result; });
    writer.enqueue(frame({ type: 'RUN_STARTED', threadId: 'thread', runId: 'run' }));
    writer.enqueue(frame({ type: 'CUSTOM', name: 'gis.progress', value: { phase: 'responding' } }));
    writer.enqueue(frame({ type: 'TEXT_MESSAGE_START', messageId: 'message', role: 'assistant' }));
    writer.enqueue(frame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'message', delta: '正在' }));
    await textArrived;
    expect(finished).toBe(false);
    expect(updates).toContainEqual({ progress: { phase: 'responding' } });
    writer.enqueue(frame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'message', delta: '回复' }));
    writer.enqueue(frame({ type: 'TEXT_MESSAGE_END', messageId: 'message' }));
    writer.enqueue(frame({ type: 'RUN_FINISHED', threadId: 'thread', runId: 'run' }));
    writer.close();
    const result = await pending;
    expect(result.call).toBe(null);
    expect(result.messages[0].content).toBe('正在回复');
  });
});
