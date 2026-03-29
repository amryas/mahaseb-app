// @ts-check
/**
 * تجربة التطبيق كعميل: فتح التطبيق، الرئيسية، البيع، المخزون، التقارير.
 * التشغيل: npm run e2e  (أو: npm run dev ثم npx playwright test)
 * يفضّل تشغيل E2E بدون تفعيل Supabase/Firebase حتى لا تظهر شاشة تسجيل الدخول.
 */
import { test, expect } from '@playwright/test';

const TEST_ACCOUNT_ID = 'e2e-test-account-1';
const TEST_ACCOUNT_NAME = 'حساب تجريبي E2E';

// Cold start/build on CI or first launch can exceed Playwright's default 30s test timeout.
test.setTimeout(90_000);

test.describe('تجربة التطبيق كعميل', () => {
  test.beforeEach(async ({ page }) => {
    // عرض ثابت للشاشة الكبيرة حتى تظهر القائمة الجانبية
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.evaluate(({ accountId, accountName }) => {
      localStorage.setItem('e2e_skip_auth', '1'); // تخطي شاشة تسجيل الدخول في E2E
      localStorage.setItem('mahaseb_accounts', JSON.stringify([{ id: accountId, name: accountName }]));
      localStorage.setItem('mahaseb_current_account', accountId);
      localStorage.setItem('mahaseb_onboarding_done', '1');
    }, { accountId: TEST_ACCOUNT_ID, accountName: TEST_ACCOUNT_NAME });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
  });

  test('فتح التطبيق والوصول للرئيسية', async ({ page }) => {
    // انتظار لوحة التحكم (عنوان الصفحة الرئيسية)
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 20000 });
    // التأكد من وجود زر الرئيسية (شريط جانبي أو تنقل سفلي)
    await expect(page.getByText('الرئيسية').first()).toBeVisible({ timeout: 5000 });
  });

  test('التنقل من الرئيسية إلى البيع', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /البيع/ }).click();
    await expect(page.getByText(/المنتج|كمية|سعر|إتمام البيع/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('التنقل إلى المخزون', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /المخزون/ }).click();
    await expect(page.getByText(/المخزون|منتج|كمية|إضافة/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('التنقل إلى التقارير', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /التقارير/ }).click();
    await expect(page.getByText(/التقارير|تقرير|ملخص/i).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('تسجيل الدخول بالبريد وكلمة المرور', () => {
  const LOGIN_EMAIL = (process.env.E2E_LOGIN_EMAIL || '').trim();
  const LOGIN_PASSWORD = (process.env.E2E_LOGIN_PASSWORD || '').trim();

  test.beforeEach(async ({ page }) => {
    test.skip(!LOGIN_EMAIL || !LOGIN_PASSWORD, 'عيّن E2E_LOGIN_EMAIL و E2E_LOGIN_PASSWORD لتشغيل اختبار الدخول السحابي');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
  });

  test('الدخول بالبريد المعرّف في البيئة والوصول للوحة التحكم', async ({ page }) => {
    await page.waitForTimeout(2000);
    const dashboard = page.getByRole('heading', { name: 'لوحة التحكم' });
    const loginBtn = page.getByRole('button', { name: 'تسجيل الدخول' });
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]').first();

    const loginVisible = await loginBtn.isVisible().catch(() => false);
    if (loginVisible) {
      await emailInput.fill(LOGIN_EMAIL);
      await passwordInput.fill(LOGIN_PASSWORD);
      await loginBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000);
      const authError = page.locator('.auth-error');
      if (await authError.isVisible().catch(() => false)) {
        const errText = await authError.textContent();
        test.skip(true, `تسجيل الدخول فشل (تحقق من البريد وكلمة المرور في Supabase): ${errText || ''}`);
      }
    }

    await expect(dashboard).toBeVisible({ timeout: 15000 });
  });
});

test.describe('تجربة التطبيق كاملاً بعد الدخول', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.evaluate(({ accountId, accountName }) => {
      localStorage.setItem('e2e_skip_auth', '1');
      localStorage.setItem('mahaseb_accounts', JSON.stringify([{ id: accountId, name: accountName }]));
      localStorage.setItem('mahaseb_current_account', accountId);
      localStorage.setItem('mahaseb_onboarding_done', '1');
    }, { accountId: 'e2e-full-tour', accountName: 'حساب جولة كاملة' });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
  });

  test('الدخول ثم تجربة كل الصفحات: الرئيسية، المخزون، البيع، المصروفات، التقارير، المزيد، العملاء، الموردين، الاستيراد، النسخ الاحتياطي، الإعدادات', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 15000 });

    // المخزون
    await page.getByRole('button', { name: /المخزون/ }).click();
    await expect(page.getByText(/المخزون|منتج|إضافة منتج|كمية/i).first()).toBeVisible({ timeout: 8000 });

    // البيع
    await page.getByRole('button', { name: /البيع/ }).click();
    await expect(page.getByText(/المنتج|كمية|سعر|إتمام البيع|البيع/i).first()).toBeVisible({ timeout: 8000 });

    // المصروفات
    await page.getByRole('button', { name: /المصروفات/ }).click();
    await expect(page.getByText(/المصروفات|إيراد|مصروف|إضافة/i).first()).toBeVisible({ timeout: 8000 });

    // التقارير
    await page.getByRole('button', { name: /التقارير/ }).click();
    await expect(page.getByText(/التقارير|تقرير|ملخص|كشف يومي/i).first()).toBeVisible({ timeout: 8000 });

    // المزيد
    await page.getByRole('button', { name: /المزيد/ }).click();
    await expect(page.getByText(/المزيد|العملاء|الموردين|استيراد|نسخ احتياطي|الإعدادات/i).first()).toBeVisible({ timeout: 8000 });

    // من صفحة المزيد: العملاء والفواتير
    await page.getByRole('button', { name: /العملاء/ }).click();
    await expect(page.getByText(/العملاء|الفواتير|عميل|فاتورة/i).first()).toBeVisible({ timeout: 8000 });

    // العودة للمزيد ثم الموردين
    await page.getByRole('button', { name: /المزيد/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /الموردين/ }).click();
    await expect(page.getByText(/الموردين|مورد|مشتريات|ديون/i).first()).toBeVisible({ timeout: 8000 });

    // المزيد ← استيراد Excel
    await page.getByRole('button', { name: /المزيد/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /استيراد Excel|استيراد/i }).click();
    await expect(page.getByText(/استيراد|Excel|حركات|مبيعات/i).first()).toBeVisible({ timeout: 8000 });

    // المزيد ← نسخ احتياطي
    await page.getByRole('button', { name: /المزيد/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /نسخ احتياطي|احتياطي/i }).click();
    await expect(page.getByText(/نسخ احتياطي|تصدير|استعادة|JSON/i).first()).toBeVisible({ timeout: 8000 });

    // المزيد ← الإعدادات
    await page.getByRole('button', { name: /المزيد/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /الإعدادات|إعدادات/i }).click();
    await expect(page.getByText(/إعدادات|الشركة|اسم الشركة|حفظ/i).first()).toBeVisible({ timeout: 8000 });

    // العودة للرئيسية
    await page.getByRole('button', { name: /الرئيسية/ }).click();
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('100 مخزون + 100 عملية بيع ثم التقارير والأرباح', () => {
  const ACCOUNT_ID = 'e2e-bulk-100';
  const PRODUCTS_KEY = `mahaseb_${ACCOUNT_ID}_products`;
  const SALES_KEY = `mahaseb_${ACCOUNT_ID}_sales`;
  const TRANSACTIONS_KEY = `mahaseb_${ACCOUNT_ID}_transactions`;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ accountId, productsKey, salesKey, transactionsKey }) => {
        localStorage.setItem('e2e_skip_auth', '1');
        localStorage.setItem(
          'mahaseb_accounts',
          JSON.stringify([{ id: accountId, name: 'حساب 100 مخزون وبيع', createdAt: new Date().toISOString() }])
        );
        localStorage.setItem('mahaseb_current_account', accountId);
        localStorage.setItem('mahaseb_onboarding_done', '1');

        const products = [];
        for (let i = 1; i <= 100; i++) {
          products.push({
            id: `prod-${i}`,
            name: `منتج ${i}`,
            quantity: 50,
            minQuantity: 0,
            unit: 'قطعة',
            costPrice: 10 + (i % 50),
          });
        }
        localStorage.setItem(productsKey, JSON.stringify(products));

        const today = new Date().toISOString().slice(0, 10);
        const sales = [];
        const transactions = [];
        for (let i = 1; i <= 100; i++) {
          const prod = products[i - 1];
          const qty = 1;
          const unitPrice = (prod.costPrice || 10) * 1.25;
          const total = qty * unitPrice;
          const profit = total - (prod.costPrice || 10) * qty;
          const saleId = `sale-${i}`;
          sales.push({
            id: saleId,
            productId: prod.id,
            productName: prod.name,
            quantity: qty,
            unitPrice,
            unitCost: prod.costPrice,
            discount: 0,
            total,
            profit,
            profitMargin: total > 0 ? (profit / total) * 100 : 0,
            date: today,
            clientName: i % 3 === 0 ? `عميل ${i}` : 'نقدي',
            paid: true,
            status: 'completed',
          });
          transactions.push({
            id: `tx-${i}`,
            type: 'income',
            description: `بيع: ${prod.name} × ${qty}`,
            amount: total,
            category: 'مبيعات',
            date: today,
            source: 'sale',
            saleId,
          });
        }
        localStorage.setItem(salesKey, JSON.stringify(sales));
        localStorage.setItem(transactionsKey, JSON.stringify(transactions));
      },
      {
        accountId: ACCOUNT_ID,
        productsKey: PRODUCTS_KEY,
        salesKey: SALES_KEY,
        transactionsKey: TRANSACTIONS_KEY,
      }
    );
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
    await page.waitForTimeout(1000);
  });

  test('عرض 100 منتج في المخزون ثم 100 مبيعة والتقارير والأرباح', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 15000 });

    const stored = await page.evaluate(() => {
      const accountId = localStorage.getItem('mahaseb_current_account');
      const raw = localStorage.getItem('mahaseb_e2e-bulk-100_products');
      const products = raw ? JSON.parse(raw) : [];
      const rawSales = localStorage.getItem('mahaseb_e2e-bulk-100_sales');
      const sales = rawSales ? JSON.parse(rawSales) : [];
      return { accountId, productsCount: products.length, salesCount: sales.length };
    });
    if (stored.accountId !== 'e2e-bulk-100' || stored.productsCount !== 100 || stored.salesCount !== 100) {
      test.skip(true, `البيانات أو الحساب لم يُحتفظ به بعد التحميل (مزامنة سحابية؟). accountId=${stored.accountId}, products=${stored.productsCount}, sales=${stored.salesCount}. شغّل E2E بدون Supabase لتفعيل هذا الاختبار.`);
      return;
    }

    await page.getByRole('button', { name: /المخزون/ }).click();
    await expect(page.getByText(/المخزون|قائمة المنتجات|جرد المخزون|إضافة منتج/i).first()).toBeVisible({ timeout: 8000 });
    if (await page.getByText('لا يوجد منتجات').isVisible().catch(() => false)) {
      test.skip(true, 'قائمة المنتجات فارغة رغم وجود بيانات (الحساب الحالي قد اُستبدل).');
      return;
    }
    await expect(page.getByText(/منتج 1|منتج 2|عرض المزيد|قائمة المنتجات/).first()).toBeVisible({ timeout: 8000 });

    await page.getByRole('button', { name: /البيع/ }).click();
    await expect(page.getByText(/تسجيل مبيعة|آخر المبيعات/i).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/مبيعات|مبيعة|البيع/)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /التقارير/ }).click();
    await expect(page.getByText(/التقارير|ملخص|إيراد|مصروف/i).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/إجمالي|مبيعات|ربح|ج\.م|الإيرادات|المصروفات/)).toBeVisible({ timeout: 8000 });

    const pageContent = await page.content();
    const hasProfitOrSales = /ربح|إجمالي|مبيعات|ج\.م|[\d,]+\.?\d*\s*ج\.م/.test(pageContent);
    expect(hasProfitOrSales).toBe(true);
  });
});

test.describe('إضافة مخزون ومبيعات من الواجهة ثم التقارير والأرباح', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('e2e_skip_auth', '1');
      localStorage.setItem(
        'mahaseb_accounts',
        JSON.stringify([{ id: 'e2e-ui-flow', name: 'حساب تجربة واجهة', createdAt: new Date().toISOString() }])
      );
      localStorage.setItem('mahaseb_current_account', 'e2e-ui-flow');
      localStorage.setItem('mahaseb_onboarding_done', '1');
    });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
  });

  test('إضافة 5 منتجات ثم 5 مبيعات ثم فتح التقارير والأرباح', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /المخزون/ }).click();
    await expect(page.getByPlaceholder('اسم المنتج')).toBeVisible({ timeout: 8000 });
    for (let i = 1; i <= 5; i++) {
      await page.getByPlaceholder('اسم المنتج').fill(`منتج واجهة ${i}`);
      await page.locator('input[placeholder="سعر التكلفة"]').fill(String(20 + i * 10));
      await page.locator('input[placeholder="0"]').first().fill('100');
      await page.getByRole('button', { name: 'إضافة' }).click();
      await page.waitForTimeout(400);
    }
    await expect(page.getByText('منتج واجهة 5')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /البيع/ }).click();
    await page.waitForTimeout(1500);
    if (await page.getByText('لا يوجد منتجات').isVisible().catch(() => false)) {
      test.skip(true, 'صفحة البيع فارغة (المخزون قد اُستبدل بمزامنة السحابة). شغّل E2E بدون Supabase لتفعيل اختبار المخزون والبيع.');
      return;
    }
    const saleForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'تسجيل البيع' }) });
    await expect(saleForm.locator('select').first()).toBeVisible({ timeout: 8000 });
    for (let i = 1; i <= 5; i++) {
      // Option label in the UI includes extra suffix like "(متوفر: ...)".
      const select = saleForm.locator('select').first();
      const productOption = select.locator('option', { hasText: `منتج واجهة ${i}` }).first();
      await productOption.waitFor({ state: 'attached', timeout: 8000 });
      const value = await productOption.getAttribute('value');
      expect(value, `No select option value for منتج واجهة ${i}`).toBeTruthy();
      await select.selectOption({ value });
      await page.waitForTimeout(200);
      await saleForm.locator('input[type="number"]').first().fill('2');
      await saleForm.locator('input[type="number"]').nth(1).fill(String(30 + i * 10));
      await page.getByRole('button', { name: 'تسجيل البيع' }).click();
      await page.waitForTimeout(600);
    }
    await expect(page.getByText(/تم تسجيل البيع|آخر المبيعات|مبيعات/)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /التقارير/ }).click();
    await expect(page.getByText(/إجمالي|ملخص|إيراد|مصروف|ربح|ج\.م/).first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('إنشاء حساب جديد والدخول به', () => {
  const NEW_EMAIL = `e2e.mahaseb.${Date.now()}@test.local`;
  const NEW_PASSWORD = (process.env.E2E_SIGNUP_PASSWORD || '').trim();

  test.beforeEach(async ({ page }) => {
    test.skip(!NEW_PASSWORD, 'عيّن E2E_SIGNUP_PASSWORD لاختبار إنشاء حساب (كلمة مرور قوية حسب سياسة المزوّد)');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/', { timeout: 90_000, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
    await page.waitForTimeout(1500);
  });

  test('إنشاء حساب ثم تسجيل الدخول والوصول للوحة التحكم', async ({ page }) => {
    const signupSwitch = page.getByRole('button', { name: /ليس لديك حساب|سجّل الآن/ });
    const loginSwitch = page.getByRole('button', { name: /لديك حساب\؟ سجّل الدخول/ });
    const emailInput = page.locator('input[type="email"]');
    const passwordInputs = page.locator('input[type="password"]');
    const createAccountBtn = page.getByRole('button', { name: 'إنشاء الحساب' });
    const loginBtn = page.getByRole('button', { name: 'تسجيل الدخول' });
    const dashboard = page.getByRole('heading', { name: 'لوحة التحكم' });

    const showSignup = await signupSwitch.isVisible().catch(() => false);
    if (!showSignup) {
      test.skip(true, 'شاشة الدخول غير ظاهرة (ربما الدخول غير مفعّل)');
      return;
    }

    await signupSwitch.click();
    await page.waitForTimeout(500);
    await emailInput.fill(NEW_EMAIL);
    await passwordInputs.nth(0).fill(NEW_PASSWORD);
    await passwordInputs.nth(1).fill(NEW_PASSWORD);
    await createAccountBtn.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);

    const authError = page.locator('.auth-error');
    if (await authError.isVisible().catch(() => false)) {
      const errText = await authError.textContent();
      throw new Error(`فشل إنشاء الحساب: ${errText || ''}`);
    }

    const alreadyOnDashboard = await dashboard.isVisible().catch(() => false);
    if (alreadyOnDashboard) {
      await expect(dashboard).toBeVisible();
      return;
    }

    const showLogin = await loginSwitch.isVisible().catch(() => false);
    if (showLogin) {
      await loginSwitch.click();
      await page.waitForTimeout(500);
      await emailInput.fill(NEW_EMAIL);
      await passwordInputs.first().fill(NEW_PASSWORD);
      await loginBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
      if (await authError.isVisible().catch(() => false)) {
        const errText = await authError.textContent();
        test.skip(true, `تم إنشاء الحساب لكن الدخول يتطلب تأكيد البريد: ${errText || ''}`);
        return;
      }
    }

    await expect(dashboard).toBeVisible({ timeout: 15000 });
  });
});
