import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentAccountId } from '../data/store';
import { getCacheUserId } from '../data/cacheStore';
import { getTransactionsPageByCursor } from '../data/indexedDbStore';
import { TRANSACTIONS_EVENTS } from '../data/transactionsWriteService';
import { trackMemoryWindowItemCount } from '../services/performanceGuards';

const PAGE_SIZE = 30;
const MAX_PAGES_IN_MEMORY = 3;

async function fetchPageWithRetry(workspaceId, userId, limit, cursor, typeFilter, signal, retries = 2) {
  let last = { items: [], nextCursor: null };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) return last;
    last = await getTransactionsPageByCursor(workspaceId, userId, {
      limit,
      cursor,
      ...(typeFilter ? { type: typeFilter } : {}),
    });
    if (last.items.length > 0 || !last.nextCursor) return last;
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return last;
}

/**
 * Cursor-based transactions list (IndexedDB), newest first; keeps last 3 pages.
 * @param {'income'|'expense'|null} [filterType]
 */
export function useTransactionsCursor(filterType = null) {
  const workspaceId = getCurrentAccountId();
  const userId = getCacheUserId();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);

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
      setItems([]);
      setLoading(false);
      setHasMore(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let { items: chunk, nextCursor } = await fetchPageWithRetry(wid, uid, PAGE_SIZE, null, filterType, signal);
      if (signal.aborted) return;
      cursorRef.current = nextCursor;
      pagesRef.current = [chunk];
      const flat = flattenPages(pagesRef.current);
      setItems(flat);
      trackMemoryWindowItemCount(flat.length, 'transactions_cursor');
      setHasMore(!!nextCursor);
    } catch (e) {
      if (!signal.aborted) setError(e?.message || 'load_failed');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [filterType]);

  const loadMore = useCallback(async () => {
    const wid = getCurrentAccountId();
    const uid = getCacheUserId();
    if (!wid || !uid || !cursorRef.current || loadingMore) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setLoadingMore(true);
    setError(null);
    try {
      const { items: chunk, nextCursor } = await fetchPageWithRetry(
        wid,
        uid,
        PAGE_SIZE,
        cursorRef.current,
        filterType,
        signal
      );
      if (signal.aborted) return;
      cursorRef.current = nextCursor;
      pagesRef.current = [...pagesRef.current, chunk];
      if (pagesRef.current.length > MAX_PAGES_IN_MEMORY) {
        pagesRef.current = pagesRef.current.slice(-MAX_PAGES_IN_MEMORY);
      }
      const flat = flattenPages(pagesRef.current);
      setItems(flat);
      trackMemoryWindowItemCount(flat.length, 'transactions_cursor');
      setHasMore(!!nextCursor);
    } catch (e) {
      if (!signal.aborted) setError(e?.message || 'load_more_failed');
    } finally {
      if (!signal.aborted) setLoadingMore(false);
    }
  }, [loadingMore, filterType]);

  useEffect(() => {
    cursorRef.current = null;
    pagesRef.current = [];
    void loadFirst();
  }, [workspaceId, userId, filterType, loadFirst]);

  useEffect(() => {
    const onChanged = () => {
      const now = Date.now();
      if (now - lastChangeAtRef.current < 600) return;
      lastChangeAtRef.current = now;
      void loadFirst();
    };
    if (typeof window === 'undefined') return undefined;
    window.addEventListener(TRANSACTIONS_EVENTS.CHANGED, onChanged);
    return () => window.removeEventListener(TRANSACTIONS_EVENTS.CHANGED, onChanged);
  }, [loadFirst]);

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    refresh: loadFirst,
    pageSize: PAGE_SIZE,
  };
}
