import { enviarMetaEvento } from "../lib/meta-capi.js";

function ipDoRequest(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return "127.0.0.1";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const body = req.body || {};
    const event_name = body.event_name || "PageView";
    const permitidos = ["PageView", "Purchase", "InitiateCheckout", "CompleteRegistration"];
    if (!permitidos.includes(event_name)) {
      return res.status(400).json({ error: "Evento não permitido." });
    }

    const result = await enviarMetaEvento({
      event_name,
      email: body.email,
      value: body.value,
      currency: body.currency || "BRL",
      content_name: body.content_name,
      event_id: body.event_id,
      url: body.url || "https://app.historinhadosono.com/",
      ip: ipDoRequest(req),
      user_agent: req.headers["user-agent"] || "",
      fbp: body.fbp,
      fbc: body.fbc
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error("meta-event", err);
    return res.status(500).json({ error: "Erro ao enviar evento." });
  }
}
