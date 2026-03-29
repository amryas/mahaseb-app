-- المرحلة 4 — الاشتراكات والدفع (فودافون كاش / انستا باي)
-- شغّله من Supabase → SQL Editor

-- اشتراكات المستخدمين (مرتبطة بالمستخدم)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null default 'monthly',
  status text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);

-- سجلات الدفع (فودافون كاش أو انستا باي)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_egp numeric not null,
  method text not null check (method in ('vodafone_cash', 'instapay')),
  status text not null default 'pending',
  reference_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_user_id on public.payments(user_id);
create index if not exists idx_payments_subscription_id on public.payments(subscription_id);

-- RLS
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;

create policy "subscriptions_own" on public.subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "payments_own" on public.payments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.subscriptions is 'اشتراكات المستخدمين';
comment on table public.payments is 'مدفوعات فودافون كاش / انستا باي';
