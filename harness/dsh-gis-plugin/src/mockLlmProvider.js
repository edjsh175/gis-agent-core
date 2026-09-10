function parseToolResult(messages) {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.source?.kind === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  for (let index = messages.length - 1; index > latestUserIndex; index--) {
    const message = messages[index];
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type !== 'tool-result' || !Array.isArray(block.content))
        continue;
      const text = block.content.find((item) => item?.type === 'text')?.text;
      if (typeof text !== 'string') continue;
      try {
        return { callId: block.toolCallId, value: JSON.parse(text) };
      } catch {
        return null;
      }
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
      try {
        return JSON.parse(block.text.slice(start));
      } catch {
        /* keep searching */
      }
    }
  }
  return null;
}

function chunksForTool(callId, name, args) {
  const json = JSON.stringify(args);
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'tool-call-delta',
      index: 0,
      id: callId,
      name,
      argumentsDelta: json,
    },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name, arguments: json },
    },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.source?.kind !== 'user' || !Array.isArray(message.content))
      continue;
    const text = message.content
      .filter(
        (block) => block?.type === 'text' && typeof block.text === 'string'
      )
      .map((block) => block.text)
      .join('');
    if (text) return text;
  }
  return '';
}

function matchingCards(cards, userText) {
  const exact = cards.filter(
    (card) => card.title && userText.includes(card.title)
  );
  return exact.length
    ? exact
    : cards.filter((card) => /管线/.test(card.title || ''));
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
    providerInfo(provider) {
      return { id: provider, name: provider };
    },
    providerRetryPolicy() {
      return undefined;
    },
    listModels() {
      return Promise.resolve([
        { id: 'gis-browser-test', name: 'GIS Browser Test' },
      ]);
    },
    resolveModel(provider, model) {
      return Promise.resolve({ provider, id: model, name: model });
    },
    async *stream(options) {
      const expectedTools = [
        'archive_business_card',
        'delete_business_card',
        'fit_vector_layer',
        'get_pipeline_statistics',
        'import_vector_dataset',
        'list_business_cards',
        'publish_business_card',
        'refresh_business_card',
        'set_user_layer_visibility',
        'set_vector_style',
        'update_business_card',
      ];
      const actualTools = (options.tools ?? []).map((tool) => tool.name).sort();
      if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
        throw new Error(
          `GIS_TEST_TOOL_SCOPE_MISMATCH:${JSON.stringify(actualTools)}`
        );
      }
      const toolResult = parseToolResult(options.messages);
      const mapContext = parseLatestMapContext(options.messages);
      const userText = latestUserText(options.messages);
      const businessScenario = /统计|概览卡片|业务卡片/.test(userText);
      const archiveScenario =
        /归档|收起|下架/.test(userText) && /卡片|管线/.test(userText);
      const deleteScenario =
        /永久删除|彻底删除|删除/.test(userText) && /卡片|管线/.test(userText);
      const updateScenario =
        /改|修改|换成|增加|重排/.test(userText) && /卡片|管线/.test(userText);
      const refreshScenario =
        /刷新/.test(userText) && /卡片|管线/.test(userText);
      let chunks;
      if ((archiveScenario || deleteScenario) && !toolResult) {
        chunks = chunksForTool(
          'business-lifecycle-list-1',
          'list_business_cards',
          {}
        );
      } else if (
        (archiveScenario || deleteScenario) &&
        toolResult?.callId === 'business-lifecycle-list-1'
      ) {
        const cards = toolResult.value?.data?.cards ?? [];
        const candidates = matchingCards(cards, userText);
        if (candidates.length !== 1) {
          chunks = chunksForText(
            candidates.length
              ? '发现多张同名管线业务概览卡片，请明确 cardId。'
              : '没有找到明确的管线业务概览卡片，请提供 cardId。'
          );
        } else {
          const card = candidates[0];
          const name = deleteScenario
            ? 'delete_business_card'
            : 'archive_business_card';
          chunks = chunksForTool('business-lifecycle-1', name, {
            cardId: card.cardId,
            expectedRevision: card.revision,
          });
        }
      } else if (
        (archiveScenario || deleteScenario) &&
        toolResult?.callId === 'business-lifecycle-1'
      ) {
        const applied =
          toolResult.value?.data?.durable === true &&
          toolResult.value?.data?.removedFromView === true &&
          toolResult.value?.effect?.status === 'applied';
        chunks = chunksForText(
          applied
            ? deleteScenario
              ? '已永久删除该业务卡片并从当前页面移除。'
              : '已归档该业务卡片并从当前页面移除。'
            : '业务卡片生命周期操作未能完整完成。'
        );
      } else if (updateScenario && !toolResult) {
        chunks = chunksForTool(
          'business-update-list-1',
          'list_business_cards',
          {}
        );
      } else if (
        updateScenario &&
        toolResult?.callId === 'business-update-list-1'
      ) {
        const cards = toolResult.value?.data?.cards ?? [];
        const candidates = matchingCards(cards, userText);
        if (candidates.length !== 1) {
          chunks = chunksForText(
            candidates.length
              ? '发现多张同名管线业务概览卡片，请明确要修改的 cardId。'
              : '没有找到明确的管线业务概览卡片，请先创建或提供 cardId。'
          );
        } else {
          const card = candidates[0];
          const spec = JSON.parse(JSON.stringify(card.spec));
          spec.description = '已按用户要求调整展示结构。';
          spec.layout = { type: 'grid', columns: 2 };
          spec.blocks = spec.blocks.filter((block) => block.type !== 'table');
          const chart = spec.blocks.find((block) => block.type === 'chart');
          if (chart) chart.chartType = 'pie';
          chunks = chunksForTool('business-update-1', 'update_business_card', {
            cardId: card.cardId,
            expectedRevision: card.revision,
            spec,
          });
        }
      } else if (updateScenario && toolResult?.callId === 'business-update-1') {
        const applied =
          toolResult.value?.data?.durable === true &&
          toolResult.value?.data?.visible === true &&
          toolResult.value?.effect?.status === 'applied';
        const durable = toolResult.value?.data?.durable === true;
        chunks = chunksForText(
          applied
            ? '已修改并更新当前页面。'
            : durable
              ? '卡片修改已保存，但当前页面未能展示。'
              : '卡片修改失败，未保存。'
        );
      } else if (refreshScenario && !toolResult) {
        chunks = chunksForTool('business-list-1', 'list_business_cards', {});
      } else if (refreshScenario && toolResult?.callId === 'business-list-1') {
        const cards = toolResult.value?.data?.cards ?? [];
        const candidates = matchingCards(cards, userText);
        if (candidates.length !== 1) {
          chunks = chunksForText(
            candidates.length
              ? '发现多张同名管线业务概览卡片，请明确要刷新的 cardId。'
              : '没有找到明确的管线业务概览卡片，请先创建或提供 cardId。'
          );
        } else {
          chunks = chunksForTool(
            'business-refresh-1',
            'refresh_business_card',
            {
              cardId: candidates[0].cardId,
              expectedRevision: candidates[0].revision,
            }
          );
        }
      } else if (
        refreshScenario &&
        toolResult?.callId === 'business-refresh-1'
      ) {
        const applied =
          toolResult.value?.data?.durable === true &&
          toolResult.value?.data?.visible === true &&
          toolResult.value?.effect?.status === 'applied';
        const durable = toolResult.value?.data?.durable === true;
        chunks = chunksForText(
          applied
            ? '已刷新并更新当前页面。'
            : durable
              ? '卡片数据已刷新保存，但当前页面未能展示。'
              : '卡片刷新失败，数据未保存。'
        );
      } else if (businessScenario && !toolResult) {
        chunks = chunksForTool(
          'business-stats-1',
          'get_pipeline_statistics',
          {}
        );
      } else if (
        businessScenario &&
        toolResult?.callId === 'business-stats-1'
      ) {
        const statisticsRef = toolResult.value?.data?.statistics_ref;
        chunks = chunksForTool('business-publish-1', 'publish_business_card', {
          spec: {
            schemaVersion: 'business-card/v1',
            title: '管线业务概览',
            description: '基于当前项目管线统计快照生成。',
            layout: { type: 'grid', columns: 2 },
            blocks: [
              {
                id: 'metrics',
                type: 'metric_group',
                items: [
                  {
                    label: '管线总数',
                    value: {
                      statistics_ref: statisticsRef,
                      path: 'summary.count',
                    },
                    unit: '条',
                  },
                  {
                    label: '管线总长度',
                    value: {
                      statistics_ref: statisticsRef,
                      path: 'summary.total_length',
                    },
                    unit: '米',
                  },
                ],
              },
              {
                id: 'material',
                type: 'chart',
                chartType: 'bar',
                source: {
                  statistics_ref: statisticsRef,
                  path: 'groups.material',
                },
                xField: 'key',
                yField: 'count',
              },
            ],
          },
        });
      } else if (
        businessScenario &&
        toolResult?.callId === 'business-publish-1'
      ) {
        const applied =
          toolResult.value?.data?.durable === true &&
          toolResult.value?.data?.visible === true &&
          toolResult.value?.effect?.status === 'applied';
        chunks = chunksForText(
          applied
            ? '已根据真实统计快照创建并展示管线业务概览卡片。'
            : '业务卡片未能完整创建并展示。'
        );
      } else if (!toolResult) {
        const fileRef = mapContext?.availableFiles?.[0]?.file_ref;
        if (!fileRef) chunks = chunksForText('No browser file is available.');
        else
          chunks = chunksForTool('gis-import-1', 'import_vector_dataset', {
            file_ref: fileRef,
          });
      } else if (toolResult.callId === 'gis-import-1') {
        chunks = chunksForTool('gis-style-1', 'set_vector_style', {
          layer_ref: toolResult.value?.data?.layer_ref,
          style: { stroke: { color: '#ff0000', width: 4, opacity: 0.8 } },
        });
      } else if (toolResult.callId === 'gis-style-1') {
        chunks = chunksForTool('gis-fit-1', 'fit_vector_layer', {
          layer_ref:
            toolResult.value?.data?.layer_ref ??
            mapContext?.userLayers?.[0]?.layer_ref,
        });
      } else {
        chunks = chunksForText(
          '已完成道路数据导入、红色 4px 80% 透明度样式设置，并缩放到该图层。'
        );
      }
      for (const chunk of chunks) {
        if (options.signal?.aborted) throw new Error('aborted');
        yield chunk;
      }
    },
  };
  ctx.llm.registerAdapter(['gis-browser-test'], adapter);
}
