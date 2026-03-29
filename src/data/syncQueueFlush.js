/**
 * Shared throttled drain for the IndexedDB sync queue (all entity write-through paths).
 */
import { processSyncQueue } from './syncQueue';
import { isWorkspaceSaaSEnabled } from './workspaceApi';

let _flushTimer = null;

/** Coalesce rapid writes + always try an immediate process. */
export function requestSyncQueueFlush() {
  void processSyncQueue();
  if (typeof window === 'undefined') return;
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = window.setTimeout(() => {
    _flushTimer = null;
    void processSyncQueue();
  }, 900);
}

let _intervalId = null;

/** Call once from App mount: 30s background drain when SaaS is enabled. */
export function ensureGlobalSyncInterval() {
  if (typeof window === 'undefined' || _intervalId != null) return;
  _intervalId = window.setInterval(() => {
    if (isWorkspaceSaaSEnabled()) void processSyncQueue();
  }, 30_000);
}
