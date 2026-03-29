-- إصلاح: السماح للمالك بإضافة نفسه كعضو عند إنشاء مساحة عمل جديدة
-- بدون هذا لا يمكن إنشاء workspace (سياسة الإدراج القديمة تتطلب workspace_id في user_workspace_ids()
-- وهي فارغة قبل إضافة العضو الأول = دائرة مفرغة)

DROP POLICY IF EXISTS "workspace_members_insert" ON public.workspace_members;

-- السماح بالإدراج: المستخدم يضيف نفسه والـ workspace مملوك له (حالة إنشاء مساحة جديدة)
CREATE POLICY "workspace_members_insert_owner" ON public.workspace_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );
