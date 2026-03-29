/**
 * Aggregates over IndexedDB using cursor pages (bounded in-memory batches).
 * @module aggregatesService
 */
import { getCacheUserId } from './cacheStore';
import { getCurrentAccountId, getSaleTotal, getSaleProfit, parseAmount } from './store';
import { logSystemEvent } from '../services/monitoring';
import {
  getSalesPageByCursor,
  getTransactionsPageByCursor,
  getProductsPageByCursor,
} from './indexedDbStore';

const DEFAULT_MAX_PAGES = 400;

/**
 * @param {string} wid
 * @param {string} uid
 * @param {(sale: Record<string, unknown>) => void} visit
 * @param {{ pageSize?: number, maxPages?: number }} [opts]
 */
async function forEachSalePage(wid, uid, visit, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.pageSize) || 100));
  const maxPages = Math.min(10_000, Math.max(1, Number(opts.maxPages) || DEFAULT_MAX_PAGES));
  let cursor = null;
  for (let p = 0; p < maxPages; p += 1) {
    const { items, nextCursor } = await getSalesPageByCursor(wid, uid, { limit, cursor });
    for (const s of items) visit(s);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
}

/**
 * @param {string} wid
 * @param {string} uid
 * @param {(t: Record<string, unknown>) => void} visit
 * @param {{ pageSize?: number, maxPages?: number }} [opts]
 */
async function forEachTransactionPage(wid, uid, visit, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.pageSize) || 100));
  const maxPages = Math.min(10_000, Math.max(1, Number(opts.maxPages) || DEFAULT_MAX_PAGES));
  let cursor = null;
  for (let p = 0; p < maxPages; p += 1) {
    const { items, nextCursor } = await getTransactionsPageByCursor(wid, uid, { limit, cursor });
    for (const t of items) visit(t);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
}

/**
 * @param {string} wid
 * @param {string} uid
 * @param {(p: Record<string, unknown>) => void} visit
 * @param {{ pageSize?: number, maxPages?: number }} [opts]
 */
async function forEachProductPage(wid, uid, visit, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.pageSize) || 100));
  const maxPages = Math.min(10_000, Math.max(1, Number(opts.maxPages) || DEFAULT_MAX_PAGES));
  let cursor = null;
  for (let p = 0; p < maxPages; p += 1) {
    const { items, nextCursor } = await getProductsPageByCursor(wid, uid, { limit, cursor });
    for (const row of items) visit(row);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
}

function workspaceOrNull() {
  const wid = getCurrentAccountId();
  const uid = getCacheUserId();
  if (!wid || !uid) return null;
  return { wid, uid };
}

/**
 * Sum of completed sales totals for a calendar day (local date string YYYY-MM-DD).
 * @param {string} dateIso10
 * @param {{ maxPages?: number }} [opts]
 */
export async function getTodayRevenue(dateIso10, opts = {}) {
  const w = workspaceOrNull();
  if (!w) return { revenue: 0, count: 0 };
  const day = (dateIso10 || new Date().toISOString().slice(0, 10)).slice(0, 10);
  let revenue = 0;
  let count = 0;
  await forEachSalePage(
    w.wid,
    w.uid,
    (s) => {
      if ((s.status || 'completed') !== 'completed') return;
      if (String(s.date || '').slice(0, 10) !== day) return;
      revenue += getSaleTotal(s);
      count += 1;
    },
    opts
  );
  return { revenue: Math.round(revenue * 100) / 100, count };
}

/**
 * @param {string} startIso10 inclusive
 * @param {string} endIso10 inclusive
 * @param {{ maxPages?: number }} [opts]
 */
export async function getRevenueRange(startIso10, endIso10, opts = {}) {
  const w = workspaceOrNull();
  if (!w) return { revenue: 0, profit: 0, count: 0 };
  const a = String(startIso10 || '').slice(0, 10);
  const b = String(endIso10 || '').slice(0, 10);
  let revenue = 0;
  let profit = 0;
  let count = 0;
  await forEachSalePage(
    w.wid,
    w.uid,
    (s) => {
      if ((s.status || 'completed') !== 'completed') return;
      const d = String(s.date || '').slice(0, 10);
      if (d < a || d > b) return;
      revenue += getSaleTotal(s);
      profit += getSaleProfit(s);
      count += 1;
    },
    opts
  );
  return {
    revenue: Math.round(revenue * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    count,
  };
}

/**
 * Top products by revenue in range (single-product sales + cart lines best-effort).
 * @param {string} startIso10
 * @param {string} endIso10
 * @param {number} limit
 */
export async function getTopProducts(startIso10, endIso10, limit = 10, opts = {}) {
  const w = workspaceOrNull();
  if (!w) return [];
  const a = String(startIso10 || '').slice(0, 10);
  const b = String(endIso10 || '').slice(0, 10);
  /** @type {Record<string, { id: string, name: string, revenue: number, qty: number }>} */
  const map = {};
  await forEachSalePage(
    w.wid,
    w.uid,
    (s) => {
      if ((s.status || 'completed') !== 'completed') return;
      const d = String(s.date || '').slice(0, 10);
      if (d < a || d > b) return;
      if (Array.isArray(s.items) && s.items.length > 0) {
        for (const line of s.items) {
          const id = line.productId || line.id;
          if (!id) continue;
          const name = line.productName || '';
          const sub = (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0);
          if (!map[id]) map[id] = { id, name, revenue: 0, qty: 0 };
          map[id].revenue += sub;
          map[id].qty += Number(line.quantity) || 0;
          if (name) map[id].name = name;
        }
      } else if (s.productId) {
        const id = s.productId;
        if (!map[id]) map[id] = { id, name: s.productName || '', revenue: 0, qty: 0 };
        map[id].revenue += getSaleTotal(s);
        map[id].qty += Number(s.quantity) || 0;
        if (s.productName) map[id].name = s.productName;
      }
    },
    opts
  );
  return Object.values(map)
    .sort((x, y) => y.revenue - x.revenue)
    .slice(0, Math.max(1, Number(limit) || 10));
}

/**
 * Daily revenue buckets for last N days (completed sales).
 * @param {number} days
 */
export async function getSalesTrend(days = 14, opts = {}) {
  const w = workspaceOrNull();
  if (!w) return [];
  const n = Math.min(90, Math.max(1, Number(days) || 14));
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (n - 1));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  /** @type {Record<string, number>} */
  const byDay = {};
  await forEachSalePage(
    w.wid,
    w.uid,
    (s) => {
      if ((s.status || 'completed') !== 'completed') return;
      const d = String(s.date || '').slice(0, 10);
      if (d < startStr || d > endStr) return;
      byDay[d] = (byDay[d] || 0) + getSaleTotal(s);
    },
    opts
  );
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const x = new Date(start);
    x.setDate(x.getDate() + i);
    const key = x.toISOString().slice(0, 10);
    out.push({ date: key, revenue: Math.round((byDay[key] || 0) * 100) / 100 });
  }
  return out;
}

/**
 * Daily profit trend for last N days (bounded scan with early stop).
 * Profit هنا = (ربح المبيعات) + (إيرادات الحركات) − (مصروفات الحركات)
 * @param {number} days
 * @param {{ pageSize?: number, maxPages?: number }} [opts]
 */
export async function getDailyProfitTrend(days = 30, opts = {}) {
  const w = workspaceOrNull();
  if (!w) return [];
  const n = Math.min(60, Math.max(1, Number(days) || 30));
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (n - 1));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const pageSize = Math.min(200, Math.max(20, Number(opts.pageSize) || 120));
  const maxPages = Math.min(800, Math.max(1, Number(opts.maxPages) || 200));

  /** @type {Record<string, { sales: number, salesProfit: number, income: number, expense: number }>} */
  const byDay = {};
  for (let i = 0; i < n; i += 1) {
    const x = new Date(start);
    x.setDate(x.getDate() + i);
    const key = x.toISOString().slice(0, 10);
    byDay[key] = { sales: 0, salesProfit: 0, income: 0, expense: 0 };
  }

  // Sales scan (newest first) with early stop once we are past startStr.
  {
    let cursor = null;
    for (let p = 0; p < maxPages; p += 1) {
      const { items, nextCursor } = await getSalesPageByCursor(w.wid, w.uid, { limit: pageSize, cursor });
      if (!items?.length) break;
      let minDateInPage = '9999-12-31';
      for (const s of items) {
        const d = String(s?.date || '').slice(0, 10);
        if (d && d < minDateInPage) minDateInPage = d;
        if ((s?.status || 'completed') !== 'completed') continue;
        if (!d || d < startStr || d > endStr) continue;
        const bucket = byDay[d];
        if (!bucket) continue;
        bucket.sales += getSaleTotal(s);
        bucket.salesProfit += getSaleProfit(s);
      }
      if (minDateInPage < startStr) break;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
  }

  // Transactions scan (newest first) with early stop.
  {
    let cursor = null;
    for (let p = 0; p < maxPages; p += 1) {
      const { items, nextCursor } = await getTransactionsPageByCursor(w.wid, w.uid, { limit: pageSize, cursor });
      if (!items?.length) break;
      let minDateInPage = '9999-12-31';
      for (const t of items) {
        const d = String(t?.date || '').slice(0, 10);
        if (d && d < minDateInPage) minDateInPage = d;
        if (!d || d < startStr || d > endStr) continue;
        const bucket = byDay[d];
        if (!bucket) continue;
        const amt = parseAmount(t.amount);
        if (t.type === 'income') bucket.income += amt;
        else if (t.type === 'expense') bucket.expense += amt;
      }
      if (minDateInPage < startStr) break;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
  }

  const out = [];
  for (let i = 0; i < n; i += 1) {
    const x = new Date(start);
    x.setDate(x.getDate() + i);
    const key = x.toISOString().slice(0, 10);
    const b = byDay[key] || { sales: 0, salesProfit: 0, income: 0, expense: 0 };
    const net = (b.salesProfit || 0) + (b.income || 0) - (b.expense || 0);
    out.push({
      date: key,
      name: dateLabelArShort(key),
      sales: Math.round((b.sales || 0) * 100) / 100,
      salesProfit: Math.round((b.salesProfit || 0) * 100) / 100,
      income: Math.round((b.income || 0) * 100) / 100,
      expense: Math.round((b.expense || 0) * 100) / 100,
      profit: Math.round(net * 100) / 100,
    });
  }
  return out;
}

/**
 * Products at or below minQuantity (when minQuantity > 0).
 * @param {number} cap max rows
 */
export async function getLowStockProducts(cap = 50, opts = {}) {
  const w = workspaceOrNull();
  if (!w) return [];
  const max = Math.min(500, Math.max(1, Number(cap) || 50));
  const low = [];
  await forEachProductPage(
    w.wid,
    w.uid,
    (p) => {
      if (low.length >= max) return;
      const min = p.minQuantity != null ? Number(p.minQuantity) : 0;
      const q = Number(p.quantity) || 0;
      if (min > 0 && q <= min) low.push(p);
    },
    opts
  );
  return low;
}

/**
 * Net cash movements (income − expense) over transaction pages.
 */
export async function getMovementNet(opts = {}) {
  const w = workspaceOrNull();
  if (!w) return { income: 0, expense: 0, net: 0 };
  let income = 0;
  let expense = 0;
  await forEachTransactionPage(
    w.wid,
    w.uid,
    (t) => {
      const amt = parseAmount(t.amount);
      if (t.type === 'income') income += amt;
      else if (t.type === 'expense') expense += amt;
    },
    opts
  );
  const net = Math.round((income - expense) * 100) / 100;
  return { income, expense, net };
}

/**
 * Sum of transaction amounts for one type (full cursor scan; use sparingly e.g. header totals).
 * @param {'income'|'expense'} type
 */
export async function getTransactionSumByType(type, opts = {}) {
  const w = workspaceOrNull();
  if (!w || (type !== 'income' && type !== 'expense')) return 0;
  let sum = 0;
  await forEachTransactionPage(
    w.wid,
    w.uid,
    (t) => {
      if (t.type === type) sum += parseAmount(t.amount);
    },
    opts
  );
  return Math.round(sum * 100) / 100;
}

/**
 * @param {string} iso10
 */
function dateLabelArShort(iso10) {
  try {
    const [y, m, d] = String(iso10).slice(0, 10).split('-').map(Number);
    const x = new Date(y, (m || 1) - 1, d || 1);
    return x.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
  } catch {
    return iso10;
  }
}

/**
 * @param {string} yyyymm
 */
function monthLabelAr(yyyymm) {
  try {
    const [y, m] = String(yyyymm).split('-').map(Number);
    const x = new Date(y, (m || 1) - 1, 1);
    return x.toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' });
  } catch {
    return yyyymm;
  }
}

/**
 * Single IDB pass for dashboard sales metrics + chart buckets + recent rows.
 * @param {{ maxPages?: number }} [opts]
 */
export async function fetchDashboardSalesReadModel(opts = {}) {
  const w = workspaceOrNull();
  if (!w) {
    return {
      todaySales: 0,
      todaySalesCount: 0,
      todayProfitFromSales: 0,
      monthSales: 0,
      monthSalesCount: 0,
      monthProfitFromSales: 0,
      totalProfitFromSales: 0,
      totalSalesRevenue: 0,
      completedCount: 0,
      unpaidSalesReceivables: 0,
      bestSellingProduct: null,
      recentSales: [],
      topProductsThisMonth: [],
      saleDay: {},
      saleMonth: {},
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const dayKeys = [];
  for (let i = 13; i >= 0; i -= 1) {
    const x = new Date();
    x.setDate(x.getDate() - i);
    dayKeys.push(x.toISOString().slice(0, 10));
  }
  const sixMonthMeta = [];
  {
    const d = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const y = x.getFullYear();
      const m = x.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const next = new Date(y, m, 0);
      const keyEnd = `${y}-${String(m).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      sixMonthMeta.push({ key, keyStart: `${key}-01`, keyEnd, label: monthLabelAr(`${y}-${String(m).padStart(2, '0')}`) });
    }
  }

  /** @type {Record<string, { sales: number, salesProfit: number }>} */
  const saleDay = Object.fromEntries(dayKeys.map((k) => [k, { sales: 0, salesProfit: 0 }]));
  /** @type {Record<string, { sales: number, salesProfit: number }>} */
  const saleMonth = Object.fromEntries(sixMonthMeta.map(({ key }) => [key, { sales: 0, salesProfit: 0 }]));

  let todaySales = 0;
  let todaySalesCount = 0;
  let todayProfitFromSales = 0;
  let monthSales = 0;
  let monthSalesCount = 0;
  let monthProfitFromSales = 0;
  let totalProfitFromSales = 0;
  let totalSalesRevenue = 0;
  let completedCount = 0;
  let unpaidSalesReceivables = 0;
  /** @type {Record<string, number>} */
  const byName = {};
  /** @type {Record<string, { id: string, name: string, revenue: number, qty: number }>} */
  const topMap = {};
  /** @type {any[]} */
  let recentBuffer = [];

  await forEachSalePage(
    w.wid,
    w.uid,
    (s) => {
      const completed = (s.status || 'completed') === 'completed';
      const d = String(s.date || '').slice(0, 10);
      const tot = getSaleTotal(s);
      const prof = getSaleProfit(s);
      if (completed) {
        completedCount += 1;
        totalProfitFromSales += prof;
        totalSalesRevenue += tot;
        if (d === today) {
          todaySales += tot;
          todaySalesCount += 1;
          todayProfitFromSales += prof;
        }
        if (d >= monthStart && d <= today) {
          monthSales += tot;
          monthSalesCount += 1;
          monthProfitFromSales += prof;
        }
        if (saleDay[d]) {
          saleDay[d].sales += tot;
          saleDay[d].salesProfit += prof;
        }
        const mk = d.slice(0, 7);
        if (saleMonth[mk]) {
          saleMonth[mk].sales += tot;
          saleMonth[mk].salesProfit += prof;
        }
        if (Array.isArray(s.items) && s.items.length > 0) {
          s.items.forEach((i) => {
            const name = i.productName || '—';
            byName[name] = (byName[name] || 0) + (parseAmount(i.quantity) || 0) * (parseAmount(i.unitPrice) || 0);
          });
        } else {
          const name = s.productName || '—';
          byName[name] = (byName[name] || 0) + tot;
        }
        if (d >= monthStart && d <= today) {
          if (Array.isArray(s.items) && s.items.length > 0) {
            for (const line of s.items) {
              const id = line.productId || line.id;
              if (!id) continue;
              const name = line.productName || '';
              const sub = (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0);
              if (!topMap[id]) topMap[id] = { id, name, revenue: 0, qty: 0 };
              topMap[id].revenue += sub;
              topMap[id].qty += Number(line.quantity) || 0;
              if (name) topMap[id].name = name;
            }
          } else if (s.productId) {
            const id = s.productId;
            if (!topMap[id]) topMap[id] = { id, name: s.productName || '', revenue: 0, qty: 0 };
            topMap[id].revenue += tot;
            topMap[id].qty += Number(s.quantity) || 0;
            if (s.productName) topMap[id].name = s.productName;
          }
        }
        recentBuffer.push(s);
        if (recentBuffer.length > 120) {
          recentBuffer.sort((a, b) => new Date(b.date) - new Date(a.date));
          recentBuffer = recentBuffer.slice(0, 40);
        }
      }
      if (completed && !s.paid) unpaidSalesReceivables += tot;
    },
    opts
  );

  const entries = Object.entries(byName).sort((a, b) => b[1] - a[1]);
  const bestSellingProduct = entries[0] ? { name: entries[0][0], total: entries[0][1] } : null;
  const recentSales = recentBuffer.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  const topProductsThisMonth = Object.values(topMap)
    .sort((x, y) => y.revenue - x.revenue)
    .slice(0, 10)
    .map((row) => ({
      ...row,
      revenue: Math.round(row.revenue * 100) / 100,
    }));

  return {
    todaySales: Math.round(todaySales * 100) / 100,
    todaySalesCount,
    todayProfitFromSales: Math.round(todayProfitFromSales * 100) / 100,
    monthSales: Math.round(monthSales * 100) / 100,
    monthSalesCount,
    monthProfitFromSales: Math.round(monthProfitFromSales * 100) / 100,
    totalProfitFromSales: Math.round(totalProfitFromSales * 100) / 100,
    totalSalesRevenue: Math.round(totalSalesRevenue * 100) / 100,
    completedCount,
    unpaidSalesReceivables: Math.round(unpaidSalesReceivables * 100) / 100,
    bestSellingProduct,
    recentSales,
    topProductsThisMonth,
    saleDay,
    saleMonth,
    sixMonthMeta,
    dayKeys,
  };
}

/**
 * Single IDB pass for dashboard transaction metrics + chart buckets + recent rows.
 */
export async function fetchDashboardTransactionsReadModel(opts = {}) {
  const w = workspaceOrNull();
  if (!w) {
    return {
      income: 0,
      expense: 0,
      monthIncome: 0,
      lastMonthIncome: 0,
      txCount: 0,
      txDay: {},
      txMonth: {},
      recentTransactions: [],
      dayKeys: [],
      sixMonthMeta: [],
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const now = new Date();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStartStr = `${lastMonthStart.getFullYear()}-${String(lastMonthStart.getMonth() + 1).padStart(2, '0')}-01`;
  const lastMonthEndStr = new Date(lastMonthStart.getFullYear(), lastMonthStart.getMonth() + 1, 0).toISOString().slice(0, 10);

  const dayKeys = [];
  for (let i = 13; i >= 0; i -= 1) {
    const x = new Date();
    x.setDate(x.getDate() - i);
    dayKeys.push(x.toISOString().slice(0, 10));
  }
  const sixMonthMeta = [];
  {
    const d = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const y = x.getFullYear();
      const m = x.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const next = new Date(y, m, 0);
      const keyEnd = `${y}-${String(m).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      sixMonthMeta.push({ key, keyStart: `${key}-01`, keyEnd, label: monthLabelAr(`${y}-${String(m).padStart(2, '0')}`) });
    }
  }

  /** @type {Record<string, { income: number, expense: number }>} */
  const txDay = Object.fromEntries(dayKeys.map((k) => [k, { income: 0, expense: 0 }]));
  /** @type {Record<string, { income: number, expense: number }>} */
  const txMonth = Object.fromEntries(sixMonthMeta.map(({ key }) => [key, { income: 0, expense: 0 }]));

  let income = 0;
  let expense = 0;
  let monthIncome = 0;
  let lastMonthIncome = 0;
  let txCount = 0;
  /** @type {any[]} */
  let recentBuffer = [];

  await forEachTransactionPage(
    w.wid,
    w.uid,
    (t) => {
      txCount += 1;
      const amt = parseAmount(t.amount);
      const d = String(t.date || '').slice(0, 10);
      if (t.type === 'income') income += amt;
      else if (t.type === 'expense') expense += amt;
      if (t.type === 'income' && d >= monthStart && d <= today) monthIncome += amt;
      if (t.type === 'income' && d >= lastMonthStartStr && d <= lastMonthEndStr) lastMonthIncome += amt;
      if (txDay[d]) {
        if (t.type === 'income') txDay[d].income += amt;
        else if (t.type === 'expense') txDay[d].expense += amt;
      }
      const mk = d.slice(0, 7);
      if (txMonth[mk]) {
        if (t.type === 'income') txMonth[mk].income += amt;
        else if (t.type === 'expense') txMonth[mk].expense += amt;
      }
      recentBuffer.push(t);
      if (recentBuffer.length > 160) {
        recentBuffer.sort((a, b) => new Date(b.date) - new Date(a.date));
        recentBuffer = recentBuffer.slice(0, 48);
      }
    },
    opts
  );

  const recentTransactions = recentBuffer.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);

  return {
    income,
    expense,
    monthIncome,
    lastMonthIncome,
    txCount,
    txDay,
    txMonth,
    recentTransactions,
    dayKeys,
    sixMonthMeta,
  };
}

/**
 * Parallel dashboard read model (sales + transactions + optional low stock).
 */
export async function fetchDashboardReadModel(opts = {}) {
  try {
    const [salesRm, txRm, lowStock] = await Promise.all([
      fetchDashboardSalesReadModel(opts),
      fetchDashboardTransactionsReadModel(opts),
      getLowStockProducts(50, opts),
    ]);

    const dk =
      salesRm.dayKeys && salesRm.dayKeys.length > 0 ? salesRm.dayKeys : (txRm.dayKeys || []);
    const sm =
      salesRm.sixMonthMeta && salesRm.sixMonthMeta.length > 0 ? salesRm.sixMonthMeta : (txRm.sixMonthMeta || []);

    const last14Days = dk.map((dateStr) => {
      const sd = salesRm.saleDay[dateStr] || { sales: 0, salesProfit: 0 };
      const td = txRm.txDay[dateStr] || { income: 0, expense: 0 };
      const inc = td.income;
      const exp = td.expense;
      return {
        date: dateStr,
        name: dateLabelArShort(dateStr),
        income: Math.round(inc * 100) / 100,
        expense: Math.round(exp * 100) / 100,
        sales: Math.round(sd.sales * 100) / 100,
        salesProfit: Math.round(sd.salesProfit * 100) / 100,
        profit: Math.round((inc - exp) * 100) / 100,
      };
    });

    const last6Months = sm.map(({ key, label }) => {
      const td = txRm.txMonth[key] || { income: 0, expense: 0 };
      const sm = salesRm.saleMonth[key] || { sales: 0, salesProfit: 0 };
      const inc = td.income;
      const exp = td.expense;
      const salesInMonth = sm.sales;
      const salesProfitInMonth = sm.salesProfit;
      return {
        key,
        label,
        name: label,
        income: Math.round(inc * 100) / 100,
        expense: Math.round(exp * 100) / 100,
        sales: Math.round(salesInMonth * 100) / 100,
        salesProfit: Math.round(salesProfitInMonth * 100) / 100,
        profit: Math.round((inc - exp) * 100) / 100,
      };
    });

    const averageSaleAmount =
      salesRm.completedCount > 0 ? Math.round((salesRm.totalSalesRevenue / salesRm.completedCount) * 100) / 100 : 0;

    return {
      sales: salesRm,
      tx: txRm,
      lowStockProducts: lowStock,
      last14Days,
      last6Months,
      averageSaleAmount,
      topProducts: salesRm.topProductsThisMonth || [],
    };
  } catch (e) {
    void logSystemEvent('aggregate_failure', 'fetchDashboardReadModel failed', { error: e?.message || 'unknown' });
    throw e;
  }
}

/**
 * Metrics for SmartInsights (two IDB passes).
 */
export async function fetchSmartInsightsFinancials(opts = {}) {
  try {
    const [salesRm, txRm] = await Promise.all([
      fetchDashboardSalesReadModel(opts),
      fetchDashboardTransactionsReadModel(opts),
    ]);
    return {
      income: txRm.income,
      expense: txRm.expense,
      salesProfitTotal: salesRm.totalProfitFromSales,
      monthIncome: txRm.monthIncome,
      lastMonthIncome: txRm.lastMonthIncome,
      transactionCount: txRm.txCount,
    };
  } catch (e) {
    void logSystemEvent('aggregate_failure', 'fetchSmartInsightsFinancials failed', { error: e?.message || 'unknown' });
    throw e;
  }
}

/**
 * Revenue + profit for an arbitrary inclusive date range (reports).
 */
export async function getRevenueRangeAggregate(startIso10, endIso10, opts = {}) {
  return getRevenueRange(startIso10, endIso10, opts);
}

/**
 * Full reports read model from IDB (sales + transactions scans).
 */
export async function fetchReportsReadModel(opts = {}) {
  const w = workspaceOrNull();
  if (!w) {
    return {
      totalSalesAmount: 0,
      totalProfitFromSales: 0,
      completedCount: 0,
      cancelledCount: 0,
      returnedCount: 0,
      todaySalesReport: 0,
      monthSalesReport: 0,
      salesByProduct: [],
      clientBalancesUnpaid: [],
      byCategoryIncome: [],
      byCategoryExpense: [],
      monthly: [],
      totalIncome: 0,
      totalExpense: 0,
      transactionCount: 0,
    };
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStart = `${todayStr.slice(0, 7)}-01`;

  const { getCategories } = await import('./store');
  const cats = getCategories();

  let totalSalesAmount = 0;
  let totalProfitFromSales = 0;
  let completedCount = 0;
  let cancelledCount = 0;
  let returnedCount = 0;
  let todaySalesReport = 0;
  let monthSalesReport = 0;
  /** @type {Record<string, { name: string, quantity: number, total: number, profit: number }>} */
  const prodMap = {};
  /** @type {Record<string, number>} */
  const clientUnpaid = {};

  await forEachSalePage(
    w.wid,
    w.uid,
    (s) => {
      const st = s.status || 'completed';
      if (st === 'cancelled') {
        cancelledCount += 1;
        return;
      }
      if (st === 'returned') {
        returnedCount += 1;
        return;
      }
      if (st !== 'completed') return;
      completedCount += 1;
      const tot = getSaleTotal(s);
      const prof = getSaleProfit(s);
      totalSalesAmount += tot;
      totalProfitFromSales += prof;
      const d = String(s.date || '').slice(0, 10);
      if (d === todayStr) todaySalesReport += tot;
      if (d >= monthStart && d <= todayStr) monthSalesReport += tot;
      if (!s.paid) {
        const name = s.clientName || 'نقدي';
        clientUnpaid[name] = (clientUnpaid[name] || 0) + tot;
      }
      if (Array.isArray(s.items) && s.items.length > 0) {
        const saleTotal = tot;
        const subtotal = s.items.reduce((sum, i) => sum + (parseAmount(i.quantity) || 0) * parseAmount(i.unitPrice), 0);
        const ratio = subtotal > 0 ? saleTotal / subtotal : 1;
        s.items.forEach((it) => {
          const key = it.productId || it.productName || 'غير معروف';
          if (!prodMap[key]) prodMap[key] = { name: it.productName || key, quantity: 0, total: 0, profit: 0 };
          const q = parseAmount(it.quantity) || 0;
          const itemRevenue = q * parseAmount(it.unitPrice);
          const itemCost = q * parseAmount(it.unitCost);
          const itemTotal = ratio * itemRevenue;
          const itemProfit = itemTotal - itemCost;
          prodMap[key].quantity += q;
          prodMap[key].total += itemTotal;
          prodMap[key].profit += itemProfit;
        });
      } else {
        const key = s.productId || s.productName || 'غير معروف';
        if (!prodMap[key]) prodMap[key] = { name: s.productName || key, quantity: 0, total: 0, profit: 0 };
        prodMap[key].quantity += parseAmount(s.quantity) || 0;
        prodMap[key].total += tot;
        prodMap[key].profit += prof;
      }
    },
    opts
  );

  /** @type {Record<string, number>} */
  const byCatInc = {};
  cats.income.forEach((c) => {
    byCatInc[c] = 0;
  });
  /** @type {Record<string, number>} */
  const byCatExp = {};
  cats.expense.forEach((c) => {
    byCatExp[c] = 0;
  });
  /** @type {Record<string, { income: number, expense: number }>} */
  const monthly = {};
  let totalIncome = 0;
  let totalExpense = 0;
  let transactionCount = 0;

  await forEachTransactionPage(
    w.wid,
    w.uid,
    (t) => {
      transactionCount += 1;
      const amt = parseAmount(t.amount);
      const key = t.date?.slice(0, 7);
      if (!key) return;
      if (!monthly[key]) monthly[key] = { income: 0, expense: 0 };
      if (t.type === 'income') {
        totalIncome += amt;
        monthly[key].income += amt;
        byCatInc[t.category] = (byCatInc[t.category] || 0) + amt;
      } else if (t.type === 'expense') {
        totalExpense += amt;
        monthly[key].expense += amt;
        byCatExp[t.category] = (byCatExp[t.category] || 0) + amt;
      }
    },
    opts
  );

  const salesByProduct = Object.values(prodMap).sort((a, b) => b.quantity - a.quantity);
  const clientBalancesUnpaid = Object.entries(clientUnpaid).sort((a, b) => b[1] - a[1]);

  return {
    totalSalesAmount: Math.round(totalSalesAmount * 100) / 100,
    totalProfitFromSales: Math.round(totalProfitFromSales * 100) / 100,
    completedCount,
    cancelledCount,
    returnedCount,
    todaySalesReport: Math.round(todaySalesReport * 100) / 100,
    monthSalesReport: Math.round(monthSalesReport * 100) / 100,
    salesByProduct,
    clientBalancesUnpaid,
    byCategoryIncome: Object.entries(byCatInc).filter(([, v]) => v > 0),
    byCategoryExpense: Object.entries(byCatExp).filter(([, v]) => v > 0),
    monthly: Object.entries(monthly).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6),
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpense: Math.round(totalExpense * 100) / 100,
    transactionCount,
  };
}
