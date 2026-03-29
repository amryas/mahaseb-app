import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentAccountId } from '../data/store';
import { getCacheUserId } from '../data/cacheStore';
import { getSalesPageByCursor, putSaleRecord } from '../data/indexedDbStore';
import { getSyncQueueLength } from '../data/syncQueue';
import { isSalesStorageReadOnly, SALES_EVENTS, migrateLegacySalesSampleToIdb } from '../data/salesWriteService';
import { trackMemoryWindowItemCount } from '../services/performanceGuards';

const PAGE_SIZE = 30;
const MAX_PAGES_IN_MEMORY = 3;

async function fetchPageWithRetry(workspaceId, userId, limit, cursor, signal, retries = 2) {
  let last = { items: [], nextCursor: null };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) return last;
    last = await getSalesPageByCursor(workspaceId, userId, { limit, cursor });
    if (last.items.length > 0 || !last.nextCursor) return last;
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return last;
}

/**
 * Cursor-based sales list: IndexedDB only, newest first, keeps last 3 pages in memory.
 */
export function useSalesCursor() {
  const workspaceId = getCurrentAccountId();
  const userId = getCacheUserId();

  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [readOnlySafeMode, setReadOnlySafeMode] = useState(() => isSalesStorageReadOnly());
  const [queueBacklogWarning, setQueueBacklogWarning] = useState(false);

  const cursorRef = useRef(null);
  const pagesRef = useRef([]);
  const abortRef = useRef(null);
  const lastChangeAtRef = useRef(0);

  const flattenPages = (pages) => (Array.isArray(pages) ? pages.flat() : []);

  const loadFirst = useCallback(async () => {
    const wid = getCurrentAccountId();
    const uid = getCacheUserId();
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    if (!wid || !uid) {
      setSales([]);
      setLoading(false);
      setHasMore(false);
      return;
    }
    setLoading(true);
    try {
      let { items, nextCursor } = await fetchPageWithRetry(wid, uid, PAGE_SIZE, null, signal);
      if (signal.aborted) return;
      if (items.length === 0) {
        await migrateLegacySalesSampleToIdb(wid, uid, PAGE_SIZE * MAX_PAGES_IN_MEMORY);
        const again = await fetchPageWithRetry(wid, uid, PAGE_SIZE, null, signal);
        items = again.items;
        nextCursor = again.nextCursor;
      }
      if (signal.aborted) return;
      cursorRef.current = nextCursor;
      pagesRef.current = [items];
      const flat0 = flattenPages(pagesRef.current);
      setSales(flat0);
      trackMemoryWindowItemCount(flat0.length, 'sales_cursor');
      setHasMore(!!nextCursor);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const wid = getCurrentAccountId();
    const uid = getCacheUserId();
    if (!wid || !uid || !cursorRef.current || loadingMore) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setLoadingMore(true);
    try {
      const { items, nextCursor } = await fetchPageWithRetry(wid, uid, PAGE_SIZE, cursorRef.current, signal);
      if (signal.aborted) return;
      cursorRef.current = nextCursor;
      pagesRef.current = [...pagesRef.current, items];
      if (pagesRef.current.length > MAX_PAGES_IN_MEMORY) {
        pagesRef.current = pagesRef.current.slice(-MAX_PAGES_IN_MEMORY);
      }
      const flat1 = flattenPages(pagesRef.current);
      setSales(flat1);
      trackMemoryWindowItemCount(flat1.length, 'sales_cursor');
      setHasMore(!!nextCursor);
    } finally {
      if (!signal.aborted) setLoadingMore(false);
    }
  }, [loadingMore]);

  useEffect(() => {
    cursorRef.current = null;
    pagesRef.current = [];
    void loadFirst();
  }, [workspaceId, userId, loadFirst]);

  useEffect(() => {
    const onChanged = () => {
      const now = Date.now();
      if (now - lastChangeAtRef.current < 600) return;
      lastChangeAtRef.current = now;
      void loadFirst();
    };
    const onReadonly = () => setReadOnlySafeMode(true);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(SALES_EVENTS.CHANGED, onChanged);
    window.addEventListener(SALES_EVENTS.READONLY, onReadonly);
    return () => {
      window.removeEventListener(SALES_EVENTS.CHANGED, onChanged);
      window.removeEventListener(SALES_EVENTS.READONLY, onReadonly);
    };
  }, [loadFirst]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const id = window.setInterval(() => {
      try {
        setQueueBacklogWarning(getSyncQueueLength() > 40);
      } catch {
        setQueueBacklogWarning(false);
      }
    }, 8000);
    return () => window.clearInterval(id);
  }, []);

  /** Optimistic prepend after local write-through */
  const prependSale = useCallback((sale) => {
    if (!sale?.id) return;
    const first = pagesRef.current[0] ? [...pagesRef.current[0]] : [];
    first.unshift(sale);
    pagesRef.current = [first.slice(0, PAGE_SIZE), ...pagesRef.current.slice(1)].filter((p) => p.length);
    setSales(flattenPages(pagesRef.current).slice(0, PAGE_SIZE * MAX_PAGES_IN_MEMORY));
  }, []);

  const replaceSaleInList = useCallback((id, updater) => {
    setSales((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
    pagesRef.current = pagesRef.current.map((page) => page.map((s) => (s.id === id ? updater(s) : s)));
  }, []);

  const removeSaleFromList = useCallback((id) => {
    setSales((prev) => prev.filter((s) => s.id !== id));
    pagesRef.current = pagesRef.current.map((page) => page.filter((s) => s.id !== id));
  }, []);

  return {
    sales,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    refresh: loadFirst,
    readOnlySafeMode,
    queueBacklogWarning,
    prependSale,
    replaceSaleInList,
    removeSaleFromList,
    pageSize: PAGE_SIZE,
    putSaleRecordHydrate: putSaleRecord,
  };
}
