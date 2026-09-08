import { describe, expect, it, vi } from 'vitest';
import { createAguiEventStream } from '../../harness/dsh-gis-plugin/src/aguiEventStream.js';

function fixture() {
  const listeners = [];
  const res = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    writeHead: vi.fn(() => { res.headersSent = true; }),
    flushHeaders: vi.fn(),
    write: vi.fn(),
  };
  const session = { id: 'thread-1', events: [] };
  const ctx = { on: vi.fn((_name, listener) => { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); }) };
  const stream = createAguiEventStream({ ctx, session, input: { threadId: 'thread-1', runId: 'run-1', state: { gisObserved: {} } }, res });
  return { listeners, res, session, stream };
}

describe('AG-UI Harness event stream', () => {
  it('flushes the run baseline immediately and maps text/reasoning without leaking reasoning', () => {
    const { listeners, res, session, stream } = fixture();
    expect(res.writeHead).toHaveBeenCalledOnce();
    expect(res.flushHeaders).toHaveBeenCalledOnce();
    listeners[0](session, { type: 'step/start', data: { turn: 1, step: 1 } });
    listeners[0](session, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'secret' } } });
    listeners[0](session, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'block-start', blockType: 'text' } } });
    listeners[0](session, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '完成' } } });
    listeners[0](session, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'block-end', block: { type: 'text', text: '完成' } } } });
    stream.finish({ kind: 'idle' });
    const output = res.write.mock.calls.map(([value]) => value).join('');
    expect(output).toContain('"phase":"thinking"');
    expect(output).not.toContain('secret');
    expect((output.match(/TEXT_MESSAGE_START/g) ?? [])).toHaveLength(1);
    expect(output).toContain('RUN_FINISHED');
  });

  it('ignores other sessions and emits pending tool calls before finish', () => {
    const { listeners, res, session, stream } = fixture();
    listeners[0]({ id: 'other' }, { type: 'tool/call', data: { callId: 'x', name: 'bad', arguments: '{}' } });
    stream.finish({ kind: 'pending', request: { callId: 'call-1', operation: 'import_vector_dataset', arguments: { file_ref: 'f' } } });
    const output = res.write.mock.calls.map(([value]) => value).join('');
    expect(output).not.toContain('"toolCallId":"x"');
    expect(output).toContain('call-1');
    stream.dispose();
    expect(listeners).toHaveLength(0);
    expect(session.id).toBe('thread-1');
  });
});

