import { validateBusinessArtifactFrontendCall } from './frontendTools.js';

function failure(error, invoked = false, kind = 'business_card_present') {
  return {
    ok: false,
    error: {
      code: error?.code || 'CARD_PRESENT_FAILED',
      message: error?.message || '业务卡片展示失败',
    },
    effect: {
      status: invoked ? 'unknown' : 'none',
      kind,
    },
  };
}

export function createBusinessArtifactFrontendExecutor({ application }) {
  if (
    !application ||
    typeof application.present !== 'function' ||
    typeof application.dismiss !== 'function'
  )
    throw new Error('business artifact application is required');
  const calls = new Map();

  return {
    execute(call) {
      let args;
      try {
        args = validateBusinessArtifactFrontendCall(call.name, call.args);
        if (
          typeof call.runId !== 'string' ||
          !call.runId ||
          typeof call.toolCallId !== 'string' ||
          !call.toolCallId
        )
          throw new Error('INVALID_BUSINESS_ARTIFACT_TOOL');
      } catch (error) {
        return Promise.resolve(failure(error));
      }

      const key = JSON.stringify([call.runId, call.toolCallId]);
      const signature = JSON.stringify([call.name, args]);
      const known = calls.get(key);
      if (known)
        return known.signature === signature
          ? known.promise
          : Promise.resolve(
              failure(
                Object.assign(new Error('业务卡片工具调用冲突'), {
                  code: 'TOOL_CALL_CONFLICT',
                })
              )
            );

      const promise = Promise.resolve().then(async () => {
        let invoked = false;
        const effectKind =
          call.name === 'dismiss_business_card'
            ? 'business_card_dismiss'
            : 'business_card_present';
        try {
          invoked = true;
          if (call.name === 'dismiss_business_card') {
            const payload = application.dismiss(args.cardId, args.revision);
            return {
              ok: true,
              data: {
                cardId: payload.cardId,
                revision: payload.revision,
                visible: false,
              },
              effect: { status: 'applied', kind: effectKind },
            };
          }
          const payload = await application.present(args.cardId, args.revision);
          return {
            ok: true,
            data: {
              cardId: payload.card.cardId,
              revision: payload.card.revision,
              visible: true,
            },
            effect: { status: 'applied', kind: effectKind },
          };
        } catch (error) {
          return failure(error, invoked, effectKind);
        }
      });
      calls.set(key, { signature, promise });
      return promise;
    },
  };
}
