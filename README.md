# Vida Mágica

App de jornada de prosperidade da Suellen e Renato Seragi. Backend Express + WebSocket nativo (`ws`) que serve a API REST, o WebSocket de chat e o frontend estático (HTML/CSS/JS direto, sem build step).

---

## Quem usa o sistema

O app tem 3 públicos distintos, com URLs e auth separados:

| Público | URL | Auth | Pra quê |
|---|---|---|---|
| **Aluna** | `/app` | JWT Bearer (15 min) + refresh token (30 dias) | Acompanha jornada, faz teste do subconsciente, conversa com atendimento, assiste vídeos exclusivos |
| **Atendimento** | `/atendimento` | OTP via WhatsApp → JWT painel (30 dias) com `escopo='atendimento'` | Conversa com alunas, libera produtos cortesia, vê jornada de cada aluna |
| **Admin** | `/admin` | OTP via WhatsApp → JWT painel (30 dias) com `escopo='admin'` | Gerencia preços, feed de vídeos, depoimentos, gateway WhatsApp, templates de mensagens |

A "antessala" de chat (`/app` → "Fale com a Su") é uma view própria, separada da conversa em si. Só ao clicar em "Falar com a Suellen" ou "Dúvidas e suporte" é que entra no chat real (com suas regras especiais de layout, teclado dinâmico, etc.).

---

## Stack

- **Node.js >= 18** (definido em `engines`)
- **Express 4** — servidor HTTP
- **ws 8** — WebSocket nativo, sem socket.io
- **pg 8** — Postgres direto (4 pools separados)
- **JWT** — todos os tokens (aluna, painel, WS) assinados com `JWT_SECRET`
- **axios** — chamadas HTTP externas (Evolution API, Brevo, Cloudinary)
- **web-push** — notificações push pro painel de atendimento
- **bcrypt** — hash de senha das alunas
- **Cloudinary** — upload de imagens/áudio do chat
- **Brevo** — envio de e-mail transacional

**Sem build step no frontend.** Os HTMLs em `public/` são servidos direto. CSS e JS sem bundler. Mantemos assim de propósito — simplicidade pra deploy e debug.

---

## Arquitetura

### 1. Quatro bancos Postgres separados

`db.js` expõe 4 pools. Cada módulo importa o pool específico que precisa. **Nunca cruzar com JOIN entre bancos** — cruzamento é feito em código JS.

| Pool | Conteúdo |
|---|---|
| `poolCore` | Identidade (`usuarios`), sessões, dispositivos, produtos liberados, atualizações pendentes |
| `poolTeste` | "Teste do Subconsciente" — leads, respostas, perfis, versões |
| `poolMensagens` | Chat aluna ↔ atendimento (`chat_conversas`, `chat_mensagens`, `chat_pacotes`, `chat_push_subscriptions`) |
| `poolComunicacao` | `fila_mensagens`, `gateway_*`, `templates_mensagens`, `feed`, `jornadas_*`, `precos`, `teste_perfis_conteudo`, `depoimentos` |

`usuario_id` em outros bancos é referência **lógica** (sem FK física). `telefone_canonico` é chave alternativa.

Schema é criado com `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` em `db.js`. Roda no boot via `initDb()`. Pra adicionar coluna nova, adicione um `ALTER TABLE ... IF NOT EXISTS` — não edite o `CREATE TABLE` original.

### 2. Três níveis de autenticação (`middleware/autenticar.js`)

1. **`autenticar`** — JWT Bearer da aluna (access token de 15 min, claim `sub = usuario.id`). Refresh tokens vivem em `poolCore` (sessões/dispositivos).
2. **`autenticarPainel(escopo)`** — JWT do painel (30 dias). Valida `role='admin'`, `escopo` exato (`'admin'` ou `'atendimento'`), e checa `sid` contra `sessoes_admin` no banco (revogação real).
3. **`autenticarPainelHibrido`** — aceita ambos os escopos. Usado em endpoints compartilhados (ex: produtos/jornada da aluna acessados tanto pelo admin quanto pelo atendimento).

Login do painel é por **OTP via WhatsApp** (`routes/admin-auth.js`), não senha.

### 3. Gateway de WhatsApp (`core/gateway.js`)

**Tudo que sai pelo WhatsApp passa por esse gateway**, exceto o chat aluna↔atendimento (que é interno via WebSocket).

- Trabalha por **"atendimento"** — sequência de 1+ mensagens pro mesmo destinatário, mesmo motivo
- **Cooldowns separados** pra reativos vs ativos, configuráveis via `gateway_config` (cache de 30s)
- **Categorias pausáveis** via `gateway_categorias` (cache de 30s)
- **Limite diário** pra mensagens ativas
- **Worker em loop** iniciado em `server.js` depois do `initDb()`, parado em `SIGTERM`/`SIGINT`
- `core/whatsapp.js` é a camada baixa (Evolution API HTTP direto) — só chame se quiser bypass do gateway de propósito (raro)

**Webhook de entrada:** `POST /webhook/evolution` — transforma WhatsApp entrante em magic link de login.

### 4. WebSocket de chat (`/ws/chat`)

Upgrade handler em `server.js` autentica via query string (`?token=...&modo=aluna|atendimento`) e delega registro pra `routes/chat.js`. Heartbeat ping/pong a cada 30s.

JWT do painel pode vir no formato novo (`role='admin'` + `escopo='atendimento'`) ou legado (`role='atendimento'|'suellen'`).

### 5. Roteamento de páginas

`server.js` define rotas "amigáveis" que devolvem HTML estático:
- `/atendimento` → `public/atendimento.html`
- `/admin` → `public/admin.html`
- `/auth` → `public/auth.html`
- `/cadastro` → `public/cadastro.html`
- `/teste` → `public/teste.html`
- `/termos` → `public/termos.html`
- `/resultado/:id` → `public/resultado.html`
- `/app[/dashboard|perfil|chat|loja|sementes]` → `public/app.html` (via regex)

Depois disso: `express.static('public')`, 404 JSON em `/api/*`, e por fim SPA fallback (`*` → `index.html`).

A área `/app` é uma mini-SPA com views (Home, Materiais, Antessala/Fale com a Su, Vídeos, Perfil, Chat) controladas via JS — sem framework, só classes `.view.active` e a função `irPara(viewId)`.

### 6. Conceitos do produto

- **Teste do Subconsciente** — 15 perguntas, calcula perfil dominante (medo, desordem, validação, sobrevivência, prosperidade nv1-3). Lógica em `core/teste-resultado.js`.
- **Jornadas do Método** — 3 jornadas de prosperidade calculadas a partir do perfil + produtos comprados. Lógica em `core/jornadas.js` (fonte da verdade).
- **Clube Vida Mágica** — assinatura. Fonte da verdade: `usuarios.plano !== 'gratuito'`. Função `temClubeVidaMagica()` em `core/jornadas.js`.
- **Tesouro da Su** — mensagem/áudio diário pra aluna, registrado em `poolMensagens`.
- **Feed do App** — player principal de vídeo no topo do `/app` + grade "Netflix" em `/app/videos`. Conteúdo cadastrado em `/admin` → Feed do App. Só 1 item pode estar com **"Player Principal"** ativo por vez.
- **Sementes** — moeda virtual da aluna (`usuarios.sementes`), ganha em interações com o app.

---

## Frontend `/app` — mini-SPA

Views (em `public/app.html`):

| View | ID | Descrição |
|---|---|---|
| Início | `view-home` | Player do topo + saudação + barra de jornada + Tesouro da Su + Trilha de passos |
| Materiais | `view-produtos` | Lista de produtos comprados/liberados |
| Fale com a Su (antessala) | `view-fale-com-a-su` | Tela de escolha entre Suellen e Suporte |
| Chat | `view-chat` | Conversa real (com regras especiais de layout) |
| Vídeos | `view-videos` | Grade Netflix com vídeos exclusivos do feed |
| Perfil | `view-perfil` | Dados da aluna + ações |

Navegação via `irPara(viewId)`. View atual persiste em `sessionStorage` (sobrevive a pull-to-refresh).

### Player do topo (vídeo do feed)

- Em `public/app/app.js`, função `carregarPlayerTopo(ctx)`
- Mostra o item do feed com `destaque=true` (só 1 ativo por vez — backend garante via `routes/feed.js`)
- Suporta YouTube e Vimeo (Vimeo é melhor pra blindar link, ver "Limitações conhecidas")
- Pra **não-assinante**: cadeado dourado no centro, click abre modal de venda do Clube
- Pra **assinante** (`ctx.tem_clube === true`): play normal, abre iframe inline

### Partículas (sprites)

`criarParticulas()` em `app.js` — bolinhas douradas que sobem pela tela. **Marca registrada**.

- **Não-assinante:** 22 partículas douradas com glow moderado
- **Assinante** (body com classe `clube-ativo`): +24 partículas extras maiores e com glow forte ("chuva de ouro"). A class `clube-ativo` é adicionada em `hidratarHome` quando `ctx.tem_clube === true`.

---

## Convenções do código

- Todos os arquivos começam com um banner `/* === VIDA MÁGICA — <arquivo> === ... === */` descrevendo propósito, bancos usados e regras críticas. **Mantenha esse padrão ao criar arquivos novos.**
- Português em nomes de tabelas, colunas, variáveis e mensagens de log.
- Logs com emojis como prefixo de severidade: `🚀` start, `✅` ok, `❌` erro, `⚠️` warning, `💥` crash. Manter o estilo.
- Routers Express são montados em `server.js`. Rotas novas: crie `routes/<nome>.js` exportando um `Router` e monte com `app.use('/api/...', require('./routes/<nome>'))`.
- `routes/chat.js` é especial — exporta `{ routerAluna, routerAtendimento, registrarWsAluna, registrarWsAtendimento }`.

---

## Comandos

```bash
npm run dev      # roda com nodemon (hot reload), porta 3000 ou $PORT
npm start        # produção (node server.js)
```

**Não há suite de testes nem linter** configurados. Não invente comandos de teste/lint.

---

## Variáveis de ambiente

Ver `.env.example` na raiz pra a lista completa com comentários. Resumo:

- **`DATABASE_URL`** + `DATABASE_URL_TESTE` + `DATABASE_URL_MENSAGENS` + `DATABASE_URL_COMUNICACAO` — os 4 Postgres
- **`JWT_SECRET`** — assina todos os tokens
- **`EVOLUTION_URL`** + `EVOLUTION_API_KEY` + `EVOLUTION_INSTANCE` — API do WhatsApp
- **`VAPID_PUBLIC_KEY`** + `VAPID_PRIVATE_KEY` + `VAPID_EMAIL` — web push pro painel
- **`CLOUDINARY_*`** — upload de imagens/áudio
- **`BREVO_API_KEY`** — e-mail transacional
- **`NODE_ENV=production`** — ativa SSL (`rejectUnauthorized: false`) nos pools

---

## Deploy

**Alvo:** Railway (`vidamagica-production.up.railway.app`).

**Fluxo:**
1. Atualizar arquivos localmente
2. Subir pro GitHub (cópia/cola via interface, ou git push)
3. Railway detecta automaticamente e faz deploy (1-2 minutos)
4. Status visível em `railway.app/project/.../deployments`

**Origins CORS** estão hardcoded em `server.js` — se mudar de domínio, atualizar lá.

Não há ambiente de staging. O código que está no GitHub na branch principal vai direto pra produção.

---

## Limitações conhecidas

### YouTube embed
- Não permite esconder 100% o botão "Compartilhar" nem o logo "YouTube" do player
- Algumas configurações de canal/vídeo bloqueiam embed com erro 153
- Long-press no iOS pode oferecer compartilhar (URL exposta)
- Pra blindar de verdade, **trocar pra Vimeo Pro** (com domain restriction) ou Cloudflare Stream

### iOS Safari
- `background-attachment: fixed` é tratado como `scroll`
- `overflow: hidden` no body nem sempre trava scroll — preciso `position: fixed` em alguns casos
- Pull-to-refresh é nativo, bloquear é tricky (precisa `overscroll-behavior: none` + às vezes mais)

### Pagamentos
- ⚠️ Gateway de pagamento **ainda não está implementado** — todos os testes são considerados "pagos" via flag `|| true` em `routes/app.js` linhas 164 e 337. **Remover esse override quando o webhook do Kiwify entrar em produção.**

### Múltiplos canais
- A coluna `chat_conversas.tipo` aceita `'suellen'` ou `'suporte'`. Adicionar canal novo requer ajustes em `routes/chat.js`, `atendimento.html` e WS de atendimento.

---

## Documentação relacionada

- **`CLAUDE.md`** — instruções pro Claude (assistant) quando trabalhar nesse projeto. Carregado automaticamente em conversas.
- **`db.js`** — schema dos 4 bancos (verdade absoluta da estrutura)
- **`core/jornadas.js`** — regras das 3 jornadas e cálculo de Clube
- **`core/gateway.js`** — gateway de WhatsApp (cooldowns, fila, categorias)
- **`routes/app.js`** — endpoint `/api/app/contexto` que alimenta TODAS as telas do `/app`. Princípio: nenhuma tela calcula nada, o contexto é a verdade.
