const CACHE_PREFIX = 'app_cache';
const CACHE_USER_KEY = 'app_cache_user_id';
const CACHE_VERSION = 1;

function safeParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getCacheUserId() {
  try {
    return localStorage.getItem(CACHE_USER_KEY) || 'guest';
  } catch {
    return 'guest';
  }
}

export function setCacheUserId(userId) {
  try {
    if (userId) localStorage.setItem(CACHE_USER_KEY, String(userId));
    else localStorage.removeItem(CACHE_USER_KEY);
  } catch (_) {}
}

export function buildWorkspaceCacheKey(workspaceId, userId = getCacheUserId()) {
  if (!workspaceId) return null;
  return `${CACHE_PREFIX}_${workspaceId}_${userId || 'guest'}`;
}

function getLegacySuffixKey(workspaceId, suffix) {
  if (!workspaceId || !suffix) return null;
  return `mahaseb_${workspaceId}_${suffix}`;
}

function readWorkspaceBlob(workspaceId, userId = getCacheUserId()) {
  const key = buildWorkspaceCacheKey(workspaceId, userId);
  if (!key) return null;
  try {
    const parsed = safeParse(localStorage.getItem(key));
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== CACHE_VERSION || typeof parsed.data !== 'object' || parsed.data == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeWorkspaceBlob(workspaceId, blob, userId = getCacheUserId()) {
  const key = buildWorkspaceCacheKey(workspaceId, userId);
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(blob));
    return true;
  } catch {
    return false;
  }
}

function ensureWorkspaceBlob(workspaceId, userId = getCacheUserId()) {
  const existing = readWorkspaceBlob(workspaceId, userId);
  if (existing) return existing;
  return {
    version: CACHE_VERSION,
    workspaceId,
    userId: userId || 'guest',
    updatedAt: new Date().toISOString(),
    data: {},
  };
}

export function getWorkspaceSlice(workspaceId, suffix, defaultValue, userId = getCacheUserId()) {
  if (!workspaceId || !suffix) return defaultValue;
  const blob = readWorkspaceBlob(workspaceId, userId);
  if (blob?.data && Object.prototype.hasOwnProperty.call(blob.data, suffix)) return blob.data[suffix];

  // Migration fallback from legacy per-suffix keys.
  const legacyKey = getLegacySuffixKey(workspaceId, suffix);
  if (!legacyKey) return defaultValue;
  try {
    const legacyRaw = localStorage.getItem(legacyKey);
    if (legacyRaw == null) return defaultValue;
    const legacyParsed = safeParse(legacyRaw);
    const legacyValue = legacyParsed == null ? legacyRaw : legacyParsed;
    setWorkspaceSlice(workspaceId, suffix, legacyValue, userId);
    localStorage.removeItem(legacyKey);
    return legacyValue;
  } catch {
    return defaultValue;
  }
}

export function setWorkspaceSlice(workspaceId, suffix, value, userId = getCacheUserId()) {
  if (!workspaceId || !suffix) return false;
  const blob = ensureWorkspaceBlob(workspaceId, userId);
  blob.data = blob.data || {};
  blob.data[suffix] = value;
  blob.updatedAt = new Date().toISOString();
  return writeWorkspaceBlob(workspaceId, blob, userId);
}

export function clearAllWorkspaceCache() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(`${CACHE_PREFIX}_`) || k.startsWith('mahaseb_')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch (_) {}
}

function coerceDateIso10(v) {
  // Expected: 'YYYY-MM-DD' or ISO timestamp.
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // Try to extract first 10 chars for ISO timestamps.
  if (v.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/**
 * Prune old records in localStorage cache to keep memory usage bounded.
 * This is a safety net; IndexedDB is the main engine.
 */
export function pruneWorkspaceCacheByAge(workspaceId, userId = getCacheUserId(), cutoffIso10) {
  if (!workspaceId || !cutoffIso10) return false;
  try {
    const blob = readWorkspaceBlob(workspaceId, userId);
    if (!blob?.data || typeof blob.data !== 'object') return false;

    const before = {
      sales: Array.isArray(blob.data.sales) ? blob.data.sales.length : 0,
      invoices: Array.isArray(blob.data.invoices) ? blob.data.invoices.length : 0,
      transactions: Array.isArray(blob.data.transactions) ? blob.data.transactions.length : 0,
    };

    // Filter only by date-ish fields; keep shape stable.
    if (Array.isArray(blob.data.sales)) {
      blob.data.sales = blob.data.sales.filter((s) => {
        const d = coerceDateIso10(s?.date ?? s?.createdAt ?? s?.updatedAt);
        return d ? d >= cutoffIso10 : false;
      });
    }
    if (Array.isArray(blob.data.invoices)) {
      blob.data.invoices = blob.data.invoices.filter((inv) => {
        const d = coerceDateIso10(inv?.createdAt ?? inv?.dueDate ?? inv?.updatedAt);
        return d ? d >= cutoffIso10 : false;
      });
    }
    if (Array.isArray(blob.data.transactions)) {
      blob.data.transactions = blob.data.transactions.filter((t) => {
        const d = coerceDateIso10(t?.date ?? t?.createdAt ?? t?.updatedAt);
        return d ? d >= cutoffIso10 : false;
      });
    }

    blob.updatedAt = new Date().toISOString();
    return writeWorkspaceBlob(workspaceId, blob, userId) || false;
  } catch (_) {
    return false;
  }
}
