# Historinha do Sono — como publicar

Este projeto tem 2 partes:
- `index.html` — o site (roda no navegador)
- `api/gerar.js` — a função que chama a OpenAI com segurança (roda no servidor do Vercel)

A sua chave da OpenAI **nunca** fica no código. Ela vai numa configuração
segura do Vercel (variável de ambiente). Siga os passos abaixo.

---

## PASSO 1 — Criar o repositório no GitHub

1. Entre em https://github.com e faça login.
2. Clique no **+** no canto superior direito → **New repository**.
3. Nome: `historinha-do-sono`. Deixe **Public** ou **Private** (tanto faz).
   NÃO marque nenhuma opção de README/gitignore (já temos os arquivos).
4. Clique em **Create repository**.
5. Na tela seguinte, clique em **"uploading an existing file"**
   (link no meio da página).
6. Arraste TODOS os arquivos e a pasta `api` desta pasta para lá:
   - index.html
   - package.json
   - .gitignore
   - a pasta `api` inteira (com o gerar.js dentro)
7. Clique em **Commit changes**.

---

## PASSO 2 — Conectar no Vercel

1. Entre em https://vercel.com → **Add New… → Project**.
2. Ache o repositório `historinha-do-sono` na lista e clique **Import**.
   (Se não aparecer, clique em "Adjust GitHub App Permissions" e
    autorize o Vercel a ver esse repositório.)
3. NÃO mude nenhuma configuração de build. Só falta uma coisa: a chave.

---

## PASSO 3 — Colocar a chave da OpenAI (o passo mais importante)

Ainda na tela de import (ou depois em Settings → Environment Variables):

1. Procure a seção **Environment Variables**.
2. Adicione:
   - **Key (nome):** `OPENAI_API_KEY`
   - **Value (valor):** cole aqui a sua chave da OpenAI (começa com `sk-...`)
3. Clique em **Add**.
4. Agora clique em **Deploy**.

Espere 1 minuto. Pronto — o site sobe com a IA funcionando de verdade.

---

## Se já tinha o projeto no ar e quer só atualizar

Como agora está ligado ao GitHub, é automático: qualquer arquivo que você
atualizar no repositório do GitHub, o Vercel republica sozinho em segundos.

---

## PASSO 4 — Ligar o pagamento (quando quiser vender)

No arquivo `index.html`, lá no começo do `<script>`, troque:

    const CHECKOUT_URL = "https://SEU-LINK-DE-CHECKOUT-AQUI.com";

pelo seu link de checkout real (Kirvano, Cakto, Hotmart, Stripe...).
Salve, suba no GitHub, e o Vercel atualiza sozinho.

---

## Custo da OpenAI

O modelo usado é o `gpt-4o-mini` (barato). Cada história custa uma fração
de centavo. Você recebe créditos/limites da própria OpenAI — acompanhe o
uso no painel https://platform.openai.com/usage.

Dica de segurança: no painel da OpenAI, em "Limits", coloque um limite
mensal de gasto (ex.: US$ 5) para nunca ter surpresa na fatura.
