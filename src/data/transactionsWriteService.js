/**
 * Write-through for transactions (income/expense rows).
 * @typedef {{ ok: boolean, error?: string }} EntityWriteResult
 */

import { getCacheUserId } from './cacheStore';
import { upsertEntityRecord, deleteEntityRecord } from './indexedDbStore';
import { addToSyncQueue } from './syncQueue';
import { requestSyncQueueFlush } from './syncQueueFlush';
import { OP } from './operationTypes';
import { ENTITY_WRITE_MAX_RETRIES } from './entityWriteConstants';
import {
  getCurrentAccountId,
  ensureSingleAccount,
  mergeTransactionIntoCache,
  removeTransactionFromCache,
} from './store';
import { isWorkspaceSaaSEnabled } from './workspaceApi';
import { logSystemEvent } from '../services/monitoring';
import { assertWriteAllowedEntity } from './subscriptionWriteGuard';

const TRANSACTIONS_CHANGED = 'mohaseb-transactions-changed';

function dispatchTransactionsChanged() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TRANSACTIONS_CHANGED));
  } catch (_) {}
}

export const TRANSACTIONS_EVENTS = { CHANGED: TRANSACTIONS_CHANGED };

/**
 * @param {Record<string, unknown>} tx
 * @returns {Record<string, unknown>}
 */
function normalizeTransaction(tx) {
  if (!tx || typeof tx !== 'object') throw new Error('invalid_transaction');
  const id =
    tx.id ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const now = new Date().toISOString();
  return { ...tx, id, updatedAt: tx.updatedAt || now };
}

async function enqueueWhenSaaS(type, wid, payload, dedupeKey, latestUpdatedAt) {
  if (!isWorkspaceSaaSEnabled()) return;
  await addToSyncQueue(type, wid, payload, {
    dedupeKey,
    latestUpdatedAt,
    maxRetry: ENTITY_WRITE_MAX_RETRIES,
    skipLocalWrite: true,
    skipSubscriptionGuard: true,
  });
}

/**
 * @param {Record<string, unknown>} transaction
 * @param {{ skipSubscriptionNetwork?: boolean }} [opts]
 * @returns {Promise<EntityWriteResult>}
 */
export async function addTransaction(transaction, opts = {}) {
  let wid = getCurrentAccountId();
  let uid = getCacheUserId();
  if (!wid || !uid) {
    try {
      ensureSingleAccount();
    } catch (_) {}
  }
  wid = getCurrentAccountId();
  uid = getCacheUserId();
  if (!wid || !uid) return { ok: false, error: 'no_workspace' };
  if (typeof indexedDB === 'undefined') return { ok: false, error: 'no_idb' };
  let normalized;
  try {
    normalized = normalizeTransaction(transaction);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const billingBlock = await assertWriteAllowedEntity(wid, {
    skipSubscriptionNetwork: !!opts.skipSubscriptionNetwork,
  });
  if (billingBlock) return billingBlock;
  try {
    await upsertEntityRecord('transactions', wid, uid, normalized);
    mergeTransactionIntoCache(normalized);
    await enqueueWhenSaaS(
      OP.INSERT_TRANSACTION,
      wid,
      normalized,
      `insert_transaction:${wid}:${normalized.id}`,
      normalized.updatedAt
    );
    requestSyncQueueFlush();
    dispatchTransactionsChanged();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('transaction_write_failure', 'addTransaction failed', { error: e?.message || 'unknown' });
    return { ok: false, error: 'idb' };
  }
}

/**
 * @param {string} id
 * @param {{ skipSubscriptionNetwork?: boolean }} [opts]
 * @returns {Promise<EntityWriteResult>}
 */
export async function deleteTransaction(id, opts = {}) {
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid || !id) return { ok: false, error: 'no_workspace' };
  if (typeof indexedDB === 'undefined') return { ok: false, error: 'no_idb' };
  const billingBlock = await assertWriteAllowedEntity(wid, {
    skipSubscriptionNetwork: !!opts.skipSubscriptionNetwork,
  });
  if (billingBlock) return billingBlock;
  try {
    await deleteEntityRecord('transactions', wid, uid, id);
    removeTransactionFromCache(id);
    const now = new Date().toISOString();
    await enqueueWhenSaaS(
      OP.DELETE_TRANSACTION,
      wid,
      { transactionId: id },
      `delete_transaction:${wid}:${id}:${now}`,
      now
    );
    requestSyncQueueFlush();
    dispatchTransactionsChanged();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('transaction_write_failure', 'deleteTransaction failed', { id, error: e?.message || 'unknown' });
    return { ok: false, error: 'idb' };
  }
}
