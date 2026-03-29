/**
 * Central billing write guard — authoritative for SaaS workspaces (server state + cache + grace + offline deferral).
 */

import { isWorkspaceSaaSEnabled } from './workspaceApi';
import { getCurrentAccountId } from './store';
import { getCacheUserId } from './cacheStore';
import {
  getSubscription,
  getSubscriptionFromCache,
  ensureSubscriptionForWorkspace,
  isSubscriptionActive,
  computeEffectiveStatus,
} from './subscriptionApi';
import { BILLING_ERROR_CODES, BillingGuardError } from './billingErrors';
import { assertUsageLimitAllows } from './usageLimitsApi';
import { logSystemEvent } from '../services/monitoring';

/**
 * Ensures the workspace may perform mutating operations when SaaS billing applies.
 * @param {string} [workspaceId]
 * @param {{ skipNetworkRefresh?: boolean }} [options]
 * @returns {Promise<void>}
 * @throws {BillingGuardError} SUBSCRIPTION_REQUIRED when blocked online or unknown subscription
 */
export async function ensureSubscriptionAllowsWriteCentral(workspaceId, options = {}) {
  const { skipNetworkRefresh = false } = options;

  if (!isWorkspaceSaaSEnabled()) return;

  const wid = workspaceId || getCurrentAccountId();
  if (!wid) {
    throw new BillingGuardError(BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED, 'no_workspace');
  }

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  let sub = getSubscriptionFromCache(wid);
  if (sub) {
    sub = { ...sub, effectiveStatus: computeEffectiveStatus(sub) };
  }

  if (!skipNetworkRefresh || !sub) {
    try {
      const fresh = await getSubscription(wid);
      if (fresh) sub = fresh;
    } catch {
      if (!sub) {
        throw new BillingGuardError(BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED, 'subscription_fetch_failed');
      }
    }
  }

  if (!sub) {
    const uid = getCacheUserId();
    if (uid && !offline) {
      await ensureSubscriptionForWorkspace(uid, wid);
      sub = await getSubscription(wid);
    }
    if (!sub) {
      throw new BillingGuardError(BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED, 'subscription_missing');
    }
  }

  if (isSubscriptionActive(sub)) return;

  if (offline) {
    void logSystemEvent(
      'billing_offline_write',
      'Write allowed while offline; billing inactive in cache',
      {
        workspaceId: wid,
        effectiveStatus: sub.effectiveStatus ?? computeEffectiveStatus(sub),
      },
      { force: true, workspaceId: wid }
    );
    return;
  }

  throw new BillingGuardError(BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED, 'subscription_inactive');
}

/**
 * Subscription (+ optional product plan limit) for entity writes.
 * @param {string} workspaceId
 * @param {{ checkProductLimit?: boolean, skipSubscriptionNetwork?: boolean }} [opts]
 * @returns {Promise<null | { ok: false, error: string, code?: string }>}
 */
export async function assertWriteAllowedEntity(workspaceId, opts = {}) {
  const { checkProductLimit = false, skipSubscriptionNetwork = false } = opts;
  try {
    await ensureSubscriptionAllowsWriteCentral(workspaceId, {
      skipNetworkRefresh: skipSubscriptionNetwork,
    });
  } catch (e) {
    const r = billingGuardToWriteResult(e);
    if (r) return r;
    throw e;
  }
  if (checkProductLimit) {
    try {
      await assertUsageLimitAllows(workspaceId, 'product');
    } catch (e) {
      const r = billingGuardToWriteResult(e);
      if (r) return r;
      throw e;
    }
  }
  return null;
}

/** Map guard errors to entity write result shape */
export function billingGuardToWriteResult(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.code === BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED) {
    return { ok: false, error: 'subscription_required', code: e.code };
  }
  if (e.code === BILLING_ERROR_CODES.PLAN_LIMIT_REACHED) {
    return { ok: false, error: 'plan_limit_reached', code: e.code };
  }
  return null;
}
