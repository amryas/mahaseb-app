// إنشاء دفعة عبر Paymob وإرجاع رابط الدفع (فودافون كاش / انستا باي)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYMOB_AUTH_URL = "https://accept.paymobsolutions.com/api/auth/tokens";
const PAYMOB_ORDER_URL = "https://accept.paymobsolutions.com/api/ecommerce/orders";
const PAYMOB_PAYMENT_KEYS_URL = "https://accept.paymobsolutions.com/api/acceptance/payment_keys";
const PAYMOB_IFRAME_BASE = "https://accept.paymob.com/api/acceptance/iframes";

const PLANS: Record<string, { amount: number; days: number }> = {
  monthly: { amount: 99, days: 30 },
  yearly: { amount: 999, days: 365 },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const apiKey = Deno.env.get("PAYMOB_API_KEY");
  const iframeId = Deno.env.get("PAYMOB_IFRAME_ID");
  const integrationId = Deno.env.get("PAYMOB_WALLET_INTEGRATION_ID");
  const successUrl = Deno.env.get("PAYMOB_SUCCESS_URL") ?? "";
  const failUrl = Deno.env.get("PAYMOB_FAIL_URL") ?? "";

  if (!apiKey || !iframeId || !integrationId) {
    return new Response(JSON.stringify({ error: "Payment not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let body: { plan_id: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const plan = PLANS[body.plan_id] ?? PLANS.monthly;
  const amountCents = Math.round(plan.amount * 100);

  // 1) Auth token
  const authRes = await fetch(PAYMOB_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!authRes.ok) {
    return new Response(JSON.stringify({ error: "Paymob auth failed" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
  const authData = await authRes.json();
  const token = authData.token;
  const merchantId = authData.profile?.id ?? authData.merchant_id;
  if (!token) {
    return new Response(JSON.stringify({ error: "Paymob token missing" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  // 2) Register order
  const orderBody: Record<string, unknown> = {
    auth_token: token,
    delivery_needed: "false",
    amount_cents: amountCents,
    currency: "EGP",
    merchant_order_id: `sub-${user.id}-${Date.now()}`,
    items: [],
  };
  if (merchantId != null) orderBody.merchant_id = merchantId;
  const orderRes = await fetch(PAYMOB_ORDER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderBody),
  });
  if (!orderRes.ok) {
    const errText = await orderRes.text();
    return new Response(JSON.stringify({ error: "Order failed", detail: errText }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
  const orderData = await orderRes.json();
  const paymobOrderId = orderData.id;
  if (!paymobOrderId) {
    return new Response(JSON.stringify({ error: "Order id missing" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  // 3) Payment key (wallet)
  const keyRes = await fetch(PAYMOB_PAYMENT_KEYS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_token: token,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: paymobOrderId,
      billing_data: {
        first_name: "User",
        last_name: "App",
        email: user.email ?? "user@app.com",
        phone_number: "01000000000",
        country: "EGY",
      },
      currency: "EGP",
      integration_id: parseInt(integrationId, 10),
    }),
  });
  if (!keyRes.ok) {
    const errText = await keyRes.text();
    return new Response(JSON.stringify({ error: "Payment key failed", detail: errText }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
  const keyData = await keyRes.json();
  const paymentToken = keyData.token;
  if (!paymentToken) {
    return new Response(JSON.stringify({ error: "Payment token missing" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  // 4) Save payment record (pending)
  const { data: paymentRow, error: payErr } = await supabaseAdmin
    .from("payments")
    .insert({
      user_id: user.id,
      amount_egp: plan.amount,
      method: "vodafone_cash",
      status: "pending",
      reference_id: String(paymobOrderId),
    })
    .select("id")
    .single();
  if (payErr) {
    return new Response(JSON.stringify({ error: "DB failed", detail: payErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const paymentUrl = `${PAYMOB_IFRAME_BASE}/${iframeId}?payment_token=${paymentToken}`;

  return new Response(
    JSON.stringify({ payment_url: paymentUrl, payment_id: paymentRow.id }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
});
