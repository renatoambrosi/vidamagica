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
              t.feito_em, v.nome AS versao_nome
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

    // ── 5. Teste atual (mais recente concluído) + cálculo ───
    let testeAtual = null;
    let jornadaAtual = null;
    let conteudoPerfil = null;

    const testeMaisRecente = todosTestes[0];
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

      // O teste é "pago" quando a aluna tem produto teste-subconsciente liberado
      const pago = slugsComprados.has('teste-subconsciente');

      testeAtual = {
        id: testeMaisRecente.id,
        feito_em: testeMaisRecente.feito_em,
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

          // Produtos cadastrados (Core) com link de checkout
          const produtosR = await poolCore.query(
            `SELECT slug, nome, link_checkout_padrao, imagem_url
               FROM produtos
              WHERE slug = ANY($1::text[])`,
            [passosR.rows.map(p => p.produto_slug)]
          );

          jornadaAtual = montarJornada(jornadaCfg, slugsComprados, produtosR.rows);
        }
      } catch (e) {
        console.warn('[contexto] erro ao montar jornada:', e.message);
      }
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
      jornada_atual: jornadaAtual,
      todos_testes: todosTestes.map(t => ({
        id: t.id,
        feito_em: t.feito_em,
        versao_nome: t.versao_nome,
        perfil_dominante: t.perfil_dominante,
        percentual_prosperidade: t.percentual_prosperidade,
      })),
      comprados: comprados.map(c => ({
        id: c.id,
        produto_slug: c.slug,
        produto_nome: c.nome,
        produto_tipo: c.tipo,
        produto_imagem: c.imagem_url,
        origem_tipo: c.origem_tipo,
        acesso_inicio: c.acesso_inicio,
        acesso_fim: c.acesso_fim,
        observacao: c.observacao,
      })),
    });
  } catch (err) {
    console.error('[app/contexto] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

module.exports = router;
