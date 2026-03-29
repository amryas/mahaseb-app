import { useState, useEffect, useCallback } from 'react';
import { getCurrentAccountId } from '../data/store';
import { getCacheUserId } from '../data/cacheStore';
import { fetchDashboardReadModel } from '../data/aggregatesService';
import { logSystemEvent } from '../services/monitoring';

/**
 * Bundled dashboard read model (sales + transactions + low stock) with no extra full-array scans.
 * Exposes the same metric shapes as getTodayRevenue, getSalesTrend(14), getTopProducts(month),
 * and getMovementNet, derived from the single bundle.
 */
export function useDashboardAggregates() {
  const workspaceId = getCurrentAccountId();
  const userId = getCacheUserId();

  const [readModel, setReadModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!workspaceId || !userId) {
      setReadModel(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

    try {
      const rm = await fetchDashboardReadModel();
      const salesTrend = (rm.sales.dayKeys || []).map((d) => ({
        date: d,
        revenue: Math.round((rm.sales.saleDay[d]?.sales || 0) * 100) / 100,
      }));
      const todayRevenue = { revenue: rm.sales.todaySales, count: rm.sales.todaySalesCount };
      const movementNet = {
        income: rm.tx.income,
        expense: rm.tx.expense,
        net: Math.round((rm.tx.income - rm.tx.expense) * 100) / 100,
      };

      void logSystemEvent('dashboard_aggregates_loaded', 'useDashboardAggregates', {
        ms: t0 ? Math.round(performance.now() - t0) : 0,
      });

      setReadModel({
        ...rm,
        todayRevenue,
        salesTrend,
        topProducts: rm.topProducts || [],
        movementNet,
      });
    } catch (e) {
      setError(e?.message || 'dashboard_aggregate_failed');
      void logSystemEvent('aggregate_failure', 'useDashboardAggregates', { error: e?.message || 'unknown' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    readModel,
    loading,
    error,
    refresh,
    todayRevenue: readModel?.todayRevenue ?? null,
    salesTrend: readModel?.salesTrend ?? [],
    topProducts: readModel?.topProducts ?? [],
    movementNet: readModel?.movementNet ?? null,
  };
}
