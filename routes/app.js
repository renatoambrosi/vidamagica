/* ============================================================
   VIDA MÁGICA — routes/app.js
   Endpoint central que alimenta TODAS as telas do /app.

   GET /api/app/contexto
   - Autenticado (JWT da aluna)
   - Devolve UM pacote com tudo que qualquer view do app precisa:
     dados da aluna, teste mais recente concluído, teste em andamento,
     jornada atual com passos do método, todos os testes históricos,
     produtos comprados.

   Princípio: nenhuma tela do app calcula nada. O contexto é a verdade.
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolCore, poolTeste, poolComunicacao } = require('../db');
const { autenticar } = require('../middleware/autenticar');
const {
  calcularResultado,
  montarLivrosRecomendados,
  montarListaEnergias,
  montarJornada,
} = require('../core/teste-resultado');
const { calcularJornadaVigente, temClubeVidaMagica } = require('../core/jornadas');
const { creditarSementes } = require('../core/sementes');

/* ============================================================
   ⚠️  MODO DEV — TESOURO INFINITO  ⚠️   (NÃO é bug, é proposital)
   ============================================================
   Enquanto o sistema está em fase de validação (só o Renato usa
   antes de abrir pra alunas reais), o Baú do Tesouro permite
   resgatar várias vezes — pra validar animação, modal, semente
   voando, etc., sem precisar de painel admin nem múltiplas contas.

   Quando estiver `true`:
   - GET /api/app/tesouro/disponivel ignora histórico de resgates
     da aluna e SEMPRE devolve o primeiro item ativo do feed.
   - POST /api/app/tesouro/:id/resgatar deleta o registro anterior
     de `tesouros_resgatados` antes do INSERT, permitindo crédito
     repetido da semente (passa pelo helper normalmente).

   ROTAS AFETADAS (procurar TESOURO_INFINITO_DEV neste arquivo):
   - GET  /tesouro/disponivel        — bloco do `tesouro = ...`
   - POST /tesouro/:id/resgatar      — bloco do DELETE antes do INSERT

   COMO REVERTER quando abrir pra alunas reais:
   ► Trocar a constante abaixo de `true` pra `false`. Só isso.
   ► O comportamento volta a ser 1 resgate por aluna por tesouro,
     com idempotência forte no ledger de sementes.

   Mesmo padrão do `|| true` em /relatos:164 e :337 (gateway de
   pagamento). Não tratar como bug nem sugerir remover — é decisão.
   ============================================================ */
const TESOURO_INFINITO_DEV = true;

// ── GET /api/app/contexto ───────────────────────────────────
router.get('/contexto', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;

    // ── 1. Aluna ─────────────────────────────────────────────
    const uRows = await poolCore.query(
      `SELECT id, nome, nome_preferencia, genero, ocupacao, cpf, data_nascimento,
              telefone, telefone_formatado, telefone_validado_em,
              email, email_verificado, foto_url, plano, sementes,
              perfil_teste, percentual_prosperidade, criado_em, senha_hash
         FROM usuarios WHERE id = $1`,
      [usuarioId]
    );
    if (!uRows.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const aluna = uRows.rows[0];
    // Como ela quer ser chamada: usa nome_preferencia se houver, senão
    // primeiro nome do canônico. Aluna pode editar em "Informações do
    // meu perfil".
    const primeiroNome = (aluna.nome_preferencia && aluna.nome_preferencia.trim())
      || (aluna.nome || '').split(' ')[0]
      || 'Você';

    // ── 2. Produtos comprados (usuario_produtos) ─────────────
    // Cruzamento por usuario_id OU telefone_canonico (caso ela tenha comprado
    // como lead antes de virar usuário registrado).
    const compradosRows = await poolCore.query(
      `SELECT up.id, up.produto_id, up.origem_tipo, up.acesso_inicio, up.acesso_fim, up.ativo,
              up.observacao, p.slug, p.nome, p.tipo, p.imagem_url
         FROM usuario_produtos up
         LEFT JOIN produtos p ON p.id = up.produto_id
        WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2)
          AND up.ativo = true
        ORDER BY up.acesso_inicio DESC`,
      [usuarioId, aluna.telefone]
    );
    const comprados = compradosRows.rows;
    const slugsComprados = new Set(comprados.map(c => c.slug).filter(Boolean));

    // ── 3. Testes — TODOS (mais recente primeiro) ────────────
    // Cruzamento idem: por usuario_id OU telefone (vinculação histórica)
    const testesRows = await poolTeste.query(
      `SELECT t.id, t.usuario_id, t.lead_id, t.versao_id, t.respostas, t.contagem,
              t.percentuais, t.perfil_dominante, t.percentual_prosperidade, t.nivel_prosperidade,
              t.feito_em, t.visto_em, t.ativou_trilha, t.pago, v.nome AS versao_nome
         FROM testes t
         LEFT JOIN teste_versoes v ON v.id = t.versao_id
        WHERE t.usuario_id = $1 OR t.telefone_canonico = $2
        ORDER BY t.feito_em DESC`,
      [usuarioId, aluna.telefone]
    );
    const todosTestes = testesRows.rows;

    // ── 4. Teste em andamento (lead com respostas, sem teste concluído) ──
    let testeEmAndamento = null;
    try {
      const versaoAtivaR = await poolTeste.query(
        `SELECT id, nome FROM teste_versoes WHERE status='ativa' LIMIT 1`
      );
      const versaoAtiva = versaoAtivaR.rows[0];
      if (versaoAtiva) {
        // Procura lead da aluna (por usuario_id ou telefone)
        const leadR = await poolTeste.query(
          `SELECT id FROM teste_leads
            WHERE usuario_id = $1 OR telefone_canonico = $2
            ORDER BY criado_em DESC LIMIT 1`,
          [usuarioId, aluna.telefone]
        );
        const lead = leadR.rows[0];
        if (lead) {
          // Tem respostas dela na versão ativa que NÃO foram finalizadas?
          const respR = await poolTeste.query(
            `SELECT COUNT(*)::int AS n, MIN(respondido_em) AS iniciado_em
               FROM teste_respostas
              WHERE lead_id = $1 AND versao_id = $2`,
            [lead.id, versaoAtiva.id]
          );
          const n = respR.rows[0].n;
          if (n > 0 && n < 15) {
            // Confirma que NÃO existe teste concluído pra esse lead na versão ativa
            const concR = await poolTeste.query(
              `SELECT 1 FROM testes WHERE lead_id = $1 AND versao_id = $2 LIMIT 1`,
              [lead.id, versaoAtiva.id]
            );
            if (!concR.rows[0]) {
              testeEmAndamento = {
                lead_id: lead.id,
                versao_id: versaoAtiva.id,
                versao_nome: versaoAtiva.nome,
                respondidas: n,
                total: 15,
                iniciado_em: respR.rows[0].iniciado_em,
              };
            }
          }
        }
      }
    } catch (e) {
      console.warn('[contexto] erro ao detectar teste em andamento:', e.message);
    }

    // ── 5. Teste atual = mais recente com TRILHA ATIVADA ────
    // Regra: a jornada/perfil da aluna no app só atualiza quando ela
    // confirma "Sim, atualizar" no popup ao ver um re-teste (ou no banner
    // "Atualizar agora"). No primeiro teste, é ativado automaticamente.
    // Antes da ativação, o app continua mostrando o teste anterior ativo.
    let testeAtual = null;
    let jornadaAtual = null;
    let jornadaVigente = null;
    let conteudoPerfil = null;

    const testeMaisRecente = todosTestes.find(t => t.ativou_trilha);

    // Teste aguardando ativação: já foi visto MAS não foi ativado ainda.
    // Ex: aluna refez o teste, viu o resultado, escolheu "Não" no popup ou
    // ainda não decidiu — fica como pendente pra mostrar banner/aviso.
    const testeAguardandoAtivacao = todosTestes.find(t =>
      t.visto_em && !t.ativou_trilha && (!testeMaisRecente || t.id !== testeMaisRecente.id)
    );

    if (testeMaisRecente) {
      // Recalcula com a lógica oficial (não confia 100% no que está salvo).
      const respostas = Array.isArray(testeMaisRecente.respostas)
        ? testeMaisRecente.respostas
        : (typeof testeMaisRecente.respostas === 'string'
           ? JSON.parse(testeMaisRecente.respostas)
           : []);
      const calc = calcularResultado(respostas);
      const energias = montarListaEnergias(calc);

      // Conteúdo do perfil (banco Comunicação)
      const cR = await poolComunicacao.query(
        `SELECT * FROM teste_perfis_conteudo WHERE slug = $1`,
        [calc.perfil_dominante]
      );
      conteudoPerfil = cR.rows[0] || null;

      // O teste é "pago" quando o registro tem pago=true OU quando a aluna
      // tem o produto teste_subconsciente liberado em usuario_produtos.
      // (slug com underscore — alinhado com Preços, fonte da verdade dos slugs)
      //
      // ⚠️ TEMPORÁRIO ⚠️ — enquanto o gateway de pagamento não está implementado,
      // todos os testes são considerados pagos pra liberar acesso ao resultado.
      // Quando o webhook do Kiwify entrar em produção, REMOVER `|| true`.
      const pago = !!testeMaisRecente.pago || slugsComprados.has('teste_subconsciente') || true;

      testeAtual = {
        id: testeMaisRecente.id,
        feito_em: testeMaisRecente.feito_em,
        visto_em: testeMaisRecente.visto_em,
        versao_nome: testeMaisRecente.versao_nome,
        perfil_dominante: calc.perfil_dominante,            // ex: prosperidade_nv2
        perfil_dominante_bruto: calc.perfil_dominante_bruto, // ex: prosperidade
        nome_exibicao: conteudoPerfil?.nome_exibicao || calc.perfil_dominante,
        energias,
        pago,
        conteudo: conteudoPerfil,
      };

      // ── 6. Jornada atual da aluna ───────────────────────
      // Usa o mapa perfil → jornada, monta os passos com estado de "comprado"
      try {
        const mapR = await poolComunicacao.query(
          `SELECT j.slug, j.numero, j.nome_exibicao, j.subtitulo, j.cor
             FROM jornadas_perfis_map m
             JOIN jornadas_metodo j ON j.slug = m.jornada_slug
            WHERE m.perfil_slug = $1`,
          [calc.perfil_dominante]
        );
        const jornadaCfg = mapR.rows[0];
        if (jornadaCfg) {
          // Passos da jornada
          const passosR = await poolComunicacao.query(
            `SELECT ordem, produto_slug, titulo_passo, descricao_passo
               FROM jornadas_passos
              WHERE jornada_slug = $1
              ORDER BY ordem`,
            [jornadaCfg.slug]
          );
          jornadaCfg.passos = passosR.rows;

          // Dados dos produtos da jornada — fonte: tabela `precos` (banco Comunicação)
          const slugsPassos = passosR.rows.map(p => p.produto_slug);
          const precosR = await poolComunicacao.query(
            `SELECT key, dados FROM precos WHERE key = ANY($1::text[])`,
            [slugsPassos]
          );
          const precosBySlug = {};
          precosR.rows.forEach(r => { precosBySlug[r.key] = r.dados || {}; });

          jornadaAtual = montarJornada(jornadaCfg, slugsComprados, precosBySlug, { fezTeste: true });
        }
      } catch (e) {
        console.warn('[contexto] erro ao montar jornada:', e.message);
      }
      // ── 6.b Jornada vigente (via core/jornadas.js) ───────
      // Função canônica que substitui a lógica antiga baseada em tabelas
      // `jornadas_metodo`/`jornadas_passos`/`jornadas_perfis_map`. Aqui
      // calculamos tudo em código: aplica regra do override (trava forte
      // >20%), distribui pesos (P1/P2/P3), cruza com slugsComprados pra
      // marcar concluído. Mantém `jornadaAtual` ao lado pra retrocompat.
      try {
        jornadaVigente = calcularJornadaVigente({
          perfil_dominante: calc.perfil_dominante,
          perfil_dominante_bruto: calc.perfil_dominante_bruto,
          percentuais_exibicao: calc.percentuais_exibicao,
          nivel_prosperidade: calc.nivel_prosperidade,
          slugsComprados,
        });
      } catch (e) {
        console.warn('[contexto] erro ao calcular jornadaVigente:', e.message);
      }
    }

    // ── Outros produtos (catálogo completo da aba Preços) ──
    // O frontend filtra os já comprados e os da jornada, e mostra o resto.
    // Também serve como FONTE DA VERDADE pra enriquecer os comprados com
    // imagem_url/nome canônicos (que vivem na aba Preços, não na tabela produtos).
    let outrosProdutos = [];
    const precosBySlugAll = {};  // mapa slug → dados de precos pra enriquecer comprados
    try {
      const todosR = await poolComunicacao.query(
        `SELECT key, dados FROM precos ORDER BY key`
      );
      todosR.rows.forEach(r => { precosBySlugAll[r.key] = r.dados || {}; });
      outrosProdutos = todosR.rows.map(r => ({
        slug: r.key,
        nome: (r.dados || {}).nome || r.key,
        imagem_url: (r.dados || {}).imagem_url || '',
        tipo: (r.dados || {}).tipo || '',
        link_checkout_padrao: (r.dados || {}).link_checkout_padrao || '',
        link_checkout_aluno: (r.dados || {}).link_checkout_aluno || '',
      }));
    } catch (e) {
      console.warn('[contexto] erro ao buscar catálogo:', e.message);
    }

    // ── Normalização de slugs antigos (hífen → underscore) ──
    // Failsafe caso a tabela produtos ainda tenha registros legados com hífen.
    // Em precos os slugs estão sempre com underscore (canônico).
    const SLUG_LEGADO_MAP = {
      'teste-subconsciente':           'teste_subconsciente',
      'teste-prosperidade':            'teste_prosperidade',
      'livro-vencendo-medo':           'vencendo_medo',
      'livro-vencendo-desordem':       'vencendo_desordem',
      'livro-vencendo-validacao':      'vencendo_validacao',
      'livro-vencendo-sobrevivencia':  'vencendo_sobrevivencia',
      'curso-ouro-reprogramacao':      'ouro_reprogramacao',
      'assinatura-comunidade':         'clube_vida_magica',
      'guia-pratico-reprogramar':      'guia_pratico',
      'guia-bolso-magica-fluir':       'magica_fluir',
      'livro-tal-maneira':             'atal_maneira_livro',
      'curso-lda-biblica':             'lda_biblica',
      'curso-tal-maneira':             'atal_maneira_curso',
    };
    const normalizarSlug = (slug) => SLUG_LEGADO_MAP[slug] || slug;

    // ── Atualizações pendentes (compra/teste/etc) ──────────
    // Carregadas SEMPRE com /contexto pra o frontend já saber se precisa
    // exibir banner / aviso / splash de celebração.
    let atualizacoesPendentes = [];
    try {
      const aR = await poolCore.query(
        `SELECT id, tipo, payload, criado_em
           FROM atualizacoes_pendentes
          WHERE usuario_id = $1 AND consumido_em IS NULL
          ORDER BY criado_em DESC`,
        [usuarioId]
      );
      atualizacoesPendentes = aR.rows;
    } catch (e) {
      console.warn('[contexto] erro ao buscar atualizações pendentes:', e.message);
    }

    // ── Resposta ─────────────────────────────────────────────
    return res.json({
      ok: true,
      aluna: {
        id: aluna.id,
        nome: aluna.nome,
        nome_preferencia: aluna.nome_preferencia || null,
        primeiro_nome: primeiroNome,
        genero: aluna.genero || null,
        ocupacao: aluna.ocupacao || null,
        cpf: aluna.cpf || null,
        data_nascimento: aluna.data_nascimento || null,
        telefone_formatado: aluna.telefone_formatado,
        telefone_verificado: !!aluna.telefone_validado_em,
        email: aluna.email,
        email_verificado: !!aluna.email_verificado,
        foto_url: aluna.foto_url || null,
        plano: aluna.plano,
        sementes: aluna.sementes || 0,
        criado_em: aluna.criado_em,
        // Aluna que NUNCA definiu senha (só usa OTP) vê "Crie sua senha";
        // quem já definiu vê "Trocar sua senha" (com senha atual obrigatória).
        tem_senha: !!aluna.senha_hash,
      },
      teste_atual: testeAtual,
      teste_em_andamento: testeEmAndamento,
      // Teste aguardando ativação: aluna fez re-teste, viu o resultado, mas
      // ainda não ativou a trilha. Frontend mostra banner "Seu novo perfil
      // está pronto pra atualizar sua jornada. Quero atualizar →".
      teste_aguardando_ativacao: testeAguardandoAtivacao ? {
        id: testeAguardandoAtivacao.id,
        feito_em: testeAguardandoAtivacao.feito_em,
        visto_em: testeAguardandoAtivacao.visto_em,
      } : null,
      // Atualizações pendentes (compra de produto, ativação de teste).
      // Cada atualização gera animação de celebração na próxima visita ao
      // app, com a barra de progresso real animando 0 → percentual atual.
      atualizacoes_pendentes: atualizacoesPendentes,
      jornada_atual: jornadaAtual,
      // jornada_vigente: nova fonte da verdade (core/jornadas.js).
      // Frontend novo lê daqui; o `jornada_atual` fica pra retrocompat.
      jornada_vigente: jornadaVigente,
      // tem_clube: aluna tem Clube Vida Mágica ativo (plano !== 'gratuito')
      tem_clube: temClubeVidaMagica({ plano: aluna.plano }),
      todos_testes: todosTestes.map(t => ({
        id: t.id,
        feito_em: t.feito_em,
        visto_em: t.visto_em,
        ativou_trilha: !!t.ativou_trilha,
        versao_nome: t.versao_nome,
        perfil_dominante: t.perfil_dominante,
        percentual_prosperidade: t.percentual_prosperidade,
        // pago vem do registro OU do produto liberado em usuario_produtos.
        // ⚠️ TEMPORÁRIO ⚠️ — `|| true` libera todos os testes enquanto o gateway
        // de pagamento não está implementado. REMOVER quando o webhook entrar.
        pago: !!t.pago || slugsComprados.has('teste_subconsciente') || true,
      })),
      // Enriquece com dados de Preços (fonte da verdade pra imagem/nome).
      // O JOIN com `produtos` na query cobre só campos básicos (slug/tipo);
      // imagem_url/nome canônicos vêm de precos. Slugs legados (com hífen) são
      // normalizados pra encontrar o produto correto em precos (underscore).
      comprados: comprados.map(c => {
        const slugCanonico = normalizarSlug(c.slug);
        const precos = precosBySlugAll[slugCanonico] || {};
        return {
          id: c.id,
          produto_slug: slugCanonico,
          produto_nome: precos.nome || c.nome,
          produto_tipo: precos.tipo || c.tipo,
          produto_imagem: precos.imagem_url || c.imagem_url || '',
          origem_tipo: c.origem_tipo,
          acesso_inicio: c.acesso_inicio,
          acesso_fim: c.acesso_fim,
          observacao: c.observacao,
        };
      }),
      outros_produtos: outrosProdutos,
    });
  } catch (err) {
    console.error('[app/contexto] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// ATUALIZAÇÕES PENDENTES (jornada)
// ──────────────────────────────────────────────────────────
// Lista as atualizações que a aluna ainda não consumiu. O frontend
// usa pra decidir se mostra banner "atualizar jornada" / aviso no
// sino / splash de celebração na próxima visita.
router.get('/atualizacoes', autenticar, async (req, res) => {
  try {
    const r = await poolCore.query(
      `SELECT id, tipo, payload, criado_em
         FROM atualizacoes_pendentes
        WHERE usuario_id = $1 AND consumido_em IS NULL
        ORDER BY criado_em DESC`,
      [req.usuario.sub]
    );
    return res.json({ ok: true, atualizacoes: r.rows });
  } catch (err) {
    console.error('[app/atualizacoes] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// Marca uma atualização como consumida (aluna viu a splash de celebração).
router.post('/atualizacoes/:id/consumir', autenticar, async (req, res) => {
  try {
    const id = (req.params.id || '').toString().trim();
    if (!id) return res.status(400).json({ ok: false, erro: 'id ausente' });
    const r = await poolCore.query(
      `UPDATE atualizacoes_pendentes
          SET consumido_em = NOW()
        WHERE id = $1 AND usuario_id = $2 AND consumido_em IS NULL
        RETURNING id`,
      [id, req.usuario.sub]
    );
    return res.json({ ok: true, marcou: r.rowCount > 0 });
  } catch (err) {
    console.error('[app/atualizacoes/consumir] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ════════════════════════════════════════════════════════════════════
// RELATOS — Fase 2.1 (aluna posta) + 2.2 (reage + Baú)
// Pool: poolComunicacao (depoimentos vive lá), mas ID da aluna vem do JWT
// (poolCore). Cross-pool feito em JS, sem JOIN.
// ════════════════════════════════════════════════════════════════════

// POST /api/app/relato — aluna posta um relato (vai pra moderação)
// Body: { texto: string }
// Limite: 1 relato pendente por aluna por vez (evita spam acidental).
// Limite mensal: 1 relato por aluna por mês (regra de produto — força transformação real, não spam).
router.post('/relato', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const texto = (req.body && req.body.texto || '').toString().trim();
    if (!texto || texto.length < 20) {
      return res.status(400).json({ ok: false, erro: 'O relato precisa ter pelo menos 20 caracteres' });
    }
    if (texto.length > 2000) {
      return res.status(400).json({ ok: false, erro: 'O relato é grande demais (máximo 2000 caracteres)' });
    }

    // Busca dados da aluna pra montar o snapshot (nome + assinatura no momento)
    const uRows = await poolCore.query(
      `SELECT id, nome, plano FROM usuarios WHERE id = $1`,
      [usuarioId]
    );
    if (!uRows.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const aluna = uRows.rows[0];
    const eAssinante = !!(aluna.plano && aluna.plano !== 'gratuito');

    // Regra anti-spam: se já tem 1 pendente, recusa
    const pend = await poolComunicacao.query(
      `SELECT id FROM depoimentos
        WHERE usuario_id = $1 AND status_moderacao = 'pendente'
        LIMIT 1`,
      [usuarioId]
    );
    if (pend.rows[0]) {
      return res.status(409).json({
        ok: false,
        erro: 'Você já tem um relato em análise. Aguarde a aprovação antes de enviar outro.',
        relato_pendente_id: pend.rows[0].id,
      });
    }

    // Regra de produto: 1 relato aprovado por mês (calendário rolling — últimos 30 dias)
    const mensal = await poolComunicacao.query(
      `SELECT COUNT(*) AS qtd FROM depoimentos
        WHERE usuario_id = $1 AND status_moderacao = 'aprovado'
          AND criado_em > NOW() - INTERVAL '30 days'`,
      [usuarioId]
    );
    if (parseInt(mensal.rows[0].qtd, 10) >= 1) {
      return res.status(429).json({
        ok: false,
        erro: 'Você já compartilhou um relato neste mês. Volte daqui a alguns dias 🌱',
      });
    }

    // Insere o relato pendente. Tema + categorias são preenchidos pelo admin na moderação.
    const ins = await poolComunicacao.query(
      `INSERT INTO depoimentos
         (nome, usuario_id, texto, status_moderacao, ativo, mostrar_no_ticker,
          gerado_por_ia, autora_era_assinante_clube, tags, ordem)
       VALUES ($1, $2, $3, 'pendente', TRUE, FALSE, FALSE, $4, '{}', 0)
       RETURNING id, criado_em`,
      [aluna.nome || 'Aluna Vida Mágica', usuarioId, texto, eAssinante]
    );

    return res.json({
      ok: true,
      relato: {
        id: ins.rows[0].id,
        status: 'pendente',
        criado_em: ins.rows[0].criado_em,
      },
    });
  } catch (err) {
    console.error('[app/relato POST] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// GET /api/app/meus-relatos — lista relatos da aluna logada (pendentes + aprovados + rejeitados)
router.get('/meus-relatos', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const r = await poolComunicacao.query(
      `SELECT d.id, d.texto, d.status_moderacao, d.motivo_rejeicao,
              d.criado_em, d.atualizado_em,
              d.tema_id, t.slug AS tema_slug, t.nome AS tema_nome
         FROM depoimentos d
         LEFT JOIN temas t ON t.id = d.tema_id
        WHERE d.usuario_id = $1
        ORDER BY d.criado_em DESC`,
      [usuarioId]
    );
    return res.json({ ok: true, relatos: r.rows });
  } catch (err) {
    console.error('[app/meus-relatos] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ════════════════════════════════════════════════════════════════════
// REAÇÕES (Fase 2.2) — quero / ja_vivo / nao_e_pra_mim / parabens
// Regras:
//   - quero | ja_vivo | nao_e_pra_mim são MUTUAMENTE EXCLUSIVAS (1 só por relato)
//   - parabens é INDEPENDENTE (pode acumular com qualquer outra)
//   - Toda reação salva no Baú (UNIQUE evita duplicar). Mesmo se removida depois,
//     a entrada do Baú permanece (histórico comportamental).
// ════════════════════════════════════════════════════════════════════
const TIPOS_REACAO = ['quero', 'ja_vivo', 'nao_e_pra_mim', 'parabens'];
const TIPOS_EXCLUSIVOS = ['quero', 'ja_vivo', 'nao_e_pra_mim'];

// POST /api/app/relato/:id/reagir { tipo }  → adiciona/troca reação
router.post('/relato/:id/reagir', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const depoimentoId = parseInt(req.params.id, 10);
    const tipo = String((req.body && req.body.tipo) || '').trim();

    if (!Number.isFinite(depoimentoId)) return res.status(400).json({ ok: false, erro: 'id inválido' });
    if (!TIPOS_REACAO.includes(tipo)) return res.status(400).json({ ok: false, erro: 'tipo inválido' });

    // Confere se o relato existe e está visível publicamente
    const rel = await poolComunicacao.query(
      `SELECT id FROM depoimentos
        WHERE id = $1 AND ativo = TRUE AND status_moderacao = 'aprovado'
          AND oculto_por_conta_inativa = FALSE LIMIT 1`,
      [depoimentoId]
    );
    if (!rel.rows[0]) return res.status(404).json({ ok: false, erro: 'relato não encontrado ou não disponível' });

    // Se o tipo é exclusivo, remove os outros 2 exclusivos antes de inserir o novo
    if (TIPOS_EXCLUSIVOS.includes(tipo)) {
      const outros = TIPOS_EXCLUSIVOS.filter(t => t !== tipo);
      await poolComunicacao.query(
        `DELETE FROM depoimento_reacoes
          WHERE depoimento_id = $1 AND usuario_id = $2 AND tipo = ANY($3)`,
        [depoimentoId, usuarioId, outros]
      );
    }

    // Insere a reação (idempotente — se já existe, não duplica)
    await poolComunicacao.query(
      `INSERT INTO depoimento_reacoes (depoimento_id, usuario_id, tipo)
       VALUES ($1, $2, $3)
       ON CONFLICT (depoimento_id, usuario_id, tipo) DO NOTHING`,
      [depoimentoId, usuarioId, tipo]
    );

    // Salva no Baú (idempotente, fica pra sempre)
    await poolComunicacao.query(
      `INSERT INTO relatos_salvos_bau (usuario_id, depoimento_id, tipo_reacao)
       VALUES ($1, $2, $3)
       ON CONFLICT (usuario_id, depoimento_id, tipo_reacao) DO NOTHING`,
      [usuarioId, depoimentoId, tipo]
    );

    // Retorna estado atual (reações da aluna nesse relato + contagens públicas)
    const meu = await poolComunicacao.query(
      `SELECT tipo FROM depoimento_reacoes WHERE depoimento_id = $1 AND usuario_id = $2`,
      [depoimentoId, usuarioId]
    );
    const cont = await poolComunicacao.query(
      `SELECT tipo, COUNT(*)::int AS n FROM depoimento_reacoes
        WHERE depoimento_id = $1 GROUP BY tipo`,
      [depoimentoId]
    );

    return res.json({
      ok: true,
      minhas_reacoes: meu.rows.map(r => r.tipo),
      contagens: cont.rows.reduce((acc, r) => ({ ...acc, [r.tipo]: r.n }), {}),
      primeira_no_bau: true, // o frontend decide se mostra a animação na 1ª vez (via localStorage)
    });
  } catch (err) {
    console.error('[app/relato/reagir POST] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// DELETE /api/app/relato/:id/reagir?tipo=X  → remove uma reação específica
// (Não apaga do Baú — histórico permanece. Só some o "checked" visual no modal.)
router.delete('/relato/:id/reagir', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const depoimentoId = parseInt(req.params.id, 10);
    const tipo = String((req.query && req.query.tipo) || '').trim();

    if (!Number.isFinite(depoimentoId)) return res.status(400).json({ ok: false, erro: 'id inválido' });
    if (!TIPOS_REACAO.includes(tipo)) return res.status(400).json({ ok: false, erro: 'tipo inválido' });

    await poolComunicacao.query(
      `DELETE FROM depoimento_reacoes
        WHERE depoimento_id = $1 AND usuario_id = $2 AND tipo = $3`,
      [depoimentoId, usuarioId, tipo]
    );

    const meu = await poolComunicacao.query(
      `SELECT tipo FROM depoimento_reacoes WHERE depoimento_id = $1 AND usuario_id = $2`,
      [depoimentoId, usuarioId]
    );
    const cont = await poolComunicacao.query(
      `SELECT tipo, COUNT(*)::int AS n FROM depoimento_reacoes
        WHERE depoimento_id = $1 GROUP BY tipo`,
      [depoimentoId]
    );
    return res.json({
      ok: true,
      minhas_reacoes: meu.rows.map(r => r.tipo),
      contagens: cont.rows.reduce((acc, r) => ({ ...acc, [r.tipo]: r.n }), {}),
    });
  } catch (err) {
    console.error('[app/relato/reagir DELETE] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// GET /api/app/relato/:id/reacoes  → minhas_reacoes + contagens (pra hidratar o modal)
router.get('/relato/:id/reacoes', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const depoimentoId = parseInt(req.params.id, 10);
    if (!Number.isFinite(depoimentoId)) return res.status(400).json({ ok: false, erro: 'id inválido' });

    const meu = await poolComunicacao.query(
      `SELECT tipo FROM depoimento_reacoes WHERE depoimento_id = $1 AND usuario_id = $2`,
      [depoimentoId, usuarioId]
    );
    const cont = await poolComunicacao.query(
      `SELECT tipo, COUNT(*)::int AS n FROM depoimento_reacoes
        WHERE depoimento_id = $1 GROUP BY tipo`,
      [depoimentoId]
    );
    return res.json({
      ok: true,
      minhas_reacoes: meu.rows.map(r => r.tipo),
      contagens: cont.rows.reduce((acc, r) => ({ ...acc, [r.tipo]: r.n }), {}),
    });
  } catch (err) {
    console.error('[app/relato/reacoes GET] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// POST /api/app/relato/:id/visto — registra visualização (aluna abriu o modal)
// Idempotente: UPSERT incrementando vezes_visto + atualizando visto_em.
router.post('/relato/:id/visto', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const depoimentoId = parseInt(req.params.id, 10);
    if (!Number.isFinite(depoimentoId)) return res.status(400).json({ ok: false, erro: 'id inválido' });
    await poolComunicacao.query(
      `INSERT INTO depoimento_visualizacoes (depoimento_id, usuario_id, visto_em, vezes_visto)
       VALUES ($1, $2, NOW(), 1)
       ON CONFLICT (depoimento_id, usuario_id)
       DO UPDATE SET visto_em = NOW(), vezes_visto = depoimento_visualizacoes.vezes_visto + 1`,
      [depoimentoId, usuarioId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[app/relato/visto] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// GET /api/app/relatos-feed?limit=N — feed inteligente com algoritmo completo
// Score por relato R pra aluna V (calculado em JS após query):
//   score = RANDOM × novidade × jornada × popularidade × penalidade_visto
// Reset: se TODOS os candidatos foram reagidos, ignora a penalidade_reagido
//        (resolve "esgotou tudo, agora repete").
router.get('/relatos-feed', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 12));

    // 1. Lê config (com fallback caso a row tenha sido apagada manualmente)
    const cRow = await poolComunicacao.query(
      `SELECT dados FROM feed_relevancia_config WHERE chave = 'relevancia' LIMIT 1`
    );
    const cfg = (cRow.rows[0] && cRow.rows[0].dados) || {
      mult_novidade: 5.0, mult_jornada: 3.0, mult_popularidade: 0.5,
      penalidade_visto: 0.4, penalidade_reagido: 0.05, janela_novidade_horas: 48,
    };

    // 2. Pega produtos da jornada vigente da aluna (pra boost de venda)
    let slugsJornada = new Set();
    try {
      const aluna = await poolCore.query(`SELECT id, telefone, plano FROM usuarios WHERE id=$1`, [usuarioId]);
      if (aluna.rows[0]) {
        const testes = await poolTeste.query(
          `SELECT * FROM testes
            WHERE (usuario_id=$1 OR telefone_canonico=$2) AND status='concluido'
            ORDER BY feito_em DESC LIMIT 1`,
          [usuarioId, aluna.rows[0].telefone]
        );
        if (testes.rows[0]) {
          const vigente = calcularJornadaVigente({
            perfilDominante: testes.rows[0].perfil_dominante,
            nivelProsperidade: testes.rows[0].nivel_prosperidade,
            percentualProsperidade: testes.rows[0].percentual_prosperidade,
            plano: aluna.rows[0].plano,
            energiasBrutas: testes.rows[0].energias_brutas,
          });
          if (vigente && Array.isArray(vigente.passos)) {
            for (const p of vigente.passos) {
              if (p.produto_slug) slugsJornada.add(p.produto_slug);
            }
          }
        }
      }
    } catch { /* sem jornada disponível — segue sem boost */ }

    // 3. Busca todos os relatos visíveis + estado da aluna (visto / reagiu) + contagem de reações
    const rel = await poolComunicacao.query(
      `SELECT
         d.id, d.nome, d.profissao, d.idade, d.texto, d.criado_em,
         d.tema_id, t.slug AS tema_slug, t.nome AS tema_nome, t.produto_slug,
         d.autora_era_assinante_clube,
         (SELECT vezes_visto FROM depoimento_visualizacoes v
           WHERE v.depoimento_id = d.id AND v.usuario_id = $1) AS vezes_visto,
         (SELECT COUNT(*)::int FROM depoimento_reacoes r
           WHERE r.depoimento_id = d.id AND r.usuario_id = $1) AS minhas_reacoes_qtd,
         (SELECT COUNT(*)::int FROM depoimento_reacoes r
           WHERE r.depoimento_id = d.id) AS reacoes_publicas
       FROM depoimentos d
       LEFT JOIN temas t ON t.id = d.tema_id
       WHERE d.ativo = TRUE
         AND d.status_moderacao = 'aprovado'
         AND d.oculto_por_conta_inativa = FALSE`,
      [usuarioId]
    );

    if (!rel.rows.length) return res.json({ ok: true, relatos: [] });

    const agora = Date.now();
    const janelaMs = Number(cfg.janela_novidade_horas || 48) * 60 * 60 * 1000;

    // 4. Detecta se TODOS os candidatos já foram reagidos (cenário do "esgotou")
    const todosReagidos = rel.rows.every(r => (r.minhas_reacoes_qtd || 0) > 0);

    // 5. Calcula score por relato
    const scored = rel.rows.map(r => {
      const idadeMs = r.criado_em ? (agora - new Date(r.criado_em).getTime()) : Infinity;
      const ehNovo = idadeMs <= janelaMs;
      const ehJornada = r.produto_slug && slugsJornada.has(r.produto_slug);
      const reacoes = r.reacoes_publicas || 0;
      const jaViu = (r.vezes_visto || 0) > 0;
      const jaReagiu = (r.minhas_reacoes_qtd || 0) > 0;

      let pesoVisto = 1.0;
      if (jaReagiu && !todosReagidos)      pesoVisto = Number(cfg.penalidade_reagido || 0.05);
      else if (jaViu && !jaReagiu)         pesoVisto = Number(cfg.penalidade_visto || 0.4);

      const score = Math.random()
        * (ehNovo ? Number(cfg.mult_novidade || 5.0) : 1)
        * (ehJornada ? Number(cfg.mult_jornada || 3.0) : 1)
        * (1 + Number(cfg.mult_popularidade || 0.5) * Math.log(1 + reacoes))
        * pesoVisto;

      return { ...r, _score: score };
    });

    scored.sort((a, b) => b._score - a._score);
    const top = scored.slice(0, limit).map(({ _score, vezes_visto, minhas_reacoes_qtd, ...rest }) => rest);
    return res.json({ ok: true, relatos: top, reset_aplicado: todosReagidos });
  } catch (err) {
    console.error('[app/relatos-feed] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── TESOURO DA SU — REAÇÃO ✨ "QUERO VIVER ISSO" ──────────────────────
// Salva o tesouro (item do feed) no Baú da aluna, mesma tabela dos relatos.
// Tipo de reação aceito: 'quero' (única reação do tesouro hoje).

const TIPOS_REACAO_TESOURO = ['quero'];

// POST /api/app/tesouro/:id/quero-viver — marca no baú
router.post('/tesouro/:id/quero-viver', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const feedId = parseInt(req.params.id, 10);
    if (!Number.isFinite(feedId)) return res.status(400).json({ ok: false, erro: 'id inválido' });

    // Confere se o tesouro existe e está ativo
    const f = await poolComunicacao.query(
      `SELECT id FROM feed WHERE id = $1 AND ativo = TRUE LIMIT 1`,
      [feedId]
    );
    if (!f.rows[0]) return res.status(404).json({ ok: false, erro: 'tesouro não encontrado' });

    // Insere no baú — idempotente (UNIQUE parcial garante)
    await poolComunicacao.query(
      `INSERT INTO relatos_salvos_bau (usuario_id, tesouro_feed_id, tipo_reacao)
       VALUES ($1, $2, 'quero')
       ON CONFLICT (usuario_id, tesouro_feed_id, tipo_reacao) DO NOTHING`,
      [usuarioId, feedId]
    );

    return res.json({ ok: true, marcado: true });
  } catch (err) {
    console.error('[app/tesouro/quero-viver POST] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// DELETE /api/app/tesouro/:id/quero-viver — desmarca (remove do baú)
router.delete('/tesouro/:id/quero-viver', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const feedId = parseInt(req.params.id, 10);
    if (!Number.isFinite(feedId)) return res.status(400).json({ ok: false, erro: 'id inválido' });

    await poolComunicacao.query(
      `DELETE FROM relatos_salvos_bau
        WHERE usuario_id = $1 AND tesouro_feed_id = $2 AND tipo_reacao = 'quero'`,
      [usuarioId, feedId]
    );
    return res.json({ ok: true, marcado: false });
  } catch (err) {
    console.error('[app/tesouro/quero-viver DELETE] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// POST /api/app/tesouro/:id/resgatar — credita semente (transação atômica + idempotência)
// ⚠️  Sementes são MOEDA REAL. Tudo passa pelo helper core/sementes.js.
router.post('/tesouro/:id/resgatar', autenticar, async (req, res) => {
  const usuarioId = req.usuario.sub;
  const feedId = parseInt(req.params.id, 10);
  console.log('[resgatar] INICIO', { usuarioId, feedId, raw_id: req.params.id, modo_dev: TESOURO_INFINITO_DEV });
  if (!Number.isFinite(feedId)) {
    console.warn('[resgatar] id inválido:', req.params.id);
    return res.status(400).json({ ok: false, erro: 'id inválido' });
  }

  // 1. Valida que o tesouro existe e está ativo (poolComunicacao, fora da transação)
  try {
    const f = await poolComunicacao.query(
      `SELECT id FROM feed WHERE id = $1 AND ativo = TRUE LIMIT 1`,
      [feedId]
    );
    console.log('[resgatar] feed encontrado:', !!f.rows[0]);
    if (!f.rows[0]) return res.status(404).json({ ok: false, erro: 'tesouro não encontrado no feed' });
  } catch (err) {
    console.error('[resgatar] ERRO validação feed:', err.message, err.stack);
    return res.status(500).json({ ok: false, erro: 'feed: ' + (err.message || 'erro') });
  }

  // 2. Recompensa: por enquanto fixo em 1 semente.
  // (Se um dia virar configurável por item do feed, troca por leitura da coluna.)
  const SEMENTES_TESOURO = 1;

  // 3. Transação na poolCore: idempotência + crédito atômico
  let client;
  try {
    client = await poolCore.connect();
    console.log('[resgatar] poolCore.connect OK');
  } catch (err) {
    console.error('[resgatar] ERRO conectando poolCore:', err.message, err.stack);
    return res.status(500).json({ ok: false, erro: 'poolCore: ' + (err.message || 'erro') });
  }

  try {
    await client.query('BEGIN');
    console.log('[resgatar] BEGIN OK');

    // ⚠️ TESOURO_INFINITO_DEV ⚠️ (ver banner no topo do arquivo).
    // Quando true, deleta o registro anterior pra que o INSERT seguinte
    // (que tem UNIQUE(usuario_id, feed_id)) nunca caia em conflito —
    // aluna re-resgata e ganha sementes a cada vez. Pra desligar e
    // voltar à idempotência real: TESOURO_INFINITO_DEV = false (topo do arquivo).
    if (TESOURO_INFINITO_DEV) {
      const del = await client.query(
        `DELETE FROM tesouros_resgatados WHERE usuario_id = $1 AND feed_id = $2`,
        [usuarioId, feedId]
      );
      console.log('[resgatar] DELETE dev rows afetadas:', del.rowCount);
    }

    // Tenta inserir o registro de resgate. UNIQUE(usuario_id, feed_id) garante
    // que mesmo tesouro nunca dá semente 2x. Se já existe, retornamos saldo
    // atual sem creditar (idempotente do ponto de vista do cliente).
    const ins = await client.query(
      `INSERT INTO tesouros_resgatados (usuario_id, feed_id)
       VALUES ($1, $2)
       ON CONFLICT (usuario_id, feed_id) DO NOTHING
       RETURNING id`,
      [usuarioId, feedId]
    );
    console.log('[resgatar] INSERT tesouros_resgatados id:', ins.rows[0]?.id || 'CONFLICT');

    if (!ins.rows[0]) {
      // Já resgatado — retorna saldo atual
      const u = await client.query(`SELECT sementes FROM usuarios WHERE id = $1`, [usuarioId]);
      await client.query('COMMIT');
      console.log('[resgatar] FIM ja_resgatado, saldo:', u.rows[0]?.sementes);
      return res.json({
        ok: true,
        ja_resgatado: true,
        sementes_creditadas: 0,
        saldo: u.rows[0] ? Number(u.rows[0].sementes) || 0 : 0,
      });
    }

    // Credita semente via helper (lock + ledger + update atômicos)
    console.log('[resgatar] chamando creditarSementes...');
    const { saldo_atual, movimentacao_id } = await creditarSementes({
      client,
      usuario_id: usuarioId,
      delta: SEMENTES_TESOURO,
      motivo: 'resgate_tesouro',
      origem_tipo: 'feed',
      origem_id: feedId,
    });
    console.log('[resgatar] creditarSementes OK, saldo:', saldo_atual, 'mov:', movimentacao_id);

    // Atualiza a linha de resgate com referência à movimentação e quantia creditada
    await client.query(
      `UPDATE tesouros_resgatados
          SET movimentacao_id = $1, sementes_creditadas = $2
        WHERE id = $3`,
      [movimentacao_id, SEMENTES_TESOURO, ins.rows[0].id]
    );

    await client.query('COMMIT');
    console.log('[resgatar] FIM creditado, saldo:', saldo_atual);
    return res.json({
      ok: true,
      ja_resgatado: false,
      sementes_creditadas: SEMENTES_TESOURO,
      saldo: saldo_atual,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[resgatar] ERRO no fluxo principal:');
    console.error('  message:', err.message);
    console.error('  code:', err.code);
    console.error('  stack:', err.stack);
    // Devolve mensagem detalhada pro frontend (modo dev — sem alunas reais ainda)
    return res.status(500).json({
      ok: false,
      erro: err.message || 'erro interno',
      codigo: err.code || null,
    });
  } finally {
    if (client) {
      try { client.release(); } catch {}
    }
  }
});

// GET /api/app/tesouro/disponivel — devolve o tesouro de hoje (se houver) com o estado da aluna
// Estado: já resgatou? já marcou ✨? Tudo num só payload pra hidratar a Home.
router.get('/tesouro/disponivel', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;

    // Pega o que serve como "tesouro": primeiro item ativo do feed ainda não
    // resgatado pela aluna. Cruza poolCore (resgates) e poolComunicacao (feed)
    // em código JS (regra: sem JOIN entre bancos).
    const resgatadosR = await poolCore.query(
      `SELECT feed_id FROM tesouros_resgatados WHERE usuario_id = $1`,
      [usuarioId]
    );
    const jaResgatados = new Set(resgatadosR.rows.map(r => r.feed_id));

    const itensR = await poolComunicacao.query(
      `SELECT id, tipo, titulo, subtitulo, corpo, url, imagem_url
         FROM feed
        WHERE ativo = TRUE
        ORDER BY ordem ASC, publicado_em DESC`
    );
    // ⚠️ TESOURO_INFINITO_DEV ⚠️ (ver banner no topo do arquivo).
    // Quando true, ignora histórico de resgates — primeiro item ativo do feed
    // SEMPRE vem como tesouro disponível. Quando false (produção real),
    // só vem item que a aluna ainda NÃO resgatou.
    const tesouro = TESOURO_INFINITO_DEV
      ? (itensR.rows[0] || null)
      : (itensR.rows.find(i => !jaResgatados.has(i.id)) || null);

    let jaQuero = false;
    if (tesouro) {
      const q = await poolComunicacao.query(
        `SELECT 1 FROM relatos_salvos_bau
          WHERE usuario_id = $1 AND tesouro_feed_id = $2 AND tipo_reacao = 'quero' LIMIT 1`,
        [usuarioId, tesouro.id]
      );
      jaQuero = q.rows.length > 0;
    }

    return res.json({
      ok: true,
      tesouro,                       // null se aluna já resgatou tudo do dia
      ja_marcou_quero: jaQuero,
      total_resgatados: jaResgatados.size,
    });
  } catch (err) {
    console.error('[app/tesouro/disponivel] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// GET /api/app/bau — todos os itens salvos da aluna, agrupados por tipo_reacao.
// Unifica relatos (depoimento_id) + tesouros (tesouro_feed_id). Cada item carrega
// `origem: 'relato' | 'tesouro'` pra UI diferenciar o card.
router.get('/bau', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;

    // Relatos salvos
    const rRelatos = await poolComunicacao.query(
      `SELECT b.tipo_reacao, b.salvo_em,
              d.id, d.nome, d.profissao, d.idade, d.texto,
              d.autora_era_assinante_clube,
              d.tema_id, t.slug AS tema_slug, t.nome AS tema_nome, t.produto_slug
         FROM relatos_salvos_bau b
         JOIN depoimentos d ON d.id = b.depoimento_id
         LEFT JOIN temas t ON t.id = d.tema_id
        WHERE b.usuario_id = $1
          AND b.depoimento_id IS NOT NULL
          AND d.ativo = TRUE AND d.status_moderacao = 'aprovado'
          AND d.oculto_por_conta_inativa = FALSE
        ORDER BY b.salvo_em DESC`,
      [usuarioId]
    );

    // Tesouros salvos
    const rTesouros = await poolComunicacao.query(
      `SELECT b.tipo_reacao, b.salvo_em,
              f.id, f.tipo AS feed_tipo, f.titulo, f.subtitulo, f.corpo, f.url, f.imagem_url
         FROM relatos_salvos_bau b
         JOIN feed f ON f.id = b.tesouro_feed_id
        WHERE b.usuario_id = $1
          AND b.tesouro_feed_id IS NOT NULL
          AND f.ativo = TRUE
        ORDER BY b.salvo_em DESC`,
      [usuarioId]
    );

    const abas = { quero: [], ja_vivo: [], nao_e_pra_mim: [], parabens: [] };

    for (const row of rRelatos.rows) {
      if (!abas[row.tipo_reacao]) continue;
      abas[row.tipo_reacao].push({ origem: 'relato', ...row });
    }

    for (const row of rTesouros.rows) {
      if (!abas[row.tipo_reacao]) continue;
      abas[row.tipo_reacao].push({ origem: 'tesouro', ...row });
    }

    // Reordena cada aba pela data de salvamento (DESC) já que misturamos as fontes.
    for (const aba of Object.keys(abas)) {
      abas[aba].sort((a, b) => new Date(b.salvo_em) - new Date(a.salvo_em));
    }

    return res.json({ ok: true, abas });
  } catch (err) {
    console.error('[app/bau] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

module.exports = router;
