export const name = 'gis-frontend-service';

export function gisFrontendError(code, message = code) {
  const error = new Error(message);
  error.name = 'GisFrontendError';
  error.code = code;
  return error;
}

export function apply(ctx) {
  let provider;

  const service = {
    registerProvider(nextProvider) {
      if (!nextProvider || typeof nextProvider.execute !== 'function') {
        throw gisFrontendError('INVALID_PROVIDER', 'GIS frontend provider must implement execute(request).');
      }
      const dispose = ctx.effect(function* () {
        if (provider !== undefined) {
          throw gisFrontendError('DUPLICATE_PROVIDER', 'A GIS frontend provider is already registered.');
        }
        provider = nextProvider;
        yield () => {
          if (provider === nextProvider) provider = undefined;
        };
      }, 'gisFrontend.registerProvider()');
      return () => void dispose();
    },

    async execute(request) {
      if (request?.signal?.aborted) {
        throw gisFrontendError('GIS_FRONTEND_ABORTED', 'GIS frontend execution was aborted before dispatch.');
      }
      if (provider === undefined) {
        throw gisFrontendError('NO_PROVIDER', 'No GIS frontend provider is registered.');
      }
      return provider.execute(request);
    },
  };

  ctx.provide('gisFrontend', service);
}
