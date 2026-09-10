import { createServer } from 'node:http';
import { createBusinessCardLifecycleService } from './updateService.js';

const MAX = 256 * 1024;
const defaultHosts = new Set(['localhost', '127.0.0.1']);
function apiError(res, status, code, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}
function hostAllowed(host, listeningPort, allowedHosts) {
  try {
    const u = new URL(`http://${host}`);
    return (
      allowedHosts.has(u.hostname) &&
      (!u.port ||
        u.port === '3189' ||
        u.port === '5173' ||
        String(listeningPort) === u.port)
    );
  } catch {
    return false;
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let rejected = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        if (!rejected)
          reject(
            Object.assign(new Error('body too large'), {
              code: 'PAYLOAD_TOO_LARGE',
            })
          );
        rejected = true;
      } else if (!rejected) chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(
          Object.assign(new Error('invalid JSON'), { code: 'INVALID_JSON' })
        );
      }
    });
    req.on('error', reject);
  });
}

export function createBusinessArtifactServer({
  repository,
  pipelineStatistics,
  resolveContext = () => null,
  allowedHosts = defaultHosts,
  allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3189',
    'http://127.0.0.1:3189',
  ],
} = {}) {
  if (!repository) throw new Error('repository is required');
  const lifecycleService = createBusinessCardLifecycleService({
    repository,
    statistics: pipelineStatistics,
  });
  const server = createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return apiError(res, 400, 'INVALID_URL', 'request URL is invalid');
    }
    if (
      !hostAllowed(
        req.headers.host || '',
        server.address()?.port,
        new Set(allowedHosts)
      )
    )
      return apiError(res, 400, 'INVALID_HOST', 'host is not allowed');
    const origin = req.headers.origin;
    if (origin && !new Set(allowedOrigins).has(origin))
      return apiError(res, 403, 'ORIGIN_FORBIDDEN', 'origin is not allowed');
    if (!['GET', 'POST', 'OPTIONS'].includes(req.method))
      return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'method is not allowed');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': origin || '' });
      return res.end();
    }
    const cardsPath = '/__business-artifacts/cards';
    const pipelineStatisticsPath = '/__business-artifacts/statistics/pipeline';
    if (
      !url.pathname.startsWith(cardsPath) &&
      url.pathname !== pipelineStatisticsPath
    )
      return apiError(res, 404, 'NOT_FOUND', 'not found');
    let context;
    try {
      context = await resolveContext(req);
    } catch {
      context = null;
    }
    if (!context)
      return apiError(
        res,
        401,
        'UNAUTHENTICATED',
        'authentication is required'
      );
    try {
      let result;
      if (url.pathname === pipelineStatisticsPath) {
        if (req.method !== 'POST')
          return apiError(
            res,
            405,
            'METHOD_NOT_ALLOWED',
            'method is not allowed'
          );
        if (!pipelineStatistics)
          return apiError(
            res,
            503,
            'STATISTICS_UNAVAILABLE',
            'pipeline statistics service is unavailable'
          );
        if (
          !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')
        )
          return apiError(
            res,
            415,
            'UNSUPPORTED_MEDIA_TYPE',
            'application/json is required'
          );
        const body = await readBody(req);
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length !== 0
        )
          return apiError(
            res,
            400,
            'INVALID_BODY',
            'body must be an empty object'
          );
        const snapshotData = await pipelineStatistics.query();
        const snapshot = repository.saveStatisticsSnapshot(
          context,
          snapshotData
        );
        result = {
          statistics_ref: snapshot.statistics_ref,
          dataset: snapshot.dataset,
          calculatedAt: snapshot.calculatedAt,
          scope: snapshot.scope,
          summary: snapshot.data.summary,
          groups: snapshot.data.groups,
          availablePaths: Object.keys(snapshot.schema),
        };
      } else {
        const suffix = url.pathname.slice(cardsPath.length);
        if (req.method === 'GET' && (suffix === '' || suffix === '/')) {
          const listed = repository.listCards(context, {
            includeArchived: url.searchParams.get('includeArchived') === '1',
          });
          result = {
            ...listed,
            cards: listed.cards.map((card) => ({
              ...card,
              refreshable:
                lifecycleService.canRefresh({
                  card,
                  snapshots: listed.snapshots.filter((snapshot) =>
                    card.statisticsRefs.includes(snapshot.statistics_ref)
                  ),
                }) ?? false,
            })),
          };
        } else if (req.method === 'GET' && /^\/.+/.test(suffix))
          result = repository.getCard(
            context,
            decodeURIComponent(suffix.slice(1))
          );
        else if (req.method === 'POST' && (suffix === '' || suffix === '/')) {
          if (
            !/^application\/json\s*(;|$)/i.test(
              req.headers['content-type'] || ''
            )
          )
            return apiError(
              res,
              415,
              'UNSUPPORTED_MEDIA_TYPE',
              'application/json is required'
            );
          const body = await readBody(req);
          if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length !== 1 ||
            !Object.hasOwn(body, 'spec')
          )
            return apiError(
              res,
              400,
              'INVALID_BODY',
              'body must contain only spec'
            );
          result = repository.createCard(context, body.spec);
        } else if (req.method === 'POST' && /^\/.+\/update$/.test(suffix)) {
          if (
            !/^application\/json\s*(;|$)/i.test(
              req.headers['content-type'] || ''
            )
          )
            return apiError(
              res,
              415,
              'UNSUPPORTED_MEDIA_TYPE',
              'application/json is required'
            );
          const body = await readBody(req);
          if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length !== 2 ||
            !Object.hasOwn(body, 'expectedRevision') ||
            !Object.hasOwn(body, 'spec')
          )
            return apiError(
              res,
              400,
              'INVALID_BODY',
              'body must contain only expectedRevision and spec'
            );
          result = lifecycleService.update(
            context,
            decodeURIComponent(suffix.slice(1, -'/update'.length)),
            body.expectedRevision,
            body.spec
          );
        } else if (req.method === 'POST' && /^\/.+\/archive$/.test(suffix)) {
          if (
            !/^application\/json\s*(;|$)/i.test(
              req.headers['content-type'] || ''
            )
          )
            return apiError(
              res,
              415,
              'UNSUPPORTED_MEDIA_TYPE',
              'application/json is required'
            );
          const body = await readBody(req);
          if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length !== 1 ||
            !Object.hasOwn(body, 'expectedRevision')
          )
            return apiError(
              res,
              400,
              'INVALID_BODY',
              'body must contain only expectedRevision'
            );
          result = lifecycleService.archive(
            context,
            decodeURIComponent(suffix.slice(1, -'/archive'.length)),
            body.expectedRevision
          );
        } else if (req.method === 'POST' && /^\/.+\/delete$/.test(suffix)) {
          if (
            !/^application\/json\s*(;|$)/i.test(
              req.headers['content-type'] || ''
            )
          )
            return apiError(
              res,
              415,
              'UNSUPPORTED_MEDIA_TYPE',
              'application/json is required'
            );
          const body = await readBody(req);
          if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length !== 1 ||
            !Object.hasOwn(body, 'expectedRevision')
          )
            return apiError(
              res,
              400,
              'INVALID_BODY',
              'body must contain only expectedRevision'
            );
          result = lifecycleService.delete(
            context,
            decodeURIComponent(suffix.slice(1, -'/delete'.length)),
            body.expectedRevision
          );
        } else if (req.method === 'POST' && /^\/.+\/refresh$/.test(suffix)) {
          if (
            !/^application\/json\s*(;|$)/i.test(
              req.headers['content-type'] || ''
            )
          )
            return apiError(
              res,
              415,
              'UNSUPPORTED_MEDIA_TYPE',
              'application/json is required'
            );
          const body = await readBody(req);
          if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length !== 1 ||
            !Object.hasOwn(body, 'expectedRevision')
          )
            return apiError(
              res,
              400,
              'INVALID_BODY',
              'body must contain only expectedRevision'
            );
          result = await lifecycleService.refresh(
            context,
            decodeURIComponent(suffix.slice(1, -'/refresh'.length)),
            body.expectedRevision
          );
        } else return apiError(res, 404, 'NOT_FOUND', 'not found');
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        ...(origin
          ? { 'access-control-allow-origin': origin, vary: 'Origin' }
          : {}),
      });
      res.end(JSON.stringify(result));
    } catch (e) {
      const status =
        e.code === 'CARD_NOT_FOUND'
          ? 404
          : e.code === 'CARD_REVISION_CONFLICT' ||
              e.code === 'CARD_STATE_CONFLICT'
            ? 409
            : e.code === 'CARD_PERSIST_FAILED'
              ? 500
              : e.code === 'STATISTICS_UNAVAILABLE'
                ? 503
                : e.code === 'STATISTICS_TIMEOUT'
                  ? 504
                  : e.code === 'PAYLOAD_TOO_LARGE'
                    ? 413
                    : e.code === 'UNSUPPORTED_MEDIA_TYPE'
                      ? 415
                      : 400;
      apiError(
        res,
        status,
        e.code || 'BAD_REQUEST',
        status === 500 ? 'unable to persist card' : e.message
      );
    }
  });
  return server;
}
