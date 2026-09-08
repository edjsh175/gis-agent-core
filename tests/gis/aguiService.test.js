import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeterministicAguiPlugin, PREFIX } from './agui/deterministicService.js';
import { createRunEnvelope } from '../../src/gis/integration/agui/runEnvelope.js';

const servers = [];
afterEach(async () => { while (servers.length) { const server = servers.pop(); await new Promise((resolve) => server.close(resolve)); } });
async function fixture() { const plugin = createDeterministicAguiPlugin(); const server = createServer((req, res) => { const path = new URL(req.url, 'http://127.0.0.1').pathname; if (path.startsWith(PREFIX)) plugin._handle(req, res, path); else { res.statusCode = 404; res.end(); } }); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); servers.push(server); return { plugin, base: `http://127.0.0.1:${server.address().port}` }; }
async function post(base, path, body, cookie) { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }); return { response, text: await response.text() }; }
const events = (text) => [...text.matchAll(/data: (.*)\n/g)].map((m) => JSON.parse(m[1]));
const defaultTools = [
  { name: 'locate_features', description: '定位要素', parameters: { type: 'object' } },
  { name: 'highlight_features', description: '高亮要素', parameters: { type: 'object' } },
];
const input = (binding, runId, messages, tools = defaultTools) => ({ threadId: binding.threadId, runId, messages, tools, context: [], state: {}, forwardedProps: { gisIntegration: { browserSessionId: binding.browserSessionId, workflowId: binding.workflowId } } });

describe('AG-UI run envelope', () => {
  it('preserves a legitimate backend RUN_ERROR instead of misclassifying it as protocol corruption', () => {
    const envelope = createRunEnvelope({ threadId: 'thread-1', runId: 'run-1', allowedTools: [] });
    envelope.accept({ type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
    expect(() => envelope.accept({ type: 'RUN_ERROR', message: 'MISSING_CREDENTIAL: unavailable' }))
      .toThrowError(expect.objectContaining({ code: 'AGENT_RUN_FAILED', message: 'MISSING_CREDENTIAL: unavailable' }));
  });
});

describe('deterministic AG-UI fixture service', () => {
  it('requires synthetic fixture auth and exact session binding', async () => { const { base } = await fixture(); expect((await post(base, `${PREFIX}/sessions`, {})).response.status).toBe(401); const login = await post(base, `${PREFIX}/fixture-login`, {}); const cookie = login.response.headers.get('set-cookie').split(';')[0]; const session = await post(base, `${PREFIX}/sessions`, {}, cookie); const binding = JSON.parse(session.text).data; expect(binding).not.toHaveProperty('userId'); expect((await post(base, `${PREFIX}/resolve`, { ...binding, threadId: 'other', feature_ref: { resultId: 'missing' } }, cookie)).response.status).toBe(403); });
  it('runs query, locate receipt, highlight receipt, and completion exactly once', async () => {
    const { base, plugin } = await fixture();
    const login = await post(base, `${PREFIX}/fixture-login`, {});
    const cookie = login.response.headers.get('set-cookie').split(';')[0];
    const binding = JSON.parse((await post(base, `${PREFIX}/sessions`, {}, cookie)).text).data;
    const first = await post(base, `${PREFIX}/run`, input(binding, 'run-1', [{ id: 'msg-1', role: 'user', content: '查找道路' }]), cookie);
    const firstEvents = events(first.text);
    expect(firstEvents.filter((e) => e.type === 'RUN_STARTED')).toHaveLength(1);
    expect(firstEvents.filter((e) => e.type === 'RUN_FINISHED')).toHaveLength(1);
    const call1 = firstEvents.find((e) => e.type === 'TOOL_CALL_START');
    const args1 = firstEvents.filter((e) => e.type === 'TOOL_CALL_ARGS' && e.toolCallId === call1.toolCallId).map((e) => e.delta).join('');
    const ref = JSON.parse(args1).feature_ref;
    const receipt1 = JSON.stringify({ ok: true, data: { resultId: ref.resultId }, effect: { status: 'applied' } });
    const assistant1 = { id: 'msg-2', role: 'assistant', toolCalls: [{ id: call1.toolCallId, type: 'function', function: { name: 'locate_features', arguments: JSON.stringify({ feature_ref: ref }) } }] };
    const tool1 = { id: 'msg-3', role: 'tool', toolCallId: call1.toolCallId, content: receipt1 };
    const second = await post(base, `${PREFIX}/run`, input(binding, 'run-2', [assistant1, tool1]), cookie);
    const secondEvents = events(second.text);
    const call2 = secondEvents.find((e) => e.type === 'TOOL_CALL_START');
    expect(call2.toolCallName).toBe('highlight_features');
    const receipt2 = JSON.stringify({ ok: true, data: { resultId: ref.resultId }, effect: { status: 'applied' } });
    const assistant2 = { id: 'msg-4', role: 'assistant', toolCalls: [{ id: call2.toolCallId, type: 'function', function: { name: 'highlight_features', arguments: JSON.stringify({ feature_ref: ref }) } }] };
    const tool2 = { id: 'msg-5', role: 'tool', toolCallId: call2.toolCallId, content: receipt2 };
    const third = await post(base, `${PREFIX}/run`, input(binding, 'run-3', [assistant2, tool2]), cookie);
    const thirdEvents = events(third.text);
    expect(thirdEvents.find((e) => e.type === 'TEXT_MESSAGE_CONTENT').delta).toBe('完成');
    expect(thirdEvents.filter((e) => e.type === 'RUN_FINISHED')).toHaveLength(1);
    const inspect = JSON.parse((await post(base, `${PREFIX}/inspect`, binding, cookie)).text).data;
    expect(inspect.queryCount).toBe(1);
    expect(inspect.toolResults).toHaveLength(2);
    expect((await post(base, `${PREFIX}/run`, input(binding, 'run-1', [{ id: 'msg-1', role: 'user', content: '查找道路' }]), cookie)).text).toBe(first.text);
    plugin.closeBundle();
  });
});
