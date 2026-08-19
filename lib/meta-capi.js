import crypto from "crypto";

export const META_PIXEL_ID = "929817166830999";

const PRECO = { assinatura: 39.9, pacote: 67, narracao: 7.9 };

function hashEmail(email) {
  return crypto.createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("hex");
}

export function valorCompra({ assinatura, pacote, bump5, body }) {
  const raw = parseFloat(
    body?.total || body?.amount || body?.value || body?.sale_amount || 0
  );
  if (raw > 0) return raw;
  if (assinatura) return PRECO.assinatura;
  if (pacote) return PRECO.pacote;
  return PRECO.assinatura;
}

export function nomeProduto({ assinatura, pacote, narracao }) {
  if (assinatura) return "assinatura";
  if (pacote) return "pacote";
  if (narracao) return "narracao";
  return "compra";
}

export async function enviarMetaPurchase(opts) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { ok: false, skip: "sem META_CAPI_TOKEN" };

  const email = String(opts.email || "").trim().toLowerCase();
  if (!email) return { ok: false, skip: "sem email" };

  const value = Number(opts.value) || 0;
  const currency = opts.currency || "BRL";
  const content_name = opts.content_name || "compra";
  const event_id = opts.event_id || `purchase_${hashEmail(email)}_${Date.now()}`;
  const event_time = opts.event_time || Math.floor(Date.now() / 1000);

  const payload = {
    data: [{
      event_name: "Purchase",
      event_time,
      event_id,
      action_source: "website",
      event_source_url: opts.url || "https://app.historinhadosono.com",
      user_data: { em: [hashEmail(email)] },
      custom_data: {
        value,
        currency,
        content_name,
        content_type: "product",
        num_items: 1
      }
    }],
    access_token: token
  };

  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const txt = await r.text();
    let data = {};
    try { data = JSON.parse(txt); } catch (e) {}
    const avisos = (data.messages || []).filter(function (m) { return m && (m.error_type || m.message); });
    const recebidos = Number(data.events_received) || 0;
    return {
      ok: r.ok && recebidos > 0 && avisos.length === 0,
      status: r.status,
      event_id,
      events_received: recebidos,
      avisos,
      body: txt
    };
  } catch (err) {
    console.error("meta capi", err);
    return { ok: false, error: String(err) };
  }
}
