// ============================================================
// WEBHOOK DO KIRVANO
// Compra aprovada → libera créditos / assinatura no Supabase.
// ============================================================

import { enviarMetaPurchase, valorCompra, nomeProduto } from "../lib/meta-capi.js";

const OFERTA_ASSINATURA = "baee13d4-4b07-432a-8d1b-26ad1e64a515";
const OFERTA_PACOTE     = "02e33bab-929d-4b40-a97a-1fd0848893da";
const OFERTA_PACOTE_OLD = "b95a04be-5c48-4f14-a9c1-3dd5d587b39e";
const OFERTA_NARRACAO   = "ef28e79f-c76d-40f6-a503-dc252129940d";
const OFERTA_BUMP_5     = "e231edfe-43bf-4a08-855a-f9398ad98b5a";
const OFERTA_BUMP_3     = "";

const CREDITOS_PACOTE     = 10;
const CREDITOS_ASSINATURA = 15;
const CREDITOS_BUMP_5     = 5;
const CREDITOS_BUMP_3     = 3;

const EVENTOS_OK = [
  "SALE_APPROVED",
  "SUBSCRIPTION_RENEWED",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_RESTARTED"
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
  const KIRVANO_TOKEN = process.env.KIRVANO_TOKEN;

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({ error: "Servidor sem configuração do Supabase." });
  }

  if (KIRVANO_TOKEN) {
    const tokenRecebido = req.headers["security-token"] || req.headers["token"] || "";
    if (tokenRecebido !== KIRVANO_TOKEN) {
      return res.status(401).json({ error: "Token inválido." });
    }
  }

  try {
    const body = req.body || {};
    const event = body.event;
    const status = String(body.status || "").toUpperCase();
    const tipo = String(body.type || "").toUpperCase();

    if (!EVENTOS_OK.includes(event) && status !== "APPROVED") {
      return res.status(200).json({ ok: true, ignorado: event || status });
    }

    const email = String(
      (body.customer && body.customer.email) ||
      body.email ||
      ""
    ).toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: "Sem e-mail do comprador." });
    }

    const produtos = Array.isArray(body.products) ? body.products : [];
    const ids = [];
    produtos.forEach((p) => {
      if (p.offer_id) ids.push(String(p.offer_id));
      if (p.id) ids.push(String(p.id));
    });
    const tem = (id) => id && ids.includes(id);

    let temAssinatura = tem(OFERTA_ASSINATURA) || event.startsWith("SUBSCRIPTION") || tipo === "RECURRING";
    const temPacote = tem(OFERTA_PACOTE) || tem(OFERTA_PACOTE_OLD);
    const temNarracao = tem(OFERTA_NARRACAO);
    const temBump5 = tem(OFERTA_BUMP_5) || produtos.some((p) => p.is_order_bump && /5|cinco|\+5/i.test(p.offer_name || p.name || ""));
    const temBump3 = tem(OFERTA_BUMP_3);

    if (!temAssinatura && !temPacote && !temNarracao && !temBump5 && !temBump3) {
      const nomes = produtos.map((p) => String(p.offer_name || p.name || "").toLowerCase()).join(" ");
      if (nomes.includes("assinat")) temAssinatura = true;
    }

    let creditosCompra = 0;
    if (temPacote) creditosCompra += CREDITOS_PACOTE;
    if (temBump5) creditosCompra += CREDITOS_BUMP_5;
    if (temBump3) creditosCompra += CREDITOS_BUMP_3;
    if (temAssinatura) {
      creditosCompra = CREDITOS_ASSINATURA + (temBump5 ? CREDITOS_BUMP_5 : 0) + (temBump3 ? CREDITOS_BUMP_3 : 0);
    }

    const perfil = await acharPerfil(SUPABASE_URL, SERVICE_ROLE, email);

    const pendente = {
      email,
      assinatura: !!temAssinatura,
      creditos: creditosCompra,
      narracao: !!temNarracao,
      criado_em: new Date().toISOString()
    };

    if (!perfil) {
      await sbPost(SUPABASE_URL, SERVICE_ROLE, "/rest/v1/pagamentos_pendentes", pendente);
      const saleId = body.sale_id || body.id || body.transaction_id || "";
      const metaPurchase = await enviarMetaPurchase({
        email,
        value: valorCompra({ assinatura: temAssinatura, pacote: temPacote, bump5: temBump5, body }),
        content_name: nomeProduto({ assinatura: temAssinatura, pacote: temPacote, narracao: temNarracao }),
        event_id: saleId ? `kirvano_${saleId}` : undefined,
        ip: body.customer?.ip || body.ip || "127.0.0.1",
        user_agent: body.customer?.user_agent || "Mozilla/5.0 (compatible; HistorinhaWebhook/1.0)"
      });
      return res.status(200).json({ ok: true, pendente: true, email, creditos: pendente.creditos, metaPurchase });
    }

    const id = perfil.id;
    const creditosAtuais = perfil.creditos || 0;
    const update = { atualizado_em: new Date().toISOString(), email };

    if (temAssinatura) {
      update.assinante = true;
      update.plano = "assinante";
      update.creditos = Math.max(CREDITOS_ASSINATURA, creditosAtuais) + (temBump5 ? CREDITOS_BUMP_5 : 0) + (temBump3 ? CREDITOS_BUMP_3 : 0);
    } else if (creditosCompra > 0) {
      update.creditos = creditosAtuais + creditosCompra;
    }

    if (Object.keys(update).length > 2) {
      await sbPatch(SUPABASE_URL, SERVICE_ROLE, `/rest/v1/perfis?id=eq.${id}`, update);
    } else {
      await sbPost(SUPABASE_URL, SERVICE_ROLE, "/rest/v1/pagamentos_pendentes", pendente);
    }

    let historiaMarcada = null;
    if (temNarracao) {
      const candidatas = await sbGet(SUPABASE_URL, SERVICE_ROLE,
        `/rest/v1/historias?user_id=eq.${id}&tem_narracao=eq.false&select=id&order=criado_em.desc&limit=1`);
      if (candidatas && candidatas.length) {
        historiaMarcada = candidatas[0].id;
        await sbPatch(SUPABASE_URL, SERVICE_ROLE,
          `/rest/v1/historias?id=eq.${historiaMarcada}`, { tem_narracao: true });
      }
    }

    const pagamentoAplicado = Object.keys(update).length > 2;
    let metaPurchase = null;
    if (pagamentoAplicado && (temAssinatura || temPacote || temNarracao || temBump5)) {
      const saleId = body.sale_id || body.id || body.transaction_id || "";
      metaPurchase = await enviarMetaPurchase({
        email,
        value: valorCompra({ assinatura: temAssinatura, pacote: temPacote, bump5: temBump5, body }),
        content_name: nomeProduto({ assinatura: temAssinatura, pacote: temPacote, narracao: temNarracao }),
        event_id: saleId ? `kirvano_${saleId}` : undefined,
        ip: body.customer?.ip || body.ip || "127.0.0.1",
        user_agent: body.customer?.user_agent || "Mozilla/5.0 (compatible; HistorinhaWebhook/1.0)"
      });
    }

    return res.status(200).json({ ok: true, email, aplicado: update, historiaNarrada: historiaMarcada, metaPurchase });
  } catch (err) {
    console.error("webhook erro:", err);
    return res.status(500).json({ error: "Erro ao processar." });
  }
}

async function acharPerfil(url, key, email) {
  const porEmail = await sbGet(url, key,
    `/rest/v1/perfis?email=eq.${encodeURIComponent(email)}&select=id,creditos,email`);
  if (porEmail && porEmail[0]) return porEmail[0];

  const admin = await fetch(
    `${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: key, Authorization: "Bearer " + key } }
  );
  if (admin.ok) {
    const data = await admin.json();
    const lista = data.users || data;
    const user = Array.isArray(lista)
      ? lista.find((u) => String(u.email || "").toLowerCase() === email)
      : (data && data.email ? data : null);
    if (user && user.id) {
      const porId = await sbGet(url, key, `/rest/v1/perfis?id=eq.${user.id}&select=id,creditos,email`);
      if (porId && porId[0]) return porId[0];
      await sbPost(url, key, "/rest/v1/perfis", {
        id: user.id,
        email,
        creditos: 0,
        assinante: false,
        plano: "gratis",
        atualizado_em: new Date().toISOString()
      });
      return { id: user.id, creditos: 0, email };
    }
  }
  return null;
}

async function sbGet(url, key, path) {
  const r = await fetch(url + path, {
    headers: { apikey: key, Authorization: "Bearer " + key }
  });
  if (!r.ok) return null;
  return r.json();
}
async function sbPatch(url, key, path, data) {
  const r = await fetch(url + path, {
    method: "PATCH",
    headers: {
      apikey: key, Authorization: "Bearer " + key,
      "Content-Type": "application/json", Prefer: "return=minimal"
    },
    body: JSON.stringify(data)
  });
  return r.ok;
}
async function sbPost(url, key, path, data) {
  const r = await fetch(url + path, {
    method: "POST",
    headers: {
      apikey: key, Authorization: "Bearer " + key,
      "Content-Type": "application/json", Prefer: "return=minimal"
    },
    body: JSON.stringify(data)
  });
  return r.ok;
}
