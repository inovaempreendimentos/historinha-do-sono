// ============================================================
// NARRAÇÃO — gera o áudio da história com a voz da OpenAI (TTS)
// e guarda no Supabase Storage para não gerar de novo toda vez.
//
// Variáveis de ambiente (no Vercel):
//   OPENAI_API_KEY        -> já existe (usada na geração de texto)
//   SUPABASE_URL          -> já existe
//   SUPABASE_SERVICE_ROLE -> já existe (para gravar no storage)
// ============================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

  if (!OPENAI_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return res.status(500).json({ error: "Servidor sem configuração." });
  }

  try {
    const { historiaId, paginas, previa } = req.body || {};
    if (!historiaId || !paginas || !paginas.length) {
      return res.status(400).json({ error: "Faltam dados da história." });
    }

    // ---- MODO PRÉVIA / CINEMINHA: um áudio por página para virar junto com a voz ----
    if (previa) {
      const atePagina = parseInt(req.body.atePagina, 10);
      const limite = atePagina > 0 ? Math.min(atePagina, paginas.length) : 1;
      const fatia = paginas.slice(0, limite);

      if (req.body.porPagina) {
        const audios = await Promise.all(fatia.map(async (p) => {
          const trecho = limparTexto(p.text || p.texto || p.content || "");
          if (!trecho) return null;
          try {
            const buf = await gerarFala(OPENAI_KEY, trecho);
            return buf.toString("base64");
          } catch (e) {
            console.error("TTS página", e);
            return null;
          }
        }));
        if (!audios.some(Boolean)) return res.status(502).json({ error: "Falha ao gerar áudios." });
        return res.status(200).json({ audios, previa: true });
      }

      const trecho = fatia.map(p => limparTexto(p.text || p.texto || "")).join("\n\n... ");
      const buf = await gerarFala(OPENAI_KEY, trecho);
      return res.status(200).json({ audioBase64: buf.toString("base64"), previa: true });
    }

    // 1) se já existe o áudio guardado, só devolve a URL (não gera de novo)
    const nomeArquivo = `narracao-v2-${historiaId}.mp3`;
    const urlPublica = `${SUPABASE_URL}/storage/v1/object/public/narracoes/${nomeArquivo}`;
    const jaExiste = await fetch(urlPublica, { method: "HEAD" });
    if (jaExiste.ok) {
      return res.status(200).json({ url: urlPublica, cache: true });
    }

    // 2) monta o texto completo da narração (junta as páginas com pausas)
    const texto = paginas
      .map(p => limparTexto(p.text))
      .join("\n\n... ");  // as reticências criam uma pausa natural entre páginas

    const audioBuffer = await gerarFala(OPENAI_KEY, texto);

    // 4) guarda no Supabase Storage (bucket "narracoes")
    const upload = await fetch(
      `${SUPABASE_URL}/storage/v1/object/narracoes/${nomeArquivo}`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + SERVICE_ROLE,
          apikey: SERVICE_ROLE,
          "Content-Type": "audio/mpeg",
          "x-upsert": "true"
        },
        body: audioBuffer
      }
    );

    if (!upload.ok) {
      const err = await upload.text();
      console.error("Storage erro:", err);
      // mesmo se falhar o upload, devolvemos o áudio direto (base64) como plano B
      return res.status(200).json({
        audioBase64: audioBuffer.toString("base64"),
        semCache: true
      });
    }

    // 5) marca a história como tendo narração (tem_narracao = true)
    await fetch(`${SUPABASE_URL}/rest/v1/historias?id=eq.${historiaId}`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + SERVICE_ROLE,
        apikey: SERVICE_ROLE,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ tem_narracao: true })
    });

    return res.status(200).json({ url: urlPublica });
  } catch (err) {
    console.error("narrar erro:", err);
    return res.status(500).json({ error: "Erro ao gerar narração." });
  }
}

const INSTRUCAO_NINAR = `Você é uma contadora de histórias infantis brasileira, à beira da cama.
Fale em português do Brasil, com carinho, voz baixa e pausas naturais.
Não soe como locutora de GPS nem como tradutor automático.
Tom quente, um pouco lento, como quem está ninando uma criança.`;

async function gerarFala(apiKey, texto) {
  const tts = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: texto,
      instructions: INSTRUCAO_NINAR
    })
  });
  if (tts.ok) return Buffer.from(await tts.arrayBuffer());

  const fallback = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "tts-1-hd",
      voice: "nova",
      input: texto,
      speed: 0.88
    })
  });
  if (!fallback.ok) {
    const err = await fallback.text();
    throw new Error(err || "Falha no TTS");
  }
  return Buffer.from(await fallback.arrayBuffer());
}
  return String(txt)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
