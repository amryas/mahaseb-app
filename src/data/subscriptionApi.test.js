import { describe, it, expect } from 'vitest';
import { isSubscriptionActive, computeEffectiveStatus } from './subscriptionApi';

describe('subscriptionApi', () => {
  describe('isSubscriptionActive', () => {
    it('returns false when sub is null', () => {
      expect(isSubscriptionActive(null)).toBe(false);
    });

    it('returns false when sub is undefined', () => {
      expect(isSubscriptionActive(undefined)).toBe(false);
    });

    it('returns false when status is not active', () => {
      expect(isSubscriptionActive({ status: 'cancelled' })).toBe(false);
      expect(isSubscriptionActive({ status: 'expired' })).toBe(false);
    });

    it('returns true when status is active and no expires_at', () => {
      expect(isSubscriptionActive({ status: 'active' })).toBe(true);
    });

    it('returns true when status is active and expires_at is in the future', () => {
      const future = new Date();
      future.setMonth(future.getMonth() + 1);
      expect(isSubscriptionActive({ status: 'active', expires_at: future.toISOString() })).toBe(true);
    });

    it('returns false when status is active but ended beyond grace period', () => {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      expect(isSubscriptionActive({ status: 'active', subscription_end_date: past.toISOString() })).toBe(false);
    });

    it('returns true in grace window after subscription_end_date', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      expect(isSubscriptionActive({ status: 'active', subscription_end_date: past.toISOString() })).toBe(true);
    });

    it('returns true when effective grace', () => {
      expect(isSubscriptionActive({ status: 'active', effectiveStatus: 'grace' })).toBe(true);
    });
  });

  describe('computeEffectiveStatus', () => {
    it('maps recently ended subscription to grace', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      expect(computeEffectiveStatus({ status: 'active', subscription_end_date: past.toISOString() })).toBe('grace');
    });

    it('maps old ended subscription to expired', () => {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      expect(computeEffectiveStatus({ status: 'active', subscription_end_date: past.toISOString() })).toBe('expired');
    });
  });
});
