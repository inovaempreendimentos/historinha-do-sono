// Função serverless (roda no servidor do Vercel, nunca no navegador).
// A chave da OpenAI fica na variável de ambiente OPENAI_API_KEY,
// configurada no painel do Vercel — nunca aparece no código do site.

export default async function handler(req, res) {
  // só aceita POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Chave da OpenAI não configurada no servidor." });
  }

  try {
    const { nome, idade, genero, tema, licao, detalhe, leitor } = req.body || {};

    if (!nome || !tema) {
      return res.status(400).json({ error: "Faltam dados da história." });
    }

    const pronome = genero === "Menina" ? "ela" :
                    genero === "Menino" ? "ele" :
                    "linguagem neutra (evite pronomes de gênero)";

    // ajusta o tamanho da história pela idade (sem perguntar nada a mais pra mãe)
    let paginas = 8, palavras = "35 a 55", estiloIdade = "linguagem clara e envolvente";
    if (idade && idade.includes("0-4")) {
      paginas = 5; palavras = "20 a 35";
      estiloIdade = "frases bem curtas, muita repetição rítmica, palavras simples";
    } else if (idade && idade.includes("8-10")) {
      paginas = 9; palavras = "45 a 65";
      estiloIdade = "mais camadas na aventura, algum humor, vocabulário um pouco mais rico";
    }

    const prompt = `Você é uma autora premiada de literatura infantil brasileira. Escreva uma história de ninar em português do Brasil.

DADOS:
- Nome da criança (protagonista): ${nome}
- Idade: ${idade || "5 a 7 anos"}
- Gênero/pronome: ${genero || "neutro"} (${pronome})
- Mundo/tema: ${tema}
- Lição a ensinar (sutil, sem sermão): ${licao || "coragem"}
- Detalhe especial para incluir: ${detalhe || "nenhum"}
- Quem vai ler: ${leitor || "quem ama a criança"}

REGRAS:
- Exatamente ${paginas} páginas. Cada página com ${palavras} palavras.
- O nome ${nome} deve aparecer em pelo menos ${Math.max(4, paginas - 2)} páginas.
- Linguagem adequada à idade: ${estiloIdade}.
- A lição aparece pelas AÇÕES do personagem, nunca como moral explícita.
- As 2 últimas páginas desaceleram: tom calmo, bocejos, olhinhos pesados; a última termina com ${nome} dormindo e um "boa noite".
- Para cada página, escolha 2 ou 3 emojis que ilustrem a cena.
- Crie um título encantador curto e uma dedicatória de 1 frase assinada por "${leitor || "quem ama a criança"}".

RESPONDA APENAS com JSON válido, sem markdown, sem crases, neste formato exato:
{"title":"...","dedication":"...","pages":[{"text":"...","emojis":"🦖🌋⭐"}]}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        max_tokens: 1200,
        response_format: { type: "json_object" }
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("Erro OpenAI:", errText);
      return res.status(502).json({ error: "A fada-escritora tropeçou. Tente de novo." });
    }

    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || "";
    let story;
    try {
      story = JSON.parse(content);
    } catch (e) {
      // fallback: tenta extrair o JSON de dentro do texto
      const s = content.indexOf("{"), en = content.lastIndexOf("}");
      story = JSON.parse(content.substring(s, en + 1));
    }

    if (!story.pages || story.pages.length < 4) {
      return res.status(502).json({ error: "História incompleta. Tente de novo." });
    }

    return res.status(200).json(story);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao gerar a história." });
  }
}
