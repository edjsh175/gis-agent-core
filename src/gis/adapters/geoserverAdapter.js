import { createGeoServerTransport } from './geoserverTransport.js';

export function createGeoServerAdapter({ config = {}, transport } = {}) {
  const baseUrl = String(config.baseUrl || '').replace(/\/$/, '');
  const workspace = config.workspace || '';
  const http = transport || createGeoServerTransport({ config });
  const endpoint = `${baseUrl}/${workspace}/ows`;

  return {
    async describeFeatureType(layer, { signal } = {}) {
      const response = await request(
        http,
        endpoint,
        {
          service: 'WFS',
          version: '1.0.0',
          request: 'DescribeFeatureType',
          typeName: qualifiedTypeName(layer, workspace),
        },
        signal
      );
      if (response.status < 200 || response.status >= 300)
        throw serviceError(`HTTP ${response.status}`);
      if (/<(?:\w+:)?ExceptionReport\b/i.test(response.text))
        throw serviceError('GeoServer returned ExceptionReport');
      const fields = parseDescribeFeatureType(response.text);
      if (!fields.length)
        throw serviceError('DescribeFeatureType contained no fields');
      return { fields };
    },

    async queryFeatures(layer, { cqlFilter, limit, signal } = {}) {
      const response = await request(
        http,
        endpoint,
        {
          service: 'WFS',
          version: '1.0.0',
          request: 'GetFeature',
          typeName: qualifiedTypeName(layer, workspace),
          outputFormat: 'application/json',
          srsName: 'EPSG:4326',
          CQL_FILTER: cqlFilter,
          maxFeatures: limit,
        },
        signal
      );
      if (response.status < 200 || response.status >= 300)
        throw serviceError(`HTTP ${response.status}`);
      if (/<(?:\w+:)?Exception(?:Report|Text)\b/i.test(response.text))
        throw serviceError('GeoServer returned an exception');
      let body;
      try {
        body = JSON.parse(response.text);
      } catch {
        throw serviceError('GeoServer returned invalid JSON');
      }
      if (
        !body ||
        body.type !== 'FeatureCollection' ||
        !Array.isArray(body.features)
      )
        throw serviceError('Invalid FeatureCollection');
      const crs = body.crs?.properties?.name;
      if (crs && !/(?:EPSG(?::|::|\/0\/)4326|CRS:?84)$/i.test(crs))
        throw serviceError('GeoServer did not return EPSG:4326/CRS84');
      return body;
    },
  };
}

async function request(transport, url, params, signal) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null)
  );
  const options = { method: 'GET', signal };
  const result =
    typeof transport.request === 'function'
      ? await transport.request(`${url}?${query}`, options)
      : await transport.get(url, { params, signal });
  if (result?.data !== undefined && result?.text === undefined) {
    return {
      status: result.status || 200,
      text:
        typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result.data),
    };
  }
  return result;
}

function qualifiedTypeName(layer, workspace) {
  return layer.typeName || `${workspace}:${layer.name || layer.id}`;
}

function parseDescribeFeatureType(xml) {
  if (!/<(?:\w+:)?schema\b/i.test(xml) || !/<\/(?:\w+:)?schema\s*>/i.test(xml))
    throw serviceError('Invalid schema');
  const fields = [];
  // Only sequence members are attributes; the schema's top-level feature declaration is not a field.
  xml = [
    ...xml.matchAll(
      /<(?:\w+:)?sequence\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sequence\s*>/gi
    ),
  ]
    .map((match) => match[1])
    .join('');
  const tag = /<(?:\w+:)?element\b([^>]*?)(?:\/>|>)/gi;
  let match;
  while ((match = tag.exec(xml))) {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([\w:.-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [
        m[1].split(':').pop(),
        m[2],
      ])
    );
    const type = attrs.type?.split(':').pop();
    const normalized = /^(string|normalizedString|token)$/.test(type)
      ? 'string'
      : /^(byte|short|int|integer|long|decimal|float|double|nonNegativeInteger|positiveInteger|unsignedInt|unsignedLong|unsignedShort|unsignedByte)$/.test(
            type
          )
        ? 'number'
        : type === 'boolean'
          ? 'boolean'
          : null;
    if (attrs.name && normalized)
      fields.push({ name: attrs.name, type: normalized });
  }
  return fields;
}

function serviceError(message) {
  const error = new Error(message);
  error.code = 'SERVICE_ERROR';
  return error;
}

export { parseDescribeFeatureType };
