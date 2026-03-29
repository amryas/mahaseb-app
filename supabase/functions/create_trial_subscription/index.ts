// إنشاء اشتراك تجريبي لـ workspace — يُستدعى بعد إنشاء workspace (المستخدم مصادق).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TRIAL_DAYS = 3;
const PLAN = "monthly_150";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let workspaceId: string;
  try {
    const body = await req.json();
    workspaceId = body?.workspace_id ?? body?.workspaceId ?? "";
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!workspaceId || typeof workspaceId !== "string") {
    return new Response(JSON.stringify({ error: "workspace_id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: member } = await supabaseUser
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member || member.role !== "owner") {
    return new Response(JSON.stringify({ error: "Not workspace owner" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

  const { data: existing } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (existing) {
    return new Response(
      JSON.stringify({ ok: true, subscription_id: existing.id, already_exists: true }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }

  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      user_id: user.id,
      workspace_id: workspaceId,
      plan: PLAN,
      status: "trial",
      trial_end_date: trialEnd.toISOString(),
      subscription_end_date: null,
    })
    .select("id, workspace_id, status, trial_end_date")
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message, code: error.code }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, subscription: sub }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});
