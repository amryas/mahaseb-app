/**
 * استدعاءات آمنة للاشتراكات — Edge Functions فقط.
 * لا يوجد أي تحديث مباشر من الفرونت لجدول subscriptions.
 */

import { getSupabase, isSupabaseEnabled } from '../supabase/config';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

const SUPABASE_URL = env.VITE_SUPABASE_URL || '';
const ACTIVATE_SECRET = env.VITE_SUPABASE_ACTIVATE_SECRET || '';

function functionsUrl() {
  return `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;
}

/**
 * Trial Subscription — يحتاج JWT لأن الفنكشن Protected
 */
export async function createTrialSubscriptionViaEdge(workspaceId) {
  try {
    if (!isSupabaseEnabled() || !workspaceId) return null;

    const sb = getSupabase();
    if (!sb) return null;

    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) {
      console.warn("❌ No session access token");
      return null;
    }

    const res = await fetch(`${functionsUrl()}/create_trial_subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn("❌ Trial subscription failed", data);
      return null;
    }

    console.log("✅ Trial subscription success");
    return data?.ok ? data : null;

  } catch (err) {
    console.error("🔥 Trial subscription error", err);
    return null;
  }
}

/**
 * Activate Subscription — ADMIN ONLY
 * لا يحتاج JWT — يعتمد فقط على x-admin-secret.
 * يُفترض أن تكون الدالة الخلفية idempotent (تفعيل متكرر لنفس المساحة = نجاح).
 */
export async function activateSubscriptionViaEdge(workspaceId) {

  try {

    if (!workspaceId) {
      return { ok: false, error: "workspace_id missing" };
    }

    if (!ACTIVATE_SECRET) {
      return { ok: false, error: "Admin secret not configured" };
    }

    console.log("🚀 Activating subscription for:", workspaceId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${functionsUrl()}/activate_subscription_secure`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": ACTIVATE_SECRET,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
      }),
    });

    clearTimeout(timeout);

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn("❌ Activation failed:", data);
      return {
        ok: false,
        error: data?.error || "Activation failed",
      };
    }

    console.log("✅ Subscription Activated");
    return { ok: true };

  } catch (err) {

    if (err.name === "AbortError") {
      return { ok: false, error: "Request timeout" };
    }

    console.error("🔥 Activation error:", err);
    return { ok: false, error: "Network error" };
  }
}

export function hasActivateSecret() {
  return !!ACTIVATE_SECRET;
}
