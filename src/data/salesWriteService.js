/**
 * Production write-through entry point for sales: IndexedDB first + sync queue + throttled flush.
 * @typedef {{ ok: boolean, error?: string }} SalesWriteResult
 */

import { getCurrentAccountId } from './store';
import { getSales } from './store';
import { getCacheUserId } from './cacheStore';
import {
  putSaleRecord,
  getEntityRecordById,
  deleteEntityRecord,
} from './indexedDbStore';
import { addToSyncQueue } from './syncQueue';
import { requestSyncQueueFlush, ensureGlobalSyncInterval } from './syncQueueFlush';
import { logSystemEvent } from '../services/monitoring';
import { SALE_QUEUE, SALE_QUEUE_MAX_RETRIES } from './saleQueueTypes';
import { isWorkspaceSaaSEnabled } from './workspaceApi';
import { assertWriteAllowedEntity } from './subscriptionWriteGuard';

export { requestSyncQueueFlush, ensureGlobalSyncInterval } from './syncQueueFlush';

const SALES_CHANGED = 'mohaseb-sales-changed';
const SALES_READONLY = 'mohaseb-sales-readonly';

let _storageReadOnly = false;
let _storageErrorMessage = '';

/** @returns {boolean} */
export function isSalesStorageReadOnly() {
  return _storageReadOnly;
}

/** @returns {string} */
export function getSalesStorageErrorMessage() {
  return _storageErrorMessage;
}

function markReadOnly(message) {
  _storageReadOnly = true;
  _storageErrorMessage = message || '';
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SALES_READONLY, { detail: { message } }));
    }
  } catch (_) {}
}

function dispatchChanged() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SALES_CHANGED));
  } catch (_) {}
}

/** @deprecated Use requestSyncQueueFlush — alias for sales call sites. */
export function requestSalesSyncFlush() {
  requestSyncQueueFlush();
}

/** @deprecated Use ensureGlobalSyncInterval — alias for App bootstrap. */
export function ensureSalesSyncInterval() {
  ensureGlobalSyncInterval();
}

/**
 * @param {Record<string, unknown>} sale
 * @returns {Record<string, unknown>}
 */
function normalizeSaleForStore(sale) {
  if (!sale || typeof sale !== 'object') throw new Error('invalid_sale');
  const id = sale.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const date =
    typeof sale.date === 'string' && sale.date
      ? sale.date.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  return { ...sale, id, date };
}

/**
 * Optimistic IDB put + queue SALE_CREATE (max 5 retries on processor).
 * @param {Record<string, unknown>} sale
 * @param {{ skipSubscriptionNetwork?: boolean }} [opts]
 * @returns {Promise<SalesWriteResult>}
 */
export async function addSale(sale, opts = {}) {
  if (_storageReadOnly) return { ok: false, error: 'readonly' };
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid) return { ok: false, error: 'no_workspace' };
  if (typeof indexedDB === 'undefined') return { ok: false, error: 'no_idb' };
  let normalized;
  try {
    normalized = normalizeSaleForStore(sale);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const billingBlock = await assertWriteAllowedEntity(wid, {
    skipSubscriptionNetwork: !!opts.skipSubscriptionNetwork,
  });
  if (billingBlock) return billingBlock;
  try {
    await putSaleRecord(wid, uid, {
      ...normalized,
      syncStatus: 'pending',
      pending_sync: isWorkspaceSaaSEnabled() && typeof navigator !== 'undefined' && !navigator.onLine,
    });
    await addToSyncQueue(
      SALE_QUEUE.CREATE,
      wid,
      { sale: normalized },
      {
        dedupeKey: `${SALE_QUEUE.CREATE}:${wid}:${normalized.id}`,
        latestUpdatedAt: normalized.updatedAt || new Date().toISOString(),
        maxRetry: SALE_QUEUE_MAX_RETRIES,
        skipLocalWrite: true,
        skipSubscriptionGuard: true,
      }
    );
    requestSyncQueueFlush();
    dispatchChanged();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') {
      return { ok: false, error: 'safe_mode' };
    }
    void logSystemEvent('sales_write_failure', 'addSale IndexedDB/queue failed', {
      workspaceId: wid,
      error: e?.message || 'unknown',
    });
    markReadOnly('تعذر حفظ المبيعات محلياً. وضع القراءة فقط مؤقتاً.');
    return { ok: false, error: 'idb' };
  }
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @returns {Promise<SalesWriteResult>}
 */
export async function updateSale(id, patch) {
  if (_storageReadOnly) return { ok: false, error: 'readonly' };
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid || !id) return { ok: false, error: 'no_workspace' };
  const billingBlock = await assertWriteAllowedEntity(wid, {});
  if (billingBlock) return billingBlock;
  try {
    const existing = await getEntityRecordById('sales', wid, uid, id);
    const now = new Date().toISOString();
    const merged = { ...(existing || {}), ...patch, id, updatedAt: now };
    await putSaleRecord(wid, uid, { ...merged, syncStatus: 'pending' });
    const apiPatch = { ...patch };
    await addToSyncQueue(
      SALE_QUEUE.UPDATE,
      wid,
      { id, patch: apiPatch },
      {
        dedupeKey: `${SALE_QUEUE.UPDATE}:${wid}:${id}:${now}`,
        latestUpdatedAt: now,
        maxRetry: SALE_QUEUE_MAX_RETRIES,
        skipLocalWrite: true,
        skipSubscriptionGuard: true,
      }
    );
    requestSyncQueueFlush();
    dispatchChanged();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('sales_write_failure', 'updateSale failed', { id, error: e?.message || 'unknown' });
    markReadOnly('تعذر تحديث المبيعات محلياً.');
    return { ok: false, error: 'idb' };
  }
}

/**
 * Hard delete local + queue delete for cloud.
 * @param {string} id
 * @returns {Promise<SalesWriteResult>}
 */
export async function deleteSale(id) {
  if (_storageReadOnly) return { ok: false, error: 'readonly' };
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid || !id) return { ok: false, error: 'no_workspace' };
  const billingBlock = await assertWriteAllowedEntity(wid, {});
  if (billingBlock) return billingBlock;
  try {
    await deleteEntityRecord('sales', wid, uid, id);
    const now = new Date().toISOString();
    await addToSyncQueue(
      SALE_QUEUE.DELETE,
      wid,
      { id },
      {
        dedupeKey: `${SALE_QUEUE.DELETE}:${wid}:${id}:${now}`,
        latestUpdatedAt: now,
        maxRetry: SALE_QUEUE_MAX_RETRIES,
        skipLocalWrite: true,
        skipSubscriptionGuard: true,
      }
    );
    requestSyncQueueFlush();
    dispatchChanged();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('sales_write_failure', 'deleteSale failed', { id, error: e?.message || 'unknown' });
    markReadOnly('تعذر حذف سجل المبيعات محلياً.');
    return { ok: false, error: 'idb' };
  }
}

/**
 * Hydrate from legacy localStorage slice when IDB has no rows (transition only).
 * @param {string} workspaceId
 * @param {string} userId
 * @param {number} maxRecords
 */
export async function migrateLegacySalesSampleToIdb(workspaceId, userId, maxRecords = 90) {
  if (!workspaceId || !userId || typeof indexedDB === 'undefined') return 0;
  const legacy = getSales();
  if (!Array.isArray(legacy) || legacy.length === 0) return 0;
  let n = 0;
  for (const s of legacy.slice(0, maxRecords)) {
    if (!s?.id) continue;
    try {
      await putSaleRecord(workspaceId, userId, { ...s, syncStatus: s.syncStatus || 'synced' });
      n += 1;
    } catch {
      break;
    }
  }
  return n;
}

/**
 * @param {any[]} list
 * @param {{ chunkSize?: number, onProgress?: (p: { done: number, total: number }) => void, signal?: AbortSignal }} [options]
 */
export async function importSalesInChunks(list, options = {}) {
  const chunkSize = Math.min(200, Math.max(1, Number(options.chunkSize) || 50));
  const signal = options.signal;
  const total = Array.isArray(list) ? list.length : 0;
  let done = 0;
  if (total === 0) return { ok: true, imported: 0 };
  const wid0 = getCurrentAccountId();
  if (wid0) {
    const deny = await assertWriteAllowedEntity(wid0, {});
    if (deny) return { ok: false, imported: 0, error: deny.error };
  }
  for (let i = 0; i < list.length; i += chunkSize) {
    if (signal?.aborted) return { ok: false, imported: done, aborted: true };
    const chunk = list.slice(i, i + chunkSize);
    for (const raw of chunk) {
      if (signal?.aborted) return { ok: false, imported: done, aborted: true };
      const sale = {
        ...raw,
        id: raw?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      };
      const r = await addSale(sale, { skipSubscriptionNetwork: true });
      if (!r.ok) return { ok: false, imported: done, error: r.error };
      done += 1;
      options.onProgress?.({ done, total });
    }
  }
  return { ok: true, imported: done };
}

export const SALES_EVENTS = { CHANGED: SALES_CHANGED, READONLY: SALES_READONLY };
