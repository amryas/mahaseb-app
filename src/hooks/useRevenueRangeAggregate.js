import { useState, useEffect, useCallback } from 'react';
import { getCurrentAccountId } from '../data/store';
import { getCacheUserId } from '../data/cacheStore';
import { getRevenueRangeAggregate } from '../data/aggregatesService';
import { logSystemEvent } from '../services/monitoring';

/**
 * @param {{ startIso10: string, endIso10: string } | null} range
 */
export function useRevenueRangeAggregate(range) {
  const workspaceId = getCurrentAccountId();
  const userId = getCacheUserId();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!range?.startIso10 || !range?.endIso10 || !workspaceId || !userId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await getRevenueRangeAggregate(range.startIso10, range.endIso10);
      setData(row);
    } catch (e) {
      setError(e?.message || 'revenue_range_failed');
      void logSystemEvent('aggregate_failure', 'useRevenueRangeAggregate', { error: e?.message || 'unknown' });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range?.startIso10, range?.endIso10, workspaceId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
