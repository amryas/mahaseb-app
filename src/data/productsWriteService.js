/**
 * Write-through for products: single-row IndexedDB + sync queue + cache slice (no full-array IDB rewrite).
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
  getProducts,
  mergeProductIntoCache,
  removeProductFromCache,
} from './store';
import { isWorkspaceSaaSEnabled } from './workspaceApi';
import { logSystemEvent } from '../services/monitoring';
import { assertWriteAllowedEntity } from './subscriptionWriteGuard';

const PRODUCTS_CHANGED = 'mohaseb-products-changed';

function dispatchProductsChanged() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PRODUCTS_CHANGED));
  } catch (_) {}
}

export const PRODUCTS_EVENTS = { CHANGED: PRODUCTS_CHANGED };

/**
 * @param {Record<string, unknown>} product
 * @returns {Record<string, unknown>}
 */
function normalizeProduct(product) {
  if (!product || typeof product !== 'object') throw new Error('invalid_product');
  const id =
    product.id ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const now = new Date().toISOString();
  return { ...product, id, updatedAt: product.updatedAt || now };
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
 * @param {Record<string, unknown>} product
 * @param {{ skipSubscriptionNetwork?: boolean }} [opts]
 * @returns {Promise<EntityWriteResult>}
 */
export async function addProduct(product, opts = {}) {
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid) {
    try {
      ensureSingleAccount();
    } catch (_) {}
  }
  const w = getCurrentAccountId();
  const u = getCacheUserId();
  if (!w || !u) return { ok: false, error: 'no_workspace' };
  if (typeof indexedDB === 'undefined') return { ok: false, error: 'no_idb' };
  let normalized;
  try {
    normalized = normalizeProduct(product);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const billingBlock = await assertWriteAllowedEntity(w, {
    checkProductLimit: true,
    skipSubscriptionNetwork: !!opts.skipSubscriptionNetwork,
  });
  if (billingBlock) return billingBlock;
  try {
    await upsertEntityRecord('products', w, u, normalized);
    mergeProductIntoCache(normalized);
    await enqueueWhenSaaS(OP.INSERT_PRODUCT, w, normalized, `insert_product:${w}:${normalized.id}`, normalized.updatedAt);
    requestSyncQueueFlush();
    dispatchProductsChanged();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('product_write_failure', 'addProduct failed', { error: e?.message || 'unknown' });
    return { ok: false, error: 'idb' };
  }
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} updates
 * @returns {Promise<EntityWriteResult>}
 */
export async function updateProduct(id, updates) {
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid || !id) return { ok: false, error: 'no_workspace' };
  if (typeof indexedDB === 'undefined') return { ok: false, error: 'no_idb' };
  const billingBlock = await assertWriteAllowedEntity(wid, {});
  if (billingBlock) return billingBlock;
  try {
    const existing = await getEntityRecordById('products', wid, uid, id);
    const now = new Date().toISOString();
    const merged = { ...(existing || {}), ...(updates || {}), id, updatedAt: now };
    await upsertEntityRecord('products', wid, uid, merged);
    mergeProductIntoCache(merged);
    await enqueueWhenSaaS(
      OP.UPDATE_PRODUCT,
      wid,
      { id, updates: { ...updates } },
      `update_product:${wid}:${id}:${now}`,
      now
    );
    requestSyncQueueFlush();
    dispatchProductsChanged();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('product_write_failure', 'updateProduct failed', { id, error: e?.message || 'unknown' });
    return { ok: false, error: 'idb' };
  }
}

/**
 * @param {string} id
 * @returns {Promise<EntityWriteResult>}
 */
export async function deleteProduct(id) {
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid || !id) return { ok: false, error: 'no_workspace' };
  if (typeof indexedDB === 'undefined') return { ok: false, error: 'no_idb' };
  const billingBlock = await assertWriteAllowedEntity(wid, {});
  if (billingBlock) return billingBlock;
  try {
    await deleteEntityRecord('products', wid, uid, id);
    removeProductFromCache(id);
    const now = new Date().toISOString();
    await enqueueWhenSaaS(
      OP.DELETE_PRODUCT,
      wid,
      { productId: id },
      `delete_product:${wid}:${id}:${now}`,
      now
    );
    requestSyncQueueFlush();
    dispatchProductsChanged();
    return { ok: true };
  } catch (e) {
    if (e?.code === 'SAFE_MODE') return { ok: false, error: 'safe_mode' };
    void logSystemEvent('product_write_failure', 'deleteProduct failed', { id, error: e?.message || 'unknown' });
    return { ok: false, error: 'idb' };
  }
}

/**
 * Apply signed quantity deltas per product (e.g. cart lines: negative). Sequential updates; stops on first hard failure.
 * @param {Record<string, number>} deltas productId -> delta
 * @returns {Promise<{ ok: boolean, failed: string[] }>}
 */
export async function applyStockDeltas(deltas) {
  const failed = [];
  if (!deltas || typeof deltas !== 'object') {
    dispatchProductsChanged();
    return { ok: true, failed: [] };
  }
  const entries = Object.entries(deltas).filter(([, d]) => Number.isFinite(Number(d)) && Number(d) !== 0);
  for (const [productId, delta] of entries) {
    const wid = getCurrentAccountId();
    const uid = getCacheUserId();
    if (!wid || !uid) {
      failed.push(productId);
      continue;
    }
    let existing = null;
    try {
      existing = await getEntityRecordById('products', wid, uid, productId);
    } catch (_) {}
    const fromCache = getProducts().find((p) => p.id === productId);
    const base =
      typeof existing?.quantity === 'number'
        ? Number(existing.quantity)
        : Number(fromCache?.quantity ?? 0);
    const nextQty = Math.max(0, base + Number(delta));
    const r = await updateProduct(productId, { quantity: nextQty });
    if (!r.ok) failed.push(productId);
  }
  dispatchProductsChanged();
  return { ok: failed.length === 0, failed };
}
