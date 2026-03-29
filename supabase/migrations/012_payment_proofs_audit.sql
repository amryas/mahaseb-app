-- Audit fields for payment proof approval (optional; app falls back to status-only if missing)
ALTER TABLE public.payment_proofs
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.payment_proofs.approved_at IS 'وقت موافقة الأدمن';
COMMENT ON COLUMN public.payment_proofs.approved_by IS 'معرّف الأدمن الذي وافق';
