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

    // ---- MODO PRÉVIA: gera só um trechinho (primeira página), não guarda em cache ----
    // é barato (uma fração do custo da narração completa) e serve pra mãe
    // ouvir "como fica" antes de comprar a versão inteira.
    if (previa) {
      const trecho = limparTexto(paginas[0].text).split(" ").slice(0, 28).join(" ");
      const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: "Bearer " + OPENAI_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tts-1", voice: "nova", input: trecho, speed: 0.92 })
      });
      if (!ttsResp.ok) return res.status(502).json({ error: "Falha ao gerar prévia." });
      const buf = Buffer.from(await ttsResp.arrayBuffer());
      return res.status(200).json({ audioBase64: buf.toString("base64"), previa: true });
    }

    // 1) se já existe o áudio guardado, só devolve a URL (não gera de novo)
    const nomeArquivo = `narracao-${historiaId}.mp3`;
    const urlPublica = `${SUPABASE_URL}/storage/v1/object/public/narracoes/${nomeArquivo}`;
    const jaExiste = await fetch(urlPublica, { method: "HEAD" });
    if (jaExiste.ok) {
      return res.status(200).json({ url: urlPublica, cache: true });
    }

    // 2) monta o texto completo da narração (junta as páginas com pausas)
    const texto = paginas
      .map(p => limparTexto(p.text))
      .join("\n\n... ");  // as reticências criam uma pausa natural entre páginas

    // 3) gera o áudio com a OpenAI (voz "nova" — suave e acolhedora)
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENAI_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "nova",          // voz feminina suave; boa para ninar
        input: texto,
        speed: 0.92             // um pouco mais devagar, tom de história de ninar
      })
    });

    if (!ttsResp.ok) {
      const err = await ttsResp.text();
      console.error("OpenAI TTS erro:", err);
      return res.status(502).json({ error: "Falha ao gerar o áudio." });
    }

    const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());

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

// remove emojis do texto (a voz não deve "ler" emoji)
function limparTexto(txt) {
  return String(txt)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
