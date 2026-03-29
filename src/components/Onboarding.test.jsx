import { describe, it, expect, beforeEach } from 'vitest';
import { shouldShowOnboarding, dismissOnboarding } from './Onboarding';

const KEY = 'mahaseb_onboarding_done';

describe('Onboarding', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  it('shouldShowOnboarding returns true when key not set', () => {
    expect(shouldShowOnboarding()).toBe(true);
  });

  it('shouldShowOnboarding returns false after dismissOnboarding', () => {
    dismissOnboarding();
    expect(shouldShowOnboarding()).toBe(false);
  });

  it('dismissOnboarding sets localStorage key', () => {
    dismissOnboarding();
    expect(localStorage.getItem(KEY)).toBe('1');
  });
});
