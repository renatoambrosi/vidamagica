/* ============================================================
   VIDA MÁGICA — routes/painel-aluna.js
   Endpoints que ADMIN e ATENDIMENTO ambos precisam acessar.

   Autenticação: autenticarPainelHibrido (aceita escopo 'admin' OU 'atendimento').
   Prefixo: /api/painel-aluna

   Endpoints:
     GET    /produtos                      → lista de produtos cadastrados (dropdown)
     GET    /usuarios/:id/produtos         → produtos liberados pra essa aluna
     POST   /usuarios/:id/produtos         → libera produto manualmente
     DELETE /usuarios/:id/produtos/:upId   → revoga acesso
     GET    /usuarios/:id/jornada          → jornada atual + recomendações
   ============================================================ */

const express = require('express');
const router = express.Router();
const { autenticarPainelHibrido } = require('../middleware/autenticar');

router.use(autenticarPainelHibrido);

// ── GET /produtos ───────────────────────────────────────────
router.get('/produtos', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const r = await poolCore.query(
      `SELECT id, slug, nome, tipo, acesso_modelo, link_checkout_padrao, ativo
         FROM produtos
        WHERE ativo = true
        ORDER BY ordem, nome`
    );
    return res.json({ ok: true, produtos: r.rows });
  } catch (err) {
    console.error('[painel-aluna/produtos] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /usuarios/:id/produtos ──────────────────────────────
router.get('/usuarios/:id/produtos', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const usuarioId = req.params.id;

    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
    if (!u.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const telefone = u.rows[0].telefone;

    const r = await poolCore.query(
      `SELECT up.id, up.produto_id, up.origem_tipo, up.acesso_inicio, up.acesso_fim,
              up.ativo, up.observacao,
              p.slug, p.nome, p.tipo, p.imagem_url
         FROM usuario_produtos up
         LEFT JOIN produtos p ON p.id = up.produto_id
        WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2)
        ORDER BY up.ativo DESC, up.acesso_inicio DESC`,
      [usuarioId, telefone]
    );
    return res.json({ ok: true, produtos: r.rows });
  } catch (err) {
    console.error('[painel-aluna/usuarios/:id/produtos] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── POST /usuarios/:id/produtos ─────────────────────────────
router.post('/usuarios/:id/produtos', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const usuarioId = req.params.id;
    let { produto_id, produto_slug, origem_tipo, observacao } = req.body || {};

    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
    if (!u.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const telefone = u.rows[0].telefone;

    if (!produto_id && produto_slug) {
      const p = await poolCore.query(`SELECT id FROM produtos WHERE slug = $1`, [produto_slug]);
      if (!p.rows[0]) return res.status(400).json({ ok: false, erro: 'produto não encontrado' });
      produto_id = p.rows[0].id;
    }
    if (!produto_id) return res.status(400).json({ ok: false, erro: 'produto_id ou produto_slug obrigatório' });

    if (!['cortesia', 'manual'].includes(origem_tipo)) {
      origem_tipo = 'manual';
    }

    const exist = await poolCore.query(
      `SELECT id FROM usuario_produtos
        WHERE (usuario_id = $1 OR telefone_canonico = $2)
          AND produto_id = $3 AND ativo = true
        LIMIT 1`,
      [usuarioId, telefone, produto_id]
    );
    if (exist.rows[0]) {
      await poolCore.query(
        `UPDATE usuario_produtos SET observacao = COALESCE($1, observacao), atualizado_em = NOW() WHERE id = $2`,
        [observacao || null, exist.rows[0].id]
      );
      return res.json({ ok: true, id: exist.rows[0].id, ja_existia: true });
    }

    const r = await poolCore.query(
      `INSERT INTO usuario_produtos (usuario_id, telefone_canonico, produto_id, origem_tipo, observacao, ativo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id`,
      [usuarioId, telefone, produto_id, origem_tipo, observacao || null]
    );
    return res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error('[painel-aluna POST] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── DELETE /usuarios/:id/produtos/:upId ─────────────────────
router.delete('/usuarios/:id/produtos/:upId', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const r = await poolCore.query(
      `UPDATE usuario_produtos SET ativo = false, atualizado_em = NOW()
        WHERE id = $1 AND (usuario_id = $2 OR telefone_canonico = (SELECT telefone FROM usuarios WHERE id = $2))`,
      [req.params.upId, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, erro: 'não encontrado' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[painel-aluna DELETE] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /usuarios/:id/jornada ───────────────────────────────
router.get('/usuarios/:id/jornada', async (req, res) => {
  try {
    const { poolCore, poolTeste, poolComunicacao } = require('../db');
    const { calcularResultado, montarJornada } = require('../core/teste-resultado');

    const usuarioId = req.params.id;
    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
    if (!u.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const telefone = u.rows[0].telefone;

    const tR = await poolTeste.query(
      `SELECT id, respostas, perfil_dominante, feito_em
         FROM testes
        WHERE usuario_id = $1 OR telefone_canonico = $2
        ORDER BY feito_em DESC LIMIT 1`,
      [usuarioId, telefone]
    );
    if (!tR.rows[0]) {
      return res.json({ ok: true, jornada: null, motivo: 'Aluna ainda não fez o teste.' });
    }
    const teste = tR.rows[0];
    const respostas = Array.isArray(teste.respostas) ? teste.respostas : JSON.parse(teste.respostas || '[]');
    const calc = calcularResultado(respostas);

    const mapR = await poolComunicacao.query(
      `SELECT j.slug, j.numero, j.nome_exibicao, j.subtitulo, j.cor
         FROM jornadas_perfis_map m
         JOIN jornadas_metodo j ON j.slug = m.jornada_slug
        WHERE m.perfil_slug = $1`,
      [calc.perfil_dominante]
    );
    if (!mapR.rows[0]) {
      return res.json({ ok: true, jornada: null, motivo: 'Sem jornada mapeada para o perfil ' + calc.perfil_dominante });
    }
    const jornadaCfg = mapR.rows[0];

    const passosR = await poolComunicacao.query(
      `SELECT ordem, produto_slug, titulo_passo, descricao_passo
         FROM jornadas_passos
        WHERE jornada_slug = $1 ORDER BY ordem`,
      [jornadaCfg.slug]
    );
    jornadaCfg.passos = passosR.rows;

    const compR = await poolCore.query(
      `SELECT p.slug FROM usuario_produtos up
         JOIN produtos p ON p.id = up.produto_id
        WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2) AND up.ativo = true`,
      [usuarioId, telefone]
    );
    const slugsComprados = new Set(compR.rows.map(r => r.slug));

    const prodR = await poolCore.query(
      `SELECT slug, nome, link_checkout_padrao, imagem_url
         FROM produtos WHERE slug = ANY($1::text[])`,
      [passosR.rows.map(p => p.produto_slug)]
    );

    const jornada = montarJornada(jornadaCfg, slugsComprados, prodR.rows, { fezTeste: true });

    return res.json({
      ok: true,
      teste_id: teste.id,
      perfil_dominante: calc.perfil_dominante,
      jornada,
    });
  } catch (err) {
    console.error('[painel-aluna/jornada] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

module.exports = router;
