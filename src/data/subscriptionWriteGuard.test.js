import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BILLING_ERROR_CODES } from './billingErrors';

const hoisted = vi.hoisted(() => ({
  getSubscriptionFromCache: vi.fn(() => null),
  getSubscription: vi.fn(),
  ensureSubscriptionForWorkspace: vi.fn(),
  isSubscriptionActive: vi.fn(),
  isWorkspaceSaaSEnabled: vi.fn(() => true),
}));

vi.mock('./workspaceApi', () => ({
  isWorkspaceSaaSEnabled: () => hoisted.isWorkspaceSaaSEnabled(),
}));

vi.mock('./subscriptionApi', () => ({
  getSubscriptionFromCache: (...a) => hoisted.getSubscriptionFromCache(...a),
  getSubscription: (...a) => hoisted.getSubscription(...a),
  ensureSubscriptionForWorkspace: (...a) => hoisted.ensureSubscriptionForWorkspace(...a),
  isSubscriptionActive: (...a) => hoisted.isSubscriptionActive(...a),
  computeEffectiveStatus: (sub) => sub?.effectiveStatus || sub?.status || 'expired',
}));

vi.mock('./store', () => ({
  getCurrentAccountId: () => 'ws-test',
}));

vi.mock('./cacheStore', () => ({
  getCacheUserId: () => 'user-test',
}));

vi.mock('../services/monitoring', () => ({
  logSystemEvent: vi.fn(() => Promise.resolve(true)),
}));

import { ensureSubscriptionAllowsWriteCentral } from './subscriptionWriteGuard';

describe('subscriptionWriteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.isWorkspaceSaaSEnabled.mockReturnValue(true);
    hoisted.getSubscriptionFromCache.mockReturnValue(null);
    hoisted.getSubscription.mockResolvedValue(null);
    hoisted.ensureSubscriptionForWorkspace.mockResolvedValue(null);
    hoisted.isSubscriptionActive.mockReturnValue(false);
  });

  it('throws SUBSCRIPTION_REQUIRED when SaaS on, online, and subscription inactive', async () => {
    hoisted.getSubscription.mockResolvedValue({ status: 'trial', trial_end_date: '2000-01-01', effectiveStatus: 'expired' });
    hoisted.isSubscriptionActive.mockReturnValue(false);
    vi.stubGlobal('navigator', { onLine: true });

    await expect(ensureSubscriptionAllowsWriteCentral('ws-test', {})).rejects.toMatchObject({
      code: BILLING_ERROR_CODES.SUBSCRIPTION_REQUIRED,
    });

    vi.unstubAllGlobals();
  });

  it('allows write when offline and subscription inactive (deferred enforcement)', async () => {
    hoisted.getSubscription.mockResolvedValue({ status: 'trial', trial_end_date: '2000-01-01', effectiveStatus: 'expired' });
    hoisted.isSubscriptionActive.mockReturnValue(false);
    vi.stubGlobal('navigator', { onLine: false });

    await expect(ensureSubscriptionAllowsWriteCentral('ws-test', {})).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('no-op when SaaS disabled', async () => {
    hoisted.isWorkspaceSaaSEnabled.mockReturnValue(false);
    await expect(ensureSubscriptionAllowsWriteCentral('ws-test', {})).resolves.toBeUndefined();
    expect(hoisted.getSubscription).not.toHaveBeenCalled();
  });
});
