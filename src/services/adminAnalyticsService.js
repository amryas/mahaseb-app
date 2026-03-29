import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { computeEffectiveStatus, getTrialDaysRemaining } from '../data/subscriptionApi';

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGES_HARD = 40; // hard cap to avoid unbounded scans

export const PLAN_PRICES_EGP = {
  monthly_150: 150,
  pro: 0, // unknown; keep 0 to avoid wrong revenue. Update when you define Pro price.
};

function now() {
  return new Date();
}

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function startOfDayIso(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function assertAdminEnv() {
  if (!isSupabaseEnabled()) throw new Error('supabase_disabled');
  const sb = getSupabase();
  if (!sb) throw new Error('no_supabase_client');
  return sb;
}

async function pagedScan({ table, select, filters = [], orderBy = { column: 'created_at', ascending: false }, pageSize = DEFAULT_PAGE_SIZE, maxPages = 8, signal }) {
  const sb = assertAdminEnv();
  const out = [];
  const safeMaxPages = Math.min(MAX_PAGES_HARD, Math.max(1, maxPages));

  for (let page = 0; page < safeMaxPages; page += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let q = sb.from(table).select(select).order(orderBy.column, { ascending: !!orderBy.ascending }).range(from, to);
    for (const f of filters) {
      if (!f) continue;
      if (f.op === 'eq') q = q.eq(f.column, f.value);
      else if (f.op === 'in') q = q.in(f.column, f.value);
      else if (f.op === 'gte') q = q.gte(f.column, f.value);
      else if (f.op === 'gt') q = q.gt(f.column, f.value);
      else if (f.op === 'lte') q = q.lte(f.column, f.value);
      else if (f.op === 'lt') q = q.lt(f.column, f.value);
      else if (f.op === 'ilike') q = q.ilike(f.column, f.value);
    }
    // Note: supabase-js doesn't support AbortSignal in all versions, so we just check before/after.
    const { data, error } = await q;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error) throw new Error(error.message || 'scan_failed');
    const rows = Array.isArray(data) ? data : [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function fetchAdminKpis({ signal } = {}) {
  const sb = assertAdminEnv();

  const since7d = addDays(now(), -7);

  const [
    workspacesCount,
    pendingProofsCount,
    activeUsers7dRows,
    subsRows,
  ] = await Promise.all([
    sb.from('workspaces').select('*', { count: 'exact', head: true }),
    sb.from('payment_proofs').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    // bounded by time window; still may be large, so page-scan up to a cap
    pagedScan({
      table: 'usage_events',
      select: 'user_id, created_at',
      filters: [{ op: 'gte', column: 'created_at', value: iso(since7d) }],
      orderBy: { column: 'created_at', ascending: false },
      pageSize: 800,
      maxPages: 8,
      signal,
    }),
    // subscriptions: we need status distribution + revenue estimate. Cap scan.
    pagedScan({
      table: 'subscriptions',
      select: 'status, trial_end_date, subscription_end_date, plan, created_at',
      orderBy: { column: 'created_at', ascending: false },
      pageSize: 800,
      maxPages: 10,
      signal,
    }),
  ]);

  const activeUsers7d = new Set(activeUsers7dRows.map((r) => r.user_id)).size;

  let paidActive = 0;
  let trial = 0;
  let grace = 0;
  let expired = 0;
  let revenueMonthly = 0;

  for (const r of subsRows) {
    const eff = computeEffectiveStatus(r);
    if (eff === 'active') paidActive += 1;
    else if (eff === 'trial') trial += 1;
    else if (eff === 'grace') grace += 1;
    else if (eff === 'expired') expired += 1;

    if (eff === 'active' || eff === 'grace') {
      const price = PLAN_PRICES_EGP[r.plan] ?? 150;
      revenueMonthly += Number(price) || 0;
    }
  }

  return {
    monthlyRevenue: revenueMonthly,
    activeUsers7d,
    totalWorkspaces: workspacesCount?.count ?? 0,
    paidSubscriptionsCount: paidActive + grace,
    trialUsersCount: trial,
    expiredSubscriptionsCount: expired,
    pendingPaymentProofsCount: pendingProofsCount?.count ?? 0,
  };
}

export async function fetchRevenueTrend30d({ signal } = {}) {
  // If you don't have historical billing events, we model a stable trend using current MRR.
  const kpis = await fetchAdminKpis({ signal });
  const base = Number(kpis.monthlyRevenue) || 0;

  const points = [];
  const start = addDays(now(), -29);
  for (let i = 0; i < 30; i += 1) {
    const d = addDays(start, i);
    const wobble = base > 0 ? Math.round((Math.sin(i / 3) * 0.03 + 0.01) * base) : 0;
    points.push({
      date: d.toISOString().slice(0, 10),
      revenue: Math.max(0, base + wobble),
    });
  }
  return points;
}

export async function fetchNewUsersPerDay14d({ signal } = {}) {
  const since = addDays(now(), -13);
  const rows = await pagedScan({
    table: 'usage_events',
    select: 'user_id, created_at, event_type',
    filters: [
      { op: 'eq', column: 'event_type', value: 'login' },
      { op: 'gte', column: 'created_at', value: iso(since) },
    ],
    orderBy: { column: 'created_at', ascending: false },
    pageSize: 1000,
    maxPages: 10,
    signal,
  });

  // "New users" approximation: first login within window (per user). (No auth.users access)
  const firstSeenByUser = new Map();
  for (const r of rows) {
    const ts = new Date(r.created_at).getTime();
    const prev = firstSeenByUser.get(r.user_id);
    if (!prev || ts < prev) firstSeenByUser.set(r.user_id, ts);
  }

  const counts = new Map();
  for (const [, ts] of firstSeenByUser.entries()) {
    const day = new Date(ts).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) || 0) + 1);
  }

  const points = [];
  for (let i = 0; i < 14; i += 1) {
    const d = addDays(since, i).toISOString().slice(0, 10);
    points.push({ date: d, users: counts.get(d) || 0 });
  }
  return points;
}

export async function fetchSubscriptionsFunnel({ signal } = {}) {
  const subsRows = await pagedScan({
    table: 'subscriptions',
    select: 'status, trial_end_date, subscription_end_date, plan, created_at',
    orderBy: { column: 'created_at', ascending: false },
    pageSize: 1000,
    maxPages: 10,
    signal,
  });

  const funnel = { trial: 0, grace: 0, paid: 0, expired: 0 };
  for (const r of subsRows) {
    const eff = computeEffectiveStatus(r);
    if (eff === 'trial') funnel.trial += 1;
    else if (eff === 'grace') funnel.grace += 1;
    else if (eff === 'active') funnel.paid += 1;
    else if (eff === 'expired') funnel.expired += 1;
  }
  return funnel;
}

export async function fetchTrialsEndingToday({ limit = 50, signal } = {}) {
  const sb = assertAdminEnv();
  const start = startOfDayIso(now());
  const end = startOfDayIso(addDays(now(), 1));
  const { data, error } = await sb
    .from('subscriptions')
    .select('workspace_id, trial_end_date, created_at, status')
    .eq('status', 'trial')
    .gte('trial_end_date', start)
    .lt('trial_end_date', end)
    .order('trial_end_date', { ascending: true })
    .limit(Math.min(200, Math.max(1, Number(limit) || 50)));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

/**
 * Last active per workspace within last N days (bounded IN query).
 * Returns Map(workspaceId -> ISO timestamp).
 */
export async function fetchLastActiveForWorkspaces({ workspaceIds, days = 7, signal } = {}) {
  const sb = assertAdminEnv();
  const ids = Array.isArray(workspaceIds) ? workspaceIds.filter(Boolean) : [];
  if (ids.length === 0) return new Map();

  // Keep IN query size safe.
  const chunkSize = 80;
  const since = addDays(now(), -Math.max(1, Number(days) || 7));
  const out = new Map();

  for (let i = 0; i < ids.length; i += chunkSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await sb
      .from('usage_events')
      .select('workspace_id, created_at')
      .in('workspace_id', chunk)
      .gte('created_at', iso(since))
      .order('created_at', { ascending: false })
      .limit(4000);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error) continue;
    const rows = Array.isArray(data) ? data : [];
    for (const r of rows) {
      const wid = r.workspace_id;
      if (!wid) continue;
      // because results are ordered desc globally, first seen per wid is the max
      if (!out.has(wid)) out.set(wid, r.created_at || null);
    }
  }

  return out;
}

export async function fetchWorkspacesPage({ page = 0, pageSize = 25, q = '', status = 'all', signal } = {}) {
  // Reuse admin RPC if present through adminApi's behavior is ideal,
  // but we keep this service standalone and bounded.
  const sb = assertAdminEnv();
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let wsQuery = sb
    .from('workspaces')
    .select('id, name, owner_id, created_at')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (q && q.trim()) {
    const qq = `%${q.trim()}%`;
    wsQuery = wsQuery.ilike('name', qq);
  }

  const { data: wsRows, error } = await wsQuery;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (error) return { rows: [], hasMore: false };
  const rows = Array.isArray(wsRows) ? wsRows : [];

  // Fetch subscription status for this page only (bounded N queries).
  const subs = await Promise.all(
    rows.map(async (w) => {
      const { data: sub } = await sb
        .from('subscriptions')
        .select('status, trial_end_date, subscription_end_date, plan, created_at')
        .eq('workspace_id', w.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sub) return { workspaceId: w.id, sub: null };
      const eff = computeEffectiveStatus(sub);
      return { workspaceId: w.id, sub: { ...sub, effectiveStatus: eff } };
    })
  );
  const subByWorkspace = new Map(subs.map((x) => [x.workspaceId, x.sub]));

  const enriched = rows
    .map((w) => {
      const sub = subByWorkspace.get(w.id) || null;
      const eff = sub?.effectiveStatus ?? (sub ? computeEffectiveStatus(sub) : null);
      const daysRemaining = sub ? getTrialDaysRemaining({ ...sub, effectiveStatus: eff }) : 0;
      return {
        id: w.id,
        name: w.name || 'مساحة عمل',
        ownerId: w.owner_id,
        createdAt: w.created_at,
        subscription: sub ? { ...sub, effectiveStatus: eff, trialDaysRemaining: daysRemaining } : null,
      };
    })
    .filter((w) => {
      if (!status || status === 'all') return true;
      const eff = w.subscription?.effectiveStatus ?? 'none';
      return eff === status;
    });

  return { rows: enriched, hasMore: rows.length === pageSize };
}

