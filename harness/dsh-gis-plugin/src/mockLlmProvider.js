function parseToolResult(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type !== 'tool-result' || !Array.isArray(block.content)) continue;
      const text = block.content.find((item) => item?.type === 'text')?.text;
      if (typeof text !== 'string') continue;
      try { return { callId: block.toolCallId, value: JSON.parse(text) }; }
      catch { return null; }
    }
  }
  return null;
}

function parseLatestMapContext(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue;
      const marker = 'MapContext';
      if (!block.text.includes(marker)) continue;
      const start = block.text.indexOf('{');
      if (start < 0) continue;
      try { return JSON.parse(block.text.slice(start)); }
      catch { /* keep searching */ }
    }
  }
  return null;
}

function chunksForTool(callId, name, args) {
  const json = JSON.stringify(args);
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: json },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: json } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
}

function chunksForText(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

export const name = 'gis-test-llm';
export const inject = ['llm'];

export function apply(ctx) {
  const adapter = {
    providerInfo(provider) { return { id: provider, name: provider }; },
    providerRetryPolicy() { return undefined; },
    listModels() { return Promise.resolve([{ id: 'gis-browser-test', name: 'GIS Browser Test' }]); },
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }); },
    async *stream(options) {
      const expectedTools = [
        'fit_vector_layer',
        'import_vector_dataset',
        'set_user_layer_visibility',
        'set_vector_style',
      ];
      const actualTools = (options.tools ?? []).map((tool) => tool.name).sort();
      if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
        throw new Error(`GIS_TEST_TOOL_SCOPE_MISMATCH:${JSON.stringify(actualTools)}`);
      }
      const toolResult = parseToolResult(options.messages);
      const mapContext = parseLatestMapContext(options.messages);
      let chunks;
      if (!toolResult) {
        const fileRef = mapContext?.availableFiles?.[0]?.file_ref;
        if (!fileRef) chunks = chunksForText('No browser file is available.');
        else chunks = chunksForTool('gis-import-1', 'import_vector_dataset', { file_ref: fileRef });
      } else if (toolResult.callId === 'gis-import-1') {
        chunks = chunksForTool('gis-style-1', 'set_vector_style', {
          layer_ref: toolResult.value?.data?.layer_ref,
          style: { stroke: { color: '#ff0000', width: 4, opacity: 0.8 } },
        });
      } else if (toolResult.callId === 'gis-style-1') {
        chunks = chunksForTool('gis-fit-1', 'fit_vector_layer', {
          layer_ref: toolResult.value?.data?.layer_ref ?? mapContext?.userLayers?.[0]?.layer_ref,
        });
      } else {
        chunks = chunksForText('已完成道路数据导入、红色 4px 80% 透明度样式设置，并缩放到该图层。');
      }
      for (const chunk of chunks) {
        if (options.signal?.aborted) throw new Error('aborted');
        yield chunk;
      }
    },
  };
  ctx.llm.registerAdapter(['gis-browser-test'], adapter);
}
