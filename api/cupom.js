// Cupom de teste 100% — valida no servidor (não fica só no HTML).
// Código padrão: SONO100
// Pode sobrescrever no Vercel com CUPON_TESTE.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const codigoOk = (process.env.CUPON_TESTE || "SONO100").trim().toUpperCase();
  const codigo = String((req.body && req.body.codigo) || "").trim().toUpperCase();
  if (!codigo || codigo !== codigoOk) {
    return res.status(400).json({ error: "Cupom inválido." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  // Sem login: o front desbloqueia a história atual. Com login: dá 1 crédito.
  if (!token || !SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(200).json({ ok: true, credito: false });
  }

  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: "Bearer " + token, apikey: SERVICE_ROLE }
    });
    if (!userResp.ok) {
      return res.status(200).json({ ok: true, credito: false });
    }
    const user = await userResp.json();
    const id = user.id;
    if (!id) return res.status(200).json({ ok: true, credito: false });

    const perfilResp = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis?id=eq.${id}&select=id,creditos`,
      { headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE } }
    );
    const perfil = perfilResp.ok ? await perfilResp.json() : [];
    const atuais = (perfil[0] && perfil[0].creditos) || 0;

    await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: "Bearer " + SERVICE_ROLE,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        creditos: atuais + 1,
        atualizado_em: new Date().toISOString()
      })
    });

    return res.status(200).json({ ok: true, credito: true });
  } catch (err) {
    console.error("cupom", err);
    return res.status(200).json({ ok: true, credito: false });
  }
}
