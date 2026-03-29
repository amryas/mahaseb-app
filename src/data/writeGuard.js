/**
 * Blocks local write-through when global safe mode is active.
 */
import { isGlobalSafeMode } from './globalSafeMode';
import { logSystemEvent } from '../services/monitoring';

/**
 * @param {string} op
 * @returns {{ ok: false, error: string, safeMode: true } | null}
 */
export function blockIfGlobalSafeMode(op) {
  if (!isGlobalSafeMode()) return null;
  void logSystemEvent('write_blocked_safe_mode', String(op || 'write'), {});
  return { ok: false, error: 'safe_mode', safeMode: true };
}
