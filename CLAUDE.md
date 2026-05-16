# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — roda o servidor com nodemon (hot reload). Porta padrão `3000`, sobrescrita por `PORT`.
- `npm start` — roda em produção (`node server.js`).
- Não há suite de testes nem linter configurados. Não invente comandos de teste/lint.
- Node `>=18` é obrigatório (definido em `engines`).

## Variáveis de ambiente necessárias

O servidor depende de `dotenv` (`.env` na raiz). Sem essas variáveis, partes do app falham silenciosamente ou no startup:

- `DATABASE_URL`, `DATABASE_URL_TESTE`, `DATABASE_URL_MENSAGENS`, `DATABASE_URL_COMUNICACAO` — **quatro Postgres separados**.
- `JWT_SECRET` — assina todos os tokens (aluna, painel, WS). Sem ele há um default inseguro com warning.
- `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` — API Evolution (WhatsApp), lidas em `core/whatsapp.js`.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` — web push pro painel de atendimento.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — uploads de áudio/imagem do chat (`routes/upload.js:25`).
- `BREVO_API_KEY`, `SENDER_EMAIL` — e-mail transacional (`routes/auth.js:70`). `SENDER_EMAIL` default: `sistema@suellenseragi.com.br`.
- `APP_URL` — base usada em magic links e e-mails (default `https://www.vidamagica.com.br`).
- `WA_COMUNIDADE_NUMERO` — número da comunidade no WhatsApp (default `5562999884411`).
- `NODE_ENV=production` ativa SSL (`rejectUnauthorized: false`) nos pools. Rodando local, **não defina** `NODE_ENV=production` — evita warnings de TLS contra Postgres local.

Deploy alvo: Railway (`vidamagica-production.up.railway.app`). Origins CORS estão hardcoded em `server.js:55-66` (Railway, Vercel, vidamagica.com.br + localhost 3000/5173).

## Arquitetura (visão macro)

Backend Express monolítico + WebSocket nativo (`ws`) servindo tanto API REST quanto o frontend estático (`public/`). O frontend são páginas HTML estáticas (não há build step) que falam com a API por fetch e WS.

### Helmet "afrouxado" de propósito (não conserte!)

Em `server.js:39-48`, o helmet roda com `contentSecurityPolicy: false`, `permissionsPolicy: false`, `crossOriginOpenerPolicy: false`, `crossOriginResourcePolicy: false` e `referrerPolicy: 'strict-origin-when-cross-origin'`. **Isso é intencional** — sem essas exceções, o YouTube/Vimeo bloqueia o embed dentro do `/app` (erro 153 "Erro de configuração do player"), porque ele exige o header `Referer` com a origem e isolamento cross-origin frouxo. Há também um header manual `Permissions-Policy: microphone=(self), camera=(self), autoplay=*, fullscreen=*` em `server.js:49-52` pra liberar fullscreen em iframes. **Não "endureça" esses defaults sem testar embed de vídeo.**

### Quatro bancos Postgres — regra crítica

`db.js` expõe **quatro pools separados**, e o resto do código importa o pool específico de que precisa. **Nunca crie um pool genérico** nem faça JOIN entre bancos:

| Pool             | Conteúdo                                                            |
|------------------|---------------------------------------------------------------------|
| `poolCore`       | identidade (`usuarios`), financeiro, produtos, comunidade           |
| `poolTeste`      | "Teste do Subconsciente" — leads, respostas, perfis                 |
| `poolMensagens`  | chat aluna ↔ atendimento (`chat_conversas`, `chat_mensagens`, etc.) |
| `poolComunicacao`| `fila_mensagens`, `gateway_*`, `templates_mensagens`, CRM, conteúdo |

Cruzamento entre bancos é feito em código JS, não em SQL. `usuario_id` em outros bancos é referência **lógica** (sem FK). `telefone_canonico` é chave alternativa onipresente.

Todo schema é criado com `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` em `db.js` — migrations são idempotentes e rodam no boot via `initDb()`. Para adicionar coluna nova, adicione um `ALTER TABLE ... IF NOT EXISTS` em vez de editar o `CREATE TABLE`.

### Três níveis de autenticação (`middleware/autenticar.js`)

1. **`autenticar`** — JWT Bearer da aluna (access token de 15 min). Refresh tokens vivem em `poolCore` (sessões/dispositivos).
2. **`autenticarPainel(escopo)`** — JWT do painel admin/atendimento (30 dias). Valida `role='admin'`, `escopo` exato (`'admin'` ou `'atendimento'`), e checa `sid` contra `sessoes_admin` no banco (revogação real). Use `autenticarPainelHibrido` quando o endpoint precisa servir os dois escopos (ex: jornadas/produtos da aluna).
3. **Legados** (`autenticarAdmin` Basic, `autenticarAtendimento` JWT antigo) — só pra retrocompatibilidade, não use em código novo.

Login do painel é por **OTP via WhatsApp** (`routes/admin-auth.js`), não senha.

### Gateway de WhatsApp (`core/gateway.js`)

**Tudo que sai pelo WhatsApp passa pelo gateway**, exceto o chat aluna↔atendimento interno do app. O gateway:

- Trabalha por **"atendimento"** (sequência de mensagens pro mesmo destinatário, mesmo motivo).
- Cooldowns separados pra **reativos** vs **ativos**, configuráveis via `gateway_config` (cache de 30s) — editável pelo painel admin em `/admin`.
- **Categorias pausáveis** via `gateway_categorias` (cache de 30s) — também editáveis pelo painel admin.
- **Limite diário** pra mensagens ativas.
- Worker em loop iniciado em `server.js` após `initDb()`; parado em `SIGTERM`/`SIGINT`.
- `core/whatsapp.js` é a camada baixa (Evolution API HTTP direto) — só chame se quiser bypass do gateway de propósito (raro).

**Webhook de entrada** (`routes/webhook-evolution.js`): `POST /webhook/evolution`. **Não é** webhook de status de entrega — é vetor de **login**. Único cenário tratado: aluna manda zap pra entrar pelo número e o handler gera um magic link de retorno. Qualquer outro evento da Evolution é ignorado.

### WebSocket de chat (`/ws/chat`)

Upgrade handler em `server.js` autentica via query string (`?token=...&modo=aluna|atendimento`) e delega registro pra `routes/chat.js` (`registrarWsAluna`/`registrarWsAtendimento`). Heartbeat ping/pong a cada 30s. JWT do painel pode vir no formato novo (`role='admin'`, `escopo='atendimento'`) ou legado (`role='atendimento'|'suellen'`).

### Roteamento e páginas servidas

`server.js` define rotas "amigáveis" (sem `.html`) que devolvem páginas estáticas: `/atendimento`, `/admin`, `/auth`, `/cadastro`, `/teste`, `/ouro-da-reprogramacao-mental`, `/lei-da-atracao-biblica`, `/guia-pratico-reprogramacao-mental`, `/a-tal-maneira`, `/magica-do-fluir`, `/termos`, `/resultado/:id`, `/app[/<seção>]`. Depois disso, `express.static('public')`, depois 404 JSON em `/api/*`, e finalmente SPA fallback (`*` → `index.html`).

Cada LP de produto (`teste.html`, `ouro-da-reprogramacao-mental.html`, `lei-da-atracao-biblica.html`, `guia-pratico-reprogramacao-mental.html`, `a-tal-maneira.html`, `magica-do-fluir.html`) reaproveita literalmente os mesmos componentes do `index.html` — navbar fixa + dropdown logada, ticker de depoimentos, `.section-eyebrow`/`.section-title`/`.section-lead`, `.hero` + `.glow`, `.btn-cta`, `.dep-carousel`+`.dep-track`, `.faq-item`+JS accordion, footer com redes sociais, `data-reveal` IntersectionObserver, `scroll-progress`, `back-top`, ripple e o helper `VmSession`. **A divergência por produto é só a paleta no `:root` e o conteúdo das seções** — qualquer ajuste global de marca (logo, paleta dourada, fontes) deve ser refletido nos HTMLs de LP. Paletas atuais: teste = azul-noite + ciano (dark), ouro = champagne quente (dark), lei-da-atracao = marinho profundo + ouro (dark), guia-pratico = pérola/marfim + laranja-dourado (light), a-tal-maneira = sépia/pergaminho + ouro radiante (light), magica-do-fluir = creme luminoso + ouro radiante + azul-céu sutil das borboletas (light). Depoimentos são puxados de `/api/depoimentos?tag=<slug>` com fallback hardcoded por LP (tags: `teste_subconsciente`, `ouro_reprogramacao_mental`, `lei_atracao_biblica`, `guia_pratico_rm`, `atal_maneira`, `magica_fluir`).

LPs novas (Guia Prático, A Tal Maneira, Mágica do Fluir, e as antigas Ouro e Lei já migradas) **herdam preço e link de checkout de `/api/precos`** dinamicamente — cada elemento marcado com `data-preco-key="<slug>"` (ou só `data-preco-de`/`data-preco-parcelas`/`data-preco-avista` quando a LP tem um único produto) é populado no load. Botões com `data-checkout-link data-utm="<campanha>"` recebem o `link_checkout_padrao` + UTM. A LP `a-tal-maneira.html` tem **3 planos** (slugs: `atal_maneira_livro`, `atal_maneira_curso`, `atal_maneira_combo`) lado a lado, com card "Combo" destacado. Pra adicionar um novo produto+plano: criar slug em `routes/seed.js` (PRECOS_INICIAIS), depois marcar elementos no HTML com `data-preco-key="<slug>"`.

Navbar das LPs **light** (guia-pratico, a-tal-maneira, magica-do-fluir) usa fundo dourado `linear-gradient(135deg, var(--gold), var(--gold-deep))` pra destacar a logo dourada; navbar das **dark** mantém fundo escuro padrão. Botões `.btn-login` e `.btn-cadastro-nav` adaptam cor pra contrastar com o fundo.

A área `/app` é uma mini-SPA cujas seções (`dashboard|perfil|chat|loja|sementes|jornada`) caem todas em `public/app.html` via regex (`server.js:131`).

### Routers montados (`server.js:136-150`)

| Mount                            | Arquivo                       | Propósito                                                                 |
|----------------------------------|-------------------------------|---------------------------------------------------------------------------|
| `/api/auth`                      | `routes/auth.js`              | Auth da aluna: OTP (WhatsApp + Email), senha, esqueci/redefinir, dispositivos, sessões |
| `/api/painel`                    | `routes/admin-auth.js`        | OTP de login do painel (admin + atendimento)                              |
| `/api/admin`                     | `routes/admin.js`             | Endpoints `/admin` (gateway, templates, usuários) — `escopo='admin'`     |
| `/api/painel-aluna`              | `routes/painel-aluna.js`      | Produtos + jornada da aluna — `autenticarPainelHibrido` (admin OU atendimento) |
| `/webhook`                       | `routes/webhook-evolution.js` | Webhook Evolution (zap entrante → magic link)                             |
| `/api` (compartilhado)           | `routes/precos.js`            | CRUD de preços                                                            |
| `/api` (compartilhado)           | `routes/depoimentos.js`       | CRUD de depoimentos                                                       |
| `/api` (compartilhado)           | `routes/feed.js`              | CRUD do feed do app (video/texto/imagem/link)                             |
| `/api` (compartilhado)           | `routes/config.js`            | Config do site/app (chave única `'site'`)                                 |
| `/api` (compartilhado)           | `routes/seed.js`              | Endpoint manual `POST /api/admin/seed` (mesma função roda no boot)        |
| `/api/chat`                      | `routes/chat.js` → `routerAluna` | Chat lado da aluna                                                     |
| `/api/atendimento/chat`          | `routes/chat.js` → `routerAtendimento` | Chat lado do painel                                              |
| `/api/upload`                    | `routes/upload.js`            | Upload de áudio/imagem via Cloudinary (aceita JWT aluna OU painel)        |
| `/api/teste`                     | `routes/teste.js`             | Teste do Subconsciente (lado da aluna)                                    |
| `/api/app`                       | `routes/app.js`               | `GET /api/app/contexto` — contexto unificado pra todas as telas do `/app` |

Os 5 routers montados em `/api` raiz definem seus próprios subpaths internamente (ex: `/api/precos`, `/api/depoimentos`). Não é tudo em `/api/<arquivo>` — checar o router antes de assumir o path.

### Módulos `core/`

| Arquivo                  | Pool(s)                  | Função                                                                              |
|--------------------------|--------------------------|-------------------------------------------------------------------------------------|
| `core/usuarios.js`       | `poolCore`               | Helpers de identidade/auth/sessões (busca por telefone principal + histórico ativo) |
| `core/admins.js`         | `poolComunicacao`        | Helpers de admin (`admins`, `admin_otp_tokens`, `admin_sessoes`)                    |
| `core/gateway.js`        | `poolComunicacao`        | Gateway unificado de saída WhatsApp + worker em loop                                |
| `core/whatsapp.js`       | —                        | Cliente HTTP baixo nível da Evolution (sem fila/retry; quem chama decide)           |
| `core/jornadas.js`       | `poolCore` + `poolTeste` | Calcula jornada vigente da aluna (Conhecer → Vida Mágica → Multiplicando)           |
| `core/teste-conteudo.js` | —                        | Conteúdo estático do Teste (15 perguntas × 5 alternativas, 5 perfis)                |
| `core/teste-resultado.js`| —                        | Lógica de cálculo do resultado (alta resolução interna, arredondamento visual)      |
| `core/atualizacoes.js`   | `poolCore`               | `criarAtualizacaoCompra` / `criarAtualizacaoTeste` — gera celebração na Home        |
| `core/utils.js`          | —                        | Normalização canônica de telefone (E.164 sem `+`). Não reimplementar em outro lugar.|

### Seed idempotente

`routes/seed.js` exporta `seedPrecos()` que roda no boot (após `initDb`). Adicione produtos novos em `PRECOS_INICIAIS` lá; o seed insere apenas o que não existe, sem sobrescrever edições do admin.

## Convenções do código

- Todos os arquivos começam com um banner `/* === VIDA MÁGICA — <arquivo> === ... === */` descrevendo propósito, bancos usados e regras. **Mantenha esse padrão ao criar arquivos novos** e atualize o banner quando o propósito mudar.
- Português em nomes de tabelas, colunas, variáveis e mensagens de log. Mantenha.
- Logs usam emojis como prefixo de severidade (`🚀` start, `❌` erro, `⚠️` warning, `💥` crash). Mantenha o estilo.
- Routers Express são montados em `server.js`. Rotas novas: crie `routes/<nome>.js` exportando um `Router` e monte com `app.use('/api/...', require('./routes/<nome>'))`.
- `routes/chat.js` é especial — exporta `{ routerAluna, routerAtendimento, registrarWsAluna, registrarWsAtendimento }`.
