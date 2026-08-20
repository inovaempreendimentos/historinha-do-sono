import crypto from "crypto";

export const META_PIXEL_ID = "929817166830999";

const PRECO = { assinatura: 39.9, pacote: 67, narracao: 7.9 };
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function hashEmail(email) {
  return crypto.createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("hex");
}

function buildUserData(opts) {
  const ud = {
    client_ip_address: opts.ip || "127.0.0.1",
    client_user_agent: opts.user_agent || DEFAULT_UA
  };
  const email = String(opts.email || "").trim().toLowerCase();
  if (email) ud.em = [hashEmail(email)];
  if (opts.fbp) ud.fbp = String(opts.fbp);
  if (opts.fbc) ud.fbc = String(opts.fbc);
  return ud;
}

export function valorCompra({ assinatura, pacote, body }) {
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

export async function enviarMetaEvento(opts) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { ok: false, skip: "sem META_CAPI_TOKEN" };

  const event_name = opts.event_name || "Purchase";
  const event_id = opts.event_id || `${event_name.toLowerCase()}_${Date.now()}`;
  const event_time = opts.event_time || Math.floor(Date.now() / 1000);
  const value = Number(opts.value) || 0;
  const currency = opts.currency || "BRL";

  const event = {
    event_name,
    event_time,
    event_id,
    action_source: "website",
    event_source_url: opts.url || "https://app.historinhadosono.com/",
    user_data: buildUserData(opts)
  };

  if (event_name === "Purchase" || event_name === "InitiateCheckout") {
    event.custom_data = {
      value: value || PRECO.assinatura,
      currency,
      content_name: opts.content_name || "assinatura",
      content_type: "product",
      num_items: 1
    };
  }

  const payload = { data: [event], access_token: token };
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
    const avisos = (data.messages || []).filter(function (m) {
      return m && (m.error_type || m.message);
    });
    const recebidos = Number(data.events_received) || 0;
    return {
      ok: r.ok && recebidos > 0 && avisos.length === 0,
      status: r.status,
      event_id,
      event_name,
      events_received: recebidos,
      avisos,
      body: txt
    };
  } catch (err) {
    console.error("meta capi", err);
    return { ok: false, error: String(err) };
  }
}

export async function enviarMetaPurchase(opts) {
  return enviarMetaEvento({ ...opts, event_name: "Purchase" });
}
