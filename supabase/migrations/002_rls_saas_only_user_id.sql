-- ============================================================
-- RLS لـ SaaS حقيقي: ربط الحسابات بـ user_id فقط (بدون device_id)
-- استخدم هذا الملف لو التطبيق أصبح تسجيل دخول إلزامي وكل حساب مرتبط بمستخدم واحد.
-- الجهاز يمكن تغييره بسهولة؛ الاعتماد على user_id أوضح وأكثر استقراراً.
--
-- شغّل بعد 001_enable_rls.sql (يستبدل سياسات accounts و account_data).
-- ============================================================

-- سياسات accounts: user_id فقط
-- ----------------------------
DROP POLICY IF EXISTS "accounts_select_by_user_or_device" ON public.accounts;
CREATE POLICY "accounts_select_by_user" ON public.accounts
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "accounts_insert_own" ON public.accounts;
CREATE POLICY "accounts_insert_own" ON public.accounts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "accounts_update_own" ON public.accounts;
CREATE POLICY "accounts_update_own" ON public.accounts
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "accounts_delete_own" ON public.accounts;
CREATE POLICY "accounts_delete_own" ON public.accounts
  FOR DELETE
  USING (user_id = auth.uid());

-- سياسات account_data: account_id مرتبط بـ user_id فقط
-- ----------------------------------------------------
DROP POLICY IF EXISTS "account_data_select_own" ON public.account_data;
CREATE POLICY "account_data_select_own" ON public.account_data
  FOR SELECT
  USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "account_data_insert_own" ON public.account_data;
CREATE POLICY "account_data_insert_own" ON public.account_data
  FOR INSERT
  WITH CHECK (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "account_data_update_own" ON public.account_data;
CREATE POLICY "account_data_update_own" ON public.account_data
  FOR UPDATE
  USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  )
  WITH CHECK (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "account_data_delete_own" ON public.account_data;
CREATE POLICY "account_data_delete_own" ON public.account_data
  FOR DELETE
  USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );
