export const name = 'business-artifact-frontend-service';

export function businessArtifactFrontendError(code, message = code) {
  const error = new Error(message);
  error.name = 'BusinessArtifactFrontendError';
  error.code = code;
  return error;
}

export function apply(ctx) {
  let provider;
  ctx.provide('businessArtifactFrontend', {
    registerProvider(nextProvider) {
      if (!nextProvider || typeof nextProvider.execute !== 'function')
        throw businessArtifactFrontendError('INVALID_PROVIDER');
      const dispose = ctx.effect(function* () {
        if (provider) throw businessArtifactFrontendError('DUPLICATE_PROVIDER');
        provider = nextProvider;
        yield () => {
          if (provider === nextProvider) provider = undefined;
        };
      }, 'businessArtifactFrontend.registerProvider()');
      return () => void dispose();
    },
    execute(request) {
      if (!provider) throw businessArtifactFrontendError('NO_PROVIDER');
      return provider.execute(request);
    },
  });
}
