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

## 🧭 PADRÕES REUTILIZÁVEIS — use ao invés de criar paralelo

**Regra de ouro:** antes de criar qualquer tabela, rota, pasta, função ou estrutura nova, **verifique se algo similar já existe**. O Renato construiu esse projeto com lógica robusta e cada peça tem casa. Criar paralelo destrói coerência e gera bug.

**Como verificar:** `grep -rn "palavra-chave" routes/ core/ db.js` ou use Explore. Custo de procurar = baixo. Custo de criar paralelo = altíssimo (retrabalho + bug + perda de confiança).

### Mapa do existente (use isso, não invente)

| Se você precisar de... | USE isso que já existe | NÃO crie paralelo |
|---|---|---|
| **QUALQUER coisa que aluna "possui"** (curso, livro, análise, acesso a feature paga) | Tabela `usuario_produtos` (poolCore). Campos chave: `produto_id` (FK pra `produtos`), `origem_tipo` (`'pagamento'`/`'assinatura'`/`'cortesia'`/`'manual'`), `acesso_inicio`, `acesso_fim`, `ativo`. **Modelo universal.** Cadastrar a feature como PRODUTO em `routes/seed.js` (`PRECOS_INICIAIS`), Renato põe preço/link no admin, sistema insere em `usuario_produtos` quando aluna compra. | Tabela paralela tipo `chat_pacotes`, `creditos`, `acessos_v2`, etc. |
| **Cobrança/preço de qualquer produto** | Tabela `precos` (alias `produtos`) — campo `preco_padrao`, `link_checkout_padrao`, etc. Renato edita pelo admin. | Hardcode em código (ex: `chat.js` linha 445 tem `9.90` hardcoded — débito técnico, NÃO replicar) |
| **Verificar se aluna é membro do Clube** | `temClubeVidaMagica({plano})` em `core/jornadas.js`. Critério: `usuario.plano !== 'gratuito'`. | Outro check em outro lugar |
| **Verificar se aluna comprou produto X** | Buscar em `usuario_produtos` por `produto_id` + `ativo=true`. `routes/app.js:43-50` mostra o padrão. | Flag em outro lugar |
| **Moderação de conteúdo** | Coluna `status_moderacao VARCHAR(20)` enum `'pendente'/'aprovado'/'rejeitado'` (já existe em `depoimentos`). Endpoints públicos filtram automático. | Outro mecanismo de aprovação |
| **Enviar WhatsApp pra aluna ou pro admin** | `core/gateway.js` (com cooldowns, fila, categorias). NUNCA usar `core/whatsapp.js` direto (bypass do gateway só em raras exceções) | Envio paralelo, hardcode |
| **Criar celebração na Home (sino/banner/splash)** | Helpers em `core/atualizacoes.js`: `criarAtualizacaoCompra`, `criarAtualizacaoTeste`. Chamar logo após criar registro em `usuario_produtos`. | Lógica de "notificação" em outro lugar |
| **Migration (coluna nova / tabela nova)** | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ou `CREATE TABLE IF NOT EXISTS` dentro de `db.js` (na função `initXxx` correta). Roda no boot. | Arquivos de migration separados |
| **Seed idempotente de dados iniciais** | Tabela `seed_log` (poolComunicacao) + verificação `seed_key` no início da função. Ver `seedDepoimentos` em `routes/depoimentos.js` ou `seedPrecos` em `routes/seed.js`. | Seed sem proteção (roda toda vez) |
| **Normalização de telefone (E.164 sem '+')** | `core/utils.js` (função `canonicalizarTelefone` ou similar) | Reimplementar regex |
| **Autenticar aluna num endpoint** | Middleware `autenticar` de `middleware/autenticar.js` | Nova lógica de JWT |
| **Autenticar admin ou atendimento** | `autenticarPainel('admin')` ou `autenticarPainel('atendimento')` ou `autenticarPainelHibrido` (aceita os dois) | Verificação custom |
| **Slug de produto** (Ouro, LDA, etc.) | Coluna `key` da tabela `precos` (= produtos). Slugs canônicos em `core/jornadas.js` constante `SLUG`. | Slug paralelo em outra tabela |
| **Tema de relato** (vínculo produto ↔ relato) | Tabela `temas` (poolComunicacao). Cada tema aponta pra `produto_slug`. Cada relato aponta pra `tema_id`. | Tag paralela, categoria nova |
| **Imagem/preço/link checkout de um produto** | `/api/precos` (ou `/api/produtos` — alias). Frontend SEMPRE puxa de lá via `data-preco-key`. | Hardcode no HTML |
| **Carrossel de relatos numa LP nova** | `<script src="/relatos-card.js"></script>` antes de `</body>`. Não reimplementar swipe/modal. | Reescrever interatividade |
| **Cálculo de jornada da aluna** | `calcularJornadaVigente()` em `core/jornadas.js`. Fonte da verdade. | Outra lógica de "qual jornada" |
| **Cálculo de resultado do teste** | `calcularResultado()` em `core/teste-resultado.js`. | Recalcular percentuais |
| **Lista de livros do Passo 2** | `montarLivrosRecomendados()` em `core/teste-resultado.js`. Regra de tag (Urgente/Necessário/Útil/Complemento) já aplicada. | Filtragem custom |
| **Sessão da aluna no frontend** | Helper global `VmSession` (localStorage/sessionStorage). | Cookie próprio |
| **Cadastrar produto novo** | Adicionar em `PRECOS_INICIAIS` de `routes/seed.js`. Seed insere no próximo boot (sem sobrescrever). | INSERT manual no banco |
| **Creditar/debitar SEMENTES** (qualquer motivo) | `core/sementes.js` → `creditarSementes({ client, usuario_id, delta, motivo, origem_tipo, origem_id })` ou `debitarSementes(...)`. Sempre dentro de transação (`poolCore.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`). Helper grava no ledger `sementes_movimentacoes`, faz `SELECT … FOR UPDATE` no usuário, atualiza `usuarios.sementes` atomicamente. | `UPDATE usuarios SET sementes = sementes + N` solto, soma no cliente, qualquer atalho |
| **Idempotência de evento que credita semente** (ex: resgate de tesouro, futura compra de produto) | Tabela própria com `UNIQUE(usuario_id, <chave_do_evento>)` na mesma transação do crédito. Ex: `tesouros_resgatados (usuario_id, feed_id)`. INSERT … ON CONFLICT DO NOTHING; se já existe, NÃO credita de novo. | Confiar em localStorage da aluna, flag client-side |
| **Registrar ação que conta como progresso de missão/ofensiva** (escreveu no caderno, viu vídeo, comprou, etc.) | `core/gamificacao.js` → `progressoEvento(usuario_id, alvo_tipo, contexto?)`. Avança automaticamente todas as missões com `alvo_tipo` correspondente da jornada vigente da aluna; quando atinge `alvo_qtd`, completa e credita sementes (idempotente). `alvo_tipo` aceitos hoje: `caderno_escrita`, `tesouro_resgatado`, `video_assistido`, `produto_comprado`, `teste_concluido`. | Contagem em tabela paralela, lógica de gamificação dentro de cada rota |
| **Atualizar ofensiva de login da aluna** (qualquer dia que ela usa o app) | `core/gamificacao.js` → `registrarLogin(usuario_id)`. Idempotente — 1ª chamada do dia avança 3 streaks (mensal cumulativo, trimestral cumulativo, rápida consecutiva) e concede prêmios elegíveis. Chamado já em `GET /api/app/contexto`. **Não chamar duas vezes manualmente.** | Setar `usuarios.algo = NOW()` paralelo, contar dia no frontend |
| **Conteúdo cadastrado pelo admin do Caderno** (prompts, afirmações, áudios) | Tabelas em `poolComunicacao`: `caderno_prompts`, `caderno_afirmacoes`, `caderno_audios_foco`. CRUD admin em `routes/admin-caderno.js`. Endpoint público em `routes/caderno.js` (aluna lê). Seed inicial em `routes/seed-caderno.js` chave `caderno_gamificacao_v1`. | Hardcode no HTML do app, tabela separada |
| **Conteúdo gerado pela aluna no Caderno** (escritas, cápsulas, vision, metas, favoritos, áudio próprio) | Tabelas em `poolCore` com prefixo `caderno_*`. CRUD em `routes/caderno.js` (mount `/api/app/caderno`). Todas autenticadas com `autenticar`. | Sessionstorage, localStorage |
| **Avisar aluna quando algo ficou pronto pra ela ver** (cápsula madura, futuro: missão expirando, ranking fechou) | `core/caderno-avisos.js` é o modelo: worker em `setInterval` que busca registros prontos + dispara WhatsApp (via gateway) + Email (Brevo) + marca canal `in_app` (banner via `/contexto`). Idempotência via `UNIQUE(entidade_id, canal)`. | Mandar email direto da rota, polling no cliente |

### Antes de codar QUALQUER feature nova
1. Pergunte: "isso já tem casa em algum padrão acima?"
2. Se não tem certeza, faça `grep -rn` no projeto pra checar
3. Se tem algo similar, **reuse a estrutura existente** (mesmo que precise estender)
4. Só crie paralelo se houver justificativa técnica real — e nesse caso, documente o porquê neste CLAUDE.md

## ⚠️ PENDÊNCIAS EM ABERTO (ler ANTES de mexer em coisas relacionadas)

Este projeto tem frentes em construção. Antes de fazer qualquer alteração que toque uma destas áreas, **leia a memória correspondente** (em `~/.claude/projects/-Users-Renato1-Desktop-AQUIIIIIIII-vidamagica/memory/`):

| Área do código | Memória a ler antes | O que está pendente |
|---|---|---|
| `core/jornadas.js` ou regras de jornada | `project_frente_4b_jornadas.md` | Jornada 2 vai virar 4 passos. Prosperidade + trava deixa de rebaixar pra Conhecer e Despertar. 6 decisões do Renato faltam. |
| Sistema de análise/leitura inteligente do teste | `project_analise_renato.md` | Produto "Análise do Renato" (Sub-fase 1A) — backend + admin sem expor ao frontend ainda. Modelo PSN-com-cadeado. |
| Tabela `depoimentos` ou UI de relatos | `project_relatos_fases234.md` | Fase 2 (aluna envia pelo /app), Fase 3 (moderação no admin), Fase 4 (auto-off por arquivamento). Infra já pronta. |
| Criação de nova LP de produto | `project_lps_blueprint.md` | 4 LPs da Série Conhecer e Despertar + 1 LP "só dela" pendentes. NÃO mexer no esqueleto comum entre LPs. |
| Vocabulário (produto/preço, depoimento/relato, perfis, jornadas) | `project_nomes_oficiais.md` | Regra crítica de nomenclatura — Renato corrige se trocar nome. |
| Modo de trabalho com o Renato | `user_expertise_e_destino.md` | Modelo: rascunho + correção, não pergunta-por-pergunta. Tom positivo SEMPRE. |
| Perfil do `/app` (reconstrução) | `project_perfil_app_reconstrucao.md` (+ `project_regras_auth_completas.md` pra regras de cadastro) | **Frente aberta (2026-05-18).** A view de perfil (`view-perfil` em `public/app.html` + handlers em `public/app/app.js`) precisa ser **reconstruída com base no que já existe** — não jogar fora, refazer em cima. Spec aprovada na memória. Inclui selo de plano dinâmico (Clube com brilho vs "Plano grátis" off), avatar editável obrigatório pra iniciar chat com a Suellen, 6 itens de menu, Sair com mini-modal (lembrar/esquecer). |
| Plano, assinaturas, pagamentos, cortesia, integração Kiwify/Railway | `project_plano_assinatura_arquitetura.md` | **Regra crítica:** aplicação Railway é quem escreve em `assinaturas`/`pagamentos`/`eventos_financeiros`/`membros` (poolCore). Vida Mágica **só lê**. Cortesia do atendimento passa pela mesma Railway (não pela Kiwify), grava como venda de valor 0. Schemas e templates já estão aqui; regras de execução ainda vivem só na aplicação Railway do Renato. |
| Sementes (qualquer crédito/débito) | `project_sementes_moeda.md` + `project_bau_tesouro_entrega.md` | **Sementes = MOEDA REAL** (poder de compra de produtos). Toda alteração passa por `core/sementes.js` (helper transacional + ledger `sementes_movimentacoes`). NUNCA `UPDATE usuarios SET sementes = sementes + N` solto. Idempotência por chave única (`tesouros_resgatados`, futuras `compras_produto`). Cliente nunca incrementa local. |
| Baú do Tesouro da Su (Home + view-bau) | `project_bau_tesouro_entrega.md` | Lottie em `public/assets/treasure-chest.json`, 3 estados (chacoalhando/abrindo/resgatado), modal com 2 ações (✨ quero viver / 🌱 resgatar). Tesouros caem no MESMO baú dos relatos (`relatos_salvos_bau` agora tem `tesouro_feed_id`). Pendente: recompensa variável, cortesia admin, endpoint de gastar. |
| UTMs, atribuição de venda, tracking ponta-a-ponta | `project_utms_atribuicao.md` | **Frente aberta 2026-05-21**, próxima sessão. Renato já tem UTMs vindo de fora (Meta/Google/email). Falta: capturar na entrada do site, manter na navegação, propagar até CTAs do checkout, receber no webhook Kiwify, gravar atribuição. Pré-requisito pra ranking de relato por vendas. |
| Algoritmo das LPs/index dirigido por VENDAS | `project_algoritmo_lps_vendas.md` | **Frente latente** (aguarda UTMs). Hoje superfícies públicas ordenam por `ordem ASC` (editorial manual). Renato quer migrar pra ranking dirigido por conversão real. NÃO confundir com o algoritmo do `relatos-feed` — esse já funciona, é da home logada. |

Se você não tem certeza se uma mudança afeta alguma dessas áreas, **leia a memória primeiro**. O custo de ler é baixo. O custo de fazer errado é alto.

## Fase atual e decisões deliberadas

**Contexto operacional importante:**

- O sistema está **em produção no Railway**, mas hoje só o **Renato** (dono do projeto) usa. Ainda não foi aberto pra alunas reais.
- Renato **não é programador** e **não usa terminal**. Ele edita arquivos via interface web do GitHub e o Railway auto-deploya em 1-2 min. "Ver funcionando" pra ele = ver no site de produção.
- **Não há ambiente de staging.** O que entra na branch principal vai direto pra produção. Mudanças arriscadas precisam de cuidado proporcional — mas sem alunas reais hoje, ainda há espaço pra experimentar.

**Decisões deliberadas que NÃO são bug:**

1. ⚠️ `routes/app.js:164` e `routes/app.js:337` contêm `|| true` que considera **qualquer teste como pago**, ignorando o gateway de pagamento. Isso é **proposital** e os próprios comentários no código marcam como ⚠️ TEMPORÁRIO ⚠️. Razão técnica: **o Kiwify não tem modo sandbox/teste** — toda transação é dinheiro real. Renato precisa rodar o fluxo do Teste do Subconsciente várias vezes pra validar texto, layout do resultado, e-mail, etc. Se o pagamento estivesse ligado, cada validação custaria uma compra real. O `|| true` é o "modo desenvolvedor" caseiro que o Kiwify não oferece. **Não tratar como bug nem sugerir remover** até que Renato diga explicitamente "vou plugar o Kiwify pra valer" / "vou abrir pras alunas". Nesse momento, essas 2 linhas (e qualquer outra similar) saem.

2. ⚠️ `routes/app.js` topo do arquivo: constante `TESOURO_INFINITO_DEV = true` permite que a aluna **resgate o mesmo tesouro do dia várias vezes**, ignorando idempotência. Mesma razão filosófica do `|| true` acima: Renato precisa validar várias vezes a animação do baú abrindo, modal pergaminho, carta voadora e semente voando — sem painel admin nem múltiplas contas. Afeta 2 rotas: `GET /api/app/tesouro/disponivel` (devolve sempre o primeiro item ativo do feed) e `POST /api/app/tesouro/:id/resgatar` (deleta registro anterior antes do INSERT, fazendo crédito real de semente passar pelo helper a cada chamada). **Reversão = trocar pra `false` na constante (1 linha)**. Não tratar como bug. Quando Renato disser "vou abrir pras alunas reais", trocar pra `false` antes de o tráfego real chegar — senão alunas farmam sementes infinitas (e sementes = moeda real, ver `project_sementes_moeda.md`).

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

### "Produto" vs "preço" — vocabulário canônico

**Regra absoluta:**

- **Produto** = entidade do catálogo (Ouro da Reprogramação Mental, Clube Vida Mágica, A Tal Maneira etc.). Tem nome, imagem, tipo, preços (campos), parcelas, links de checkout. **Termo usado pelo Renato e pela aluna.**
- **Preço** = APENAS um campo do produto. Não é a entidade.

**Mapeamento código ↔ realidade:**

- Tabela do banco: `precos` (nome histórico — mantido por compat; não renomear)
- Rota canônica nova: `/api/produtos` (+ `/api/admin/produtos`)
- Rota legada (mantida pra LPs e webhooks): `/api/precos` (+ `/api/admin/precos`) → reusa os mesmos handlers de `routes/produtos.js`
- Arquivo canônico: `routes/produtos.js`
- Arquivo legado (NÃO REMOVER): `routes/precos.js` (alias fino)
- Variáveis JS no admin: `dadosProdutos`, `carregarProdutos`, `salvarProdutos`, `coletarProdutos`
- Aba do admin: `tab-produtos` (URL hash: `#produtos`)
- Atributos HTML nas LPs: `data-preco-key`, `data-preco-de`, `data-preco-parcelas`, `data-preco-avista` (espalhados em 7 arquivos — não renomear, custo desproporcional)

Quando o Renato falar "produto", é da tabela `precos` que estamos falando — não confundir.

### Roteamento e páginas servidas

`server.js` define rotas "amigáveis" (sem `.html`) que devolvem páginas estáticas: `/atendimento`, `/admin`, `/auth`, `/cadastro`, `/teste`, `/ouro-da-reprogramacao-mental`, `/lei-da-atracao-biblica`, `/guia-pratico-reprogramacao-mental`, `/a-tal-maneira`, `/magica-do-fluir`, `/termos`, `/resultado/:id`, `/app[/<seção>]`. Depois disso, `express.static('public')`, depois 404 JSON em `/api/*`, e finalmente SPA fallback (`*` → `index.html`).

Cada LP de produto (`teste.html`, `ouro-da-reprogramacao-mental.html`, `lei-da-atracao-biblica.html`, `guia-pratico-reprogramacao-mental.html`, `a-tal-maneira.html`, `magica-do-fluir.html`) reaproveita literalmente os mesmos componentes do `index.html` — navbar fixa + dropdown logada, ticker de depoimentos, `.section-eyebrow`/`.section-title`/`.section-lead`, `.hero` + `.glow`, `.btn-cta`, `.dep-carousel`+`.dep-track`, `.faq-item`+JS accordion, footer com redes sociais, `data-reveal` IntersectionObserver, `scroll-progress`, `back-top`, ripple e o helper `VmSession`. **A divergência por produto é só a paleta no `:root` e o conteúdo das seções** — qualquer ajuste global de marca (logo, paleta dourada, fontes) deve ser refletido nos HTMLs de LP. Paletas atuais: teste = azul-noite + ciano (dark), ouro = champagne quente (dark), lei-da-atracao = marinho profundo + ouro (dark), guia-pratico = pérola/marfim + laranja-dourado (light), a-tal-maneira = sépia/pergaminho + ouro radiante (light), magica-do-fluir = creme luminoso + ouro radiante + azul-céu sutil das borboletas (light). Depoimentos são puxados de `/api/depoimentos?tag=<slug>` com fallback hardcoded por LP (tags: `teste_subconsciente`, `ouro_reprogramacao_mental`, `lei_atracao_biblica`, `guia_pratico_rm`, `atal_maneira`, `magica_fluir`).

LPs novas (Guia Prático, A Tal Maneira, Mágica do Fluir, e as antigas Ouro e Lei já migradas) **herdam preço e link de checkout de `/api/precos`** dinamicamente — cada elemento marcado com `data-preco-key="<slug>"` (ou só `data-preco-de`/`data-preco-parcelas`/`data-preco-avista` quando a LP tem um único produto) é populado no load. Botões com `data-checkout-link data-utm="<campanha>"` recebem o `link_checkout_padrao` + UTM. A LP `a-tal-maneira.html` tem **3 planos** (slugs: `atal_maneira_livro`, `atal_maneira_curso`, `atal_maneira_combo`) lado a lado, com card "Combo" destacado. Pra adicionar um novo produto+plano: criar slug em `routes/seed.js` (PRECOS_INICIAIS), depois marcar elementos no HTML com `data-preco-key="<slug>"`.

Navbar das LPs **light** (guia-pratico, a-tal-maneira, magica-do-fluir) usa fundo dourado `linear-gradient(135deg, var(--gold), var(--gold-deep))` pra destacar a logo dourada; navbar das **dark** mantém fundo escuro padrão. Botões `.btn-login` e `.btn-cadastro-nav` adaptam cor pra contrastar com o fundo.

A área `/app` é uma mini-SPA cujas seções (`dashboard|perfil|chat|loja|sementes|jornada`) caem todas em `public/app.html` via regex (`server.js:131`). **Atenção à distinção:** essas 6 URLs são as únicas com endereço próprio no navegador. Internamente, o `/app` tem mais views (`view-home`, `view-produtos`, `view-fale-com-a-su`, `view-chat`, `view-videos`, `view-perfil`) que **não têm URL** — são trocadas via JS, não via navegação do browser.

### Frontend `/app` — convenção do mini-SPA

- Cada tela é um `<div class="view" id="view-NOME">` em `public/app.html`.
- Troca de tela via função global `irPara('NOME')` em `public/app/app.js` (adiciona/remove classe `.active`).
- A view atual persiste em `sessionStorage` — sobrevive a pull-to-refresh do iOS.
- Quando a aluna é assinante do Clube Vida Mágica, `hidratarHome` adiciona a classe `clube-ativo` no `<body>`. Essa classe ativa a "chuva de ouro" extra das partículas (`criarParticulas()` em `app.js`) — 46 partículas em vez de 22, com glow forte. **É marca registrada visual, não enfeite descartável.**
- Player principal do topo: mostra o item do feed com `destaque=true`. Backend garante que **apenas 1 item** pode ter destaque ativo por vez (`routes/feed.js`). Pra não-assinante, exibe cadeado dourado + modal de venda; pra assinante, abre iframe inline. YouTube e Vimeo são suportados (Vimeo preferido por proteção de link).

### `/api/app/contexto` — princípio de "fonte única"

`routes/app.js` expõe `GET /api/app/contexto`, que retorna **TUDO** que qualquer tela do `/app` precisa em uma chamada só: dados da aluna, teste mais recente concluído, teste em andamento, produtos liberados, jornada vigente, atualizações pendentes, flags (`tem_clube` etc.).

**Princípio arquitetural:** *nenhuma tela do `/app` calcula nada — o contexto é a verdade.* Telas novas devem consumir esse payload, não criar endpoints próprios. Se algo está faltando no contexto, **acrescenta no `/contexto`** em vez de criar uma nova rota.

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
| `/api/app/caderno`               | `routes/caderno.js`           | Caderno da Mentalização (escritas, cápsulas, vision board, metas, afirmações, áudios) — lado da aluna |
| `/api/app/gamificacao`           | `routes/gamificacao.js`       | Conquistas — status de ofensivas, missões da jornada, prêmios recebidos, ranking mensal — lado da aluna |
| `/api/admin` (compartilhado)     | `routes/admin-caderno.js`     | Admin do Caderno (prompts/afirmações/áudios) + Gamificação (prêmios/missões/ranking) |

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
| `core/gamificacao.js`    | `poolCore` + `poolTeste` + `poolComunicacao` | Motor TRANSVERSAL: `registrarLogin`, `progressoEvento`, `concederPremio`, `fecharRankingMensal`, `lerIndicadoresGamificacao`. Avança 3 ofensivas (mensal cumulativa, trimestral cumulativa, rápida consecutiva), missões por jornada, ranking. NÃO é do Caderno — Caderno é só uma das fontes (escrever = `alvo_tipo='caderno_escrita'`). |
| `core/caderno-avisos.js` | `poolCore` + gateway     | Worker em `setInterval` (10 min) que dispara avisos de Cápsulas do Tempo maduras: WhatsApp (via gateway, categoria `caderno_capsula`) + Email (Brevo) + marca canal `in_app` (banner aparece via `/contexto`). Idempotente por `UNIQUE(capsula_id, canal)` em `caderno_capsula_avisos`. |

### Seed idempotente

`routes/seed.js` exporta `seedPrecos()` que roda no boot (após `initDb`). Adicione produtos novos em `PRECOS_INICIAIS` lá; o seed insere apenas o que não existe, sem sobrescrever edições do admin.

## Conceitos do produto (vocabulário oficial)

Nomes e conceitos do produto. **Escrever sempre por extenso, na grafia exata** — Renato é cuidadoso com a marca e corrige abreviações.

### As 3 Jornadas (ordem fixa)

1. **Conhecer e Despertar** (`conhecer_e_despertar`) — default; pra quem tem trava forte
2. **Vida Mágica** (`vida_magica`) — Prosperidade dominante nv1 ou nv2, SEM trava > 20%
3. **Multiplicando a Vida Mágica** (`multiplicando_vida_magica`) — Prosperidade dominante nv3, SEM trava > 20%

**Regra do override** (em `core/jornadas.js`): mesmo se Prosperidade for dominante, se QUALQUER perfil bloqueador (medo/desordem/sobrevivencia/validacao) > 20%, a aluna fica na Jornada 1 (Conhecer e Despertar). Trava forte tem prioridade. **Não bypassar** — é regra do produto.

### Os 5 perfis do Teste do Subconsciente

- **Medo** (`medo`)
- **Desordem** (`desordem`)
- **Sobrevivência** (`sobrevivencia`) — antes `autossuficiencia`, renomeado; mesma lógica
- **Validação** (`validacao`)
- **Prosperidade** (`prosperidade`), subdividida em 3 níveis (faixas oficiais — não confundir com versões antigas do código):
  - `prosperidade_nv1` — **< 50%** (até 49,99) → abre **Vida Mágica** se dominante
  - `prosperidade_nv2` — **≥ 50% e < 80%** (50 a 79,99) → ⚠️ ainda **não tem jornada própria**; Renato vai criar produtos pra essa faixa. Enquanto isso, segue mesma trilha de nv1 (Vida Mágica) como placeholder
  - `prosperidade_nv3` — **≥ 80%** → abre **Multiplicando a Vida Mágica**

Os 4 primeiros são "perfis bloqueadores". Cálculo interno usa alta resolução (fração decimal); exibição usa `Math.round`. Empates visuais são possíveis (ex: 27% e 27%) mas o desempate interno é fixo: `validacao > sobrevivencia > desordem > medo`.

### Outros termos de marca

- **Teste do Subconsciente** — não "teste de prosperidade" (esse aparece em alguns nomes de banco, mas o nome pra aluna é Subconsciente).
- **Clube Vida Mágica** — assinatura recorrente. Aluna é membro quando `usuarios.plano !== 'gratuito'`. Helper `temClubeVidaMagica()` em `core/jornadas.js` é fonte da verdade.
- **Tesouro da Su** — mensagem/áudio diário pra aluna, registrado em `poolMensagens`.
- **Sementes** — moeda virtual da aluna (`usuarios.sementes`), ganhas em interações com o app.
- **Suellen** (ou **Su**) — face do atendimento pra aluna. Renato é o admin/dono.

### Passo 3 do Resultado — automático (não editável no admin)

A página `/resultado/:id` mostra um "Passo 3 — Curso recomendado". **Os 5 campos manuais antigos** (`passo3_curso_titulo`, `passo3_curso_capa_url`, `passo3_curso_descricao`, `passo3_curso_preco`, `passo3_curso_link_checkout`) e seus duplicados `_2` **NÃO são mais editáveis no admin** (foram removidos da tela "Conteúdo dos Resultados").

O backend (`routes/teste.js`) preenche esses campos automaticamente lendo do produto vinculado, via regra de jornada:

- **Sobrevivência** dominante → `lda_biblica`
- **Medo / Desordem / Validação** dominantes → `ouro_reprogramacao`
- **Prosperidade dominante COM trava forte** (>20% em alguma energia-problema) → hoje cai em Conhecer e Despertar e recebe `ouro_reprogramacao` (⚠️ Frente 4.B pendente: Renato definiu que essa aluna deveria ir pra Vida Mágica/Multiplicando com livros e Ouro adicionados no início — ainda não implementado)
- **Prosperidade nv1 ou nv2 SEM trava** → `atal_maneira_livro`
- **Prosperidade nv3 SEM trava** → `atal_maneira_curso`

Os campos antigos continuam no banco (`teste_perfis_conteudo`) por compat, mas são sobrescritos no envio da resposta. Frontend (`resultado.html`) não muda — recebe os mesmos nomes de campo.

**Pra mudar qual produto aparece**: ajustar a regra em `routes/teste.js` (bloco "Passo 3 — Curso recomendado") ou alterar dados do produto na aba "Produtos" do admin.

### Atualizações pendentes

`core/atualizacoes.js` expõe helpers (`criarAtualizacaoTeste`, `criarAtualizacaoCompra`) que geram celebração na Home (banner + sino + splash com barra animada 0 → percentual atual). Quando criar uma linha em `usuario_produtos` (ex: webhook de compra), **sempre chame `criarAtualizacaoCompra`** logo depois. Sem isso a aluna não vê a celebração na próxima visita.

## Caderno da Mentalização + Gamificação da Plataforma

**São DUAS features distintas que coexistem** e foi entregue no mesmo lote (2026-05-28). Importante não confundir:

| | **Caderno da Mentalização** | **Gamificação da Plataforma** |
|---|---|---|
| O que é | Espaço pessoal da aluna pra escrever, visualizar, planejar | Motor TRANSVERSAL de engajamento (ofensivas/missões/prêmios/ranking) |
| Escopo | Específico de uma view (`view-caderno`) | Aplicação inteira — qualquer ação da aluna pode alimentar |
| Telas | `<section id="view-caderno">` com 5 abas internas + `view-conquistas` mostra parte da gamificação | `<section id="view-conquistas">` é a UI, mas a lógica roda em todo lugar |
| Rotas | `/api/app/caderno/*` (aluna) + `/api/admin/caderno/*` (admin) | `/api/app/gamificacao/*` (aluna) + `/api/admin/gamificacao/*` (admin) |
| Motor | `routes/caderno.js` direto | `core/gamificacao.js` (motor) → chamado por várias rotas |

**Caderno usa Gamificação** (não o contrário): quando aluna salva uma escrita no Caderno, a rota chama `progressoEvento(usuarioId, 'caderno_escrita')` da gamificação — que avança missões e pode creditar sementes. **Outras features futuras vão fazer o mesmo** (assistir vídeo → `'video_assistido'`, comprar produto → `'produto_comprado'`, etc).

### Estrutura de tabelas (resumida)

**Caderno (poolCore — dados da aluna):**
- `caderno_escritas` (scripting diário)
- `caderno_capsulas` (carta pro futuro com `abrir_em`) + `caderno_capsula_avisos` (log idempotente WhatsApp/email/in_app, UNIQUE(capsula_id, canal))
- `caderno_vision_itens` (vision board + galeria de conquistas via `status`; só 1 `principal=TRUE` ativo por aluna)
- `caderno_metas` (termômetro de materialização: `plantando | em_movimento | quase_la | materializado`)
- `caderno_afirmacoes_favoritas` (PK composta `(usuario_id, afirmacao_id)`)
- `caderno_audio_pref_aluna` (URL própria que ela colou + último áudio do catálogo escolhido)

**Caderno (poolComunicacao — cadastrado pelo admin):**
- `caderno_prompts` (perguntas guiadas — prompt do dia é determinístico por `(usuario_id + dia_do_ano)`)
- `caderno_afirmacoes` (banco com `categoria` livre — 'prosperidade', 'autoestima', 'relacionamentos', etc.)
- `caderno_audios_foco` (catálogo de áudios — `tipo`: 'binaural' | 'branco' | 'natureza' | 'hz' | 'meditacao')

**Gamificação (poolCore — estado da aluna):**
- `gam_login_diario` (PK composta `(usuario_id, dia)` — 1 linha por dia ativo)
- `gam_streak_aluna` (1 linha por aluna com TODOS os ciclos: mensal, trimestral, rápida + recordes)
- `gam_premios_recebidos` (ledger idempotente — `UNIQUE(usuario_id, tipo, marco, ciclo_id)`)
- `gam_missao_progresso` (`UNIQUE(usuario_id, missao_id)` — progresso da aluna em cada missão)
- `gam_ranking_mensal` (snapshot do top 10 quando o mês fecha, PK `(ano_mes, posicao)`)

**Gamificação (poolComunicacao — cadastrado pelo admin):**
- `gam_premios_config` (tabela de prêmios — `UNIQUE(tipo, marco)`. Renato edita valores via admin)
- `gam_missoes` (catálogo de missões por jornada, `slug` único)

### Os 3 tipos de ofensiva — não confundir

| Tipo | Comportamento | Como persiste | Prêmios padrão (editáveis) |
|---|---|---|---|
| **Mensal** | Cumulativa em ciclo de 30 dias. Conta dias DISTINTOS que ela apareceu. Vira automaticamente quando passa 30 dias do início OU chega a 30 logins. | `ciclo_30_inicio` + `ciclo_30_logins` + `ciclo_30_ultimo_dia` em `gam_streak_aluna` | 1🌱/dia + 5🌱(7) + 15🌱(15) + 50🌱(30) + 30🌱 bônus ciclo fechado |
| **Trimestral** | Cumulativa em ciclo de 90 dias. Marcos premiados em 30, 60, 90 (30 já vem do mensal). | `ciclo_90_inicio` + `ciclo_90_logins` em `gam_streak_aluna` | 100🌱(60) + 250🌱(90) |
| **Rápida** | **Streak CONSECUTIVO** — quebra se pular 1 dia. Marcos em 3 e 7 dias. | `rapida_atual` + `rapida_ultimo_dia` em `gam_streak_aluna` | 3🌱(3 seguidos) + 10🌱(7 seguidos) |

⚠️ **NÃO existe "streak de escrita no caderno" separado.** Renato pediu pra deixar isso pra depois do primeiro layout. Hoje a única streak é a de LOGIN (qualquer GET `/api/app/contexto` autenticado). Quando for criar streak de escrita, **estender o motor existente** com um novo tipo (`escrita_30`?) — não criar tabela paralela.

### Motivos novos em `core/sementes.js`

Adicionados na constante `MOTIVOS_VALIDOS`: `streak_login`, `ofensiva_rapida`, `ciclo_fechado`, `ranking_mensal`, `missao_diaria`, `missao_jornada`, `caderno_escrita`. **Sempre adicionar motivo novo lá antes de criar lógica que credita** — senão `creditarSementes` joga erro `motivo inválido`.

### Indicadores leves no `/api/app/contexto`

Pra não pesar o contexto unificado com tudo, ele só carrega **indicadores rápidos**:

- `caderno`: `{ escreveu_hoje, total_escritas, capsula_madura_pendente, prompt_do_dia }`
- `gamificacao`: `{ ciclo_30_logins, ciclo_30_inicio, ciclo_90_logins, rapida_atual, recorde_30, recorde_90, recorde_rapida }`
- `gamificacao_premios_novos`: array de prêmios concedidos NESTA chamada (só na 1ª visita do dia — frontend mostra toast/celebração e contexto seguinte vem vazio)

Listas pesadas (escritas, vision, metas, missões, ranking) vivem em endpoints próprios sob `/api/app/caderno/*` e `/api/app/gamificacao/*` — chamados só quando aluna entra na view.

### Frontend — onde mora

- HTML: `public/app.html` tem `view-caderno`, `view-conquistas` e 3 modais (`modal-capsula-nova`, `modal-meta-nova`, `modal-capsula-abrir`). Também tem 2 cards de atalho na Home (`.atalho-card`).
- JS: **`public/app/caderno.js`** é um arquivo separado, **NÃO é module** (carregado depois de `app.js` no `app.html`). Toda lógica de render/CRUD do Caderno + Conquistas mora lá. Expõe `window.renderCaderno`, `window.renderConquistas`, `window.renderAtalhosCaderno`, `window.trocarAbaCaderno`, etc.
- Pra `caderno.js` chamar funções de `app.js` (que É module): `app.js` expõe `window.irPara/toast/abrirModal/fecharModal/fetchAutenticado` no final do arquivo (bootstrap). **Manter esse export** se for refatorar.
- CSS: tudo no fim de `public/app/app.css` (bloco com banner "CADERNO DA MENTALIZAÇÃO + CONQUISTAS"). Usa os mesmos tokens dourados.

### Worker da Cápsula do Tempo

`core/caderno-avisos.js` — roda a cada 10 min em produção. Acha cápsulas com `abrir_em <= NOW() AND aviso_enviado_em IS NULL` e dispara 3 canais em paralelo:

1. **WhatsApp** — via `enfileirarAtendimento` do gateway, categoria `caderno_capsula` (cadastre essa chave em `gateway_categorias` se quiser poder pausar)
2. **Email** — via Brevo (mesmo padrão de `enviarOTPEmail` em `routes/auth.js`)
3. **in_app** — só marca registro; o banner aparece automaticamente via `caderno.capsula_madura_pendente` no `/contexto`

Idempotência forte: `UNIQUE(capsula_id, canal)` em `caderno_capsula_avisos` faz worker rodar 100 vezes sem mandar email/WA duplicado.

**Limitação proposital:** validação no `POST /api/app/caderno/capsulas` exige `abrir_em > NOW() + 24h` (mínimo 1 dia no futuro). Pra testar localmente sem esperar, relaxar **temporariamente** essa linha — não comitar relaxado.

## Limitações conhecidas (pegadinhas reais)

### iOS Safari

- `background-attachment: fixed` é tratado como `scroll` (não fixa o fundo).
- `overflow: hidden` no `<body>` nem sempre trava scroll — em alguns casos precisa `position: fixed` no body.
- Pull-to-refresh nativo é tricky de bloquear — precisa `overscroll-behavior: none` e às vezes mais.
- ⚠️ **Cache agressivo de JS/CSS** — Safari iOS segura `app.js` (e qualquer outro arquivo estático) em cache **mesmo após deploy**. Sintoma típico: você corrige bug no código, sobe pra Railway, build verde, mas o iPhone continua mostrando o comportamento bugado enquanto o desktop já mostra a correção. **Diagnóstico:** "no desk funciona, no mobile não" = quase sempre cache do Safari iOS, NÃO bug real.
  - **Fix permanente aplicado (2026-05-28):** `server.js` agora envia `Cache-Control: no-cache` pra HTML + JS/CSS do mini-SPA `/app` + `relatos-card.js`, via `setHeaders` no `express.static`. O Safari ainda guarda o arquivo, mas revalida com o servidor antes de usar (304 vazio quando inalterado, 200 com corpo quando você sobe versão nova). Custo de banda em escala = centavos. **Não precisa mais bumpar `?v=N`** pra forçar reload no celular após deploy — o Safari pega a versão nova automaticamente. O `?v=2` atual em `public/app.html` pode ficar como cinto-e-suspensórios; novos arquivos JS não precisam dele.
  - **Bug histórico que gerou esta nota (2026-05-28):** após primeira entrega do Caderno da Mentalização, salvar escrita / plantar meta / adicionar imagem ao Vision Board falhavam **só no iPhone** com toast "Não consegui salvar". Causa real era que o `fetchAutenticado` não enviava `Content-Type: application/json` (corrigido) — mas o Safari iOS continuou rodando o `app.js` antigo (sem o fix) mesmo após múltiplos deploys. Só virou depois de adicionar `?v=2` nos `<script>`.

### YouTube embed

- Não dá pra esconder 100% o botão "Compartilhar" nem o logo "YouTube" do player.
- Alguns vídeos/canais bloqueiam embed com erro 153 ("Erro de configuração do player"). Por isso o Helmet está afrouxado.
- Long-press no iOS expõe a URL do vídeo. Pra blindagem séria, **trocar pra Vimeo Pro** (com domain restriction) ou Cloudflare Stream.

### Chat — canais limitados

A coluna `chat_conversas.tipo` aceita apenas `'suellen'` ou `'suporte'`. Adicionar canal novo exige mexer em `routes/chat.js`, `public/atendimento.html` e WS de atendimento — não é trivial.

## Convenções do código

- Todos os arquivos começam com um banner `/* === VIDA MÁGICA — <arquivo> === ... === */` descrevendo propósito, bancos usados e regras. **Mantenha esse padrão ao criar arquivos novos** e atualize o banner quando o propósito mudar.
- Português em nomes de tabelas, colunas, variáveis e mensagens de log. Mantenha.
- Logs usam emojis como prefixo de severidade (`🚀` start, `❌` erro, `⚠️` warning, `💥` crash). Mantenha o estilo.
- Routers Express são montados em `server.js`. Rotas novas: crie `routes/<nome>.js` exportando um `Router` e monte com `app.use('/api/...', require('./routes/<nome>'))`.
- `routes/chat.js` é especial — exporta `{ routerAluna, routerAtendimento, registrarWsAluna, registrarWsAtendimento }`.
