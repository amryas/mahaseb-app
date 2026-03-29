-- محاسب مشروعي — المرحلة 1: الداتابيز
-- شغّل هذا الملف في Supabase Dashboard → SQL Editor

-- الأجهزة (متصفح/جهاز) — للمرحلة 1 بدون تسجيل دخول. لاحقاً نربطها بـ user_id
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- الحسابات (مشاريع/محلات) — كل حساب مرتبط بجهاز الآن، لاحقاً بمستخدم
create table if not exists public.accounts (
  id uuid primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  name text not null default 'حسابي',
  created_at timestamptz not null default now(),
  user_id uuid null -- للمرحلة 2: ربط بالمستخدم بعد Supabase Auth
);

create index if not exists idx_accounts_device_id on public.accounts(device_id);
create index if not exists idx_accounts_user_id on public.accounts(user_id);

-- بيانات كل حساب (مفتاح-قيمة) — نفس شكل localStorage
create table if not exists public.account_data (
  account_id uuid not null references public.accounts(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (account_id, key)
);

create index if not exists idx_account_data_account_id on public.account_data(account_id);

-- صلاحيات: للسماح بالقراءة/الكتابة بدون Auth في المرحلة 1 (الوصول عبر anon key)
-- في المرحلة 2/3 نفعّل RLS وربط user_id
alter table public.devices enable row level security;
alter table public.accounts enable row level security;
alter table public.account_data enable row level security;

-- سياسات مفتوحة للمرحلة 1 (الجميع يقرأ/يكتب). سنستبدلها لاحقاً بـ RLS حسب user_id
create policy "devices allow all for anon" on public.devices for all using (true) with check (true);
create policy "accounts allow all for anon" on public.accounts for all using (true) with check (true);
create policy "account_data allow all for anon" on public.account_data for all using (true) with check (true);

comment on table public.devices is 'جهاز/متصفح — مرحلة 1 بدون تسجيل دخول';
comment on table public.accounts is 'حسابات المحاسب (مشاريع) — لاحقاً user_id';
comment on table public.account_data is 'بيانات الحساب: transactions, invoices, settings, ...';
