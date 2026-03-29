/**
 * Structured migrations keyed by IndexedDB version (runs inside idb `upgrade` transaction).
 * State is persisted in `meta` store for diagnostics and safe recovery auditing.
 */
const META = 'meta';

export const MIGRATION_META_KEY = 'schema_migrations_log';

/**
 * @param {IDBTransaction} transaction
 * @param {number} toVersion
 * @param {string[]} steps
 */
export function recordMigrationsApplied(transaction, toVersion, steps) {
  try {
    if (!transaction.db.objectStoreNames.contains(META)) return;
    const store = transaction.objectStore(META);
    const entry = {
      key: MIGRATION_META_KEY,
      version: toVersion,
      steps,
      appliedAt: new Date().toISOString(),
    };
    store.put(entry);
  } catch (_) {}
}

/**
 * @param {IDBDatabase} db
 * @param {IDBTransaction} transaction
 * @param {number} oldVersion
 * @param {number} newVersion
 */
export function runRegisteredMigrations(db, transaction, oldVersion, newVersion) {
  if (oldVersion < 5 && newVersion >= 5) {
    migrateV5MetaInit(db, transaction);
    recordMigrationsApplied(transaction, 5, ['v5_meta_init', 'integrity_marker']);
  }
}

function migrateV5MetaInit(_db, transaction) {
  try {
    if (!transaction.db.objectStoreNames.contains(META)) return;
    const store = transaction.objectStore(META);
    store.put({
      key: 'db_schema_version',
      version: 5,
      label: 'migration_runner_registered',
      updatedAt: new Date().toISOString(),
    });
  } catch (_) {}
}
