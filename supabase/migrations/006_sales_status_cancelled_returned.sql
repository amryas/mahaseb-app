-- السماح بحالات ملغى ومرتجع في جدول المبيعات
alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check
  check (status in ('completed', 'pending', 'cancelled', 'returned'));
