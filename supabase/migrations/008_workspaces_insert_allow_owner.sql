-- إصلاح: السماح للمستخدم المسجّل بإنشاء مساحة عمل (owner_id = auth.uid())
-- إذا ظهر "new row violates row-level security policy for table workspaces"
-- فشغّل هذا الملف في Supabase → SQL Editor

-- إزالة السياسة القديمة إن وُجدت (أسماء مختلفة قد تكون مُطبقة)
DROP POLICY IF EXISTS "workspaces_insert_own" ON public.workspaces;

-- السماح بالإدراج: المستخدم المسجّل فقط، والصف يكون مملوكاً له
CREATE POLICY "workspaces_insert_owner" ON public.workspaces
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = owner_id
  );
