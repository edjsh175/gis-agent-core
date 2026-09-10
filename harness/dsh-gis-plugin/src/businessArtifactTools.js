import { createBusinessArtifactBackendClient } from './businessArtifactBackendClient.js';
import { BUSINESS_CARD_SPEC_JSON_SCHEMA } from '../../../src/business-artifacts/cardSpecSchema.js';

export const name = 'business-artifact-tools';
export const inject = ['tools', 'businessArtifactFrontend'];
export { BUSINESS_ARTIFACT_TOOL_NAMES } from './businessArtifactToolCatalog.js';

const outputSchema = {
  type: 'object',
  additionalProperties: true,
};

function resultFailure(code, message, data = undefined, effect = undefined) {
  return {
    ok: false,
    ...(data ? { data } : {}),
    error: { code, message },
    ...(effect ? { effect } : {}),
  };
}

function validateLifecycleArgs(args, label) {
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).length !== 2 ||
    typeof args.cardId !== 'string' ||
    !args.cardId ||
    args.cardId.length > 128 ||
    !Number.isSafeInteger(args.expectedRevision) ||
    args.expectedRevision < 1
  )
    throw Object.assign(new Error(`${label}参数无效`), {
      code: 'INVALID_ARGUMENT',
    });
}

function validateNoArgs(args, label = '参数') {
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).length !== 0
  )
    throw Object.assign(new Error(`${label}无效`), {
      code: 'INVALID_ARGUMENT',
    });
}

export function apply(ctx, config = {}) {
  const backend = createBusinessArtifactBackendClient({
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl,
  });

  ctx.tools.register({
    name: 'get_pipeline_statistics',
    description:
      '获取当前工作区真实管线统计数据，当前支持管线数量、总长度和材质分布。用户询问这些业务事实，或后续业务成果需要引用这些事实时使用。返回 statistics_ref 作为权威统计快照引用；不得从历史文本、记忆或估算中替代本工具得到的统计事实。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      try {
        validateNoArgs(args, '统计参数');
        const workflowId = exec.agent?.id;
        const payload = await backend.getPipelineStatistics({
          workflowId,
          signal: exec.signal,
        });
        return {
          ok: true,
          data: {
            statistics_ref: payload.statistics_ref,
            dataset: payload.dataset,
            calculatedAt: payload.calculatedAt,
            availablePaths: payload.availablePaths,
            preview: {
              summary: payload.summary,
              groups: payload.groups,
            },
          },
        };
      } catch (error) {
        return resultFailure(
          error.code || 'STATISTICS_UNAVAILABLE',
          error.message || '管线统计不可用'
        );
      }
    },
  });

  ctx.tools.register({
    name: 'publish_business_card',
    description:
      '创建并永久保存新的业务卡片。卡片必须使用受控 CardSpec；涉及统计事实的内容必须引用已获得的 statistics_ref，不能直接写入权威统计值。保存后会请求当前浏览器展示。durable 表示持久化是否成功，visible 与 effect 表示当前页面是否实际展示成功，两者必须分别判断。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['spec'],
      properties: {
        spec: BUSINESS_CARD_SPEC_JSON_SCHEMA,
      },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      let persisted;
      try {
        if (
          !args ||
          typeof args !== 'object' ||
          Array.isArray(args) ||
          Object.keys(args).length !== 1 ||
          !args.spec ||
          typeof args.spec !== 'object' ||
          Array.isArray(args.spec)
        )
          throw Object.assign(new Error('CardSpec 参数无效'), {
            code: 'INVALID_ARGUMENT',
          });
        const workflowId = exec.agent?.id;
        persisted = await backend.publishCard(args.spec, {
          workflowId,
          signal: exec.signal,
        });
        const card = persisted.card;
        const receipt = await ctx.businessArtifactFrontend.execute({
          operation: 'present_business_card',
          callId: exec.callId,
          arguments: { cardId: card.cardId, revision: card.revision },
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          signal: exec.signal,
        });
        if (!receipt?.ok || receipt.effect?.status !== 'applied') {
          return resultFailure(
            receipt?.error?.code || 'CARD_PRESENT_FAILED',
            receipt?.error?.message || '业务卡片已保存，但当前页面未能展示',
            {
              cardId: card.cardId,
              durable: true,
              visible: false,
              revision: card.revision,
            },
            { status: 'partial', kind: 'business_card_present' }
          );
        }
        return {
          ok: true,
          data: {
            cardId: card.cardId,
            durable: true,
            visible: true,
            revision: card.revision,
          },
          effect: {
            status: 'applied',
            kind: 'business_card_present',
          },
        };
      } catch (error) {
        if (persisted?.card) {
          return resultFailure(
            error.code || 'CARD_PRESENT_FAILED',
            error.message || '业务卡片已保存，但当前页面未能展示',
            {
              cardId: persisted.card.cardId,
              durable: true,
              visible: false,
              revision: persisted.card.revision,
            },
            { status: 'partial', kind: 'business_card_present' }
          );
        }
        return resultFailure(
          error.code || 'CARD_PUBLISH_FAILED',
          error.message || '业务卡片创建失败',
          { durable: false, visible: false },
          { status: 'none', kind: 'business_card_present' }
        );
      }
    },
  });

  ctx.tools.register({
    name: 'list_business_cards',
    description:
      '列出当前工作区已有业务卡片，返回 cardId、标题、版本、状态、统计时间、可刷新性和当前 CardSpec。需要对已有卡片执行刷新、修改、归档或删除等操作，但用户没有直接提供唯一 cardId 时，应先用本工具定位目标；若存在多个可能对象或指代仍不唯一，应先向用户确认。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      try {
        validateNoArgs(args);
        const payload = await backend.listCards({ signal: exec.signal });
        const allSnapshots = Array.isArray(payload.snapshots)
          ? payload.snapshots
          : [];
        const cards = (Array.isArray(payload.cards) ? payload.cards : []).map(
          (card) => {
            const snapshots = allSnapshots.filter((snapshot) =>
              card.statisticsRefs?.includes(snapshot.statistics_ref)
            );
            const times = snapshots
              .map((snapshot) => snapshot.calculatedAt)
              .filter(Boolean)
              .sort();
            return {
              cardId: card.cardId,
              title: card.spec?.title || '',
              revision: card.revision,
              status: card.status,
              createdAt: card.createdAt,
              updatedAt: card.updatedAt,
              snapshotAt: times.at(-1) || null,
              refreshable: card.refreshable === true,
              spec: card.spec,
            };
          }
        );
        return { ok: true, data: { cards } };
      } catch (error) {
        return resultFailure(
          error.code || 'CARD_LIST_FAILED',
          error.message || '业务卡片列表不可用'
        );
      }
    },
  });

  ctx.tools.register({
    name: 'refresh_business_card',
    description:
      '刷新已有业务卡片所引用的统计数据，不修改卡片标题、布局、区块或 GIS Action。必须传入唯一 cardId 和当前 expectedRevision。成功后原 cardId 保持不变，生成新的统计快照并使 revision 增加；版本冲突时只读取并呈现最新版本，不自动再次刷新。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['cardId', 'expectedRevision'],
      properties: {
        cardId: { type: 'string', minLength: 1, maxLength: 128 },
        expectedRevision: { type: 'integer', minimum: 1 },
      },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      let refreshed;
      try {
        if (
          !args ||
          typeof args !== 'object' ||
          Array.isArray(args) ||
          Object.keys(args).length !== 2 ||
          typeof args.cardId !== 'string' ||
          !args.cardId ||
          args.cardId.length > 128 ||
          !Number.isSafeInteger(args.expectedRevision) ||
          args.expectedRevision < 1
        )
          throw Object.assign(new Error('刷新参数无效'), {
            code: 'INVALID_ARGUMENT',
          });
        refreshed = await backend.refreshCard(
          args.cardId,
          args.expectedRevision,
          { signal: exec.signal }
        );
        const card = refreshed.card;
        const receipt = await ctx.businessArtifactFrontend.execute({
          operation: 'present_business_card',
          callId: exec.callId,
          arguments: { cardId: card.cardId, revision: card.revision },
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          signal: exec.signal,
        });
        if (!receipt?.ok || receipt.effect?.status !== 'applied')
          return resultFailure(
            receipt?.error?.code || 'CARD_PRESENT_FAILED',
            receipt?.error?.message || '业务卡片已刷新保存，但当前页面未能展示',
            {
              cardId: card.cardId,
              durable: true,
              visible: false,
              revision: card.revision,
            },
            { status: 'partial', kind: 'business_card_refresh' }
          );
        return {
          ok: true,
          data: {
            cardId: card.cardId,
            durable: true,
            visible: true,
            revision: card.revision,
          },
          effect: { status: 'applied', kind: 'business_card_refresh' },
        };
      } catch (error) {
        if (error.code === 'CARD_REVISION_CONFLICT' && !refreshed?.card) {
          try {
            const latest = await backend.getCard(args.cardId, {
              signal: exec.signal,
            });
            const card = latest.card;
            const receipt = await ctx.businessArtifactFrontend.execute({
              operation: 'present_business_card',
              callId: exec.callId,
              arguments: { cardId: card.cardId, revision: card.revision },
              ...(exec.agent === undefined ? {} : { agent: exec.agent }),
              signal: exec.signal,
            });
            const visible =
              receipt?.ok === true && receipt.effect?.status === 'applied';
            return resultFailure(
              'CARD_REVISION_CONFLICT',
              '卡片已被其他操作更新，已读取最新版本；未自动重试刷新',
              {
                cardId: card.cardId,
                durable: false,
                visible,
                revision: card.revision,
              },
              {
                status: visible ? 'applied' : 'partial',
                kind: 'business_card_refresh_conflict',
              }
            );
          } catch (recoveryError) {
            return resultFailure(
              'CARD_REVISION_CONFLICT',
              '卡片已被其他操作更新，读取最新版本失败',
              { cardId: args.cardId, durable: false, visible: false },
              { status: 'partial', kind: 'business_card_refresh_conflict' }
            );
          }
        }
        if (refreshed?.card)
          return resultFailure(
            error.code || 'CARD_PRESENT_FAILED',
            error.message || '业务卡片已刷新保存，但当前页面未能展示',
            {
              cardId: refreshed.card.cardId,
              durable: true,
              visible: false,
              revision: refreshed.card.revision,
            },
            { status: 'partial', kind: 'business_card_refresh' }
          );
        return resultFailure(
          error.code || 'CARD_REFRESH_FAILED',
          error.message || '业务卡片刷新失败',
          { durable: false, visible: false },
          { status: 'none', kind: 'business_card_refresh' }
        );
      }
    },
  });

  ctx.tools.register({
    name: 'archive_business_card',
    description:
      '归档已有业务卡片。归档属于软下架：保留 CardRecord 和统计快照，将卡片状态改为 archived，并从当前业务成果面板移除。必须使用唯一 cardId 和当前 expectedRevision；若目标对象不唯一，应先定位或澄清。不要把归档替换成永久删除。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['cardId', 'expectedRevision'],
      properties: {
        cardId: { type: 'string', minLength: 1, maxLength: 128 },
        expectedRevision: { type: 'integer', minimum: 1 },
      },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      let archived;
      try {
        validateLifecycleArgs(args, '归档');
        archived = await backend.archiveCard(
          args.cardId,
          args.expectedRevision,
          { workflowId: exec.agent?.id, signal: exec.signal }
        );
        const card = archived.card;
        const receipt = await ctx.businessArtifactFrontend.execute({
          operation: 'dismiss_business_card',
          callId: exec.callId,
          arguments: { cardId: card.cardId, revision: card.revision },
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          signal: exec.signal,
        });
        if (!receipt?.ok || receipt.effect?.status !== 'applied')
          return resultFailure(
            receipt?.error?.code || 'CARD_DISMISS_FAILED',
            receipt?.error?.message || '业务卡片已归档保存，但当前页面未能移除',
            {
              cardId: card.cardId,
              durable: true,
              removedFromView: false,
              revision: card.revision,
              status: card.status,
            },
            { status: 'partial', kind: 'business_card_archive' }
          );
        return {
          ok: true,
          data: {
            cardId: card.cardId,
            durable: true,
            removedFromView: true,
            revision: card.revision,
            status: card.status,
          },
          effect: { status: 'applied', kind: 'business_card_archive' },
        };
      } catch (error) {
        return resultFailure(
          error.code || 'CARD_ARCHIVE_FAILED',
          error.message || '业务卡片归档失败',
          archived?.card
            ? {
                cardId: archived.card.cardId,
                durable: true,
                removedFromView: false,
                revision: archived.card.revision,
                status: archived.card.status,
              }
            : { durable: false, removedFromView: false },
          {
            status: archived?.card ? 'partial' : 'none',
            kind: 'business_card_archive',
          }
        );
      }
    },
  });

  ctx.tools.register({
    name: 'delete_business_card',
    description:
      '永久删除已有业务卡片的 CardRecord；关联 StatisticsSnapshot 不会随卡片删除。仅在用户明确要求永久删除时使用。必须使用唯一 cardId 和当前 expectedRevision；若目标对象不唯一，应先定位或澄清。不要把永久删除替换成归档。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['cardId', 'expectedRevision'],
      properties: {
        cardId: { type: 'string', minLength: 1, maxLength: 128 },
        expectedRevision: { type: 'integer', minimum: 1 },
      },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      let deleted;
      try {
        validateLifecycleArgs(args, '删除');
        deleted = await backend.deleteCard(args.cardId, args.expectedRevision, {
          workflowId: exec.agent?.id,
          signal: exec.signal,
        });
        const receipt = await ctx.businessArtifactFrontend.execute({
          operation: 'dismiss_business_card',
          callId: exec.callId,
          arguments: { cardId: deleted.cardId, revision: deleted.revision },
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          signal: exec.signal,
        });
        if (!receipt?.ok || receipt.effect?.status !== 'applied')
          return resultFailure(
            receipt?.error?.code || 'CARD_DISMISS_FAILED',
            receipt?.error?.message || '业务卡片已永久删除，但当前页面未能移除',
            {
              cardId: deleted.cardId,
              durable: true,
              removedFromView: false,
              revision: deleted.revision,
              status: 'deleted',
            },
            { status: 'partial', kind: 'business_card_delete' }
          );
        return {
          ok: true,
          data: {
            cardId: deleted.cardId,
            durable: true,
            removedFromView: true,
            revision: deleted.revision,
            status: 'deleted',
          },
          effect: { status: 'applied', kind: 'business_card_delete' },
        };
      } catch (error) {
        return resultFailure(
          error.code || 'CARD_DELETE_FAILED',
          error.message || '业务卡片删除失败',
          deleted
            ? {
                cardId: deleted.cardId,
                durable: true,
                removedFromView: false,
                revision: deleted.revision,
                status: 'deleted',
              }
            : { durable: false, removedFromView: false },
          {
            status: deleted ? 'partial' : 'none',
            kind: 'business_card_delete',
          }
        );
      }
    },
  });

  ctx.tools.register({
    name: 'update_business_card',
    description:
      '修改已有业务卡片的 CardSpec，并在原 cardId 上保存为新 revision。适用于标题、描述、布局、区块、图表类型、表格或 GIS Action 等结构与表达变更；不用于重新统计数据。应基于当前 CardSpec 修改并保留仍然有效的 statistics_ref，除非用户另外要求刷新数据。必须使用唯一 cardId 和当前 expectedRevision。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['cardId', 'expectedRevision', 'spec'],
      properties: {
        cardId: { type: 'string', minLength: 1, maxLength: 128 },
        expectedRevision: { type: 'integer', minimum: 1 },
        spec: BUSINESS_CARD_SPEC_JSON_SCHEMA,
      },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      let updated;
      try {
        if (
          !args ||
          typeof args !== 'object' ||
          Array.isArray(args) ||
          Object.keys(args).length !== 3 ||
          typeof args.cardId !== 'string' ||
          !args.cardId ||
          args.cardId.length > 128 ||
          !Number.isSafeInteger(args.expectedRevision) ||
          args.expectedRevision < 1 ||
          !args.spec ||
          typeof args.spec !== 'object' ||
          Array.isArray(args.spec)
        )
          throw Object.assign(new Error('更新参数无效'), {
            code: 'INVALID_ARGUMENT',
          });
        updated = await backend.updateCard(
          args.cardId,
          args.expectedRevision,
          args.spec,
          { workflowId: exec.agent?.id, signal: exec.signal }
        );
        const card = updated.card;
        const receipt = await ctx.businessArtifactFrontend.execute({
          operation: 'present_business_card',
          callId: exec.callId,
          arguments: { cardId: card.cardId, revision: card.revision },
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          signal: exec.signal,
        });
        if (!receipt?.ok || receipt.effect?.status !== 'applied')
          return resultFailure(
            receipt?.error?.code || 'CARD_PRESENT_FAILED',
            receipt?.error?.message || '业务卡片已更新保存，但当前页面未能展示',
            {
              cardId: card.cardId,
              durable: true,
              visible: false,
              revision: card.revision,
            },
            { status: 'partial', kind: 'business_card_update' }
          );
        return {
          ok: true,
          data: {
            cardId: card.cardId,
            durable: true,
            visible: true,
            revision: card.revision,
          },
          effect: { status: 'applied', kind: 'business_card_update' },
        };
      } catch (error) {
        if (error.code === 'CARD_REVISION_CONFLICT' && !updated?.card) {
          try {
            const latest = await backend.getCard(args.cardId, {
              signal: exec.signal,
            });
            const card = latest.card;
            const receipt = await ctx.businessArtifactFrontend.execute({
              operation: 'present_business_card',
              callId: exec.callId,
              arguments: { cardId: card.cardId, revision: card.revision },
              ...(exec.agent === undefined ? {} : { agent: exec.agent }),
              signal: exec.signal,
            });
            const visible =
              receipt?.ok === true && receipt.effect?.status === 'applied';
            return resultFailure(
              'CARD_REVISION_CONFLICT',
              '卡片已被其他操作更新，已读取最新版本；未自动重试更新',
              {
                cardId: card.cardId,
                durable: false,
                visible,
                revision: card.revision,
              },
              {
                status: visible ? 'applied' : 'partial',
                kind: 'business_card_update_conflict',
              }
            );
          } catch {
            return resultFailure(
              'CARD_REVISION_CONFLICT',
              '卡片已被其他操作更新，读取最新版本失败',
              { cardId: args.cardId, durable: false, visible: false },
              { status: 'partial', kind: 'business_card_update_conflict' }
            );
          }
        }
        if (updated?.card)
          return resultFailure(
            error.code || 'CARD_PRESENT_FAILED',
            error.message || '业务卡片已更新保存，但当前页面未能展示',
            {
              cardId: updated.card.cardId,
              durable: true,
              visible: false,
              revision: updated.card.revision,
            },
            { status: 'partial', kind: 'business_card_update' }
          );
        return resultFailure(
          error.code || 'CARD_UPDATE_FAILED',
          error.message || '业务卡片更新失败',
          { durable: false, visible: false },
          { status: 'none', kind: 'business_card_update' }
        );
      }
    },
  });
}
