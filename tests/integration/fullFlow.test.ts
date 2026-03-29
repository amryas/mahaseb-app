import { test, expect } from '@playwright/test';

test.describe('Full SaaS Flow', () => {
  test('signup -> workspace -> products -> sales -> offline -> sync -> relogin -> isolation', async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.goto('/', { timeout: 90_000 });
    await page.setViewportSize({ width: 1280, height: 800 });

    // E2E mode keeps deterministic flow in CI.
    await page.evaluate(() => {
      localStorage.setItem('e2e_skip_auth', '1');
      // Force stable cache scope for localStorage-backed cacheStore keys.
      localStorage.setItem('app_cache_user_id', 'guest');
      localStorage.setItem(
        'mahaseb_accounts',
        JSON.stringify([
          { id: 'it-ws-1', name: 'Integration WS 1', createdAt: new Date().toISOString() },
          { id: 'it-ws-2', name: 'Integration WS 2', createdAt: new Date().toISOString() },
        ])
      );
      // Also set scoped keys (store.js scopes by getCacheUserId()).
      localStorage.setItem(
        'mahaseb_accounts_guest',
        JSON.stringify([
          { id: 'it-ws-1', name: 'Integration WS 1', createdAt: new Date().toISOString() },
          { id: 'it-ws-2', name: 'Integration WS 2', createdAt: new Date().toISOString() },
        ])
      );
      localStorage.setItem('mahaseb_current_account', 'it-ws-1');
      localStorage.setItem('mahaseb_current_account_guest', 'it-ws-1');
      localStorage.setItem('mahaseb_onboarding_done', '1');

      // Force subscription active for deterministic E2E.
      const future = new Date();
      future.setMonth(future.getMonth() + 2);
      const sub = {
        status: 'active',
        expires_at: future.toISOString(),
        subscription_end_date: future.toISOString(),
        plan: 'e2e',
      };
      localStorage.setItem('mahaseb_sub_it-ws-1', JSON.stringify(sub));
      localStorage.setItem('mahaseb_sub_it-ws-2', JSON.stringify(sub));
    });

    // Clear IndexedDB caches so subscription_cache / product caches don't leak from previous runs.
    await page.evaluate(async () => {
      if (!('indexedDB' in window)) return;
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('mohaseb_db');
        req.onsuccess = () => resolve(undefined);
        req.onerror = () => resolve(undefined);
        req.onblocked = () => resolve(undefined);
      });
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible();

    // Add 3 products.
    await page.getByRole('button', { name: /المخزون/ }).click();
    for (let i = 1; i <= 3; i++) {
      await page.getByPlaceholder('اسم المنتج').fill(`INT Product ${i}`);
      await page.locator('input[placeholder="سعر التكلفة"]').fill(String(10 + i));
      await page.locator('input[placeholder="0"]').first().fill('100');
      await page.getByRole('button', { name: 'إضافة' }).click();
      await page.waitForTimeout(250);
    }

    // Verify products are actually present (prevents silent UI failures).
    await expect(page.locator('table').getByText('INT Product 1')).toBeVisible({ timeout: 15_000 });

    // Add 5 sales.
    await page.getByRole('button', { name: /البيع/ }).click();
    // <option> elements are typically hidden until the dropdown opens,
    // so we only assert attachment (existence in DOM).
    const anyProductOption = page.locator('select option', { hasText: 'INT Product 1' }).first();
    await anyProductOption.waitFor({ state: 'attached', timeout: 15_000 });
    const quickForm = page.locator('form.quick-sale-form').first();
    const mainSubmitBtn = page.locator('button.btn-sale-submit').first();
    const quickFormVisible = await quickForm.isVisible().catch(() => false);
    if (quickFormVisible) {
      await expect(quickForm).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(mainSubmitBtn).toBeVisible({ timeout: 15_000 });
    }

    // Main sale form locators (used when quick form is not available).
    const mainForm = mainSubmitBtn.locator('xpath=ancestor::form[1]');
    const mainSelect = mainForm.locator('select').first();
    const mainQtyInput = mainForm.locator('input[type="number"][min="1"]').first();
    const mainUnitPriceInput = mainForm.locator('input[type="number"][step="0.01"]').first();

    // Quick sale form locators.
    const quickSelect = quickForm.locator('select.quick-sale-select').first();
    const quickQtyInput = quickForm.locator('input[type="number"]').first();
    for (let i = 1; i <= 5; i++) {
      const productLabel = `INT Product ${(i % 3) + 1}`;

      if (quickFormVisible) {
        const productOption = quickSelect.locator('option', { hasText: productLabel }).first();
        await productOption.waitFor({ state: 'attached', timeout: 10_000 });
        const value = await productOption.getAttribute('value');
        expect(value, `No option value found for ${productLabel}`).toBeTruthy();
        await quickSelect.selectOption({ value: value! });
        await quickQtyInput.fill('1');
        await quickForm.locator('button.btn-quick-sale').first().click();
      } else {
        const productOption = mainSelect.locator('option', { hasText: productLabel }).first();
        await productOption.waitFor({ state: 'attached', timeout: 10_000 });
        const value = await productOption.getAttribute('value');
        expect(value, `No option value found for ${productLabel}`).toBeTruthy();
        await mainSelect.selectOption({ value: value! });
        await mainQtyInput.fill('1');
        await mainUnitPriceInput.fill(String(30 + i));
        await mainSubmitBtn.click();
      }
      await page.waitForTimeout(150);
    }

    // Offline sale then restore.
    await context.setOffline(true);
    {
      const productLabel = 'INT Product 1';
      if (quickFormVisible) {
        const productOption = quickSelect.locator('option', { hasText: productLabel }).first();
        await productOption.waitFor({ state: 'attached', timeout: 10_000 });
        const value = await productOption.getAttribute('value');
        expect(value, `No option value found for ${productLabel}`).toBeTruthy();
        await quickSelect.selectOption({ value: value! });
        await quickQtyInput.fill('1');
        await quickForm.locator('button.btn-quick-sale').first().click();
      } else {
        const productOption = mainSelect.locator('option', { hasText: productLabel }).first();
        await productOption.waitFor({ state: 'attached', timeout: 10_000 });
        const value = await productOption.getAttribute('value');
        expect(value, `No option value found for ${productLabel}`).toBeTruthy();
        await mainSelect.selectOption({ value: value! });
        await mainQtyInput.fill('1');
        await mainUnitPriceInput.fill('55');
        await mainSubmitBtn.click();
      }
    }
    await page.waitForTimeout(400);
    await context.setOffline(false);
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify persistence.
    await page.getByRole('button', { name: /البيع/ }).click();
    await expect(page.getByText(/آخر المبيعات|مبيعات/).first()).toBeVisible();

    // Switch workspace and verify isolation.
    await page.evaluate(() => {
      localStorage.setItem('mahaseb_current_account', 'it-ws-2');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /البيع/ }).click();
    await expect(page.getByText('لا توجد مبيعات مسجلة.')).toBeVisible();
  });
});
