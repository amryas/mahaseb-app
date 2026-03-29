-- محاسب مشروعي — مساحة عمل واحدة آمنة لكل مستخدم: اختيار ذكي + إنشاء ذري مع قفل استشاري
-- يمنع تكرار إنشاء workspaces فارغة عند guest → login أو أجهزة متعددة (سبب تشتت البيانات).
-- شغّل من Supabase Dashboard → SQL Editor بعد تطبيق migrations السابقة.

-- الدالة الأساسية: تُرجع مساحة العمل «الأفضل» للمستخدم الحالي، أو تنشئ واحدة فقط إن لم توجد أي عضوية/ملكية.
-- الأولوية: أكبر مجموع صفوف (منتجات + معاملات + فواتير + مبيعات + عملاء)، ثم updated_at، ثم created_at.
CREATE OR REPLACE FUNCTION public.get_or_create_primary_workspace()
RETURNS TABLE (workspace_id uuid, created_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  wid uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  PERFORM pg_advisory_xact_lock(847001, abs(hashtext(uid::text)));

  SELECT s.id INTO wid
  FROM (
    SELECT
      w.id,
      (
        (SELECT count(*)::bigint FROM public.products p WHERE p.workspace_id = w.id)
        + (SELECT count(*)::bigint FROM public.transactions t WHERE t.workspace_id = w.id)
        + (SELECT count(*)::bigint FROM public.invoices i WHERE i.workspace_id = w.id)
        + (SELECT count(*)::bigint FROM public.sales sa WHERE sa.workspace_id = w.id)
        + (SELECT count(*)::bigint FROM public.customers c WHERE c.workspace_id = w.id)
      ) AS score,
      w.updated_at,
      w.created_at
    FROM public.workspaces w
    WHERE w.id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = uid)
       OR w.owner_id = uid
  ) s
  ORDER BY s.score DESC, s.updated_at DESC NULLS LAST, s.created_at ASC
  LIMIT 1;

  IF wid IS NOT NULL THEN
    RETURN QUERY SELECT wid, false;
    RETURN;
  END IF;

  INSERT INTO public.workspaces (name, owner_id)
  VALUES ('مساحة عملي', uid)
  RETURNING id INTO wid;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (wid, uid, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN QUERY SELECT wid, true;
END;
$$;

COMMENT ON FUNCTION public.get_or_create_primary_workspace IS
  'Idempotent: يختار مساحة العمل ذات أكثر بيانات أو ينشئ واحدة مع قفل لمنع السباق. يستخدم auth.uid() فقط.';

-- واجهة مطابقة لطلب «get_or_create_workspace(user_id)»: يجب أن يطابق المُمرَّر المستخدم الحالي (لا يثق بالعميل).
CREATE OR REPLACE FUNCTION public.get_or_create_workspace(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  out_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT g.workspace_id INTO out_id
  FROM public.get_or_create_primary_workspace() AS g
  LIMIT 1;
  RETURN out_id;
END;
$$;

COMMENT ON FUNCTION public.get_or_create_workspace(uuid) IS
  'Alias آمن: يتحقق أن p_user_id = auth.uid() ثم يستدعي get_or_create_primary_workspace.';

REVOKE ALL ON FUNCTION public.get_or_create_primary_workspace() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_primary_workspace() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_workspace(uuid) TO authenticated;
