-- تأمين جدول subscriptions: المستخدم SELECT فقط. لا INSERT/UPDATE/DELETE.
-- التفعيل وإنشاء التجربة يتمان عبر Edge Functions (Service Role).

-- إزالة سياسات الكتابة للمستخدمين
DROP POLICY IF EXISTS "Users can insert own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own workspace subscription" ON public.subscriptions;

-- لا نضيف سياسات DELETE للمستخدمين (لا يوجد كانت مضافة) — فقط service_role يعدّل.
-- المستخدم يبقى له: "Users can read own workspace subscriptions" (SELECT فقط).
--
-- تفعيل الاشتراك: استخدم Edge Function activate_subscription_secure.
-- في Supabase: Settings → Edge Functions → Secrets → أضف SUPABASE_ACTIVATE_SUBSCRIPTION_SECRET.
COMMENT ON TABLE public.subscriptions IS 'اشتراكات مساحات العمل: SELECT فقط للمستخدم. التفعيل عبر Edge Function.';
