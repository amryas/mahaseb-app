-- جدول الاشتراكات (نظام Trial 3 أيام + اشتراك شهري 150 ج.م)
-- شغّل هذا الملف في Supabase SQL Editor ثم فعّل RLS إن لزم.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'monthly_150',
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'expired', 'cancelled')),
  trial_end_date timestamptz,
  subscription_end_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON public.subscriptions(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_workspace_unique ON public.subscriptions(workspace_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS: المستخدم يرى ويعدّل اشتراك مساحة العمل التي هو عضو فيها
CREATE POLICY "Users can read own workspace subscriptions"
  ON public.subscriptions FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = subscriptions.workspace_id AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own subscription"
  ON public.subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workspace subscription"
  ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- (اختياري) للتفعيل اليدوي من لوحة إدارية لاحقاً يمكن إضافة سياسة لـ service_role أو جدول admin_activations
COMMENT ON TABLE public.subscriptions IS 'اشتراكات مساحات العمل: trial 3 أيام ثم monthly_150';
