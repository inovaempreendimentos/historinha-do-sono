// Cliente ou servidor → envia Purchase para Meta Conversions API
import { enviarMetaPurchase } from "../lib/meta-capi.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { email, value, currency, content_name, event_id } = req.body || {};
    if (!email || !value) {
      return res.status(400).json({ error: "Faltam email ou value." });
    }

    const result = await enviarMetaPurchase({
      email,
      value,
      currency: currency || "BRL",
      content_name: content_name || "assinatura",
      event_id
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    console.error("meta-purchase", err);
    return res.status(500).json({ error: "Erro ao enviar evento." });
  }
}
