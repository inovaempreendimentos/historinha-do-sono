// ============================================================
// WEBHOOK DO KIRVANO
// Recebe o aviso do Kirvano quando alguém paga, confere que é
// verdadeiro, e libera o acesso da mãe no Supabase (adiciona
// créditos ou marca como assinante).
//
// Variáveis de ambiente necessárias no Vercel (nunca no código):
//   SUPABASE_URL          -> a URL do seu projeto Supabase
//   SUPABASE_SERVICE_ROLE -> a chave service_role (secreta!)
//   KIRVANO_TOKEN         -> um token que VOCÊ inventa e coloca
//                            também no painel do Kirvano, para
//                            confirmar que o aviso é legítimo
// ============================================================

// os offer_id de cada produto no Kirvano (parte final do link de checkout)
const OFERTA_ASSINATURA = "baee13d4-4b07-432a-8d1b-26ad1e64a515";
const OFERTA_PACOTE     = "02e33bab-929d-4b40-a97a-1fd0848893da";
const OFERTA_PACOTE_OLD = "b95a04be-5c48-4f14-a9c1-3dd5d587b39e"; // link antigo (ainda libera se alguém pagar)
const OFERTA_NARRACAO   = "ef28e79f-c76d-40f6-a503-dc252129940d";
// order bumps (preencher quando criar no Kirvano)
const OFERTA_BUMP_5     = ""; // +5 historinhas
const OFERTA_BUMP_3     = ""; // +3 historinhas (irmão)

const CREDITOS_PACOTE     = 10;
const CREDITOS_ASSINATURA = 15;
const CREDITOS_BUMP_5     = 5;
const CREDITOS_BUMP_3     = 3;

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

  // 1) SEGURANÇA: confere o token que o Kirvano manda no cabeçalho.
  //    Só aceita o aviso se o token bater com o que você configurou.
  if (KIRVANO_TOKEN) {
    const tokenRecebido = req.headers["security-token"] || req.headers["token"] || "";
    if (tokenRecebido !== KIRVANO_TOKEN) {
      return res.status(401).json({ error: "Token inválido." });
    }
  }

  try {
    const body = req.body || {};
    const event = body.event;

    // só nos interessa compra aprovada e renovação de assinatura
    const eventosDeLiberacao = ["SALE_APPROVED", "SUBSCRIPTION_RENEWED"];
    if (!eventosDeLiberacao.includes(event)) {
      // outros eventos (pix gerado, recusado etc.) a gente só confirma o recebimento
      return res.status(200).json({ ok: true, ignorado: event });
    }

    const email = (body.customer && body.customer.email || "").toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: "Sem e-mail do comprador." });
    }

    // descobre qual produto foi comprado (pelo offer_id)
    const produtos = body.products || [];
    const offerIds = produtos.map(p => p.offer_id).filter(Boolean);
    const temAssinatura = offerIds.includes(OFERTA_ASSINATURA);
    const temPacote = offerIds.includes(OFERTA_PACOTE) || offerIds.includes(OFERTA_PACOTE_OLD);
    const temNarracao = offerIds.includes(OFERTA_NARRACAO);
    const temBump5 = OFERTA_BUMP_5 && offerIds.includes(OFERTA_BUMP_5);
    const temBump3 = OFERTA_BUMP_3 && offerIds.includes(OFERTA_BUMP_3);

    let creditosCompra = 0;
    if (temPacote) creditosCompra += CREDITOS_PACOTE;
    if (temBump5) creditosCompra += CREDITOS_BUMP_5;
    if (temBump3) creditosCompra += CREDITOS_BUMP_3;
    // assinatura define créditos do mês (não soma pacote no mesmo fluxo, a não ser bumps)
    if (temAssinatura && !temPacote) creditosCompra = Math.max(creditosCompra, CREDITOS_ASSINATURA);

    // 2) acha o usuário no Supabase pelo e-mail (na tabela perfis)
    const perfil = await sbGet(SUPABASE_URL, SERVICE_ROLE,
      `/rest/v1/perfis?email=eq.${encodeURIComponent(email)}&select=id,creditos`);

    if (!perfil || !perfil.length) {
      // a mãe pagou mas ainda não tem conta no app com esse e-mail.
      // registramos para liberar quando ela criar a conta (evita perder a venda).
      await sbPost(SUPABASE_URL, SERVICE_ROLE, "/rest/v1/pagamentos_pendentes", {
        email,
        assinatura: temAssinatura,
        creditos: temAssinatura ? Math.max(CREDITOS_ASSINATURA, creditosCompra) : creditosCompra,
        narracao: temNarracao,
        criado_em: new Date().toISOString()
      });
      return res.status(200).json({ ok: true, pendente: true, email });
    }

    const id = perfil[0].id;
    const creditosAtuais = perfil[0].creditos || 0;

    // 3) monta a atualização conforme o que foi comprado
    const update = { atualizado_em: new Date().toISOString() };
    if (temAssinatura) {
      update.assinante = true;
      update.plano = "assinante";
      update.creditos = Math.max(CREDITOS_ASSINATURA, creditosAtuais) + (temBump5 ? CREDITOS_BUMP_5 : 0) + (temBump3 ? CREDITOS_BUMP_3 : 0);
    } else if (creditosCompra > 0) {
      update.creditos = creditosAtuais + creditosCompra;
    }

    if (Object.keys(update).length > 1) {
      await sbPatch(SUPABASE_URL, SERVICE_ROLE, `/rest/v1/perfis?id=eq.${id}`, update);
    }

    // 4) narração: marca a história mais recente dessa mãe que ainda não
    // tem narração como "paga" — é o que o app usa pra confirmar de verdade
    // antes de tocar automaticamente (não confia só no que o navegador acha)
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

    return res.status(200).json({ ok: true, email, aplicado: update, historiaNarrada: historiaMarcada });
  } catch (err) {
    console.error("webhook erro:", err);
    return res.status(500).json({ error: "Erro ao processar." });
  }
}

// ---- helpers para falar com o Supabase via API REST ----
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
