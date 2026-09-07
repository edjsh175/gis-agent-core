/**
 * UI-independent GeoServer HTTP transport.
 * The request function is injectable so data capabilities can run in tests,
 * workers, or the browser without depending on the application's HTTP layer.
 */
export function createGeoServerTransport({
  config = {},
  request = globalThis.fetch,
} = {}) {
  if (typeof request !== 'function')
    throw new TypeError('request must be a function');
  const timeoutMs = config.timeoutMs || 30_000;

  return {
    async request(url, options = {}) {
      const controller = new AbortController();
      const signal = options.signal;
      let timer;
      const abort = () => controller.abort(signal?.reason);
      if (signal) {
        if (signal.aborted) throw abortError(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
      }
      timer = setTimeout(
        () => controller.abort(new Error('timeout')),
        timeoutMs
      );
      try {
        const headers = new Headers(options.headers);
        if (config.auth?.username && config.auth?.password) {
          const bytes = new TextEncoder().encode(
            `${config.auth.username}:${config.auth.password}`
          );
          headers.set(
            'Authorization',
            'Basic ' +
              btoa(
                Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
              )
          );
        }
        const response = await request(url, {
          ...options,
          headers,
          signal: controller.signal,
        });
        const text = await response.text();
        return { status: response.status, headers: response.headers, text };
      } catch (error) {
        if (signal?.aborted) throw abortError(signal.reason);
        if (controller.signal.aborted) {
          const timeout = new Error('GeoServer request timed out');
          timeout.code = 'TIMEOUT';
          throw timeout;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

function abortError(reason) {
  const error = new Error('Operation cancelled', { cause: reason });
  error.code = 'OPERATION_CANCELLED';
  return error;
}
