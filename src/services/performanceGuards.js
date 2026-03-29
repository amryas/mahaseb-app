/**
 * Lightweight client-side performance signals (cursor churn, in-memory windows).
 */
import { logSystemEvent } from './monitoring';

const CURSOR_WINDOW_MS = 60_000;
const CURSOR_WARN_THRESHOLD = 180;
const MEMORY_WINDOW_WARN = 400;

let _cursorLoads = 0;
let _cursorWindowStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
let _lastCursorWarnAt = 0;
let _lastMemoryWarnAt = 0;

function bumpCursorWindow() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - _cursorWindowStart > CURSOR_WINDOW_MS) {
    _cursorLoads = 0;
    _cursorWindowStart = now;
  }
  _cursorLoads += 1;
}

/**
 * Call once per cursor page fetch (sales / products / transactions).
 * @param {string} kind
 */
export function trackCursorPageLoad(kind = 'unknown') {
  bumpCursorWindow();
  if (_cursorLoads < CURSOR_WARN_THRESHOLD) return;
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (t - _lastCursorWarnAt < 30_000) return;
  _lastCursorWarnAt = t;
  void logSystemEvent('perf_cursor_spike', 'Excessive cursor page loads in window', {
    kind,
    count: _cursorLoads,
    windowMs: CURSOR_WINDOW_MS,
  });
  if (import.meta.env.DEV) {
    console.warn(`[perf] cursor loads (${kind}): ${_cursorLoads} in ~${CURSOR_WINDOW_MS}ms`);
  }
}

/**
 * @param {number} itemCount flattened rows in memory (e.g. cursor pages)
 * @param {string} [label]
 */
export function trackMemoryWindowItemCount(itemCount, label = 'list') {
  const n = Number(itemCount) || 0;
  if (n < MEMORY_WINDOW_WARN) return;
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (t - _lastMemoryWarnAt < 60_000) return;
  _lastMemoryWarnAt = t;
  void logSystemEvent('perf_memory_window', 'Large in-memory list window', { label, itemCount: n });
  if (import.meta.env.DEV) {
    console.warn(`[perf] memory window ${label}: ${n} items`);
  }
}

/**
 * Dev-only: warn if a render path builds a huge array (e.g. accidental full clone).
 * @param {unknown[]} arr
 * @param {string} label
 * @param {number} [max]
 */
export function warnLargeRenderArray(arr, label, max = 5000) {
  if (!import.meta.env.DEV || !Array.isArray(arr) || arr.length < max) return;
  console.warn(`[perf] large render array (${label}): ${arr.length}`);
}
