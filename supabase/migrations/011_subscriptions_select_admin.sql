-- الأدمن يقرأ كل الاشتراكات (للوحة التحكم: عدد الاشتراكات النشطة + حالة كل مساحة)
CREATE POLICY "subscriptions_select_admin"
  ON public.subscriptions FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email'))
  );

COMMENT ON POLICY "subscriptions_select_admin" ON public.subscriptions IS 'الأدمن يرى كل الاشتراكات لعرض الداشبورد';
