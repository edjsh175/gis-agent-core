import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  resolveCardBindings,
  validateCardSpec,
} from '../../src/business-artifacts/contracts.js';

const json = (value) => JSON.stringify(value);

function error(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
function requireContext(context) {
  if (
    !context ||
    typeof context.principalId !== 'string' ||
    !context.principalId ||
    typeof context.workspaceId !== 'string' ||
    !context.workspaceId
  ) {
    throw error('UNAUTHENTICATED', '可信主体和工作区上下文是必需的');
  }
}

function readSnapshot(row) {
  return {
    statistics_ref: row.statistics_ref,
    schemaVersion: row.schema_version,
    dataset: row.dataset,
    calculatedAt: row.calculated_at,
    scope: JSON.parse(row.scope_json),
    query: JSON.parse(row.query_json),
    data: JSON.parse(row.data_json),
    schema: JSON.parse(row.schema_json),
    createdBy: row.created_by,
    workflowId: row.workflow_id,
  };
}
function readCard(row) {
  return {
    cardId: row.card_id,
    workspaceId: row.workspace_id,
    schemaVersion: row.schema_version,
    spec: JSON.parse(row.spec_json),
    statisticsRefs: JSON.parse(row.statistics_refs_json),
    status: row.status,
    createdBy: row.created_by,
    createdByAgent: Boolean(row.created_by_agent),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}

export function createBusinessArtifactRepository({
  filename = '.business-artifacts/cards.sqlite',
} = {}) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  const version = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (version > 1) {
    db.close();
    throw error(
      'UNSUPPORTED_DB_VERSION',
      `database version ${version} is newer than supported version 1`
    );
  }
  db.exec(`CREATE TABLE IF NOT EXISTS statistics_snapshots (
    statistics_ref TEXT PRIMARY KEY, principal_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    workflow_id TEXT, schema_version TEXT NOT NULL, dataset TEXT NOT NULL, calculated_at TEXT NOT NULL,
    scope_json TEXT NOT NULL, query_json TEXT NOT NULL, data_json TEXT NOT NULL, schema_json TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS card_records (
    card_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    schema_version TEXT NOT NULL, spec_json TEXT NOT NULL, statistics_refs_json TEXT NOT NULL,
    status TEXT NOT NULL, created_by TEXT NOT NULL, created_by_agent INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cards_scope ON card_records(principal_id, workspace_id);
  CREATE INDEX IF NOT EXISTS snapshots_scope ON statistics_snapshots(principal_id, workspace_id);`);
  if (version === 0) db.exec('PRAGMA user_version = 1;');
  const snapshotByRef = db.prepare(
    'SELECT * FROM statistics_snapshots WHERE statistics_ref = ? AND principal_id = ? AND workspace_id = ?'
  );
  const snapshotsFor = (context, refs = null) => {
    const rows = refs
      ? refs
          .map((ref) =>
            snapshotByRef.get(ref, context.principalId, context.workspaceId)
          )
          .filter(Boolean)
      : db
          .prepare(
            'SELECT * FROM statistics_snapshots WHERE principal_id = ? AND workspace_id = ? ORDER BY calculated_at DESC'
          )
          .all(context.principalId, context.workspaceId);
    return rows.map(readSnapshot);
  };
  const findRefs = (spec) => {
    const refs = new Set();
    for (const block of spec.blocks) {
      if (block.type === 'metric_group')
        block.items.forEach((item) => refs.add(item.value.statistics_ref));
      if (block.type === 'chart' || block.type === 'table')
        refs.add(block.source.statistics_ref);
    }
    return [...refs];
  };
  function insertSnapshot(context, snapshotData = {}) {
    const ref = `stat_${randomUUID()}`;
    const scope = {
      ...(snapshotData.scope || {}),
      workspaceId: context.workspaceId,
    };
    db.prepare(
      `INSERT INTO statistics_snapshots (statistics_ref,principal_id,workspace_id,workflow_id,schema_version,dataset,calculated_at,scope_json,query_json,data_json,schema_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      ref,
      context.principalId,
      context.workspaceId,
      context.workflowId || snapshotData.workflowId || null,
      snapshotData.schemaVersion || 'statistics/v1',
      snapshotData.dataset || 'unknown',
      snapshotData.calculatedAt || new Date().toISOString(),
      json(scope),
      json(snapshotData.query || {}),
      json(snapshotData.data),
      json(snapshotData.schema || {}),
      context.principalId
    );
    return readSnapshot(
      db
        .prepare('SELECT * FROM statistics_snapshots WHERE statistics_ref = ?')
        .get(ref)
    );
  }
  function saveStatisticsSnapshot(context, snapshotData = {}) {
    requireContext(context);
    if (
      !snapshotData ||
      typeof snapshotData !== 'object' ||
      Array.isArray(snapshotData) ||
      !snapshotData.data
    )
      throw error('INVALID_STATISTICS_SNAPSHOT', 'snapshot data is required');
    return insertSnapshot(context, snapshotData);
  }
  function createCard(context, spec) {
    requireContext(context);
    const valid = validateCardSpec(spec);
    const refs = findRefs(valid);
    const snapshots = snapshotsFor(context, refs);
    if (snapshots.length !== refs.length)
      throw error('CARD_BINDING_INVALID', 'statistics_ref is not accessible');
    if (
      context.workflowId &&
      snapshots.some((s) => s.workflowId !== context.workflowId)
    )
      throw error(
        'CARD_BINDING_INVALID',
        'statistics_ref is outside the current workflow'
      );
    resolveCardBindings(valid, snapshots);
    const cardId = `card_${randomUUID()}`;
    const now = new Date().toISOString();
    try {
      db.exec('BEGIN');
      db.prepare(
        'INSERT INTO card_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(
        cardId,
        context.principalId,
        context.workspaceId,
        valid.schemaVersion,
        json(valid),
        json(refs),
        'active',
        context.principalId,
        context.createdByAgent === true ? 1 : 0,
        now,
        now,
        1
      );
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      const e = error('CARD_PERSIST_FAILED', 'unable to persist card');
      e.cause = cause;
      throw e;
    }
    return {
      card: readCard(
        db.prepare('SELECT * FROM card_records WHERE card_id = ?').get(cardId)
      ),
      snapshots,
    };
  }
  function listCards(context, { includeArchived = false } = {}) {
    requireContext(context);
    const rows = includeArchived
      ? db
          .prepare(
            'SELECT * FROM card_records WHERE principal_id = ? AND workspace_id = ? AND status IN (?, ?) ORDER BY created_at DESC'
          )
          .all(context.principalId, context.workspaceId, 'active', 'archived')
      : db
          .prepare(
            'SELECT * FROM card_records WHERE principal_id = ? AND workspace_id = ? AND status = ? ORDER BY created_at DESC'
          )
          .all(context.principalId, context.workspaceId, 'active');
    const cards = rows.map(readCard);
    const refs = [...new Set(cards.flatMap((card) => card.statisticsRefs))];
    return { cards, snapshots: snapshotsFor(context, refs) };
  }
  function getCard(context, id) {
    requireContext(context);
    const row = db
      .prepare(
        'SELECT * FROM card_records WHERE card_id = ? AND principal_id = ? AND workspace_id = ?'
      )
      .get(id, context.principalId, context.workspaceId);
    if (!row) throw error('CARD_NOT_FOUND', 'card not found');
    const card = readCard(row);
    return { card, snapshots: snapshotsFor(context, card.statisticsRefs) };
  }
  function updateCardAtomic(context, cardId, expectedRevision, spec) {
    requireContext(context);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw error(
        'CARD_REVISION_INVALID',
        'expectedRevision must be a positive integer'
      );
    const valid = validateCardSpec(spec);
    const nextRefs = findRefs(valid);
    let result;
    try {
      db.exec('BEGIN');
      const row = db
        .prepare(
          'SELECT * FROM card_records WHERE card_id = ? AND principal_id = ? AND workspace_id = ? AND status = ?'
        )
        .get(cardId, context.principalId, context.workspaceId, 'active');
      if (!row) throw error('CARD_NOT_FOUND', 'card not found');
      if (row.revision !== expectedRevision)
        throw error('CARD_REVISION_CONFLICT', 'card revision has changed');
      const current = readCard(row);
      const snapshots = snapshotsFor(context, nextRefs);
      if (snapshots.length !== nextRefs.length)
        throw error('CARD_BINDING_INVALID', 'statistics_ref is not accessible');
      const retainedRefs = new Set(current.statisticsRefs);
      if (
        context.workflowId &&
        snapshots.some(
          (snapshot) =>
            !retainedRefs.has(snapshot.statistics_ref) &&
            snapshot.workflowId !== context.workflowId
        )
      )
        throw error(
          'CARD_BINDING_INVALID',
          'new statistics_ref is outside the current workflow'
        );
      resolveCardBindings(valid, snapshots);
      const now = new Date().toISOString();
      const update = db
        .prepare(
          'UPDATE card_records SET schema_version = ?, spec_json = ?, statistics_refs_json = ?, updated_at = ?, revision = revision + 1 WHERE card_id = ? AND principal_id = ? AND workspace_id = ? AND status = ? AND revision = ?'
        )
        .run(
          valid.schemaVersion,
          json(valid),
          json(nextRefs),
          now,
          cardId,
          context.principalId,
          context.workspaceId,
          'active',
          expectedRevision
        );
      if (update.changes !== 1)
        throw error('CARD_REVISION_CONFLICT', 'card revision has changed');
      result = {
        card: readCard(
          db.prepare('SELECT * FROM card_records WHERE card_id = ?').get(cardId)
        ),
        snapshots,
      };
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      if (
        cause.code === 'CARD_NOT_FOUND' ||
        cause.code === 'CARD_REVISION_CONFLICT' ||
        cause.code === 'CARD_BINDING_INVALID'
      )
        throw cause;
      const e = error('CARD_PERSIST_FAILED', 'unable to update card');
      e.cause = cause;
      throw e;
    }
    return result;
  }
  function archiveCardAtomic(context, cardId, expectedRevision) {
    requireContext(context);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw error(
        'CARD_REVISION_INVALID',
        'expectedRevision must be a positive integer'
      );
    let result;
    try {
      db.exec('BEGIN');
      const row = db
        .prepare(
          'SELECT * FROM card_records WHERE card_id = ? AND principal_id = ? AND workspace_id = ?'
        )
        .get(cardId, context.principalId, context.workspaceId);
      if (!row) throw error('CARD_NOT_FOUND', 'card not found');
      if (row.revision !== expectedRevision)
        throw error('CARD_REVISION_CONFLICT', 'card revision has changed');
      if (row.status !== 'active')
        throw error('CARD_STATE_CONFLICT', 'card is not active');
      const now = new Date().toISOString();
      const update = db
        .prepare(
          'UPDATE card_records SET status = ?, updated_at = ?, revision = revision + 1 WHERE card_id = ? AND principal_id = ? AND workspace_id = ? AND status = ? AND revision = ?'
        )
        .run(
          'archived',
          now,
          cardId,
          context.principalId,
          context.workspaceId,
          'active',
          expectedRevision
        );
      if (update.changes !== 1)
        throw error('CARD_REVISION_CONFLICT', 'card revision has changed');
      const card = readCard(
        db.prepare('SELECT * FROM card_records WHERE card_id = ?').get(cardId)
      );
      result = { card, snapshots: snapshotsFor(context, card.statisticsRefs) };
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      if (
        cause.code === 'CARD_NOT_FOUND' ||
        cause.code === 'CARD_REVISION_CONFLICT' ||
        cause.code === 'CARD_STATE_CONFLICT'
      )
        throw cause;
      const e = error('CARD_PERSIST_FAILED', 'unable to archive card');
      e.cause = cause;
      throw e;
    }
    return result;
  }

  function deleteCardAtomic(context, cardId, expectedRevision) {
    requireContext(context);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw error(
        'CARD_REVISION_INVALID',
        'expectedRevision must be a positive integer'
      );
    let result;
    try {
      db.exec('BEGIN');
      const row = db
        .prepare(
          'SELECT * FROM card_records WHERE card_id = ? AND principal_id = ? AND workspace_id = ?'
        )
        .get(cardId, context.principalId, context.workspaceId);
      if (!row) throw error('CARD_NOT_FOUND', 'card not found');
      if (row.revision !== expectedRevision)
        throw error('CARD_REVISION_CONFLICT', 'card revision has changed');
      const deletedAt = new Date().toISOString();
      const removalRevision = expectedRevision + 1;
      const deletion = db
        .prepare(
          'DELETE FROM card_records WHERE card_id = ? AND principal_id = ? AND workspace_id = ? AND revision = ?'
        )
        .run(
          cardId,
          context.principalId,
          context.workspaceId,
          expectedRevision
        );
      if (deletion.changes !== 1)
        throw error('CARD_REVISION_CONFLICT', 'card revision has changed');
      result = {
        cardId,
        revision: removalRevision,
        previousStatus: row.status,
        status: 'deleted',
        deletedAt,
      };
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      if (
        cause.code === 'CARD_NOT_FOUND' ||
        cause.code === 'CARD_REVISION_CONFLICT'
      )
        throw cause;
      const e = error('CARD_PERSIST_FAILED', 'unable to delete card');
      e.cause = cause;
      throw e;
    }
    return result;
  }

  function refreshCardAtomic(context, cardId, expectedRevision, replacements) {
    requireContext(context);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw error(
        'CARD_REVISION_INVALID',
        'expectedRevision must be a positive integer'
      );
    if (
      !replacements ||
      typeof replacements !== 'object' ||
      Array.isArray(replacements)
    )
      throw error(
        'INVALID_STATISTICS_SNAPSHOT',
        'refresh replacements are required'
      );
    let result;
    try {
      db.exec('BEGIN');
      const row = db
        .prepare(
          'SELECT * FROM card_records WHERE card_id = ? AND principal_id = ? AND workspace_id = ? AND status = ?'
        )
        .get(cardId, context.principalId, context.workspaceId, 'active');
      if (!row) throw error('CARD_NOT_FOUND', 'card not found');
      if (row.revision !== expectedRevision)
        throw error('CARD_REVISION_CONFLICT', 'card revision has changed');
      const current = readCard(row);
      const refs = current.statisticsRefs;
      if (!refs.length)
        throw error(
          'CARD_REFRESH_UNSUPPORTED',
          'card has no statistics snapshot'
        );
      const keys = Object.keys(replacements);
      if (
        keys.length !== refs.length ||
        refs.some((ref) => !Object.hasOwn(replacements, ref))
      )
        throw error(
          'CARD_BINDING_INVALID',
          'refresh replacements do not match card references'
        );
      const originals = snapshotsFor(context, refs);
      if (originals.length !== refs.length)
        throw error(
          'CARD_BINDING_INVALID',
          'card statistics snapshot is unavailable'
        );
      const inserted = [];
      for (const oldRef of refs) {
        const snapshotData = replacements[oldRef];
        if (
          !snapshotData ||
          typeof snapshotData !== 'object' ||
          Array.isArray(snapshotData) ||
          !snapshotData.data
        )
          throw error(
            'INVALID_STATISTICS_SNAPSHOT',
            'replacement snapshot data is invalid'
          );
        inserted.push(
          insertSnapshot({ ...context, workflowId: null }, snapshotData)
        );
      }
      const byOld = new Map(
        refs.map((ref, index) => [ref, inserted[index].statistics_ref])
      );
      const nextSpec = JSON.parse(JSON.stringify(current.spec));
      for (const block of nextSpec.blocks) {
        if (block.type === 'metric_group')
          block.items.forEach((item) => {
            item.value.statistics_ref = byOld.get(item.value.statistics_ref);
          });
        if (block.type === 'chart' || block.type === 'table')
          block.source.statistics_ref = byOld.get(block.source.statistics_ref);
      }
      const next = validateCardSpec(nextSpec);
      const nextRefs = findRefs(next);
      resolveCardBindings(next, inserted);
      const now = new Date().toISOString();
      const update = db
        .prepare(
          'UPDATE card_records SET spec_json = ?, statistics_refs_json = ?, updated_at = ?, revision = revision + 1 WHERE card_id = ? AND principal_id = ? AND workspace_id = ? AND status = ? AND revision = ?'
        )
        .run(
          json(next),
          json(nextRefs),
          now,
          cardId,
          context.principalId,
          context.workspaceId,
          'active',
          expectedRevision
        );
      if (update.changes !== 1)
        throw error('CARD_REVISION_CONFLICT', 'card revision has changed');
      result = {
        card: readCard(
          db.prepare('SELECT * FROM card_records WHERE card_id = ?').get(cardId)
        ),
        snapshots: inserted,
      };
      db.exec('COMMIT');
    } catch (cause) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      if (
        cause.code === 'CARD_NOT_FOUND' ||
        cause.code === 'CARD_REVISION_CONFLICT' ||
        cause.code === 'CARD_BINDING_INVALID' ||
        cause.code === 'INVALID_STATISTICS_SNAPSHOT' ||
        cause.code === 'CARD_REFRESH_UNSUPPORTED'
      )
        throw cause;
      const e = error('CARD_PERSIST_FAILED', 'unable to refresh card');
      e.cause = cause;
      throw e;
    }
    return result;
  }
  return {
    createCard,
    listCards,
    getCard,
    refreshCardAtomic,
    updateCardAtomic,
    archiveCardAtomic,
    deleteCardAtomic,
    saveStatisticsSnapshot,
    close: () => db.close(),
  };
}
