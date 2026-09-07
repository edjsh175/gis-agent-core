import { describe, expect, it } from 'vitest';
import {
  createFeatureReferenceStore,
  FEATURE_REFERENCE_LIMITS,
} from '../../src/gis/integration/featureReferenceStore.js';

const binding = (overrides = {}) => ({
  userId: 'user-1',
  browserSessionId: 'browser-1',
  threadId: 'thread-1',
  workflowId: 'workflow-1',
  configVersion: 'config-1',
  leaseExpiresAt: 100_000,
  ...overrides,
});
const feature = (id = 'a') => ({
  type: 'Feature',
  layerId: 'roads',
  sourceFeatureId: id,
  properties: { name: 'Main' },
  geometry: { type: 'Point', coordinates: [1, 2] },
});

describe('feature reference store', () => {
  it('partitions quotas and revocation by the full identity binding', () => {
    let id = 0;
    const store = createFeatureReferenceStore({
      clock: () => 0,
      idFactory: () => String(++id),
    });
    const result = { features: [feature()], truncated: false };
    const refs = Array.from(
      { length: 10 },
      () => store.register(result, binding()).data.ref
    );
    const other = binding({ userId: 'user-2' });
    const own = store.register(result, other);
    expect(own.ok).toBe(true);
    for (const key of [
      'userId',
      'browserSessionId',
      'threadId',
      'workflowId',
    ]) {
      expect(
        store.resolve(refs[0], binding({ [key]: 'different' })).error.code
      ).toBe('FEATURE_REF_FORBIDDEN');
    }
    expect(
      store.revokeWorkflow(binding({ configVersion: 'changed' })).data
        .revokedCount
    ).toBe(10);
    expect(store.resolve(own.data.ref, other).ok).toBe(true);
    store.dispose();
    expect(store.resolve(own.data.ref, other).error.code).toBe(
      'FEATURE_REF_EXPIRED'
    );
    expect(store.register(result, other).error.code).toBe(
      'FEATURE_REF_EXPIRED'
    );
  });

  it('bounds allocation failures without overwriting existing snapshots', () => {
    const store = createFeatureReferenceStore({
      clock: () => 0,
      idFactory: () => 'same',
    });
    const result = { features: [feature()], truncated: false };
    const first = store.register(result, binding());
    expect(store.register(result, binding()).error.code).toBe(
      'RESULT_ID_UNAVAILABLE'
    );
    expect(store.resolve(first.data.ref, binding()).ok).toBe(true);
    const broken = createFeatureReferenceStore({
      clock: () => 0,
      idFactory() {
        throw new Error('unavailable');
      },
    });
    expect(broken.register(result, binding()).error.code).toBe(
      'RESULT_ID_UNAVAILABLE'
    );
  });

  it('rejects cyclic, accessor, sparse and non JSON payloads without invoking accessors', () => {
    const store = createFeatureReferenceStore({ clock: () => 0 });
    const cyclic = feature();
    cyclic.properties.self = cyclic;
    let invoked = false;
    const accessor = feature();
    Object.defineProperty(accessor, 'properties', {
      enumerable: true,
      get() {
        invoked = true;
        return {};
      },
    });
    const serializer = feature();
    Object.defineProperty(serializer, 'toJSON', {
      value() {
        invoked = true;
        return feature();
      },
    });
    for (const input of [
      null,
      { features: [cyclic], truncated: false },
      { features: [accessor], truncated: false },
      { features: [serializer], truncated: false },
      { features: Array(1), truncated: false },
      {
        features: [{ ...feature(), properties: new Date() }],
        truncated: false,
      },
    ]) {
      expect(store.register(input, binding()).error.code).toBe(
        'INVALID_ARGUMENT'
      );
    }
    expect(invoked).toBe(false);
  });

  it('preserves missing source IDs, null geometry and line snapshots and strictly validates refs', () => {
    const store = createFeatureReferenceStore({
      clock: () => 0,
      idFactory: () => 'line',
    });
    const line = {
      ...feature(null),
      geometry: {
        type: 'LineString',
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
    };
    const registered = store.register(
      { features: [line, { ...feature(0), geometry: null }], truncated: null },
      binding()
    );
    expect(registered.ok).toBe(true);
    expect(
      store.resolve({ resultId: 'line', indices: [1, 0] }, binding()).data
        .features
    ).toEqual([{ ...feature(0), geometry: null }, line]);
    for (const ref of [
      'line',
      { resultId: 'line', indices: [] },
      { resultId: 'line', indices: [0, 0] },
      { resultId: 'line', indices: [2] },
      { resultId: 'line', indices: [-1] },
      { resultId: 'line', indices: [0.5] },
      { resultId: 'line', indices: Array(1) },
      { resultId: 'line', url: '/unexpected' },
    ]) {
      expect(store.resolve(ref, binding()).error.code).toBe('INVALID_ARGUMENT');
    }
  });

  it('does not extend issued references after lease renewal and frees expired quota', () => {
    let now = 0;
    let id = 0;
    const store = createFeatureReferenceStore({
      clock: () => now,
      idFactory: () => String(++id),
    });
    const result = { features: [feature()], truncated: false };
    const old = store.register(result, binding()).data.ref;
    now = 100_000;
    const renewed = binding({ leaseExpiresAt: 200_000 });
    expect(store.resolve(old, renewed).error.code).toBe('FEATURE_REF_EXPIRED');
    expect(store.register(result, renewed).ok).toBe(true);
  });

  it('isolates workflows and returns immutable snapshots', () => {
    let now = 0;
    const store = createFeatureReferenceStore({
      clock: () => now,
      idFactory: () => 'ref-1',
    });
    const input = [feature()];
    const registered = store.register(
      { features: input, truncated: false },
      binding()
    );
    input[0].properties.name = 'changed';
    expect(registered.data).toMatchObject({
      resultId: 'ref-1',
      featureCount: 1,
      truncated: false,
    });
    expect(registered.data.expiresAt).toBe(100_000);

    const resolved = store.resolve(registered.data.ref, binding());
    resolved.data.features[0].properties.name = 'mutated';
    expect(
      store.resolve(registered.data.ref, binding()).data.features[0].properties
        .name
    ).toBe('Main');
    expect(
      store.resolve(registered.data.ref, binding({ workflowId: 'other' })).error
        .code
    ).toBe('FEATURE_REF_FORBIDDEN');
    expect(store.revokeWorkflow(binding()).data.revokedCount).toBe(1);
    expect(store.resolve(registered.data.ref, binding()).error.code).toBe(
      'FEATURE_REF_EXPIRED'
    );
  });

  it('checks configuration, lease, and ten minute lifetime', () => {
    let now = 0;
    const store = createFeatureReferenceStore({
      clock: () => now,
      idFactory: () => 'ref-2',
    });
    const registered = store.register(
      { features: [feature()], truncated: null },
      binding({ leaseExpiresAt: 900_000 })
    );
    expect(registered.data.expiresAt).toBe(FEATURE_REFERENCE_LIMITS.ttlMs);
    expect(
      store.resolve(
        registered.data.ref,
        binding({ configVersion: 'config-2', leaseExpiresAt: 900_000 })
      ).error.code
    ).toBe('STALE_CONTEXT');
    now = 600_000;
    expect(
      store.resolve(registered.data.ref, binding({ leaseExpiresAt: 900_000 }))
        .error.code
    ).toBe('FEATURE_REF_EXPIRED');
    expect(
      store.register(
        { features: [feature()], truncated: false },
        binding({ leaseExpiresAt: now })
      ).error.code
    ).toBe('FEATURE_REF_EXPIRED');
  });

  it('enforces snapshot, feature, and serialized size limits', () => {
    let id = 0;
    const store = createFeatureReferenceStore({
      clock: () => 0,
      idFactory: () => `ref-${++id}`,
    });
    const b = binding();
    for (let i = 0; i < FEATURE_REFERENCE_LIMITS.maxSnapshots; i++)
      expect(
        store.register({ features: [feature(String(i))], truncated: false }, b)
          .ok
      ).toBe(true);
    expect(
      store.register({ features: [feature('too-many')], truncated: false }, b)
        .ok
    ).toBe(false);
    expect(
      store.register(
        {
          features: Array.from({ length: 101 }, (_, i) => feature(String(i))),
          truncated: false,
        },
        binding({ workflowId: 'other' })
      ).error.code
    ).toBe('RESULT_LIMIT_EXCEEDED');
    expect(
      store.register(
        {
          features: [{ type: 'Feature', properties: {}, geometry: null }],
          truncated: false,
        },
        binding({ workflowId: 'invalid' })
      ).error.code
    ).toBe('INVALID_ARGUMENT');
    expect(
      store.register(
        { features: [feature('x'.repeat(6 * 1024 * 1024))], truncated: false },
        binding({ workflowId: 'large' })
      ).error.code
    ).toBe('RESULT_LIMIT_EXCEEDED');
  });

  it('returns no executable reference for empty results and validates indices', () => {
    const store = createFeatureReferenceStore({
      clock: () => 0,
      idFactory: () => 'unused',
    });
    const empty = store.register({ features: [], truncated: false }, binding());
    expect(empty.data.ref).toBeNull();
    const registered = store.register(
      { features: [feature(), feature('b')], truncated: true },
      binding({ workflowId: 'wf-2' })
    );
    expect(
      store.resolve(
        { resultId: registered.data.resultId, indices: [1] },
        binding({ workflowId: 'wf-2' })
      ).data.features
    ).toHaveLength(1);
    expect(
      store.resolve(
        { resultId: registered.data.resultId, indices: [] },
        binding({ workflowId: 'wf-2' })
      ).error.code
    ).toBe('INVALID_ARGUMENT');
  });
});
