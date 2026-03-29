import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { getCurrentAccountId } from '../data/store';
import { getCacheUserId } from '../data/cacheStore';

const SAMPLE_RATES = {
  sync_failure: 1,
  subscription_activation_failure: 1,
  db_error: 1,
  queue_retry_overflow: 1,
  billing_offline_write: 1,
  payment_proof_uploaded: 1,
  api_latency: 0.15,
  workspace_created: 1,
  workspace_switch: 1,
  workspace_guest_migrate: 1,
};

function shouldSample(type) {
  const rate = SAMPLE_RATES[type] ?? 0.2;
  return Math.random() <= rate;
}

export async function logSystemEvent(type, message, metadata = {}, opts = {}) {
  if (!type || !message) return false;
  if (!opts.force && !shouldSample(type)) return false;
  if (!isSupabaseEnabled()) return false;
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const workspaceId = opts.workspaceId || getCurrentAccountId() || null;
    const userId = opts.userId || getCacheUserId() || null;
    const payload = {
      workspace_id: workspaceId,
      user_id: userId,
      type,
      message: String(message).slice(0, 1000),
      metadata: typeof metadata === 'object' && metadata != null ? metadata : { value: String(metadata) },
    };
    const { error } = await sb.from('system_logs').insert(payload);
    return !error;
  } catch {
    return false;
  }
}

export async function withApiLatencyLog(type, fn, meta = {}) {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - start);
    await logSystemEvent('api_latency', `${type} success`, { ...meta, ms, ok: true });
    return result;
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    await logSystemEvent('api_latency', `${type} failure`, { ...meta, ms, ok: false, error: e?.message || 'unknown' });
    throw e;
  }
}
