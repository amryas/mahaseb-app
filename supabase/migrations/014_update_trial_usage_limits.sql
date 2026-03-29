-- Update trial limits to allow full 3-day experience (unlimited-ish).
-- After the trial ends, access is controlled by subscriptions.trial_end_date (billing guard),
-- so these limits should not prematurely block new users.

INSERT INTO public.usage_limits (plan, max_invoices, max_products, max_reports)
VALUES ('trial', 999999, 999999, 999999)
ON CONFLICT (plan) DO UPDATE SET
  max_invoices = EXCLUDED.max_invoices,
  max_products = EXCLUDED.max_products,
  max_reports = EXCLUDED.max_reports;

