// ويب هوك Paymob: عند نجاح الدفع نفعّل الاشتراك فوراً
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Paymob يرسل obj أو transaction - نتحقق من النجاح
  const success = body.success === true || body.success === "true";
  const orderId = body.order?.id ?? body.obj?.order?.id ?? body.order_id;
  const amountCents = Number(body.amount_cents ?? body.obj?.amount_cents ?? 0);
  if (!success || !orderId) {
    return new Response("OK", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { data: payment } = await supabase
    .from("payments")
    .select("id, user_id, amount_egp")
    .eq("reference_id", String(orderId))
    .eq("status", "pending")
    .single();

  if (!payment) {
    return new Response("OK", { status: 200 });
  }

  const amountEgp = amountCents / 100;
  const planId = amountEgp >= 900 ? "yearly" : "monthly";
  const days = planId === "yearly" ? 365 : 30;
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + days);

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", payment.user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let subscriptionId: string;
  if (existing) {
    subscriptionId = existing.id;
    await supabase
      .from("subscriptions")
      .update({
        plan_id: planId,
        status: "active",
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    const { data: inserted } = await supabase.from("subscriptions").insert({
      user_id: payment.user_id,
      plan_id: planId,
      status: "active",
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    }).select("id").single();
    subscriptionId = inserted?.id ?? "";
  }

  await supabase.from("payments").update({ subscription_id: subscriptionId, status: "paid", updated_at: new Date().toISOString() }).eq("id", payment.id);

  return new Response("OK", { status: 200 });
});
