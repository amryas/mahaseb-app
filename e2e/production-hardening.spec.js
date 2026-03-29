// @ts-check
import { test, expect } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

async function seedE2EAccount(page, accountId, name) {
  await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ id, accountName }) => {
      localStorage.setItem('e2e_skip_auth', '1');
      localStorage.setItem('mahaseb_accounts', JSON.stringify([{ id, name: accountName, createdAt: new Date().toISOString() }]));
      localStorage.setItem('mahaseb_current_account', id);
      localStorage.setItem('mahaseb_onboarding_done', '1');
    },
    { id: accountId, name }
  );
  await page.reload();
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
}

test.describe('قوائم افتراضية واستقرار التمرير', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const accountId = 'e2e-virtual-scroll';
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.evaluate(({ aid }) => {
      localStorage.setItem('e2e_skip_auth', '1');
      localStorage.setItem(
        'mahaseb_accounts',
        JSON.stringify([{ id: aid, name: 'حساب تمرير', createdAt: new Date().toISOString() }])
      );
      localStorage.setItem('mahaseb_current_account', aid);
      localStorage.setItem('mahaseb_onboarding_done', '1');
    }, { aid: accountId });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 15000 });
    // القوائم تعتمد على IndexedDB (مؤشرات الكورسور)، وليس localStorage فقط
    await page.evaluate(async () => {
      const mod = await import('/src/data/bulkHydration.js');
      const products = [];
      for (let i = 1; i <= 80; i += 1) {
        products.push({
          id: `vprod-${i}`,
          name: `عنصر تمرير ${i}`,
          quantity: 10,
          minQuantity: 0,
          unit: 'قطعة',
          costPrice: 5,
        });
      }
      const today = new Date().toISOString().slice(0, 10);
      const sales = [];
      for (let i = 1; i <= 80; i += 1) {
        const p = products[i - 1];
        sales.push({
          id: `vsale-${i}`,
          productId: p.id,
          productName: p.name,
          quantity: 1,
          unitPrice: 20,
          unitCost: 5,
          discount: 0,
          total: 20,
          profit: 15,
          profitMargin: 75,
          date: today,
          clientName: 'نقدي',
          paid: true,
          status: 'completed',
        });
      }
      await mod.hydrateProductsFromList(products);
      await mod.hydrateSalesFromList(sales);
    });
  });

  test('تمرير المخزون والبيع دون كسر العنوان', async ({ page }) => {
    await page.getByRole('button', { name: /المخزون/ }).click();
    await expect(page.getByText(/قائمة المنتجات|جرد المخزون/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.main-content .table-wrap').first()).toBeVisible({ timeout: 10000 });
    const productsScroll = page.locator('.main-content .table-wrap').first();
    await productsScroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);
    await expect(page.locator('.main-content table tbody tr').first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /البيع/ }).click();
    await expect(page.getByRole('heading', { name: 'آخر المبيعات' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.main-content .table-wrap').first()).toBeVisible({ timeout: 10000 });
    const salesScroll = page.locator('.main-content .table-wrap').first();
    await salesScroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'آخر المبيعات' })).toBeVisible();
    await expect(page.locator('.main-content table tbody tr').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('وضع القراءة الآمن (واجهة)', () => {
  test('عرض شاشة العربية ثم التعافي بعد إعادة المحاولة', async ({ page }) => {
    await seedE2EAccount(page, 'e2e-safe-mode', 'حساب وضع آمن');
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      if (!w.__MAHASEB_E2E__?.enterGlobalSafeMode) {
        throw new Error('VITE_E2E hooks missing — run E2E via playwright webServer');
      }
      w.__MAHASEB_E2E__.enterGlobalSafeMode('e2e_simulated');
    });

    await expect(page.getByRole('heading', { name: /وضع القراءة الآمن/i })).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 20000 });
  });
});

test.describe('مزامنة بعد انقطاع مؤقت', () => {
  test('البيع دون اتصال ثم العودة للاتصال لا يكسر الواجهة', async ({ page }) => {
    await seedE2EAccount(page, 'e2e-offline-sale', 'حساب دون اتصال');
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 15000 });

    await page.context().setOffline(true);
    await page.getByRole('button', { name: /البيع/ }).click();
    await expect(page.getByText(/تسجيل مبيعة|آخر المبيعات/i).first()).toBeVisible({ timeout: 10000 });
    await page.context().setOffline(false);
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await expect(page.getByText(/تسجيل مبيعة|آخر المبيعات|البيع/i).first()).toBeVisible({ timeout: 8000 });

    const drained = await page.evaluate(async () => {
      const mod = await import('/src/data/syncQueue.js');
      return mod.waitForQueueDrain(30_000, 900);
    });
    expect(drained).toBe(true);
  });
});

test.describe('حذف أثناء التفاعل', () => {
  test('حذف مصروف من القائمة', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const accountId = 'e2e-delete-tx';
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.evaluate(({ aid }) => {
      localStorage.setItem('e2e_skip_auth', '1');
      localStorage.setItem(
        'mahaseb_accounts',
        JSON.stringify([{ id: aid, name: 'حساب حذف', createdAt: new Date().toISOString() }])
      );
      localStorage.setItem('mahaseb_current_account', aid);
      localStorage.setItem('mahaseb_onboarding_done', '1');
    }, { aid: accountId });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 15000 });
    const d = new Date().toISOString().slice(0, 10);
    await page.evaluate(
      async ({ date }) => {
        const mod = await import('/src/data/bulkHydration.js');
        await mod.hydrateTransactionsFromList([
          {
            id: 'del-tx-1',
            type: 'expense',
            description: 'مصروف للحذف',
            amount: 25,
            category: 'عام',
            date,
          },
        ]);
      },
      { date: d }
    );
    await page.getByRole('button', { name: /المصروفات/ }).click();
    await expect(page.getByText(/المصروفات|إضافة/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'حذف' }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'حذف' }).first().click();
    await expect(page.getByText(/تم الحذف|حُذف/i).first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('استيراد كبير (واجهة)', () => {
  test('فتح صفحة الاستيراد مع بيانات كثيرة في التخزين', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const accountId = 'e2e-large-import-ui';
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ aid }) => {
        localStorage.setItem('e2e_skip_auth', '1');
        localStorage.setItem(
          'mahaseb_accounts',
          JSON.stringify([{ id: aid, name: 'حساب استيراد', createdAt: new Date().toISOString() }])
        );
        localStorage.setItem('mahaseb_current_account', aid);
        localStorage.setItem('mahaseb_onboarding_done', '1');
        const txs = [];
        const d = new Date().toISOString().slice(0, 10);
        for (let i = 0; i < 200; i++) {
          txs.push({
            id: `ltx-${i}`,
            type: 'expense',
            description: `مصروف استيراد ${i}`,
            amount: 10 + i,
            category: 'عام',
            date: d,
          });
        }
        localStorage.setItem(`mahaseb_${aid}_transactions`, JSON.stringify(txs));
      },
      { aid: accountId }
    );
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /المزيد/ }).click();
    await page.getByRole('button', { name: /استيراد Excel|استيراد/i }).click();
    await expect(page.getByText(/استيراد|Excel|حركات|مبيعات/i).first()).toBeVisible({ timeout: 10000 });
  });
});
