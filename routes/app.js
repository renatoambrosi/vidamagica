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

// ── GET /api/app/contexto ───────────────────────────────────
router.get('/contexto', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;

    // ── 1. Aluna ─────────────────────────────────────────────
    const uRows = await poolCore.query(
      `SELECT id, nome, telefone, telefone_formatado, email, plano, sementes,
              perfil_teste, percentual_prosperidade
         FROM usuarios WHERE id = $1`,
      [usuarioId]
    );
    if (!uRows.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const aluna = uRows.rows[0];
    const primeiroNome = (aluna.nome || '').split(' ')[0] || 'Você';

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

    // ── Outros produtos (catálogo completo) ──
    // Junta DUAS fontes (regra: sem JOIN entre bancos, cruzamento em código):
    //   • Core.produtos        → link_checkout_padrao, imagem_url, descricao, ativo
    //   • Comunicação.precos   → nome, preço, link aluno
    // O cruzamento é por slug. O resultado é o catálogo completo pro frontend.
    let outrosProdutos = [];
    const precosBySlugAll = {};
    const produtosBySlugAll = {};
    try {
      // 1. Buscar tabela produtos (Core)
      const prodR = await poolCore.query(
        `SELECT slug, nome, descricao, tipo, imagem_url, link_lp, link_checkout_padrao, ativo, fase, ordem
         FROM produtos WHERE ativo = TRUE OR ativo IS NULL ORDER BY ordem NULLS LAST, slug`
      );
      prodR.rows.forEach(p => { produtosBySlugAll[p.slug] = p; });

      // 2. Buscar tabela precos (Comunicação)
      const todosR = await poolComunicacao.query(
        `SELECT key, dados FROM precos ORDER BY key`
      );
      todosR.rows.forEach(r => { precosBySlugAll[r.key] = r.dados || {}; });

      // 3. Mesclar: união dos slugs das duas tabelas
      const todosSlugs = new Set([
        ...Object.keys(produtosBySlugAll),
        ...Object.keys(precosBySlugAll),
      ]);
      outrosProdutos = Array.from(todosSlugs).map(slug => {
        const p = produtosBySlugAll[slug] || {};
        const pr = precosBySlugAll[slug] || {};
        return {
          slug,
          nome: pr.nome || p.nome || slug,
          descricao: p.descricao || '',
          tipo: pr.tipo || p.tipo || '',
          imagem_url: pr.imagem_url || p.imagem_url || '',
          link_lp: p.link_lp || '',
          link_checkout_padrao: p.link_checkout_padrao || pr.link_checkout_padrao || '',
          link_checkout_aluno: pr.link_checkout_aluno || '',
          fase: p.fase || null,
          ordem: p.ordem || null,
        };
      });
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
        primeiro_nome: primeiroNome,
        telefone_formatado: aluna.telefone_formatado,
        email: aluna.email,
        plano: aluna.plano,
        sementes: aluna.sementes || 0,
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

module.exports = router;
