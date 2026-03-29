/**
 * طابور مزامنة محلي — عند فشل الحفظ أو انقطاع النت نضيف للطابور ثم نعيد المحاولة عند عودة الاتصال.
 * يُمسح مع الـ cache عند تسجيل الخروج (أمان الأجهزة المشتركة).
 */

import { getCacheUserId } from './cacheStore';
import { logSystemEvent } from '../services/monitoring';
import { getCurrentAccountId } from './store';
import { isGlobalSafeMode } from './globalSafeMode';
import { isWorkspaceSaaSEnabled } from './workspaceApi';
import { ensureSubscriptionAllowsWriteCentral } from './subscriptionWriteGuard';
import { assertUsageLimitAllows } from './usageLimitsApi';
import { BILLING_ERROR_CODES } from './billingErrors';
import {
  computeNextBackoff,
  enqueueSyncOperation,
  getSyncQueueBatch,
  getSyncQueueBatchAll,
  getSyncQueueOldestEntry,
  removeSyncQueueItem,
  removeDeadLetterQueueItem,
  updateSyncQueueItem,
  upsertEntityRecord,
  deleteEntityRecord,
  getEntityRecordById,
  moveSyncItemToDeadLetterQueue,
} from './indexedDbStore';
import { SALE_QUEUE } from './saleQueueTypes';

const MAX_RETRIES = 8;
const DEAD_LETTER_RETRY_THRESHOLD = 8;
const QUEUE_STUCK_OLDERS_THAN_MS = 10 * 60 * 1000; // 10 minutes
const QUEUE_STUCK_LENGTH_THRESHOLD = 500; // tune as needed

let _lastStuckAlertAt = 0;
let _queueLength = 0;
let _processing = false;

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function getSyncQueue() {
  return [];
}

async function refreshQueueLength(workspaceId, userId) {
  try {
    const batch = await getSyncQueueBatch(workspaceId, userId, 500);
    _queueLength = batch.length;
  } catch {
    _queueLength = 0;
  }
}

async function applyLocalWriteForOp(op, workspaceId, userId, payload) {
  try {
    const now = new Date().toISOString();
    switch (op) {
      case 'insert_product':
        return await upsertEntityRecord('products', workspaceId, userId, { ...payload, updatedAt: payload?.updatedAt || now });
      case 'update_product': {
        const id = payload?.id;
        if (!id) return;
        const existing = await getEntityRecordById('products', workspaceId, userId, id);
        const merged = { ...(existing || { id }), ...(payload?.updates || {}), id, updatedAt: now };
        return await upsertEntityRecord('products', workspaceId, userId, merged);
      }
      case 'delete_product':
        return await deleteEntityRecord('products', workspaceId, userId, payload?.productId);

      case 'insert_transaction':
        return await upsertEntityRecord('transactions', workspaceId, userId, { ...payload, updatedAt: payload?.updatedAt || now });
      case 'delete_transaction':
        return await deleteEntityRecord('transactions', workspaceId, userId, payload?.transactionId);

      case 'insert_invoice':
        return await upsertEntityRecord('invoices', workspaceId, userId, { ...payload, updatedAt: payload?.updatedAt || now });
      case 'update_invoice': {
        const id = payload?.invoiceId;
        if (!id) return;
        const existing = await getEntityRecordById('invoices', workspaceId, userId, id);
        const merged = { ...(existing || { id }), ...(payload?.updates || {}), id, updatedAt: now };
        return await upsertEntityRecord('invoices', workspaceId, userId, merged);
      }
      case 'delete_invoice':
        return await deleteEntityRecord('invoices', workspaceId, userId, payload?.invoiceId);

      case 'upsert_sales': {
        const sales = Array.isArray(payload?.sales) ? payload.sales : [];
        for (const sale of sales) {
          await upsertEntityRecord('sales', workspaceId, userId, { ...sale, updatedAt: sale?.updatedAt || now });
        }
        return;
      }
      case SALE_QUEUE.CREATE: {
        const s = payload?.sale;
        if (!s?.id) return;
        return await upsertEntityRecord('sales', workspaceId, userId, { ...s, updatedAt: s?.updatedAt || now });
      }
      case SALE_QUEUE.UPDATE: {
        const id = payload?.id;
        if (!id) return;
        const patch = payload?.patch || {};
        const existing = await getEntityRecordById('sales', workspaceId, userId, id);
        const merged = { ...(existing || { id }), ...patch, id, updatedAt: now };
        return await upsertEntityRecord('sales', workspaceId, userId, merged);
      }
      case SALE_QUEUE.DELETE:
        return await deleteEntityRecord('sales', workspaceId, userId, payload?.id);

      case 'insert_customer':
        return await upsertEntityRecord('customers', workspaceId, userId, { ...payload, updatedAt: payload?.updatedAt || now });
      case 'update_customer': {
        const id = payload?.id;
        if (!id) return;
        const existing = await getEntityRecordById('customers', workspaceId, userId, id);
        const merged = { ...(existing || { id }), ...(payload?.updates || {}), id, updatedAt: now };
        return await upsertEntityRecord('customers', workspaceId, userId, merged);
      }
      case 'delete_customer':
        return await deleteEntityRecord('customers', workspaceId, userId, payload?.customerId);

      default:
        return;
    }
  } catch (e) {
    void logSystemEvent('queue_local_write_failure', 'Local write to IDB failed', { op, workspaceId, userId, error: e?.message || 'unknown' });
  }
}

/** إضافة عملية للطابور (عند فشل الحفظ في السحابة) */
export function addToSyncQueue(op, workspaceId, payload, options = {}) {
  if (isGlobalSafeMode()) {
    void logSystemEvent('write_blocked_safe_mode', 'addToSyncQueue', { op });
    const err = new Error('GLOBAL_SAFE_MODE');
    err.code = 'SAFE_MODE';
    return Promise.reject(err);
  }
  const wid = workspaceId || getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid) return Promise.resolve();
  const dedupeKey =
    options?.dedupeKey ||
    `${op}:${wid}:${payload?.id || payload?.invoiceId || payload?.transactionId || payload?.productId || 'bulk'}`;
  const latestUpdatedAt = options?.latestUpdatedAt || payload?.updatedAt || new Date().toISOString();
  const maxRetry = Number.isFinite(options?.maxRetry) ? Number(options.maxRetry) : MAX_RETRIES;
  const skipLocalWrite = !!options?.skipLocalWrite;
  const skipSubscriptionGuard = !!options?.skipSubscriptionGuard;
  return (async () => {
    if (isWorkspaceSaaSEnabled() && !skipSubscriptionGuard) {
      await ensureSubscriptionAllowsWriteCentral(wid, {
        skipNetworkRefresh: !!options?.subscriptionGuardCacheOnly,
      });
      if (op === 'insert_invoice') {
        await assertUsageLimitAllows(wid, 'invoice');
      }
    }
    await enqueueSyncOperation(wid, uid, {
      id: randomId(),
      dedupeKey,
      type: op,
      payload: payload || {},
      retryCount: 0,
      maxRetry,
      latestUpdatedAt,
    });
    if (!skipLocalWrite) {
      await applyLocalWriteForOp(op, wid, uid, payload || {});
    }
    await refreshQueueLength(wid, uid);
  })();
}

/**
 * Like {@link addToSyncQueue} but swallows SAFE_MODE rejections for fire-and-forget call sites.
 * Other errors still propagate.
 */
export function addToSyncQueueSafe(op, workspaceId, payload, options = {}) {
  const p = addToSyncQueue(op, workspaceId, payload, options);
  if (!p || typeof p.then !== 'function') return Promise.resolve(false);
  return p.catch((e) => {
    if (e?.code === 'SAFE_MODE') return false;
    if (e?.code === BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED) return false;
    if (e?.code === BILLING_ERROR_CODES.PLAN_LIMIT_REACHED) return false;
    throw e;
  });
}

/**
 * Central write-through API entrypoint.
 * UI code should call this instead of direct cloud/cache writes.
 */
export function writeThroughOperation(operation) {
  if (isGlobalSafeMode()) {
    void logSystemEvent('write_blocked_safe_mode', 'writeThroughOperation', { type: operation?.type });
    return Promise.resolve(false);
  }
  const wid = operation?.workspaceId || getCurrentAccountId();
  const payload = operation?.payload || {};
  if (!wid) return Promise.resolve(false);
  const uid = getCacheUserId();
  const type = operation?.type;
  if (!type) return Promise.resolve(false);

  return (async () => {
    try {
      if (isWorkspaceSaaSEnabled()) {
        await ensureSubscriptionAllowsWriteCentral(wid, {});
        if (type === 'insert_invoice') {
          await assertUsageLimitAllows(wid, 'invoice');
        }
      }
      await addToSyncQueue(type, wid, payload, {
        dedupeKey: operation?.dedupeKey,
        latestUpdatedAt: operation?.latestUpdatedAt,
        skipSubscriptionGuard: true,
      });
      return !!uid;
    } catch (e) {
      if (e?.code === BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED || e?.code === BILLING_ERROR_CODES.PLAN_LIMIT_REACHED) {
        return false;
      }
      throw e;
    }
  })();
}

export async function replayDeadLetterQueueItem(dlqItem, opts = {}) {
  const wid = opts.workspaceId || dlqItem?.workspaceId || getCurrentAccountId();
  const uid = opts.userId || getCacheUserId();
  if (!wid || !uid || !dlqItem) return false;

  try {
    if (isWorkspaceSaaSEnabled()) {
      await ensureSubscriptionAllowsWriteCentral(wid, {});
      if (dlqItem.type === 'insert_invoice') {
        await assertUsageLimitAllows(wid, 'invoice');
      }
    }
    // Re-enqueue with retryCount reset; dedupeKey ensures deterministic overwrite.
    await enqueueSyncOperation(wid, uid, {
      type: dlqItem.type,
      dedupeKey: dlqItem.dedupeKey || dlqItem.id,
      payload: dlqItem.payload || {},
      retryCount: 0,
      maxRetry: dlqItem.maxRetry || MAX_RETRIES,
      latestUpdatedAt: dlqItem.latestUpdatedAt || new Date().toISOString(),
      createdAt: dlqItem.createdAt || undefined,
    });
    await removeDeadLetterQueueItem(wid, uid, dlqItem.id || dlqItem.dedupeKey);
    void logSystemEvent('dlq_replay_success', 'Replayed DLQ item', {
      workspaceId: wid,
      userId: uid,
      type: dlqItem.type,
      dedupeKey: dlqItem.dedupeKey,
    });
    return true;
  } catch (e) {
    void logSystemEvent('dlq_replay_failure', 'Failed to replay DLQ item', {
      workspaceId: wid,
      userId: uid,
      type: dlqItem.type,
      dedupeKey: dlqItem.dedupeKey,
      error: e?.message || 'unknown',
    });
    return false;
  }
}

// ——— تنفيذ عملية واحدة (يستدعيها processQueue) ———
async function executeItem(item, api) {
  const op = item.type || item.op;
  const workspaceId = item.workspaceId || getCurrentAccountId();
  const payload = item.payload || {};
  if (!workspaceId) return false;

  switch (op) {
    case 'insert_product': {
      const r = await api.apiInsertProduct(workspaceId, payload);
      return r != null && r.id != null;
    }
    case 'insert_transaction':
      return await api.apiInsertTransaction(workspaceId, payload);
    case 'insert_invoice':
      return await api.apiInsertInvoice(workspaceId, payload);
    case 'update_product': {
      const r = await api.apiUpdateProduct(workspaceId, payload.id, payload.updates);
      return r?.ok === true;
    }
    case 'update_invoice':
      return await api.apiUpdateInvoice(workspaceId, payload.invoiceId, payload.updates);
    case 'delete_product': {
      const r = await api.apiDeleteProduct(workspaceId, payload.productId);
      return r?.ok === true;
    }
    case 'delete_transaction':
      return await api.apiDeleteTransaction(workspaceId, payload.transactionId);
    case 'delete_invoice':
      return await api.apiDeleteInvoice(workspaceId, payload.invoiceId);
    case 'upsert_sales':
      return await api.apiUpsertSales(workspaceId, payload.sales || []);
    case SALE_QUEUE.CREATE: {
      const s = payload?.sale;
      if (!s?.id) return false;
      return await api.apiUpsertSales(workspaceId, [s]);
    }
    case SALE_QUEUE.UPDATE:
      return await api.apiUpdateSale(workspaceId, payload.id, payload.patch || {});
    case SALE_QUEUE.DELETE:
      return await api.apiDeleteSale(workspaceId, payload.id);

    case 'insert_customer': {
      const cid = await api.apiInsertCustomer(workspaceId, payload);
      return cid != null;
    }
    case 'update_customer':
      return await api.apiUpdateCustomer(workspaceId, payload.id, payload.updates || {});
    case 'delete_customer':
      return await api.apiDeleteCustomer(workspaceId, payload.customerId);

    default:
      return false;
  }
}

/** معالجة الطابور: تنفيذ كل عنصر ثم حذفه عند النجاح، أو زيادة عداد المحاولات */
export async function processSyncQueue(onProcessed) {
  if (_processing) return;
  if (isGlobalSafeMode()) return;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('e2e_billing_simulate_saas') === '1') return;
  } catch (_) {}
  _processing = true;
  const api = await import('./workspaceApi');
  const workspaceId = getCurrentAccountId();
  const userId = getCacheUserId();
  if (!workspaceId) {
    _processing = false;
    return;
  }
  try {
    // Queue health monitoring (throttled).
    const now = Date.now();
    if (now - _lastStuckAlertAt > 60_000) {
      _lastStuckAlertAt = now;
      const oldest = await getSyncQueueOldestEntry(workspaceId, userId);
      if (oldest?.createdAt) {
        const ageMs = now - new Date(oldest.createdAt).getTime();
        if (Number.isFinite(ageMs) && ageMs > QUEUE_STUCK_OLDERS_THAN_MS) {
          void logSystemEvent('queue_stuck', 'Sync queue stuck: oldest operation too old', {
            workspaceId,
            userId,
            ageMs,
            op: oldest.type,
            dedupeKey: oldest.dedupeKey,
          });
        }
      }
      const backlog = await getSyncQueueBatchAll(workspaceId, userId, QUEUE_STUCK_LENGTH_THRESHOLD + 1);
      if (backlog.length > QUEUE_STUCK_LENGTH_THRESHOLD) {
        void logSystemEvent('queue_backlog', 'Sync queue backlog too large', {
          workspaceId,
          userId,
          queueLength: backlog.length,
          threshold: QUEUE_STUCK_LENGTH_THRESHOLD,
        });
      }
    }

    const queue = await getSyncQueueBatch(workspaceId, userId, 100);
    if (queue.length === 0) {
      _queueLength = 0;
      _processing = false;
      return;
    }

    for (const item of queue) {
      const retryCount = Number(item.retryCount || 0);
      const itemMax = Number(item.maxRetry);
      const threshold = Number.isFinite(itemMax) && itemMax > 0 ? itemMax : DEAD_LETTER_RETRY_THRESHOLD;
      if (retryCount >= threshold) {
        void logSystemEvent('queue_retry_overflow', 'sync queue item moved to DLQ after max retries', {
          op: item.type,
          workspaceId,
          retryCount,
        });
        await moveSyncItemToDeadLetterQueue(workspaceId, userId, item, 'max_retries_reached', item?.payload?.error || null);
        await removeSyncQueueItem(workspaceId, userId, item.id);
        continue;
      }
      try {
        const success = await executeItem(item, api);
        if (success) {
          await removeSyncQueueItem(workspaceId, userId, item.id);
          if (typeof onProcessed === 'function') onProcessed(item);
        } else {
          void logSystemEvent('sync_failure', 'sync queue item failed', {
            op: item.type,
            workspaceId,
            retryCount,
          });
          await updateSyncQueueItem(workspaceId, userId, {
            ...item,
            retryCount: retryCount + 1,
            nextRetryAt: computeNextBackoff(retryCount + 1),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (_) {
        void logSystemEvent('sync_failure', 'sync queue exception', {
          op: item.type,
          workspaceId,
          retryCount,
        });
        await updateSyncQueueItem(workspaceId, userId, {
          ...item,
          retryCount: retryCount + 1,
          nextRetryAt: computeNextBackoff(retryCount + 1),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    await refreshQueueLength(workspaceId, userId);
  } finally {
    _processing = false;
  }
}

export function getSyncQueueLength() {
  const workspaceId = getCurrentAccountId();
  const userId = getCacheUserId();
  if (workspaceId && userId) void refreshQueueLength(workspaceId, userId);
  return _queueLength;
}

/**
 * Wait until sync_queue becomes empty (or timeout).
 * Designed for E2E verification + operational safety.
 */
export async function waitForQueueDrain(timeoutMs = 30_000, pollMs = 800) {
  const workspaceId = getCurrentAccountId();
  const userId = getCacheUserId();
  const startAt = Date.now();

  if (!workspaceId || !userId) return true;

  if (isGlobalSafeMode()) {
    void logSystemEvent('queue_drain_blocked_safe_mode', 'waitForQueueDrain: safe mode active', { workspaceId, userId });
    return false;
  }

  while (Date.now() - startAt < timeoutMs) {
    if (isGlobalSafeMode()) {
      void logSystemEvent('queue_drain_aborted_safe_mode', 'waitForQueueDrain: safe mode activated', { workspaceId, userId });
      return false;
    }
    const batch = await getSyncQueueBatch(workspaceId, userId, 1);
    if (!batch || batch.length === 0) {
      void logSystemEvent('queue_drain_success', 'Sync queue drained', { workspaceId, userId, ms: Date.now() - startAt });
      return true;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  void logSystemEvent('queue_drain_timeout', 'Timed out waiting for sync queue drain', { workspaceId, userId, timeoutMs });
  return false;
}
