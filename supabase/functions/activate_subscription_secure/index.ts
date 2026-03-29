// PUBLIC — no JWT required. Auth via x-admin-secret only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-admin-secret",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const secret = req.headers.get("x-admin-secret");
  const expectedSecret = Deno.env.get("ACTIVATE_SUBSCRIPTION_SECRET");
  if (!expectedSecret || secret !== expectedSecret) {
    console.log("[activate_subscription_secure] 401: invalid or missing x-admin-secret");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null);
  const workspace_id = body?.workspace_id ?? body?.workspaceId;
  if (!workspace_id || String(workspace_id).trim() === "") {
    console.log("[activate_subscription_secure] 400: missing workspace_id");
    return jsonResponse({ error: "workspace_id required" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 30);
  const endIso = endDate.toISOString();
  const nowIso = now.toISOString();

  // Update subscription by workspace_id
  const { data: updated, error: updateErr } = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      subscription_end_date: endIso,
      updated_at: nowIso,
    })
    .eq("workspace_id", workspace_id)
    .select("id");

  if (updateErr) {
    console.log("[activate_subscription_secure] update error", updateErr.message);
  }

  const found = Array.isArray(updated) && updated.length > 0;
  if (found) {
    console.log("[activate_subscription_secure] updated workspace_id", workspace_id);
    return jsonResponse({ ok: true }, 200);
  }

  // Not found → insert active monthly_150 for 30 days
  console.log("[activate_subscription_secure] no row updated, fetching workspace", workspace_id);
  const { data: workspace, error: wsErr } = await supabase
    .from("workspaces")
    .select("owner_id")
    .eq("id", workspace_id)
    .maybeSingle();

  if (wsErr || !workspace?.owner_id) {
    console.log("[activate_subscription_secure] workspace not found or no owner", workspace_id);
    return jsonResponse({ error: "Workspace not found or has no owner" }, 400);
  }

  const { error: insertErr } = await supabase.from("subscriptions").insert({
    user_id: workspace.owner_id,
    workspace_id,
    plan: "monthly_150",
    status: "active",
    subscription_end_date: endIso,
    updated_at: nowIso,
  });

  if (insertErr) {
    console.log("[activate_subscription_secure] insert error", insertErr.message);
    return jsonResponse({ error: insertErr.message }, 400);
  }

  console.log("[activate_subscription_secure] inserted subscription for workspace_id", workspace_id);
  return jsonResponse({ ok: true }, 200);
});
