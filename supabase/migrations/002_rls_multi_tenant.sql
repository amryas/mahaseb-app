-- المرحلة 3 — Multi-tenancy: كل مستخدم يرى بياناته فقط
-- شغّل هذا الملف في Supabase Dashboard → SQL Editor (بعد 001_initial_schema)

-- 1) إضافة user_id لجدول devices وربطها بالمستخدم
alter table public.devices add column if not exists user_id uuid references auth.users(id) on delete set null;

-- تعبئة user_id للأجهزة من الحسابات المرتبطة بها
update public.devices d
set user_id = (
  select a.user_id from public.accounts a where a.device_id = d.id and a.user_id is not null limit 1
)
where d.user_id is null;

create index if not exists idx_devices_user_id on public.devices(user_id);

-- 2) إزالة السياسات المفتوحة القديمة
drop policy if exists "devices allow all for anon" on public.devices;
drop policy if exists "accounts allow all for anon" on public.accounts;
drop policy if exists "account_data allow all for anon" on public.account_data;

-- 3) devices: المستخدم يرى ويضيف أجهزته فقط
create policy "devices_select_own" on public.devices for select using (auth.uid() = user_id);
create policy "devices_insert_own" on public.devices for insert with check (auth.uid() = user_id);

-- 4) accounts: المستخدم يرى ويعدّل حساباته فقط
create policy "accounts_select_own" on public.accounts for select using (auth.uid() = user_id);
create policy "accounts_insert_own" on public.accounts for insert with check (auth.uid() = user_id);
create policy "accounts_update_own" on public.accounts for update using (auth.uid() = user_id);
create policy "accounts_delete_own" on public.accounts for delete using (auth.uid() = user_id);

-- 5) account_data: الوصول فقط لحسابات المستخدم
create policy "account_data_select_own" on public.account_data for select
  using (account_id in (select id from public.accounts where user_id = auth.uid()));
create policy "account_data_insert_own" on public.account_data for insert
  with check (account_id in (select id from public.accounts where user_id = auth.uid()));
create policy "account_data_update_own" on public.account_data for update
  using (account_id in (select id from public.accounts where user_id = auth.uid()));
create policy "account_data_delete_own" on public.account_data for delete
  using (account_id in (select id from public.accounts where user_id = auth.uid()));

comment on column public.devices.user_id is 'المستخدم صاحب الجهاز — للمرحلة 3 RLS';
