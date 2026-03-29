import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAdminKpis,
  fetchRevenueTrend30d,
  fetchNewUsersPerDay14d,
  fetchSubscriptionsFunnel,
  fetchTrialsEndingToday,
} from '../services/adminAnalyticsService';

function makeAbortController() {
  try {
    return new AbortController();
  } catch {
    return { abort() {}, signal: null };
  }
}

export function useAdminMetrics({ auto = true } = {}) {
  const [kpis, setKpis] = useState(null);
  const [charts, setCharts] = useState({ revenue30d: null, newUsers14d: null, funnel: null });
  const [alerts, setAlerts] = useState({ trialsEndingToday: null });
  const [loading, setLoading] = useState({ kpis: false, charts: false, alerts: false });
  const [error, setError] = useState({ kpis: null, charts: null, alerts: null });

  const abortRef = useRef(null);

  const refreshKpis = useCallback(async () => {
    abortRef.current?.abort?.();
    const ac = makeAbortController();
    abortRef.current = ac;
    setLoading((p) => ({ ...p, kpis: true }));
    setError((p) => ({ ...p, kpis: null }));
    try {
      const data = await fetchAdminKpis({ signal: ac.signal });
      setKpis(data);
      return data;
    } catch (e) {
      if (e?.name !== 'AbortError') setError((p) => ({ ...p, kpis: e?.message || 'kpis_failed' }));
      return null;
    } finally {
      setLoading((p) => ({ ...p, kpis: false }));
    }
  }, []);

  const refreshCharts = useCallback(async () => {
    const ac = makeAbortController();
    setLoading((p) => ({ ...p, charts: true }));
    setError((p) => ({ ...p, charts: null }));
    try {
      const [revenue30d, newUsers14d, funnel] = await Promise.all([
        fetchRevenueTrend30d({ signal: ac.signal }),
        fetchNewUsersPerDay14d({ signal: ac.signal }),
        fetchSubscriptionsFunnel({ signal: ac.signal }),
      ]);
      setCharts({ revenue30d, newUsers14d, funnel });
      return { revenue30d, newUsers14d, funnel };
    } catch (e) {
      if (e?.name !== 'AbortError') setError((p) => ({ ...p, charts: e?.message || 'charts_failed' }));
      return null;
    } finally {
      setLoading((p) => ({ ...p, charts: false }));
    }
  }, []);

  const refreshAlerts = useCallback(async () => {
    const ac = makeAbortController();
    setLoading((p) => ({ ...p, alerts: true }));
    setError((p) => ({ ...p, alerts: null }));
    try {
      const trialsEndingToday = await fetchTrialsEndingToday({ limit: 50, signal: ac.signal });
      setAlerts({ trialsEndingToday });
      return { trialsEndingToday };
    } catch (e) {
      if (e?.name !== 'AbortError') setError((p) => ({ ...p, alerts: e?.message || 'alerts_failed' }));
      return null;
    } finally {
      setLoading((p) => ({ ...p, alerts: false }));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshKpis();
    await Promise.all([refreshCharts(), refreshAlerts()]);
  }, [refreshKpis, refreshCharts, refreshAlerts]);

  useEffect(() => {
    if (!auto) return undefined;
    void refreshAll();
    return () => abortRef.current?.abort?.();
  }, [auto, refreshAll]);

  const trend = useMemo(() => {
    // Trend indicator: compare last 7 points average vs previous 7 (mock-friendly).
    const arr = charts?.revenue30d;
    if (!Array.isArray(arr) || arr.length < 14) return null;
    const last7 = arr.slice(-7).reduce((s, x) => s + (Number(x.revenue) || 0), 0) / 7;
    const prev7 = arr.slice(-14, -7).reduce((s, x) => s + (Number(x.revenue) || 0), 0) / 7;
    if (prev7 <= 0) return { dir: 'up', pct: 0 };
    const pct = Math.round(((last7 - prev7) / prev7) * 100);
    return { dir: pct >= 0 ? 'up' : 'down', pct: Math.abs(pct) };
  }, [charts?.revenue30d]);

  return {
    kpis,
    charts,
    alerts,
    loading,
    error,
    trend,
    refreshKpis,
    refreshCharts,
    refreshAlerts,
    refreshAll,
  };
}

