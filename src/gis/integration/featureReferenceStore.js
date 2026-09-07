import { success, failure } from '../contracts.js';

/** @typedef {import('../contracts.js').CapabilityFeature} CapabilityFeature */
/** @typedef {import('./contracts.js').FeatureRef} FeatureRef */
/** @typedef {import('./contracts.js').ReferenceBinding} ReferenceBinding */

const TTL_MS = 10 * 60 * 1000;
const MAX_SNAPSHOTS = 10;
const MAX_FEATURES = 100;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const BINDING_FIELDS = [
  'userId',
  'browserSessionId',
  'threadId',
  'workflowId',
  'configVersion',
  'leaseExpiresAt',
];
const IDENTITY_FIELDS = BINDING_FIELDS.slice(0, 4);

const error = (code, message = code) => failure(code, message);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value, seen = new Set(), depth = 0) {
  if (depth > 100) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !('value' in descriptor) ||
        !isJsonValue(descriptor.value, new Set(seen), depth + 1)
      )
        return false;
    }
    return true;
  }
  if (!isPlainObject(value)) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      typeof key === 'string' &&
      descriptor?.enumerable &&
      'value' in descriptor &&
      isJsonValue(descriptor.value, new Set(seen), depth + 1)
    );
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function validFeature(feature) {
  try {
    return (
      isPlainObject(feature) &&
      feature.type === 'Feature' &&
      typeof feature.layerId === 'string' &&
      feature.layerId.length > 0 &&
      (feature.sourceFeatureId === null ||
        typeof feature.sourceFeatureId === 'string' ||
        (typeof feature.sourceFeatureId === 'number' &&
          Number.isFinite(feature.sourceFeatureId))) &&
      isPlainObject(feature.properties) &&
      validGeometry(feature.geometry)
    );
  } catch {
    return false;
  }
}

function validGeometry(geometry) {
  if (geometry === null) return true;
  if (
    !isPlainObject(geometry) ||
    typeof geometry.type !== 'string' ||
    geometry.type.length === 0
  )
    return false;
  if (geometry.type === 'GeometryCollection')
    return (
      Array.isArray(geometry.geometries) &&
      geometry.geometries.every((item) => item !== null && validGeometry(item))
    );
  const position = (value) =>
    Array.isArray(value) && value.length >= 2 && value.every(Number.isFinite);
  const list = (value, test, minimum = 0) =>
    Array.isArray(value) && value.length >= minimum && value.every(test);
  const line = (value) => list(value, position, 2);
  const polygon = (value) => list(value, (ring) => list(ring, position, 4));
  const validators = {
    Point: position,
    MultiPoint: (value) => list(value, position),
    LineString: line,
    MultiLineString: (value) => list(value, line),
    Polygon: polygon,
    MultiPolygon: (value) => list(value, polygon),
  };
  return (
    Object.hasOwn(validators, geometry.type) &&
    validators[geometry.type](geometry.coordinates)
  );
}

function validBinding(binding) {
  return (
    isPlainObject(binding) &&
    isJsonValue(binding) &&
    BINDING_FIELDS.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(binding, field);
      return descriptor && 'value' in descriptor;
    }) &&
    IDENTITY_FIELDS.every(
      (field) => typeof binding[field] === 'string' && binding[field].length > 0
    ) &&
    (typeof binding.configVersion === 'string' ||
      (typeof binding.configVersion === 'number' &&
        Number.isFinite(binding.configVersion))) &&
    typeof binding.leaseExpiresAt === 'number' &&
    Number.isFinite(binding.leaseExpiresAt)
  );
}

function validReference(ref) {
  if (
    !isPlainObject(ref) ||
    !isJsonValue(ref) ||
    Object.keys(ref).some((key) => key !== 'resultId' && key !== 'indices')
  )
    return false;
  const resultDescriptor = Object.getOwnPropertyDescriptor(ref, 'resultId');
  if (
    !resultDescriptor ||
    !('value' in resultDescriptor) ||
    typeof resultDescriptor.value !== 'string' ||
    resultDescriptor.value.length === 0
  )
    return false;
  if (Object.hasOwn(ref, 'indices')) {
    const indicesDescriptor = Object.getOwnPropertyDescriptor(ref, 'indices');
    if (!indicesDescriptor || !('value' in indicesDescriptor)) return false;
  }
  return true;
}

/**
 * Stores bounded, immutable query results partitioned by trusted workflow bindings.
 * The clock returns epoch milliseconds; idFactory must return a unique string.
 */
export function createFeatureReferenceStore({
  clock = () => Date.now(),
  idFactory,
} = {}) {
  const makeId =
    idFactory ||
    (() => {
      const randomUuid = globalThis.crypto?.randomUUID;
      if (typeof randomUuid !== 'function')
        throw new Error(
          'crypto.randomUUID is required when idFactory is not injected'
        );
      return randomUuid.call(globalThis.crypto);
    });
  if (typeof clock !== 'function' || typeof makeId !== 'function')
    throw new TypeError('clock and idFactory must be functions');

  const snapshots = new Map();
  let disposed = false;

  function validateBinding(binding, now = clock()) {
    try {
      if (!validBinding(binding))
        return error('FEATURE_REF_FORBIDDEN', 'Invalid binding');
    } catch {
      return error('FEATURE_REF_FORBIDDEN', 'Invalid binding');
    }
    if (binding.leaseExpiresAt <= now)
      return error('FEATURE_REF_EXPIRED', 'Binding lease has expired');
    return null;
  }

  function sameIdentity(a, b) {
    return IDENTITY_FIELDS.every((field) => a[field] === b[field]);
  }

  function findByWorkflow(binding) {
    return [...snapshots.values()].filter((snapshot) =>
      sameIdentity(snapshot.binding, binding)
    );
  }

  function purgeExpired(now = clock()) {
    for (const [resultId, snapshot] of snapshots)
      if (snapshot.expiresAt <= now) snapshots.delete(resultId);
  }

  /** @param {{features: CapabilityFeature[], truncated: boolean|null}} result
   * @param {ReferenceBinding} binding */
  function register(result = {}, binding) {
    if (disposed)
      return error('FEATURE_REF_EXPIRED', 'Store has been disposed');
    purgeExpired();
    const bindingError = validateBinding(binding);
    if (bindingError) return bindingError;
    let features;
    let truncated;
    try {
      if (!isPlainObject(result))
        return error('INVALID_ARGUMENT', 'Invalid snapshot result');
      const featureDescriptor = Object.getOwnPropertyDescriptor(
        result,
        'features'
      );
      if (
        Array.isArray(featureDescriptor?.value) &&
        featureDescriptor.value.length > MAX_FEATURES
      )
        return error(
          'RESULT_LIMIT_EXCEEDED',
          'Snapshot exceeds feature limits'
        );
      if (!isJsonValue(result))
        return error('INVALID_ARGUMENT', 'Invalid snapshot result');
      ({ features, truncated } = result);
    } catch {
      return error('INVALID_ARGUMENT', 'Invalid snapshot result');
    }
    if (!Array.isArray(features) || ![true, false, null].includes(truncated))
      return error('INVALID_ARGUMENT', 'Invalid snapshot result');
    if (features.length > MAX_FEATURES)
      return error('RESULT_LIMIT_EXCEEDED', 'Snapshot exceeds feature limits');
    if (!features.every(validFeature))
      return error('INVALID_ARGUMENT', 'Snapshot contains an invalid Feature');

    if (features.length === 0)
      return success({
        resultId: null,
        ref: null,
        featureCount: 0,
        truncated,
        expiresAt: null,
      });

    const snapshotJson = JSON.stringify({ features, truncated });
    const bytes = new TextEncoder().encode(snapshotJson).byteLength;
    if (bytes > MAX_SNAPSHOT_BYTES)
      return error('RESULT_LIMIT_EXCEEDED', 'Snapshot exceeds size limit');
    if (findByWorkflow(binding).length >= MAX_SNAPSHOTS)
      return error('RESULT_LIMIT_EXCEEDED', 'Workflow snapshot limit reached');
    let resultId;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = makeId();
        if (
          typeof candidate === 'string' &&
          candidate.length > 0 &&
          !snapshots.has(candidate)
        ) {
          resultId = candidate;
          break;
        }
      }
    } catch {
      return error(
        'RESULT_ID_UNAVAILABLE',
        'Unable to allocate a result reference'
      );
    }
    if (!resultId)
      return error(
        'RESULT_ID_UNAVAILABLE',
        'Unable to allocate a result reference'
      );
    const now = clock();
    if (binding.leaseExpiresAt <= now) return error('FEATURE_REF_EXPIRED');
    const expiresAt = Math.min(now + TTL_MS, binding.leaseExpiresAt);
    snapshots.set(resultId, {
      resultId,
      binding: Object.fromEntries(
        BINDING_FIELDS.map((field) => [field, binding[field]])
      ),
      features: cloneJson(features),
      truncated,
      expiresAt,
    });
    return success({
      resultId,
      ref: { resultId },
      featureCount: features.length,
      truncated,
      expiresAt,
    });
  }

  /** @param {FeatureRef} ref @param {ReferenceBinding} binding */
  function resolve(ref, binding) {
    if (disposed)
      return error('FEATURE_REF_EXPIRED', 'Store has been disposed');
    purgeExpired();
    const bindingError = validateBinding(binding);
    if (bindingError) return bindingError;
    if (!validReference(ref))
      return error('INVALID_ARGUMENT', 'Invalid feature reference');
    const resultId = Object.getOwnPropertyDescriptor(ref, 'resultId').value;
    const snapshot = snapshots.get(resultId);
    if (!snapshot)
      return error('FEATURE_REF_EXPIRED', 'Feature reference is unavailable');
    if (!sameIdentity(snapshot.binding, binding))
      return error(
        'FEATURE_REF_FORBIDDEN',
        'Feature reference belongs to another identity'
      );
    if (snapshot.binding.configVersion !== binding.configVersion)
      return error('STALE_CONTEXT', 'Configuration has changed');
    if (snapshot.expiresAt <= clock()) {
      snapshots.delete(resultId);
      return error('FEATURE_REF_EXPIRED', 'Feature reference has expired');
    }
    const indices = Object.hasOwn(ref, 'indices')
      ? Object.getOwnPropertyDescriptor(ref, 'indices').value
      : undefined;
    if (
      indices !== undefined &&
      (!Array.isArray(indices) ||
        indices.length === 0 ||
        new Set(indices).size !== indices.length ||
        indices.some(
          (index) =>
            !Number.isInteger(index) ||
            index < 0 ||
            index >= snapshot.features.length
        ))
    )
      return error('INVALID_ARGUMENT', 'Feature reference indices are invalid');
    const selected =
      indices === undefined
        ? snapshot.features
        : indices.map((index) => snapshot.features[index]);
    return success({
      resultId,
      features: cloneJson(selected),
      truncated: snapshot.truncated,
    });
  }

  /** @param {ReferenceBinding} binding */
  function revokeWorkflow(binding) {
    if (disposed) return success({ revokedCount: 0 });
    purgeExpired();
    const bindingError = validateBinding(binding);
    if (bindingError) return bindingError;
    const owned = findByWorkflow(binding);
    owned.forEach((snapshot) => snapshots.delete(snapshot.resultId));
    return success({ revokedCount: owned.length });
  }

  function dispose() {
    disposed = true;
    snapshots.clear();
  }

  return { register, resolve, revokeWorkflow, dispose };
}

export const FEATURE_REFERENCE_LIMITS = Object.freeze({
  ttlMs: TTL_MS,
  maxSnapshots: MAX_SNAPSHOTS,
  maxFeatures: MAX_FEATURES,
  maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
});
