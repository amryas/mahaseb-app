-- ============================================================
-- RLS (Row Level Security) لجدول devices و accounts و account_data
-- شغّل هذا الملف من Supabase Dashboard → SQL Editor
--
-- ⚠️ مهم: كل سياسة INSERT و UPDATE يجب أن تحتوي على WITH CHECK
--    وإلا يمكن إدخال/تحديث بيانات لحساب أو جهاز آخر.
--
-- ملاحظة: السياسات تعتمد على auth.uid() (المستخدم المسجّل دخوله).
-- للاستخدام بدون تسجيل دخول (جهاز فقط) تحتاج آلية إضافية (مثلاً JWT claim).
-- ============================================================

-- 1) جدول devices
-- ---------------
ALTER TABLE IF EXISTS public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "devices_select_own" ON public.devices;
CREATE POLICY "devices_select_own" ON public.devices
  FOR SELECT
  USING (user_id = auth.uid());

-- INSERT: WITH CHECK (true) للسماح بإنشاء جهاز قبل تسجيل الدخول (لاحقاً يُربط user_id).
-- لو التطبيق SaaS بحت وتطلب تسجيل دخول أولاً: استخدم WITH CHECK (user_id = auth.uid()).
DROP POLICY IF EXISTS "devices_insert_own" ON public.devices;
CREATE POLICY "devices_insert_own" ON public.devices
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "devices_update_own" ON public.devices;
CREATE POLICY "devices_update_own" ON public.devices
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2) جدول accounts
-- ----------------
ALTER TABLE IF EXISTS public.accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_select_by_user_or_device" ON public.accounts;
CREATE POLICY "accounts_select_by_user_or_device" ON public.accounts
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
  );

-- INSERT: WITH CHECK إلزامي — منع إدخال حساب لجهاز/مستخدم آخر.
DROP POLICY IF EXISTS "accounts_insert_own" ON public.accounts;
CREATE POLICY "accounts_insert_own" ON public.accounts
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "accounts_update_own" ON public.accounts;
CREATE POLICY "accounts_update_own" ON public.accounts
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "accounts_delete_own" ON public.accounts;
CREATE POLICY "accounts_delete_own" ON public.accounts
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
  );

-- 3) جدول account_data
-- --------------------
ALTER TABLE IF EXISTS public.account_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_data_select_own" ON public.account_data;
CREATE POLICY "account_data_select_own" ON public.account_data
  FOR SELECT
  USING (
    account_id IN (
      SELECT id FROM public.accounts
      WHERE user_id = auth.uid()
         OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
    )
  );

-- INSERT: WITH CHECK إلزامي — منع إدخال بيانات لحساب لا يخص المستخدم.
DROP POLICY IF EXISTS "account_data_insert_own" ON public.account_data;
CREATE POLICY "account_data_insert_own" ON public.account_data
  FOR INSERT
  WITH CHECK (
    account_id IN (
      SELECT id FROM public.accounts
      WHERE user_id = auth.uid()
         OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "account_data_update_own" ON public.account_data;
CREATE POLICY "account_data_update_own" ON public.account_data
  FOR UPDATE
  USING (
    account_id IN (
      SELECT id FROM public.accounts
      WHERE user_id = auth.uid()
         OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT id FROM public.accounts
      WHERE user_id = auth.uid()
         OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "account_data_delete_own" ON public.account_data;
CREATE POLICY "account_data_delete_own" ON public.account_data
  FOR DELETE
  USING (
    account_id IN (
      SELECT id FROM public.accounts
      WHERE user_id = auth.uid()
         OR device_id IN (SELECT id FROM public.devices WHERE user_id = auth.uid())
    )
  );
