// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * اختبار E2E كمستخدم/عميل.
 * شغّل السيرفر أولاً: npm run dev
 * ثم: npx playwright test
 * ملاحظة: يشغّل أفضل بدون تسجيل دخول (بدون تفعيل Supabase/Firebase في .env).
 */
const E2E_BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');

export default defineConfig({
  testDir: '.',
  testMatch: [
    '**/e2e/**/*.spec.{js,ts,jsx,tsx}',
    '**/tests/integration/**/*.test.{js,ts,jsx,tsx}',
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      VITE_E2E: '1',
    },
  },
});
