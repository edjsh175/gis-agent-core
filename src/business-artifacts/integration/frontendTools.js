const boundedString = (maxLength = 128) => ({
  type: 'string',
  minLength: 1,
  maxLength,
});

export const BUSINESS_ARTIFACT_FRONTEND_TOOLS = Object.freeze([
  {
    name: 'present_business_card',
    description:
      '把服务端已持久化的业务卡片投影到当前页面，并返回浏览器展示回执。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['cardId', 'revision'],
      properties: {
        cardId: boundedString(),
        revision: { type: 'integer', minimum: 1 },
      },
    },
  },
  {
    name: 'dismiss_business_card',
    description: '按 revision 将已归档或删除的业务卡片从当前页面投影中移除。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['cardId', 'revision'],
      properties: {
        cardId: boundedString(),
        revision: { type: 'integer', minimum: 1 },
      },
    },
  },
]);

export function validateBusinessArtifactFrontendCall(name, args) {
  if (name !== 'present_business_card' && name !== 'dismiss_business_card')
    throw new Error('INVALID_BUSINESS_ARTIFACT_TOOL');
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('INVALID_BUSINESS_ARTIFACT_TOOL');
  const keys = Object.keys(args);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(args, 'cardId') ||
    !Object.hasOwn(args, 'revision') ||
    typeof args.cardId !== 'string' ||
    args.cardId.length < 1 ||
    args.cardId.length > 128 ||
    !Number.isInteger(args.revision) ||
    args.revision < 1
  )
    throw new Error('INVALID_BUSINESS_ARTIFACT_TOOL');
  return { cardId: args.cardId, revision: args.revision };
}
