-- محاسب مشروعي — تحويل إلى SaaS: Workspace + جداول أساسية + RLS + usage_events + sync_queue (هيكل فقط)
-- شغّل من Supabase Dashboard → SQL Editor

-- ========== 1) Workspaces ==========
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'مساحة عملي',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workspaces_owner on public.workspaces(owner_id);

-- ========== 2) Workspace Members ==========
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists idx_workspace_members_user on public.workspace_members(user_id);

-- دالة مساعدة: هل المستخدم عضو في الـ workspace؟
create or replace function public.user_workspace_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid();
$$;

-- ========== 3) Products ==========
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  quantity integer not null default 0,
  min_quantity integer not null default 0,
  unit text not null default 'قطعة',
  cost_price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_workspace on public.products(workspace_id);

-- ========== 4) Transactions (إيرادات/مصروفات) ==========
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  description text not null default '',
  amount numeric not null default 0,
  category text not null default '',
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_workspace on public.transactions(workspace_id);
create index if not exists idx_transactions_date on public.transactions(workspace_id, date desc);

-- ========== 5) Invoices ==========
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client text not null default '',
  amount numeric not null default 0,
  description text default 'فاتورة',
  due_date date not null default current_date,
  paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_workspace on public.invoices(workspace_id);

-- ========== 6) Usage Events (Analytics) ==========
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_user on public.usage_events(user_id);
create index if not exists idx_usage_events_workspace on public.usage_events(workspace_id);
create index if not exists idx_usage_events_type_created on public.usage_events(event_type, created_at desc);

-- ========== 7) Sync Queue (هيكل فقط — للاستخدام لاحقاً) ==========
create table if not exists public.sync_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  table_name text not null,
  record_id uuid,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  payload jsonb default '{}',
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
  retry_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sync_queue_workspace_status on public.sync_queue(workspace_id, status);
create index if not exists idx_sync_queue_created on public.sync_queue(created_at);

comment on table public.sync_queue is 'طابور مزامنة Offline First — هيكل جاهز، التنفيذ لاحقاً';

-- ========== 8) RLS ==========
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.products enable row level security;
alter table public.transactions enable row level security;
alter table public.invoices enable row level security;
alter table public.usage_events enable row level security;
alter table public.sync_queue enable row level security;

-- workspaces: المستخدم يرى مساحاته فقط (مالك أو عضو)
drop policy if exists "workspaces_select" on public.workspaces;
create policy "workspaces_select" on public.workspaces for select
  using (id in (select user_workspace_ids()));
drop policy if exists "workspaces_insert_own" on public.workspaces;
create policy "workspaces_insert_own" on public.workspaces for insert
  with check (auth.uid() = owner_id);
drop policy if exists "workspaces_update_own" on public.workspaces;
create policy "workspaces_update_own" on public.workspaces for update
  using (id in (select user_workspace_ids()));
drop policy if exists "workspaces_delete_own" on public.workspaces;
create policy "workspaces_delete_own" on public.workspaces for delete
  using (auth.uid() = owner_id);

-- workspace_members
drop policy if exists "workspace_members_all" on public.workspace_members;
create policy "workspace_members_select" on public.workspace_members for select
  using (workspace_id in (select user_workspace_ids()));
create policy "workspace_members_insert" on public.workspace_members for insert
  with check (workspace_id in (select user_workspace_ids()));
create policy "workspace_members_update" on public.workspace_members for update
  using (workspace_id in (select user_workspace_ids()));
create policy "workspace_members_delete" on public.workspace_members for delete
  using (workspace_id in (select user_workspace_ids()));

-- products
drop policy if exists "products_workspace" on public.products;
create policy "products_select" on public.products for select
  using (workspace_id in (select user_workspace_ids()));
create policy "products_insert" on public.products for insert
  with check (workspace_id in (select user_workspace_ids()));
create policy "products_update" on public.products for update
  using (workspace_id in (select user_workspace_ids()));
create policy "products_delete" on public.products for delete
  using (workspace_id in (select user_workspace_ids()));

-- transactions
create policy "transactions_select" on public.transactions for select
  using (workspace_id in (select user_workspace_ids()));
create policy "transactions_insert" on public.transactions for insert
  with check (workspace_id in (select user_workspace_ids()));
create policy "transactions_update" on public.transactions for update
  using (workspace_id in (select user_workspace_ids()));
create policy "transactions_delete" on public.transactions for delete
  using (workspace_id in (select user_workspace_ids()));

-- invoices
create policy "invoices_select" on public.invoices for select
  using (workspace_id in (select user_workspace_ids()));
create policy "invoices_insert" on public.invoices for insert
  with check (workspace_id in (select user_workspace_ids()));
create policy "invoices_update" on public.invoices for update
  using (workspace_id in (select user_workspace_ids()));
create policy "invoices_delete" on public.invoices for delete
  using (workspace_id in (select user_workspace_ids()));

-- usage_events: المستخدم يرى أحداثه فقط
create policy "usage_events_select" on public.usage_events for select
  using (auth.uid() = user_id);
create policy "usage_events_insert_own" on public.usage_events for insert
  with check (auth.uid() = user_id);

-- sync_queue
create policy "sync_queue_select" on public.sync_queue for select
  using (workspace_id in (select user_workspace_ids()));
create policy "sync_queue_insert" on public.sync_queue for insert
  with check (workspace_id in (select user_workspace_ids()));
create policy "sync_queue_update" on public.sync_queue for update
  using (workspace_id in (select user_workspace_ids()));
create policy "sync_queue_delete" on public.sync_queue for delete
  using (workspace_id in (select user_workspace_ids()));

-- ========== 9) إنشاء workspace تلقائياً عند أول دخول (يُستدعى من الواجهة بعد signup)
-- لا trigger هنا؛ التطبيق ينشئ الـ workspace بعد signup مباشرة.

comment on table public.workspaces is 'مساحات العمل — كل مستخدم له workspace افتراضي عند التسجيل';
comment on table public.workspace_members is 'أعضاء كل مساحة (owner/admin/member)';
comment on table public.products is 'منتجات المخزون حسب workspace';
comment on table public.transactions is 'إيرادات ومصروفات حسب workspace';
comment on table public.invoices is 'فواتير حسب workspace';
comment on table public.usage_events is 'أحداث الاستخدام: login, create_invoice, import_orders';
