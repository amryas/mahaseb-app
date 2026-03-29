/**
 * Global read-only mode when IndexedDB is unusable (open failure after recovery, corruption).
 * Write paths must consult {@link isGlobalSafeMode} via writeGuard.
 */

import { logSystemEvent } from '../services/monitoring';

let _active = false;
let _reason = '';

export const GLOBAL_SAFE_MODE_EVENT = 'mohaseb-global-safe-mode';

export function enterGlobalSafeMode(reason) {
  if (_active) return;
  _active = true;
  _reason = String(reason || 'unknown');
  void logSystemEvent('global_safe_mode', 'Application entered global safe mode', { reason: _reason });
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(GLOBAL_SAFE_MODE_EVENT, { detail: { reason: _reason } }));
    }
  } catch (_) {}
}

export function clearGlobalSafeMode() {
  _active = false;
  _reason = '';
}

export function isGlobalSafeMode() {
  return _active;
}

export function getGlobalSafeModeReason() {
  return _reason;
}
