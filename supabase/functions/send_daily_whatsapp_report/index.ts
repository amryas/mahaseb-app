import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function todayIso10() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoneyEgp(n: number) {
  const x = Number(n) || 0;
  try {
    return `${Math.round(x).toLocaleString("ar-EG")} جنيه`;
  } catch {
    return `${Math.round(x)} جنيه`;
  }
}

function normalizePhone(raw: unknown) {
  const s = String(raw || "").trim();
  if (!s) return "";
  let x = s.replace(/[^\d+]/g, "");
  if (x.startsWith("00")) x = `+${x.slice(2)}`;
  if (/^01\d{9}$/.test(x)) return `+20${x.slice(1)}`;
  if (/^20\d{10}$/.test(x)) return `+${x}`;
  if (/^\+20\d{10}$/.test(x)) return x;
  if (/^\+\d{8,15}$/.test(x)) return x;
  return "";
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const workspaceId = body?.workspace_id ?? body?.workspaceId ?? "";
    const phone = normalizePhone(body?.phone);
    const reportType = String(body?.report_type || "full");
    const dateIso10 = String(body?.date_iso10 || todayIso10()).slice(0, 10);

    if (!workspaceId || typeof workspaceId !== "string") return json({ error: "workspace_id required" }, 400);
    if (!phone) return json({ ok: true, skipped: true, reason: "no_phone" }, 200);
    if (!["sales", "profit", "full"].includes(reportType)) return json({ error: "invalid report_type" }, 400);

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Ensure membership (RLS likely covers it too, but we fail fast)
    const { data: member } = await supabaseUser
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return json({ error: "Forbidden" }, 403);

    // Query today's sales + expenses only (bounded)
    const [salesRes, txRes] = await Promise.all([
      supabaseUser
        .from("sales")
        .select("total, profit, items, product_name, productId, productName, quantity, unitPrice")
        .eq("workspace_id", workspaceId)
        .eq("date", dateIso10)
        .limit(2000),
      supabaseUser
        .from("transactions")
        .select("type, amount")
        .eq("workspace_id", workspaceId)
        .eq("date", dateIso10)
        .limit(2000),
    ]);

    const salesRows = Array.isArray(salesRes.data) ? salesRes.data : [];
    const txRows = Array.isArray(txRes.data) ? txRes.data : [];

    let totalSales = 0;
    let totalProfit = 0;
    const productMap = new Map<string, { name: string; revenue: number }>();

    for (const s of salesRows) {
      const t = Number((s as any).total ?? 0) || 0;
      const p = Number((s as any).profit ?? 0) || 0;
      totalSales += t;
      totalProfit += p;

      const items = (s as any).items;
      if (Array.isArray(items) && items.length > 0) {
        for (const line of items) {
          const name = String(line?.productName || "").trim();
          const q = Number(line?.quantity ?? 0) || 0;
          const price = Number(line?.unitPrice ?? 0) || 0;
          if (!name) continue;
          const rev = q * price;
          const prev = productMap.get(name);
          productMap.set(name, { name, revenue: (prev?.revenue || 0) + rev });
        }
      } else {
        const name = String((s as any).productName || (s as any).product_name || "").trim();
        const q = Number((s as any).quantity ?? 0) || 0;
        const price = Number((s as any).unitPrice ?? 0) || 0;
        if (name) {
          const rev = q > 0 && price > 0 ? q * price : t;
          const prev = productMap.get(name);
          productMap.set(name, { name, revenue: (prev?.revenue || 0) + rev });
        }
      }
    }

    let totalExpenses = 0;
    for (const t of txRows) {
      if ((t as any).type !== "expense") continue;
      totalExpenses += Number((t as any).amount ?? 0) || 0;
    }

    const hasActivity = salesRows.length > 0 || totalExpenses > 0;
    if (!hasActivity) return json({ ok: true, skipped: true, reason: "no_activity" }, 200);

    let topProduct = "—";
    {
      const arr = Array.from(productMap.values()).sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
      if (arr.length > 0 && arr[0]?.name) topProduct = arr[0].name;
    }

    const lines: string[] = [];
    lines.push("📊 تقرير اليوم:");
    lines.push("");
    if (reportType === "sales") {
      lines.push(`💰 المبيعات: ${formatMoneyEgp(totalSales)}`);
      lines.push(`🔥 أفضل منتج: ${topProduct}`);
    } else if (reportType === "profit") {
      lines.push(`📈 الربح: ${formatMoneyEgp(totalProfit)}`);
      lines.push(`💸 المصروفات: ${formatMoneyEgp(totalExpenses)}`);
    } else {
      lines.push(`💰 المبيعات: ${formatMoneyEgp(totalSales)}`);
      lines.push(`📈 الربح: ${formatMoneyEgp(totalProfit)}`);
      lines.push(`💸 المصروفات: ${formatMoneyEgp(totalExpenses)}`);
      lines.push(`🔥 أفضل منتج: ${topProduct}`);
    }

    const message = lines.join("\n");

    // Placeholder WhatsApp API call (non-blocking semantics but we await for status)
    const sendRes = await fetch("https://api.whatsapp.fake/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, message }),
    }).catch(() => null);

    // Even if placeholder fails, don't crash — return safe error.
    if (!sendRes || !sendRes.ok) {
      return json({ ok: false, error: "whatsapp_send_failed" }, 200);
    }

    return json({ ok: true, skipped: false, message }, 200);
  } catch (e) {
    return json({ ok: false, error: (e as any)?.message || "unknown" }, 200);
  }
});

