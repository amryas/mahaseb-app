-- ============================================================
-- Mohaseb Mashro3y — Admin, Usage Limits, Payment Proofs, Logs
-- Run in Supabase SQL Editor
-- ============================================================

-- 1) admin_users — من يمكنه الدخول إلى /admin
CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'support' CHECK (role IN ('super_admin', 'support')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users(email);
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- أي مستخدم يرى فقط صفّه إن كان مسجّلاً كأدمن (للتحقق من الصلاحية)
CREATE POLICY "admin_users_select_own"
  ON public.admin_users FOR SELECT
  USING ((auth.jwt() ->> 'email') = email);

-- الإدراج/التحديث/الحذف من الداشبورد أو Service Role فقط (لا سياسة للعميل)
COMMENT ON TABLE public.admin_users IS 'قائمة الأدمن — الدخول إلى /admin حسب البريد';

-- 2) usage_limits — حدود كل خطة
CREATE TABLE IF NOT EXISTS public.usage_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan text NOT NULL UNIQUE,
  max_invoices integer NOT NULL DEFAULT 20,
  max_products integer NOT NULL DEFAULT 10,
  max_reports integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;

-- الجميع يقرأ حدود الخطط (للعرض في الواجهة)
CREATE POLICY "usage_limits_select_all"
  ON public.usage_limits FOR SELECT
  USING (true);

INSERT INTO public.usage_limits (plan, max_invoices, max_products, max_reports)
VALUES
  ('trial', 20, 10, 1),
  ('monthly_150', 500, 200, 30),
  ('pro', 9999, 9999, 999)
ON CONFLICT (plan) DO UPDATE SET
  max_invoices = EXCLUDED.max_invoices,
  max_products = EXCLUDED.max_products,
  max_reports = EXCLUDED.max_reports;

-- 3) payment_proofs — إثباتات الدفع المرفوعة من المستخدمين
CREATE TABLE IF NOT EXISTS public.payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_workspace ON public.payment_proofs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_status ON public.payment_proofs(status);
ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

-- المستخدم يرى إثباتات مساحاته فقط
CREATE POLICY "payment_proofs_select_own"
  ON public.payment_proofs FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- الأدمن يرى كل إثباتات الدفع
CREATE POLICY "payment_proofs_select_admin"
  ON public.payment_proofs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email')));

-- المستخدم يضيف إثباتات لمساحاته فقط
CREATE POLICY "payment_proofs_insert_own"
  ON public.payment_proofs FOR INSERT
  WITH CHECK (workspace_id IN (SELECT user_workspace_ids()) AND auth.uid() = user_id);

-- الأدمن يحدّث الحالة (سيتم عبر Edge Function أو سياسة منفصلة — نترك التحديث للمستخدم على صفّه حتى الرفض، والموافقة عبر Edge)
-- للموافقة: استدعاء Edge Function التي تستخدم Service Role
-- نسمح للمستخدم بتحديث status إلى rejected فقط إن كان pending (اختياري). هنا نسمح للأدمن بالقراءة والتحديث عبر سياسة تعتمد على admin_users
CREATE POLICY "payment_proofs_update_own"
  ON public.payment_proofs FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- الأدمن يحدّث الحالة (موافقة/رفض)
CREATE POLICY "payment_proofs_update_admin"
  ON public.payment_proofs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email')));

-- 4) usage_logs — سجل الأحداث (مثل usage_events لكن للتحليلات والأدمن)
CREATE TABLE IF NOT EXISTS public.usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_workspace ON public.usage_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_type_created ON public.usage_logs(event_type, created_at DESC);
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

-- المستخدم يرى سجلات مساحاته فقط
CREATE POLICY "usage_logs_select_own"
  ON public.usage_logs FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));

-- الإدراج من التطبيق لمساحات المستخدم فقط (نستخدم نفس منطق usage_events)
CREATE POLICY "usage_logs_insert_own"
  ON public.usage_logs FOR INSERT
  WITH CHECK (workspace_id IN (SELECT user_workspace_ids()));

-- 5) admin_logs — سجل أفعال الأدمن
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_workspace uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_logs(created_at DESC);
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

-- قراءة admin_logs فقط للأدمن (البريد في admin_users)
CREATE POLICY "admin_logs_select_admin"
  ON public.admin_logs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email'))
  );

-- إدراج من الأدمن فقط (يُستدعى من الواجهة بعد التحقق)
CREATE POLICY "admin_logs_insert_admin"
  ON public.admin_logs FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email'))
  );

-- ========== دالة: نسخ usage_events إلى usage_logs ==========
CREATE OR REPLACE FUNCTION public.sync_usage_log_from_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_logs (workspace_id, event_type, metadata, created_at)
  VALUES (NEW.workspace_id, NEW.event_type, COALESCE(NEW.payload, '{}'), NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_usage_events_to_logs ON public.usage_events;
CREATE TRIGGER tr_usage_events_to_logs
  AFTER INSERT ON public.usage_events
  FOR EACH ROW
  EXECUTE PROCEDURE public.sync_usage_log_from_event();

-- ========== Storage: دلو إثباتات الدفع ==========
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- السياسة: المستخدم يرفع إلى مجلد workspace_id/user_id/
-- مسار الملف: {workspace_id}/{user_id}/{uuid}.ext
CREATE POLICY "payment_proofs_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] IN (SELECT user_workspace_ids()::text)
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "payment_proofs_read_own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] IN (SELECT user_workspace_ids()::text)
  );

-- الأدمن يقرأ كل الملفات (سنستخدم Service Role من Edge أو نضيف سياسة بناءً على admin_users)
-- نضيف سياسة SELECT للأدمن: من في admin_users يمكنه قراءة أي ملف في الدلو
CREATE POLICY "payment_proofs_read_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'payment-proofs'
    AND EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email'))
  );

-- الأدمن يقرأ كل usage_logs (للتحليلات)
CREATE POLICY "usage_logs_select_admin"
  ON public.usage_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email')));

-- الأدمن يقرأ كل المساحات (للوحة التحكم)
CREATE POLICY "workspaces_select_admin"
  ON public.workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = (auth.jwt() ->> 'email')));

COMMENT ON TABLE public.usage_logs IS 'نسخة أحداث الاستخدام للتحليلات (يُملأ تلقائياً من usage_events)';
COMMENT ON TABLE public.admin_logs IS 'سجل أفعال الأدمن للتدقيق';
