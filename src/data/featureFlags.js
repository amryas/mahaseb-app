/**
 * Offline-first feature flags (local override). Remote fetch can be layered later.
 * Shape: { [flagKey]: boolean }
 */
const STORAGE_KEY = 'mohaseb_feature_flags_v1';

/** @param {string} key @param {boolean} defaultValue */
export function getFeatureFlag(key, defaultValue = true) {
  if (!key) return defaultValue;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultValue;
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && typeof o[key] === 'boolean') return o[key];
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * @param {string} key
 * @param {boolean} value
 */
/** When true, Reports.jsx uses aggregatesService + IDB cursors instead of full in-memory arrays. */
export const FLAG_REPORTS_AGGREGATES = 'reports_use_aggregates';

export function setFeatureFlagLocal(key, value) {
  if (!key) return false;
  try {
    let o = {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') o = p;
    }
    o[key] = !!value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
    return true;
  } catch {
    return false;
  }
}
