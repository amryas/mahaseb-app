// @ts-check
/**
 * Smoke checks for write-through paths (IndexedDB + cache) without cloud auth.
 * Run: npm run e2e -- e2e/write-through-smoke.spec.js
 */
import { test, expect } from '@playwright/test';

const TEST_ACCOUNT_ID = 'e2e-write-through-1';
const TEST_ACCOUNT_NAME = 'حساب كتابة E2E';

test.setTimeout(90_000);

test.describe('Write-through smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.evaluate(({ accountId, accountName }) => {
      localStorage.setItem('e2e_skip_auth', '1');
      localStorage.setItem('mahaseb_accounts', JSON.stringify([{ id: accountId, name: accountName }]));
      localStorage.setItem('mahaseb_current_account', accountId);
      localStorage.setItem('mahaseb_onboarding_done', '1');
    }, { accountId: TEST_ACCOUNT_ID, accountName: TEST_ACCOUNT_NAME });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
  });

  test('إضافة منتج عبر المخزون يظهر في القائمة', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 25_000 });
    await page.getByRole('button', { name: /المخزون/ }).click();
    await expect(page.getByRole('heading', { name: /المخزون|قائمة المنتجات/i }).first()).toBeVisible({ timeout: 15_000 });

    const unique = `e2e-prod-${Date.now()}`;
    await page.getByPlaceholder(/اسم المنتج/i).fill(unique);
    await page.getByRole('button', { name: /إضافة$/ }).click();

    await expect(page.getByRole('cell', { name: unique })).toBeVisible({ timeout: 15_000 });
  });
});
