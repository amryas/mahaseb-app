/**
 * Write-through for clients (stored as customers in IndexedDB).
 * @typedef {{ ok: boolean, error?: string }} EntityWriteResult
 */

import { getCacheUserId } from './cacheStore';
import {
  upsertEntityRecord,
  deleteEntityRecord,
  getEntityRecordById,
} from './indexedDbStore';
import { addToSyncQueue } from './syncQueue';
import { requestSyncQueueFlush } from './syncQueueFlush';
import { OP } from './operationTypes';
import { ENTITY_WRITE_MAX_RETRIES } from './entityWriteConstants';
import {
  getCurrentAccountId,
  ensureSingleAccount,
  mergeClientIntoCache,
  removeClientFromCache,
} from './store';
import { isWorkspaceSaaSEnabled } from './workspaceApi';
import { logSystemEvent } from '../services/monitoring';
import { assertWriteAllowedEntity } from './subscriptionWriteGuard';

/**
 * @param {Record<string, unknown>} client
 * @returns {Record<string, unknown>}
 */
function normalizeClient(client) {
  if (!client || typeof client !== 'object') throw new Error('invalid_client');
  const id =
    client.id ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const now = new Date().toISOString();
  return {
    ...client,
    id,
    name: client.name ?? '',
    phone: client.phone ?? '',
    address: client.address ?? '',
    updatedAt: client.updatedAt || now,
  };
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
 * @param {Record<string, unknown>} client
 * @returns {Promise<EntityWriteResult>}
 */
export async function addClient(client) {
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
    normalized = normalizeClient(client);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const billingBlock = await assertWriteAllowedEntity(wid, {});
  if (billingBlock) return billingBlock;
  try {
    await upsertEntityRecord('customers', wid, uid, normalized);
    mergeClientIntoCache(normalized);
    await enqueueWhenSaaS(
      OP.INSERT_CUSTOMER,
      wid,
      normalized,
      `insert_customer:${wid}:${normalized.id}`,
      normalized.updatedAt
    );
    requestSyncQueueFlush();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('client_write_failure', 'addClient failed', { error: e?.message || 'unknown' });
    return { ok: false, error: 'idb' };
  }
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} updates
 * @returns {Promise<EntityWriteResult>}
 */
export async function updateClient(id, updates) {
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid || !id) return { ok: false, error: 'no_workspace' };
  if (typeof indexedDB === 'undefined') return { ok: false, error: 'no_idb' };
  const billingBlock = await assertWriteAllowedEntity(wid, {});
  if (billingBlock) return billingBlock;
  try {
    const existing = await getEntityRecordById('customers', wid, uid, id);
    const now = new Date().toISOString();
    const merged = { ...(existing || {}), ...(updates || {}), id, updatedAt: now };
    await upsertEntityRecord('customers', wid, uid, merged);
    mergeClientIntoCache(merged);
    await enqueueWhenSaaS(
      OP.UPDATE_CUSTOMER,
      wid,
      { id, updates: { ...updates } },
      `update_customer:${wid}:${id}:${now}`,
      now
    );
    requestSyncQueueFlush();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('client_write_failure', 'updateClient failed', { id, error: e?.message || 'unknown' });
    return { ok: false, error: 'idb' };
  }
}

/**
 * @param {string} id
 * @returns {Promise<EntityWriteResult>}
 */
export async function deleteClient(id) {
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid || !id) return { ok: false, error: 'no_workspace' };
  if (typeof indexedDB === 'undefined') return { ok: false, error: 'no_idb' };
  const billingBlock = await assertWriteAllowedEntity(wid, {});
  if (billingBlock) return billingBlock;
  try {
    await deleteEntityRecord('customers', wid, uid, id);
    removeClientFromCache(id);
    const now = new Date().toISOString();
    await enqueueWhenSaaS(
      OP.DELETE_CUSTOMER,
      wid,
      { customerId: id },
      `delete_customer:${wid}:${id}:${now}`,
      now
    );
    requestSyncQueueFlush();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('client_write_failure', 'deleteClient failed', { id, error: e?.message || 'unknown' });
    return { ok: false, error: 'idb' };
  }
}
