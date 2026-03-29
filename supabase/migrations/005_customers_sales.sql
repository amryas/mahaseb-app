-- محاسب مشروعي — جداول العملاء والمبيعات (تنظيم ومرونة مستقبلية)
-- شغّل من Supabase Dashboard → SQL Editor بعد 004_workspace_saas

-- ========== 1) العملاء (customers) ==========
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  phone text default '',
  address text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_workspace on public.customers(workspace_id);

-- ========== 2) المبيعات (sales) ==========
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_name text default '',
  date date not null default current_date,
  discount numeric not null default 0,
  paid boolean not null default true,
  status text not null default 'completed' check (status in ('completed', 'pending')),
  items jsonb not null default '[]',
  total numeric,
  profit numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_workspace on public.sales(workspace_id);
create index if not exists idx_sales_date on public.sales(workspace_id, date desc);

-- ========== 3) RLS ==========
alter table public.customers enable row level security;
alter table public.sales enable row level security;

create policy "customers_select" on public.customers for select
  using (workspace_id in (select public.user_workspace_ids()));
create policy "customers_insert" on public.customers for insert
  with check (workspace_id in (select public.user_workspace_ids()));
create policy "customers_update" on public.customers for update
  using (workspace_id in (select public.user_workspace_ids()));
create policy "customers_delete" on public.customers for delete
  using (workspace_id in (select public.user_workspace_ids()));

create policy "sales_select" on public.sales for select
  using (workspace_id in (select public.user_workspace_ids()));
create policy "sales_insert" on public.sales for insert
  with check (workspace_id in (select public.user_workspace_ids()));
create policy "sales_update" on public.sales for update
  using (workspace_id in (select public.user_workspace_ids()));
create policy "sales_delete" on public.sales for delete
  using (workspace_id in (select public.user_workspace_ids()));

comment on table public.customers is 'العملاء حسب مساحة العمل';
comment on table public.sales is 'المبيعات (فواتير البيع) حسب مساحة العمل';
