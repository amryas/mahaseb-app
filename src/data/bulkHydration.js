/**
 * Trusted bulk hydration (backup restore, Firebase load) — IDB row + cache slice, no sync queue.
 */
import { putSaleRecord, upsertEntityRecord } from './indexedDbStore';
import { getCurrentAccountId, mergeTransactionIntoCache, mergeProductIntoCache, mergeClientIntoCache, mergeSaleIntoCache } from './store';
import { getCacheUserId } from './cacheStore';

function widUid() {
  const w = getCurrentAccountId();
  const u = getCacheUserId();
  return { w, u };
}

/** @param {any[]} rows */
export async function hydrateTransactionsFromList(rows) {
  const { w, u } = widUid();
  if (!w || !u || !Array.isArray(rows)) return 0;
  let n = 0;
  for (const t of rows) {
    if (!t?.id) continue;
    try {
      await upsertEntityRecord('transactions', w, u, t);
      mergeTransactionIntoCache(t);
      n += 1;
    } catch {
      break;
    }
  }
  return n;
}

/** @param {any[]} rows */
export async function hydrateProductsFromList(rows) {
  const { w, u } = widUid();
  if (!w || !u || !Array.isArray(rows)) return 0;
  let n = 0;
  for (const p of rows) {
    if (!p?.id) continue;
    try {
      await upsertEntityRecord('products', w, u, p);
      mergeProductIntoCache(p);
      n += 1;
    } catch {
      break;
    }
  }
  return n;
}

/** @param {any[]} rows */
export async function hydrateSalesFromList(rows) {
  const { w, u } = widUid();
  if (!w || !u || !Array.isArray(rows)) return 0;
  let n = 0;
  for (const s of rows) {
    if (!s?.id) continue;
    try {
      await putSaleRecord(w, u, { ...s, syncStatus: s.syncStatus || 'synced' });
      mergeSaleIntoCache(s);
      n += 1;
    } catch {
      break;
    }
  }
  return n;
}

/** @param {any[]} rows */
export async function hydrateClientsFromList(rows) {
  const { w, u } = widUid();
  if (!w || !u || !Array.isArray(rows)) return 0;
  let n = 0;
  for (const c of rows) {
    if (!c?.id) continue;
    try {
      await upsertEntityRecord('customers', w, u, c);
      mergeClientIntoCache(c);
      n += 1;
    } catch {
      break;
    }
  }
  return n;
}
