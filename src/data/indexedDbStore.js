import { deleteDB, openDB } from 'idb';
import { apiGetSales, apiGetInvoices } from './workspaceApi';
import { logSystemEvent } from '../services/monitoring';
import { enterGlobalSafeMode, isGlobalSafeMode } from './globalSafeMode';
import { runRegisteredMigrations } from './idbMigrationRegistry';
import { trackCursorPageLoad } from '../services/performanceGuards';

const DB_NAME = 'mohaseb_db';
export const SCHEMA_DB_VERSION = 5;
const DB_VERSION = SCHEMA_DB_VERSION;
const ARCHIVE_MONTHS_DEFAULT = 6;
const SIZE_LIMIT_BYTES = 40 * 1024 * 1024;
const META_STORE = 'meta';

const STORES = [
  'products',
  'sales',
  'invoices',
  'transactions',
  'customers',
  'sync_queue',
  'sync_dead_letter_queue',
  'subscription_cache',
];

let _dbPromise = null;
let _archiveMonths = ARCHIVE_MONTHS_DEFAULT;

// Runtime stability: trigger Safe Mode when repeated IDB operational failures happen.
const IDB_ERROR_WINDOW_MS = 60_000;
const IDB_ERROR_THRESHOLD = 5;
let _idbErrorCount = 0;
let _idbErrorWindowStart = Date.now();
let _lastSafeModeTriggerAt = 0;

// Reindex jobs are best-effort and protected with cooldown / in-flight de-dupe.
const REINDEX_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h
const REINDEX_YIELD_EVERY = 2000;
const REINDEX_MAX_RECORDS = 50_000;
const _reindexInFlight = new Map(); // storeName -> Promise<boolean>
const _reindexLastRanAt = new Map(); // storeName -> ms

function shouldYield(i) {
  return i > 0 && i % REINDEX_YIELD_EVERY === 0;
}

async function maybeEnterSafeModeFromIdbError(e, context) {
  const now = Date.now();
  if (now - _idbErrorWindowStart > IDB_ERROR_WINDOW_MS) {
    _idbErrorCount = 0;
    _idbErrorWindowStart = now;
  }
  _idbErrorCount += 1;

  if (_idbErrorCount < IDB_ERROR_THRESHOLD) return;

  // Avoid repeated Safe Mode triggers.
  if (now - _lastSafeModeTriggerAt < 60_000) return;
  _lastSafeModeTriggerAt = now;

  const msg = `${context || 'idb_error'}: ${e?.message || 'unknown'}`;
  void logSystemEvent('global_safe_mode_triggered', 'Repeated IDB errors — entering safe mode', {
    context,
    error: e?.message || 'unknown',
    count: _idbErrorCount,
  });
  enterGlobalSafeMode(msg);
}

function nowIso() {
  return new Date().toISOString();
}

function scopeKey(workspaceId, userId) {
  return `${workspaceId || 'none'}::${userId || 'guest'}`;
}

function rowKey(workspaceId, userId, id) {
  return `${scopeKey(workspaceId, userId)}::${id}`;
}

function safeJsonClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function isIndexedDbConstraintError(e) {
  const name = e?.name || '';
  // Chromium: ConstraintError. Some polyfills/browsers might vary.
  if (name && name.toLowerCase().includes('constraint')) return true;
  const msg = String(e?.message || '').toLowerCase();
  return msg.includes('constraint') || msg.includes('unique') || msg.includes('unique constraint');
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEntity(storeName, row) {
  const clean = safeJsonClone(row) || {};
  const id = clean.id || crypto.randomUUID();
  const updatedAt = clean.updatedAt || clean.createdAt || nowIso();
  return {
    ...clean,
    id,
    updatedAt,
    createdAt: clean.createdAt || nowIso(),
    _store: storeName,
  };
}

async function estimateDbSize() {
  if (!navigator?.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return estimate?.usage ?? null;
  } catch {
    return null;
  }
}

function createStoreIndexes(store, storeName) {
  store.createIndex('by_scope', 'scope');
  store.createIndex('by_scope_updatedAt', ['scope', 'updatedAt']);
  store.createIndex('by_scope_createdAt', ['scope', 'createdAt']);
  if (storeName === 'sales' || storeName === 'invoices' || storeName === 'transactions') {
    store.createIndex('by_scope_date', ['scope', 'date']);
  }
  if (storeName === 'sales') {
    store.createIndex('by_scope_syncStatus', ['scope', 'syncStatus']);
    store.createIndex('by_scope_createdAt_id', ['scope', 'createdAt', 'id']);
  }
  if (storeName === 'sync_queue') {
    store.createIndex('by_scope_dedupeKey', ['scope', 'dedupeKey'], { unique: true });
  }
}

function upgradeSalesIndexesV3(db, transaction) {
  if (!db.objectStoreNames.contains('sales')) return;
  const store = transaction.objectStore('sales');
  if (!store.indexNames.contains('by_scope_syncStatus')) {
    store.createIndex('by_scope_syncStatus', ['scope', 'syncStatus']);
  }
  if (!store.indexNames.contains('by_scope_createdAt_id')) {
    store.createIndex('by_scope_createdAt_id', ['scope', 'createdAt', 'id']);
  }
}

/**
 * @param {IDBDatabase} db
 * @param {number} oldVersion
 * @param {number} newVersion
 * @param {IDBTransaction} transaction
 */
function applySchemaUpgrade(db, oldVersion, newVersion, transaction) {
  for (const storeName of STORES) {
    if (!db.objectStoreNames.contains(storeName)) {
      const store = db.createObjectStore(storeName, { keyPath: '_pk' });
      createStoreIndexes(store, storeName);
    }
  }
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE, { keyPath: 'key' });
  }
  if (oldVersion < 3) {
    try {
      upgradeSalesIndexesV3(db, transaction);
    } catch (e) {
      void logSystemEvent('db_migration_failure', 'sales index upgrade v3 failed', { error: e?.message || 'unknown' });
    }
  }
  if (oldVersion < 4) {
    try {
      upgradeEntityCursorIndexesV4(db, transaction);
    } catch (e) {
      void logSystemEvent('db_migration_failure', 'cursor index upgrade v4 failed', { error: e?.message || 'unknown' });
    }
  }
  if (oldVersion < newVersion) {
    try {
      runRegisteredMigrations(db, transaction, oldVersion, newVersion);
    } catch (e) {
      void logSystemEvent('db_migration_failure', 'registered migrations failed', { error: e?.message || 'unknown' });
    }
  }
}

async function openWithRecovery() {
  try {
    return await openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        applySchemaUpgrade(db, oldVersion, newVersion, transaction);
      },
    });
  } catch (e) {
    try {
      void logSystemEvent('db_corruption', 'IndexedDB open failed; deleting/recreating DB', { error: e?.message || 'unknown' });
    } catch (_) {}
    await deleteDB(DB_NAME);
    try {
      return await openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) {
          applySchemaUpgrade(db, oldVersion, newVersion, transaction);
        },
      });
    } catch (e2) {
      enterGlobalSafeMode(e2?.message || String(e2));
      throw e2;
    }
  }
}

function upgradeEntityCursorIndexesV4(db, transaction) {
  for (const storeName of ['products', 'transactions']) {
    if (!db.objectStoreNames.contains(storeName)) continue;
    const store = transaction.objectStore(storeName);
    if (!store.indexNames.contains('by_scope_createdAt_id')) {
      store.createIndex('by_scope_createdAt_id', ['scope', 'createdAt', 'id']);
    }
  }
}

export function setArchiveThresholdMonths(months) {
  const m = Number(months);
  if (!Number.isFinite(m) || m < 1) return;
  _archiveMonths = m;
}

export async function getDb() {
  if (!_dbPromise) _dbPromise = openWithRecovery();
  return _dbPromise;
}

/** Clear cached connection (e.g. after global safe mode retry). */
export function resetDbConnection() {
  _dbPromise = null;
}

/**
 * Reindex by re-putting existing records back into the object store.
 * This forces IndexedDB to rebuild secondary index entries (best-effort).
 * @param {string} storeName
 * @param {{ reason?: string, recordsLimit?: number }} [opts]
 * @returns {Promise<boolean>} whether job completed (best-effort)
 */
export async function runReindexJob(storeName, opts = {}) {
  if (!storeName) return false;
  if (isGlobalSafeMode()) return false;
  if (!STORES.includes(storeName)) return false;

  const now = Date.now();
  const lastRanAt = _reindexLastRanAt.get(storeName) || 0;
  if (now - lastRanAt < REINDEX_COOLDOWN_MS) return false;

  const inFlight = _reindexInFlight.get(storeName);
  if (inFlight) return inFlight;

  const job = (async () => {
    _reindexLastRanAt.set(storeName, now);
    void logSystemEvent('db_reindex_start', 'Reindex job started', { storeName, reason: opts?.reason || 'unknown' });
    try {
      const db = await getDb();
      if (!db.objectStoreNames.contains(storeName)) return false;

      const recordsLimit = Number.isFinite(opts.recordsLimit) ? Number(opts.recordsLimit) : REINDEX_MAX_RECORDS;
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      let i = 0;
      let cursor = await store.openCursor();
      while (cursor) {
        await store.put(cursor.value);
        cursor = await cursor.continue();
        i += 1;

        if (i >= recordsLimit) break;
        if (shouldYield(i)) await new Promise((r) => setTimeout(r, 0));
      }
      await tx.done;
      void logSystemEvent('db_reindex_ok', 'Reindex job completed', { storeName, records: i, reason: opts?.reason || 'unknown' });
      return true;
    } catch (e) {
      void logSystemEvent('db_reindex_failure', 'Reindex job failed', {
        storeName,
        reason: opts?.reason || 'unknown',
        error: e?.message || 'unknown',
      });
      return false;
    } finally {
      _reindexInFlight.delete(storeName);
    }
  })();

  _reindexInFlight.set(storeName, job);
  return job;
}

/**
 * Best-effort: verify each store is readable after upgrade.
 */
export async function runPostOpenIntegrityChecks() {
  try {
    const db = await getDb();

    // Migration/meta mismatch => attempt reindex.
    if (db.objectStoreNames.contains(META_STORE)) {
      try {
        const meta = await db.get(META_STORE, 'db_schema_version');
        const metaVersion = meta?.version;
        if (metaVersion !== DB_VERSION) {
          void logSystemEvent('db_meta_mismatch', 'DB schema meta mismatch; attempting reindex', { metaVersion, expected: DB_VERSION });
          // Reindex only cursor-critical stores first (minimize cost).
          await Promise.all([
            runReindexJob('products', { reason: 'meta_mismatch' }),
            runReindexJob('transactions', { reason: 'meta_mismatch' }),
            runReindexJob('sales', { reason: 'meta_mismatch' }),
          ]);
        }
      } catch {
        // ignore; integrity checks will decide safe mode if it actually breaks reads.
      }
    }

    const verifyStore = async (storeName) => {
      if (!db.objectStoreNames.contains(storeName)) return;
      const tx = db.transaction(storeName, 'readonly');
      await tx.store.count();

      // Index structure smoke-test for cursor pagination stores.
      if (['products', 'transactions', 'sales', 'invoices'].includes(storeName)) {
        const store = tx.objectStore(storeName);
        const tryIndexNames =
          storeName === 'invoices'
            ? ['by_scope_createdAt']
            : ['by_scope_createdAt_id', 'by_scope_createdAt'];
        let indexOk = false;
        for (const idxName of tryIndexNames) {
          try {
            const idx = store.index(idxName);
            const cur = await idx.openCursor();
            // If openCursor succeeds, we consider index structurally reachable.
            void cur;
            indexOk = true;
            break;
          } catch {
            // try next index name fallback
          }
        }
        if (!indexOk) throw new Error(`index_smoke_test_failed:${storeName}`);
      }
      await tx.done;
    };

    for (const name of STORES) {
      if (!db.objectStoreNames.contains(name)) continue;
      try {
        await verifyStore(name);
      } catch (e) {
        void logSystemEvent('db_integrity_store_failure', 'Integrity check failed for store; attempting reindex', {
          storeName: name,
          error: e?.message || 'unknown',
        });
        const reindexed = await runReindexJob(name, { reason: 'integrity_check_failure' });
        if (!reindexed) throw e;
        await verifyStore(name);
      }
    }

    void logSystemEvent('db_integrity_ok', 'Post-open integrity checks OK', { version: DB_VERSION });
  } catch (e) {
    void logSystemEvent('db_integrity_failure', 'Post-open integrity check failed', { error: e?.message || 'unknown' });
    enterGlobalSafeMode(`db_integrity_failure:${e?.message || 'unknown'}`);
    throw e;
  }
}

async function putMany(storeName, workspaceId, userId, rows) {
  if (isGlobalSafeMode()) {
    void logSystemEvent('write_blocked_safe_mode', 'putMany', { storeName });
    const err = new Error('GLOBAL_SAFE_MODE');
    err.code = 'SAFE_MODE';
    throw err;
  }
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const scope = scopeKey(workspaceId, userId);
    for (const r of ensureArray(rows)) {
      const clean = normalizeEntity(storeName, r);
      await store.put({
        ...clean,
        scope,
        workspaceId,
        userId: userId || 'guest',
        _pk: rowKey(workspaceId, userId, clean.id),
        payload: clean,
      });
    }
    await tx.done;
  } catch (e) {
    void logSystemEvent('db_error', 'indexeddb putMany failed', { storeName, workspaceId, error: e?.message || 'unknown' });
    await maybeEnterSafeModeFromIdbError(e, `putMany:${storeName}`);
    throw e;
  }
}

async function readPaginated(storeName, workspaceId, userId, options = {}) {
  const { limit = 25, offset = 0, where = null, order = 'desc', indexName = 'by_scope_updatedAt' } = options;
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readonly');
    const scope = scopeKey(workspaceId, userId);
    const index = tx.objectStore(storeName).index(indexName);
    const range = IDBKeyRange.bound([scope, ''], [scope, '\uffff']);
    const rows = [];
    let skipped = 0;
    let cursor = await index.openCursor(range, order === 'asc' ? 'next' : 'prev');
    while (cursor) {
      const item = cursor.value?.payload;
      const ok = typeof where === 'function' ? where(item) : true;
      if (ok) {
        if (skipped < offset) skipped++;
        else {
          rows.push(item);
          if (rows.length >= limit) break;
        }
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return rows;
  } catch (e) {
    void logSystemEvent('db_error', 'indexeddb readPaginated failed', { storeName, workspaceId, error: e?.message || 'unknown' });
    await maybeEnterSafeModeFromIdbError(e, `readPaginated:${storeName}`);
    // Index-read errors can be recoverable by re-putting records.
    void runReindexJob(storeName, { reason: 'readPaginated_error' });
    return [];
  }
}

async function readAllByScope(storeName, workspaceId, userId) {
  try {
    const db = await getDb();
    const scope = scopeKey(workspaceId, userId);
    const tx = db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index('by_scope');
    const rows = await index.getAll(scope);
    await tx.done;
    return rows.map((r) => r.payload);
  } catch (e) {
    void logSystemEvent('db_error', 'indexeddb readAllByScope failed', { storeName, workspaceId, error: e?.message || 'unknown' });
    await maybeEnterSafeModeFromIdbError(e, `readAllByScope:${storeName}`);
    throw e;
  }
}

async function deleteOldRows(storeName, workspaceId, userId, beforeIsoDate) {
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    const index = tx.objectStore(storeName).index('by_scope_date');
    const scope = scopeKey(workspaceId, userId);
    const range = IDBKeyRange.bound([scope, ''], [scope, beforeIsoDate]);
    let cursor = await index.openCursor(range, 'next');
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (e) {
    void logSystemEvent('db_error', 'indexeddb deleteOldRows failed', { storeName, workspaceId, error: e?.message || 'unknown' });
    await maybeEnterSafeModeFromIdbError(e, `deleteOldRows:${storeName}`);
    throw e;
  }
}

function archiveCutoffIso() {
  const d = new Date();
  d.setMonth(d.getMonth() - _archiveMonths);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function getArchiveCutoffIso() {
  return archiveCutoffIso();
}

export async function archiveByAge(workspaceId, userId, onWarning) {
  if (!workspaceId) return false;
  const cutoff = archiveCutoffIso();
  await Promise.all([
    deleteOldRows('sales', workspaceId, userId, cutoff),
    deleteOldRows('invoices', workspaceId, userId, cutoff),
    deleteOldRows('transactions', workspaceId, userId, cutoff),
  ]);
  if (typeof onWarning === 'function') {
    try {
      onWarning({ cutoff, archiveMonths: _archiveMonths });
    } catch (_) {}
  }
  return true;
}

export async function enforceSizeGuard(onWarning) {
  const usage = await estimateDbSize();
  if (usage != null && usage > SIZE_LIMIT_BYTES) {
    if (typeof onWarning === 'function') onWarning({ usage, limit: SIZE_LIMIT_BYTES });
    return true;
  }
  return false;
}

export async function autoArchiveIfNeeded(workspaceId, userId, onWarning) {
  const over = await enforceSizeGuard(onWarning);
  if (!over) return false;
  const cutoff = archiveCutoffIso();
  await Promise.all([
    deleteOldRows('sales', workspaceId, userId, cutoff),
    deleteOldRows('invoices', workspaceId, userId, cutoff),
    deleteOldRows('transactions', workspaceId, userId, cutoff),
  ]);
  return true;
}

// ---------- Unified Public API ----------

export async function saveSales(workspaceId, userId, sales) {
  await putMany('sales', workspaceId, userId, sales);
}

export async function getSalesPaginated(workspaceId, userId, options = {}) {
  return readPaginated('sales', workspaceId, userId, {
    limit: 25,
    offset: 0,
    indexName: 'by_scope_createdAt',
    order: 'desc',
    ...options,
  });
}

/**
 * Single-record write for sales (no read-modify-save-all).
 * Ensures root fields used by compound indexes: createdAt, syncStatus, id.
 * @param {string} workspaceId
 * @param {string} userId
 * @param {Record<string, unknown>} record
 * @returns {Promise<boolean>}
 */
export async function putSaleRecord(workspaceId, userId, record) {
  if (!workspaceId || !userId || !record || typeof record !== 'object' || !record.id) return false;
  const now = nowIso();
  const createdAt =
    record.createdAt ||
    (record.date && typeof record.date === 'string' ? `${String(record.date).slice(0, 10)}T12:00:00.000Z` : now);
  const row = {
    ...record,
    id: record.id,
    createdAt,
    updatedAt: record.updatedAt || now,
    syncStatus: record.syncStatus != null ? String(record.syncStatus) : 'pending',
    date: record.date || (typeof createdAt === 'string' ? createdAt.slice(0, 10) : nowIso().slice(0, 10)),
  };
  await putMany('sales', workspaceId, userId, [row]);
  return true;
}

/**
 * Cursor page: order by createdAt DESC, then id DESC (tie-break).
 * @param {string} workspaceId
 * @param {string} userId
 * @param {{ limit?: number, cursor?: { createdAt: string, id: string }|null }} opts
 * @returns {Promise<{ items: any[], nextCursor: { createdAt: string, id: string }|null }>}
 */
export async function getSalesPageByCursor(workspaceId, userId, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 30));
  const cursorAfter = opts.cursor || null;
  const scope = scopeKey(workspaceId, userId);
  try {
    trackCursorPageLoad('sales');
    const db = await getDb();
    const tx = db.transaction('sales', 'readonly');
    const store = tx.objectStore('sales');
    let index;
    try {
      index = store.index('by_scope_createdAt_id');
    } catch {
      index = store.index('by_scope_createdAt');
    }
    const isTripleKey = index?.keyPath && Array.isArray(index.keyPath) && index.keyPath.length === 3;
    const range = cursorAfter?.createdAt && (cursorAfter?.id || !isTripleKey)
      ? (
        isTripleKey
          ? IDBKeyRange.lowerBound([scope, cursorAfter.createdAt, cursorAfter.id || ''], true)
          : IDBKeyRange.lowerBound([scope, cursorAfter.createdAt], true)
      )
      : (
        isTripleKey
          ? IDBKeyRange.bound([scope, '', ''], [scope, '\uffff', '\uffff'])
          : IDBKeyRange.bound([scope, ''], [scope, '\uffff'])
      );
    const items = [];
    let cur = await index.openCursor(range, 'prev');
    while (cur) {
      const row = cur.value;
      const item = row?.payload ?? row;
      if (row?.scope === scope && item) items.push(item);
      if (items.length >= limit) break;
      cur = await cur.continue();
    }
    await tx.done;
    const last = items[items.length - 1];
    const nextCursor =
      last && items.length === limit
        ? {
            createdAt: last.createdAt || (last.date ? `${String(last.date).slice(0, 10)}T12:00:00.000Z` : nowIso()),
            id: last.id,
          }
        : null;
    return { items, nextCursor };
  } catch (e) {
    void logSystemEvent('db_error', 'getSalesPageByCursor failed', { workspaceId, error: e?.message || 'unknown' });
    void runReindexJob('sales', { reason: 'cursor_page_error' });
    await maybeEnterSafeModeFromIdbError(e, 'cursor_read:sales');
    return { items: [], nextCursor: null };
  }
}

/**
 * Cursor page for products (newest first). Requires `by_scope_createdAt_id` (DB v4+).
 * @param {string} workspaceId
 * @param {string} userId
 * @param {{ limit?: number, cursor?: { createdAt: string, id: string }|null }} opts
 */
export async function getProductsPageByCursor(workspaceId, userId, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 30));
  const cursorAfter = opts.cursor || null;
  const scope = scopeKey(workspaceId, userId);
  try {
    trackCursorPageLoad('products');
    const db = await getDb();
    const tx = db.transaction('products', 'readonly');
    const store = tx.objectStore('products');
    let index;
    try {
      index = store.index('by_scope_createdAt_id');
    } catch {
      index = store.index('by_scope_createdAt');
    }
    const isTripleKey = index?.keyPath && Array.isArray(index.keyPath) && index.keyPath.length === 3;
    const range = cursorAfter?.createdAt && (cursorAfter?.id || !isTripleKey)
      ? (
        isTripleKey
          ? IDBKeyRange.lowerBound([scope, cursorAfter.createdAt, cursorAfter.id || ''], true)
          : IDBKeyRange.lowerBound([scope, cursorAfter.createdAt], true)
      )
      : (
        isTripleKey
          ? IDBKeyRange.bound([scope, '', ''], [scope, '\uffff', '\uffff'])
          : IDBKeyRange.bound([scope, ''], [scope, '\uffff'])
      );
    const items = [];
    let cur = await index.openCursor(range, 'prev');
    while (cur) {
      const row = cur.value;
      const item = row?.payload ?? row;
      if (row?.scope === scope && item) items.push(item);
      if (items.length >= limit) break;
      cur = await cur.continue();
    }
    await tx.done;
    const last = items[items.length - 1];
    const nextCursor =
      last && items.length === limit
        ? { createdAt: last.createdAt || last.updatedAt || nowIso(), id: last.id }
        : null;
    return { items, nextCursor };
  } catch (e) {
    void logSystemEvent('db_error', 'getProductsPageByCursor failed', { workspaceId, error: e?.message || 'unknown' });
    void runReindexJob('products', { reason: 'cursor_page_error' });
    await maybeEnterSafeModeFromIdbError(e, 'cursor_read:products');
    return { items: [], nextCursor: null };
  }
}

/**
 * Cursor page for transactions (newest first). Requires `by_scope_createdAt_id` (DB v4+).
 */
export async function getTransactionsPageByCursor(workspaceId, userId, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 30));
  const cursorAfter = opts.cursor || null;
  const scope = scopeKey(workspaceId, userId);
  const typeFilter = opts.type === 'income' || opts.type === 'expense' ? opts.type : null;
  try {
    trackCursorPageLoad('transactions');
    const db = await getDb();
    const tx = db.transaction('transactions', 'readonly');
    const store = tx.objectStore('transactions');
    let index;
    try {
      index = store.index('by_scope_createdAt_id');
    } catch {
      index = store.index('by_scope_createdAt');
    }
    const isTripleKey = index?.keyPath && Array.isArray(index.keyPath) && index.keyPath.length === 3;
    const range = cursorAfter?.createdAt && (cursorAfter?.id || !isTripleKey)
      ? (
        isTripleKey
          ? IDBKeyRange.lowerBound([scope, cursorAfter.createdAt, cursorAfter.id || ''], true)
          : IDBKeyRange.lowerBound([scope, cursorAfter.createdAt], true)
      )
      : (
        isTripleKey
          ? IDBKeyRange.bound([scope, '', ''], [scope, '\uffff', '\uffff'])
          : IDBKeyRange.bound([scope, ''], [scope, '\uffff'])
      );
    const items = [];
    let cur = await index.openCursor(range, 'prev');
    while (cur) {
      const row = cur.value;
      const item = row?.payload ?? row;
      if (row?.scope === scope && item) {
        if (!typeFilter || item.type === typeFilter) {
          items.push(item);
          if (items.length >= limit) break;
        }
      }
      cur = await cur.continue();
    }
    await tx.done;
    const last = items[items.length - 1];
    const nextCursor =
      last && items.length === limit
        ? { createdAt: last.createdAt || last.updatedAt || nowIso(), id: last.id }
        : null;
    return { items, nextCursor };
  } catch (e) {
    void logSystemEvent('db_error', 'getTransactionsPageByCursor failed', { workspaceId, error: e?.message || 'unknown' });
    void runReindexJob('transactions', { reason: 'cursor_page_error' });
    await maybeEnterSafeModeFromIdbError(e, 'cursor_read:transactions');
    return { items: [], nextCursor: null };
  }
}

export async function saveProducts(workspaceId, userId, products) {
  await putMany('products', workspaceId, userId, products);
}

export async function getProductsPaginated(workspaceId, userId, options = {}) {
  return readPaginated('products', workspaceId, userId, {
    limit: 25,
    offset: 0,
    indexName: 'by_scope_createdAt',
    order: 'desc',
    ...options,
  });
}

export async function saveInvoices(workspaceId, userId, invoices) {
  await putMany('invoices', workspaceId, userId, invoices);
}

export async function getInvoicesPaginated(workspaceId, userId, options = {}) {
  return readPaginated('invoices', workspaceId, userId, {
    limit: 25,
    offset: 0,
    indexName: 'by_scope_createdAt',
    order: 'desc',
    ...options,
  });
}

export async function saveTransactions(workspaceId, userId, tx) {
  await putMany('transactions', workspaceId, userId, tx);
}

export async function getTransactionsPaginated(workspaceId, userId, options = {}) {
  return readPaginated('transactions', workspaceId, userId, {
    limit: 25,
    offset: 0,
    indexName: 'by_scope_createdAt',
    order: 'desc',
    ...options,
  });
}

export async function saveCustomers(workspaceId, userId, customers) {
  await putMany('customers', workspaceId, userId, customers);
}

export async function getCustomersPaginated(workspaceId, userId, options = {}) {
  return readPaginated('customers', workspaceId, userId, { limit: 25, offset: 0, ...options });
}

export async function saveSubscriptionCache(workspaceId, userId, subscription) {
  await putMany('subscription_cache', workspaceId, userId, [{ id: 'current', ...subscription }]);
}

export async function getSubscriptionCache(workspaceId, userId) {
  const rows = await readPaginated('subscription_cache', workspaceId, userId, { limit: 1, offset: 0 });
  return rows[0] || null;
}

export async function enqueueSyncOperation(workspaceId, userId, op) {
  if (!op) return;
  if (isGlobalSafeMode()) {
    void logSystemEvent('write_blocked_safe_mode', 'enqueueSyncOperation', { type: op.type });
    return;
  }
  // Stable dedupe: use dedupeKey as id so _pk becomes deterministic.
  // This prevents duplicates even before the unique index is created.
  const computedDedupeKey = op.dedupeKey || `${op.type}:${workspaceId}:${op.entityId || 'bulk'}`;
  const entry = {
    id: computedDedupeKey,
    dedupeKey: computedDedupeKey,
    type: op.type,
    payload: op.payload || {},
    retryCount: Number(op.retryCount || 0),
    maxRetry: Number(op.maxRetry || 8),
    nextRetryAt: op.nextRetryAt || nowIso(),
    latestUpdatedAt: op.latestUpdatedAt || nowIso(),
    createdAt: op.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  try {
    await putMany('sync_queue', workspaceId, userId, [entry]);
  } catch (e) {
    // Unique index collision => duplicate enqueue; ignore.
    if (isIndexedDbConstraintError(e)) return;
    throw e;
  }
}

export async function getSyncQueueBatch(workspaceId, userId, limit = 50) {
  const now = nowIso();
  return readPaginated('sync_queue', workspaceId, userId, {
    limit,
    offset: 0,
    where: (i) => !i.nextRetryAt || i.nextRetryAt <= now,
    indexName: 'by_scope_createdAt',
    order: 'asc',
  });
}

export async function getSyncQueueBatchAll(workspaceId, userId, limit = 50) {
  return readPaginated('sync_queue', workspaceId, userId, {
    limit,
    offset: 0,
    where: null,
    indexName: 'by_scope_createdAt',
    order: 'asc',
  });
}

export async function getSyncQueueOldestEntry(workspaceId, userId) {
  const rows = await getSyncQueueBatchAll(workspaceId, userId, 1);
  return rows[0] || null;
}

export async function updateSyncQueueItem(workspaceId, userId, item) {
  await putMany('sync_queue', workspaceId, userId, [item]);
}

export async function removeSyncQueueItem(workspaceId, userId, itemId) {
  const db = await getDb();
  const tx = db.transaction('sync_queue', 'readwrite');
  await tx.objectStore('sync_queue').delete(rowKey(workspaceId, userId, itemId));
  await tx.done;
}

// ---------- Record-level entity writes (no full dataset reads) ----------

export async function upsertEntityRecord(storeName, workspaceId, userId, record) {
  if (!storeName || !workspaceId) return;
  await putMany(storeName, workspaceId, userId, [record]);
}

export async function getEntityRecordById(storeName, workspaceId, userId, id) {
  if (!storeName || !workspaceId || !id) return null;
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readonly');
    const pk = rowKey(workspaceId, userId, id);
    const res = await tx.objectStore(storeName).get(pk);
    await tx.done;
    return res?.payload ?? res ?? null;
  } catch (e) {
    void logSystemEvent('db_error', 'getEntityRecordById failed', { storeName, workspaceId, error: e?.message || 'unknown' });
    await maybeEnterSafeModeFromIdbError(e, `getEntityRecordById:${storeName}`);
    throw e;
  }
}

export async function deleteEntityRecord(storeName, workspaceId, userId, id) {
  if (!storeName || !workspaceId || !id) return;
  if (isGlobalSafeMode()) {
    void logSystemEvent('write_blocked_safe_mode', 'deleteEntityRecord', { storeName });
    const err = new Error('GLOBAL_SAFE_MODE');
    err.code = 'SAFE_MODE';
    throw err;
  }
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    await tx.objectStore(storeName).delete(rowKey(workspaceId, userId, id));
    await tx.done;
  } catch (e) {
    void logSystemEvent('db_error', 'deleteEntityRecord failed', { storeName, workspaceId, error: e?.message || 'unknown' });
    await maybeEnterSafeModeFromIdbError(e, `deleteEntityRecord:${storeName}`);
    throw e;
  }
}

// ---------- Dead Letter Queue (DLQ) ----------

export async function moveSyncItemToDeadLetterQueue(workspaceId, userId, item, reason, lastError) {
  if (!workspaceId || !item) return;
  const entry = {
    id: item.id || crypto.randomUUID(),
    dedupeKey: item.dedupeKey,
    type: item.type,
    payload: item.payload || {},
    retryCount: Number(item.retryCount || 0),
    maxRetry: Number(item.maxRetry || 8),
    latestUpdatedAt: item.latestUpdatedAt || nowIso(),
    createdAt: item.createdAt || nowIso(),
    updatedAt: nowIso(),
    deadLetterReason: reason || 'max_retries_reached',
    deadLetterAt: nowIso(),
    lastError: lastError || null,
  };
  await putMany('sync_dead_letter_queue', workspaceId, userId, [entry]);
}

export async function getDeadLetterQueueBatch(workspaceId, userId, limit = 25) {
  if (!workspaceId) return [];
  return readPaginated('sync_dead_letter_queue', workspaceId, userId, {
    limit,
    offset: 0,
    indexName: 'by_scope_createdAt',
    order: 'desc',
  });
}

export async function removeDeadLetterQueueItem(workspaceId, userId, itemId) {
  if (!workspaceId || !itemId) return;
  const db = await getDb();
  const tx = db.transaction('sync_dead_letter_queue', 'readwrite');
  await tx.objectStore('sync_dead_letter_queue').delete(rowKey(workspaceId, userId, itemId));
  await tx.done;
}

export function computeNextBackoff(retryCount) {
  const base = 1000;
  const ms = Math.min(base * Math.pow(2, Math.max(0, retryCount)), 5 * 60 * 1000);
  return new Date(Date.now() + ms).toISOString();
}

export async function getRecentSales(workspaceId, userId, limit = 25) {
  const cutoff = archiveCutoffIso();
  return getSalesPaginated(workspaceId, userId, {
    limit,
    offset: 0,
    where: (s) => !s.date || s.date >= cutoff,
    indexName: 'by_scope_date',
  });
}

export async function getArchivedSalesFromServer(workspaceId, page = 0, pageSize = 25) {
  return apiGetSales(workspaceId, page, pageSize);
}

export async function getArchivedInvoicesFromServer(workspaceId, page = 0, pageSize = 25) {
  // apiGetInvoices في workspaceApi يستخدم PAGE_SIZE ثابت من الداتا ليير،
  // لذلك pageSize هنا best-effort فقط.
  const res = await apiGetInvoices(workspaceId, page);
  const rows = res?.data || [];
  return rows;
}

export async function getAllLocalSales(workspaceId, userId) {
  return readAllByScope('sales', workspaceId, userId);
}

/** @param {string} key */
export async function getDbMetaEntry(key) {
  if (!key || typeof indexedDB === 'undefined') return null;
  try {
    const db = await getDb();
    const row = await db.get(META_STORE, key);
    return row && typeof row === 'object' ? row : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export async function setDbMetaEntry(key, value) {
  if (!key || typeof indexedDB === 'undefined') return false;
  try {
    const db = await getDb();
    await db.put(META_STORE, {
      key,
      value,
      updatedAt: nowIso(),
    });
    return true;
  } catch {
    return false;
  }
}
