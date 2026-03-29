/**
 * API مساحات العمل (Workspace) — المصدر الأساسي عند تفعيل Supabase SaaS.
 * التدفق: Save to Supabase → Update UI → Save cache local.
 */

import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { DATA_SUFFIXES } from './store';
import { cacheGet, cacheSet } from './supabaseApi';

const PAGE_SIZE = 25;

// ——— Workspace ———

/** جلب مساحات المستخدم الحالي */
export async function apiGetMyWorkspaces() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];
  const { data: members, error } = await sb
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user.id);
  if (error || !members?.length) return [];
  const ids = members.map((m) => m.workspace_id);
  const { data: workspaces, error: e2 } = await sb
    .from('workspaces')
    .select('id, name, owner_id, created_at, updated_at')
    .in('id', ids)
    .order('created_at', { ascending: true });
  if (e2) return [];
  return (workspaces || []).map((w) => ({
    id: w.id,
    name: w.name || 'مساحة عملي',
    ownerId: w.owner_id,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
  }));
}

async function countRowsForWorkspace(table, workspaceId) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return 0;
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
  if (error) return 0;
  return count ?? 0;
}

/** مجموع صفوف الجداول الرئيسية — لاختيار مساحة العمل «الأثقل» بدون RPC */
export async function scoreWorkspaceRowCounts(workspaceId) {
  if (!workspaceId) return 0;
  const tables = ['products', 'transactions', 'invoices', 'sales', 'customers'];
  const parts = await Promise.all(tables.map((t) => countRowsForWorkspace(t, workspaceId)));
  return parts.reduce((a, b) => a + b, 0);
}

/**
 * استدعاء دالة السيرفر الذرّية (قفل استشاري + ترتيب بالبيانات).
 * عند فشل RPC (migration غير مطبّق) يعود للعميل عبر pickPrimaryWorkspaceClientFallback.
 */
export async function rpcGetOrCreatePrimaryWorkspace() {
  const sb = getSupabase();
  if (!sb) return { workspaceId: null, createdNew: false, error: 'no client' };
  const { data, error } = await sb.rpc('get_or_create_primary_workspace');
  if (error) {
    return { workspaceId: null, createdNew: false, error: error.message || 'rpc failed' };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const wid = row?.workspace_id ?? null;
  const createdNew = row?.created_new === true;
  return { workspaceId: wid, createdNew, error: wid ? null : 'empty rpc result' };
}

/** مسار احتياطي: عضويات موجودة → أفضل score؛ وإلا إنشاء واحدة */
export async function pickPrimaryWorkspaceClientFallback() {
  const list = await apiGetMyWorkspaces();
  if (!list.length) {
    const created = await apiCreateWorkspace();
    return {
      workspaceId: created?.id ?? null,
      createdNew: !!created?.id,
      error: created?.id ? null : created?.error || 'create failed',
    };
  }
  const scored = await Promise.all(
    list.map(async (w) => ({
      id: w.id,
      score: await scoreWorkspaceRowCounts(w.id),
      updatedAt: w.updatedAt,
      createdAt: w.createdAt,
    })),
  );
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (tB !== tA) return tB - tA;
    const cA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return cA - cB;
  });
  return { workspaceId: scored[0].id, createdNew: false, error: null };
}

/**
 * مصدر الحقيقة بعد تسجيل الدخول: RPC أولاً، ثم نفس منطق الترتيب على العميل.
 */
export async function resolvePrimaryWorkspaceForCurrentUser() {
  const rpc = await rpcGetOrCreatePrimaryWorkspace();
  if (rpc.workspaceId) {
    return { workspaceId: rpc.workspaceId, createdNew: rpc.createdNew, error: null };
  }
  if (import.meta.env?.DEV) {
    console.warn('[workspace] get_or_create_primary_workspace RPC unavailable, using client fallback:', rpc.error);
  }
  const fb = await pickPrimaryWorkspaceClientFallback();
  return {
    workspaceId: fb.workspaceId,
    createdNew: fb.createdNew,
    error: fb.error || rpc.error,
  };
}

/** إنشاء workspace جديد وإضافة المستخدم كـ owner — يرجع { id, error, step } */
export async function apiCreateWorkspace(name = 'مساحة عملي') {
  const sb = getSupabase();
  if (!sb) return { id: null, error: 'الاتصال غير متاح', step: null };
  try { await sb.auth.refreshSession(); } catch (_) {}
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { id: null, error: 'لم يتم تسجيل الدخول', step: null };
  const ownerId = user.id;
  if (!ownerId) return { id: null, error: 'معرّف المستخدم غير متاح — الجلسة غير صالحة', step: 'workspace' };
  const { data: workspace, error } = await sb
    .from('workspaces')
    .insert({ name: name || 'مساحة عملي', owner_id: ownerId })
    .select('id')
    .single();
  if (error || !workspace?.id) {
    return { id: null, error: error?.message || 'فشل إنشاء مساحة العمل', step: 'workspace' };
  }
  const { error: e2 } = await sb.from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: 'owner',
  });
  if (e2) {
    return {
      id: null,
      error: e2.message || 'فشل إضافة العضوية (شغّل 007_workspace_members_insert_owner في Supabase)',
      step: 'membership',
    };
  }
  return { id: workspace.id, error: null, step: null };
}

/** @deprecated يُفضّل resolvePrimaryWorkspaceForCurrentUser بعد الدخول — يبقى للتوافق مع استدعاءات قديمة */
export async function apiGetOrCreateWorkspace() {
  const r = await resolvePrimaryWorkspaceForCurrentUser();
  return r.workspaceId ?? null;
}

// ——— Products (مع Pagination) ———

export async function apiGetProducts(workspaceId, page = 0) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return { data: [], total: 0 };
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error } = await sb
    .from('products')
    .select('id, name, quantity, min_quantity, unit, cost_price, created_at', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { data: [], total: 0 };
  const rows = data || [];
  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      quantity: r.quantity ?? 0,
      minQuantity: r.min_quantity ?? 0,
      unit: r.unit || 'قطعة',
      costPrice: r.cost_price ?? 0,
      createdAt: r.created_at,
    })),
    total: error ? 0 : (data?.length ?? 0),
    hasMore: rows.length === PAGE_SIZE,
  };
}

/** جلب كل المنتجات (كل الصفحات) لملء الـ cache */
export async function apiGetAllProducts(workspaceId) {
  const all = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await apiGetProducts(workspaceId, page);
    if (res.data?.length) all.push(...res.data);
    hasMore = res.hasMore === true;
    page++;
  }
  return all;
}

export async function apiInsertProduct(workspaceId, product) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return { id: null, error: !workspaceId ? 'لا توجد مساحة عمل محددة' : 'الاتصال غير متاح' };
  const { data, error } = await sb
    .from('products')
    .insert({
      id: product.id || crypto.randomUUID(),
      workspace_id: workspaceId,
      name: product.name || '',
      quantity: product.quantity ?? 0,
      min_quantity: product.minQuantity ?? 0,
      unit: product.unit || 'قطعة',
      cost_price: product.costPrice ?? 0,
    })
    .select('id')
    .single();
  if (error) return { id: null, error: error.message || error.code || 'فشل الحفظ في السحابة' };
  return { id: data?.id ?? null, error: null };
}

export async function apiUpdateProduct(workspaceId, productId, updates) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !productId) return { ok: false, error: !workspaceId ? 'لا توجد مساحة عمل محددة' : 'الاتصال غير متاح' };
  const { error } = await sb
    .from('products')
    .update({
      name: updates.name,
      quantity: updates.quantity,
      min_quantity: updates.minQuantity,
      unit: updates.unit,
      cost_price: updates.costPrice,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId)
    .eq('workspace_id', workspaceId);
  if (error) return { ok: false, error: error.message || error.code || 'فشل التحديث في السحابة' };
  return { ok: true, error: null };
}

export async function apiDeleteProduct(workspaceId, productId) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !productId) return { ok: false, error: !workspaceId ? 'لا توجد مساحة عمل محددة' : 'الاتصال غير متاح' };
  const { error } = await sb.from('products').delete().eq('id', productId).eq('workspace_id', workspaceId);
  if (error) return { ok: false, error: error.message || error.code || 'فشل الحذف في السحابة' };
  return { ok: true, error: null };
}

// ——— Transactions (مع Pagination) ———

export async function apiGetTransactions(workspaceId, page = 0, type = null) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return { data: [], total: 0 };
  let q = sb
    .from('transactions')
    .select('id, type, description, amount, category, date, created_at', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (type) q = q.eq('type', type);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error } = await q.range(from, to);
  if (error) return { data: [], total: 0 };
  const rows = data || [];
  return {
    data: rows.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description || '',
      amount: Number(r.amount),
      category: r.category || '',
      date: r.date,
      createdAt: r.created_at,
    })),
    total: rows.length,
    hasMore: rows.length === PAGE_SIZE,
  };
}

/** جلب كل الحركات (كل الصفحات) لملء الـ cache */
export async function apiGetAllTransactions(workspaceId) {
  const all = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await apiGetTransactions(workspaceId, page);
    if (res.data?.length) all.push(...res.data);
    hasMore = res.hasMore === true;
    page++;
  }
  return all;
}

export async function apiInsertTransaction(workspaceId, transaction) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return null;
  const { data, error } = await sb
    .from('transactions')
    .insert({
      id: transaction.id || crypto.randomUUID(),
      workspace_id: workspaceId,
      type: transaction.type || 'expense',
      description: transaction.description || '',
      amount: transaction.amount ?? 0,
      category: transaction.category || '',
      date: transaction.date || new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single();
  return error ? null : data?.id;
}

export async function apiDeleteTransaction(workspaceId, transactionId) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !transactionId) return false;
  const { error } = await sb.from('transactions').delete().eq('id', transactionId).eq('workspace_id', workspaceId);
  return !error;
}

// ——— Invoices (مع Pagination) ———

export async function apiGetInvoices(workspaceId, page = 0) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return { data: [], total: 0 };
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error } = await sb
    .from('invoices')
    .select('id, client, amount, description, due_date, paid, created_at, updated_at', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { data: [], total: 0 };
  const rows = data || [];
  return {
    data: rows.map((r) => ({
      id: r.id,
      client: r.client || '',
      amount: Number(r.amount),
      description: r.description || 'فاتورة',
      dueDate: r.due_date,
      paid: !!r.paid,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total: rows.length,
    hasMore: rows.length === PAGE_SIZE,
  };
}

/** جلب كل الفواتير (كل الصفحات) لملء الـ cache */
export async function apiGetAllInvoices(workspaceId) {
  const all = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await apiGetInvoices(workspaceId, page);
    if (res.data?.length) all.push(...res.data);
    hasMore = res.hasMore === true;
    page++;
  }
  return all;
}

export async function apiInsertInvoice(workspaceId, invoice) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return null;
  const { data, error } = await sb
    .from('invoices')
    .insert({
      id: invoice.id || crypto.randomUUID(),
      workspace_id: workspaceId,
      client: invoice.client || '',
      amount: invoice.amount ?? 0,
      description: invoice.description || 'فاتورة',
      due_date: invoice.dueDate || new Date().toISOString().slice(0, 10),
      paid: !!invoice.paid,
    })
    .select('id')
    .single();
  return error ? null : data?.id;
}

export async function apiUpdateInvoice(workspaceId, invoiceId, updates) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !invoiceId) return false;
  const payload = { updated_at: new Date().toISOString() };
  if (updates.paid !== undefined) payload.paid = !!updates.paid;
  if (updates.client !== undefined) payload.client = updates.client;
  if (updates.amount !== undefined) payload.amount = updates.amount;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.dueDate !== undefined) payload.due_date = updates.dueDate;
  const { error } = await sb
    .from('invoices')
    .update(payload)
    .eq('id', invoiceId)
    .eq('workspace_id', workspaceId);
  return !error;
}

export async function apiDeleteInvoice(workspaceId, invoiceId) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !invoiceId) return false;
  const { error } = await sb.from('invoices').delete().eq('id', invoiceId).eq('workspace_id', workspaceId);
  return !error;
}

// ——— Customers (العملاء) ———

export async function apiGetCustomers(workspaceId, page = 0) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return { data: [], hasMore: false };
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error } = await sb
    .from('customers')
    .select('id, name, phone, address, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { data: [], hasMore: false };
  const rows = data || [];
  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name || '',
      phone: r.phone || '',
      address: r.address || '',
      createdAt: r.created_at,
    })),
    hasMore: rows.length === PAGE_SIZE,
  };
}

export async function apiGetAllCustomers(workspaceId) {
  const all = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await apiGetCustomers(workspaceId, page);
    if (res.data?.length) all.push(...res.data);
    hasMore = res.hasMore === true;
    page++;
  }
  return all;
}

export async function apiInsertCustomer(workspaceId, customer) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return null;
  const { data, error } = await sb
    .from('customers')
    .insert({
      id: customer.id || crypto.randomUUID(),
      workspace_id: workspaceId,
      name: customer.name || '',
      phone: customer.phone || '',
      address: customer.address || '',
    })
    .select('id')
    .single();
  return error ? null : data?.id;
}

export async function apiUpdateCustomer(workspaceId, customerId, updates) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !customerId) return false;
  const { error } = await sb
    .from('customers')
    .update({
      name: updates.name,
      phone: updates.phone,
      address: updates.address,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)
    .eq('workspace_id', workspaceId);
  return !error;
}

export async function apiDeleteCustomer(workspaceId, customerId) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !customerId) return false;
  const { error } = await sb.from('customers').delete().eq('id', customerId).eq('workspace_id', workspaceId);
  return !error;
}

// ——— Sales (المبيعات) ———

export async function apiGetSales(workspaceId, page = 0, pageSize = PAGE_SIZE) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return { data: [], hasMore: false };
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data, error } = await sb
    .from('sales')
    .select('id, client_name, date, discount, paid, status, items, total, profit, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { data: [], hasMore: false };
  const rows = data || [];
  return {
    data: rows.map((r) => ({
      id: r.id,
      clientName: r.client_name || '',
      date: r.date,
      discount: Number(r.discount) || 0,
      paid: !!r.paid,
      status: r.status || 'completed',
      items: Array.isArray(r.items) ? r.items : [],
      total: r.total != null ? Number(r.total) : undefined,
      profit: r.profit != null ? Number(r.profit) : undefined,
      createdAt: r.created_at,
    })),
    hasMore: rows.length === pageSize,
  };
}

/**
 * جلب مبيعات مساحة العمل مع fallback للـ cache عند الخطأ/عدم الاتصال.
 * يُستخدم كـ API آمنة للشاشات والـ bootstrap.
 */
export async function getSales(workspaceId) {
  if (!workspaceId) return [];
  try {
    const rows = await apiGetAllSales(workspaceId);
    if (Array.isArray(rows)) {
      cacheSet(workspaceId, DATA_SUFFIXES.SALES, rows);
      return rows;
    }
  } catch (e) {
    console.warn('WorkspaceApi:getSales failed, using cache', e);
  }
  return cacheGet(workspaceId, DATA_SUFFIXES.SALES, []);
}

export async function apiGetAllSales(workspaceId) {
  const all = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await apiGetSales(workspaceId, page);
    if (res.data?.length) all.push(...res.data);
    hasMore = res.hasMore === true;
    page++;
  }
  return all;
}

/** تحويل بيع من شكل التطبيق إلى صف جدول sales */
function saleToRow(workspaceId, sale) {
  const items = Array.isArray(sale.items) && sale.items.length > 0
    ? sale.items
    : (sale.productId
      ? [{ productId: sale.productId, productName: sale.productName, quantity: sale.quantity, unitPrice: sale.unitPrice, unitCost: sale.unitCost ?? 0 }]
      : []);
  return {
    id: sale.id || crypto.randomUUID(),
    workspace_id: workspaceId,
    client_name: sale.clientName || '',
    date: sale.date || new Date().toISOString().slice(0, 10),
    discount: sale.discount ?? 0,
    paid: !!sale.paid,
    status: sale.status || 'completed',
    items,
    total: sale.total ?? null,
    profit: sale.profit ?? null,
    updated_at: new Date().toISOString(),
  };
}

/** مزامنة مصفوفة المبيعات إلى جدول sales في Supabase (لظهورها في السحابة) */
export async function apiUpsertSales(workspaceId, salesArray) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !Array.isArray(salesArray) || salesArray.length === 0) return true;
  try {
    const rows = salesArray.map((s) => saleToRow(workspaceId, s));
    const { error } = await sb.from('sales').upsert(rows, { onConflict: 'id' });
    return !error;
  } catch (e) {
    console.warn('Supabase: فشل مزامنة المبيعات إلى جدول sales', e);
    return false;
  }
}

export async function apiInsertSale(workspaceId, sale) {
  const sb = getSupabase();
  if (!sb || !workspaceId) return null;
  const row = saleToRow(workspaceId, sale);
  const { id, workspace_id, ...rest } = row;
  const { data, error } = await sb
    .from('sales')
    .insert({ id, workspace_id, ...rest })
    .select('id')
    .single();
  return error ? null : data?.id;
}

export async function apiUpdateSale(workspaceId, saleId, updates) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !saleId) return false;
  const payload = { updated_at: new Date().toISOString() };
  if (updates.paid !== undefined) payload.paid = !!updates.paid;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.clientName !== undefined) payload.client_name = updates.clientName;
  if (updates.date !== undefined) payload.date = updates.date;
  if (updates.discount !== undefined) payload.discount = updates.discount;
  if (updates.items !== undefined) payload.items = updates.items;
  if (updates.total !== undefined) payload.total = updates.total;
  if (updates.profit !== undefined) payload.profit = updates.profit;
  if (updates.deliveryStatus !== undefined) payload.delivery_status = updates.deliveryStatus;
  const { error } = await sb.from('sales').update(payload).eq('id', saleId).eq('workspace_id', workspaceId);
  return !error;
}

export async function apiDeleteSale(workspaceId, saleId) {
  const sb = getSupabase();
  if (!sb || !workspaceId || !saleId) return false;
  const { error } = await sb.from('sales').delete().eq('id', saleId).eq('workspace_id', workspaceId);
  return !error;
}

// ——— Usage Events ———

export async function apiTrackEvent(workspaceId, eventType, payload = {}) {
  const sb = getSupabase();
  if (!sb) return false;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { error } = await sb.from('usage_events').insert({
    workspace_id: workspaceId || null,
    user_id: user.id,
    event_type: eventType,
    payload: typeof payload === 'object' ? payload : {},
  });
  return !error;
}

export function isWorkspaceSaaSEnabled() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('e2e_billing_simulate_saas') === '1') {
      return true;
    }
  } catch (_) {}
  return isSupabaseEnabled();
}

export const WORKSPACE_PAGE_SIZE = PAGE_SIZE;
