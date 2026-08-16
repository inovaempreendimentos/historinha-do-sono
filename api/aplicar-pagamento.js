// Aplica pagamentos_pendentes do Kirvano quando a mãe cria/entra na conta
// com o mesmo e-mail da compra.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!SUPABASE_URL || !SERVICE_ROLE || !token) {
    return res.status(401).json({ error: "Sem sessão." });
  }

  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: "Bearer " + token, apikey: SERVICE_ROLE }
    });
    if (!userResp.ok) return res.status(401).json({ error: "Sessão inválida." });
    const user = await userResp.json();
    const email = (user.email || "").toLowerCase().trim();
    const id = user.id;
    if (!email || !id) return res.status(400).json({ error: "Usuário sem e-mail." });

    const pendResp = await fetch(
      `${SUPABASE_URL}/rest/v1/pagamentos_pendentes?email=eq.${encodeURIComponent(email)}&select=*`,
      { headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE } }
    );
    if (!pendResp.ok) return res.status(200).json({ ok: true, aplicados: 0 });
    const pendentes = await pendResp.json();
    if (!pendentes.length) return res.status(200).json({ ok: true, aplicados: 0 });

    const perfilResp = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis?id=eq.${id}&select=id,creditos,assinante`,
      { headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE } }
    );
    const perfil = perfilResp.ok ? await perfilResp.json() : [];
    let creditos = (perfil[0] && perfil[0].creditos) || 0;
    let assinante = !!(perfil[0] && perfil[0].assinante);
    let narracao = false;

    for (const p of pendentes) {
      if (p.assinatura) {
        assinante = true;
        creditos = Math.max(creditos, p.creditos || 15);
      } else if (p.creditos) {
        creditos += p.creditos;
      }
      if (p.narracao) narracao = true;
    }

    const update = {
      creditos,
      assinante,
      plano: assinante ? "assinante" : undefined,
      atualizado_em: new Date().toISOString()
    };
    if (!update.plano) delete update.plano;

    await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: "Bearer " + SERVICE_ROLE,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(update)
    });

    if (narracao) {
      const cand = await fetch(
        `${SUPABASE_URL}/rest/v1/historias?user_id=eq.${id}&tem_narracao=eq.false&select=id&order=criado_em.desc&limit=1`,
        { headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE } }
      );
      const rows = cand.ok ? await cand.json() : [];
      if (rows[0]) {
        await fetch(`${SUPABASE_URL}/rest/v1/historias?id=eq.${rows[0].id}`, {
          method: "PATCH",
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: "Bearer " + SERVICE_ROLE,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify({ tem_narracao: true })
        });
      }
    }

    const ids = pendentes.map(p => p.id).filter(Boolean);
    if (ids.length) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/pagamentos_pendentes?id=in.(${ids.join(",")})`,
        {
          method: "DELETE",
          headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE }
        }
      );
    }

    return res.status(200).json({ ok: true, aplicados: pendentes.length, creditos, assinante });
  } catch (err) {
    console.error("aplicar-pagamento", err);
    return res.status(500).json({ error: "Erro ao aplicar pagamento." });
  }
}
