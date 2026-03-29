-- دالة للأدمن فقط: إرجاع مساحات العمل مع بريد المالك (من auth.users)
-- استدعاؤها من لوحة الأدمن لعرض البريد لمعرفة العميل

CREATE OR REPLACE FUNCTION public.get_workspaces_with_owner_emails(
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  owner_id uuid,
  created_at timestamptz,
  owner_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- السماح للأدمن فقط
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = (auth.jwt() ->> 'email')
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    w.id,
    w.name,
    w.owner_id,
    w.created_at,
    u.email::text AS owner_email
  FROM public.workspaces w
  LEFT JOIN auth.users u ON u.id = w.owner_id
  ORDER BY w.created_at DESC
  LIMIT _limit
  OFFSET _offset;
END;
$$;

COMMENT ON FUNCTION public.get_workspaces_with_owner_emails IS 'للأدمن: قائمة مساحات العمل مع بريد مالك كل مساحة';
