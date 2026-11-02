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

// Slug canônico do Clube Vida Mágica. Quando esse produto é liberado/revogado,
// o campo `usuarios.plano` é sincronizado pra que `temClubeVidaMagica()` (que
// olha o plano) reconheça a aluna como assinante.
const SLUG_CLUBE = 'clube_vida_magica';

// ── POST /usuarios/:id/produtos ─────────────────────────────
router.post('/usuarios/:id/produtos', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const usuarioId = req.params.id;
    let { produto_id, produto_slug, origem_tipo, observacao } = req.body || {};

    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
    if (!u.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const telefone = u.rows[0].telefone;

    // Resolve produto_id pelo slug (se veio). Também guarda o slug pra
    // sincronizar plano abaixo.
    let slugResolvido = produto_slug || null;
    if (!produto_id && produto_slug) {
      const p = await poolCore.query(`SELECT id, slug FROM produtos WHERE slug = $1`, [produto_slug]);
      if (!p.rows[0]) return res.status(400).json({ ok: false, erro: 'produto não encontrado' });
      produto_id = p.rows[0].id;
      slugResolvido = p.rows[0].slug;
    } else if (produto_id && !slugResolvido) {
      const p = await poolCore.query(`SELECT slug FROM produtos WHERE id = $1`, [produto_id]);
      slugResolvido = p.rows[0]?.slug || null;
    }
    if (!produto_id) return res.status(400).json({ ok: false, erro: 'produto_id ou produto_slug obrigatório' });

    if (!['cortesia', 'manual'].includes(origem_tipo)) {
      origem_tipo = 'manual';
    }

    // Se está liberando o Clube Vida Mágica, sincroniza usuarios.plano='clube'.
    // É a fonte da verdade que temClubeVidaMagica() consulta. Sem isso, a aluna
    // recebe o produto mas o app continua tratando como gratuita.
    async function sincronizarPlanoSeClube() {
      if (slugResolvido === SLUG_CLUBE) {
        await poolCore.query(
          `UPDATE usuarios SET plano = 'clube', atualizado_em = NOW() WHERE id = $1`,
          [usuarioId]
        );
      }
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
      // Mesmo caso "já existia": sincroniza plano (pode ser que o produto foi
      // liberado antes mas o plano ficou desatualizado num cenário legado).
      await sincronizarPlanoSeClube();
      return res.json({ ok: true, id: exist.rows[0].id, ja_existia: true });
    }

    const r = await poolCore.query(
      `INSERT INTO usuario_produtos (usuario_id, telefone_canonico, produto_id, origem_tipo, observacao, ativo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id`,
      [usuarioId, telefone, produto_id, origem_tipo, observacao || null]
    );
    await sincronizarPlanoSeClube();
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

    // Antes de revogar, descobre qual produto é (pra saber se precisa
    // mexer no plano depois).
    const info = await poolCore.query(
      `SELECT p.slug
         FROM usuario_produtos up
         LEFT JOIN produtos p ON p.id = up.produto_id
        WHERE up.id = $1`,
      [req.params.upId]
    );
    const slugRevogado = info.rows[0]?.slug || null;

    const r = await poolCore.query(
      `UPDATE usuario_produtos SET ativo = false, atualizado_em = NOW()
        WHERE id = $1 AND (usuario_id = $2 OR telefone_canonico = (SELECT telefone FROM usuarios WHERE id = $2))`,
      [req.params.upId, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, erro: 'não encontrado' });

    // Se revogou o Clube Vida Mágica, só volta o plano pra 'gratuito' se NÃO
    // houver outro registro ativo do Clube (proteção contra cortesia + compra).
    if (slugRevogado === SLUG_CLUBE) {
      const tel = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [req.params.id]);
      const telefone = tel.rows[0]?.telefone;
      const aindaTem = await poolCore.query(
        `SELECT 1
           FROM usuario_produtos up
           JOIN produtos p ON p.id = up.produto_id
          WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2)
            AND p.slug = $3
            AND up.ativo = true
          LIMIT 1`,
        [req.params.id, telefone, SLUG_CLUBE]
      );
      if (!aindaTem.rows[0]) {
        await poolCore.query(
          `UPDATE usuarios SET plano = 'gratuito', atualizado_em = NOW() WHERE id = $1`,
          [req.params.id]
        );
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[painel-aluna DELETE] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /usuarios/:id/jornada ───────────────────────────────
router.get('/usuarios/:id/jornada', async (req, res) => {
  try {
    const { poolCore, poolComunicacao } = require('../db');
    const { calcularResultado } = require('../core/teste-resultado');
    const { calcularJornadaVigente, montarJornadaExibicao, buscarTesteDaJornada } = require('../core/jornadas');

    const usuarioId = req.params.id;
    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
    if (!u.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const telefone = u.rows[0].telefone;

    const teste = await buscarTesteDaJornada(usuarioId, telefone);
    if (!teste) {
      return res.json({ ok: true, jornada: null, motivo: 'Aluna ainda não tem jornada ativada.' });
    }
    const respostas = Array.isArray(teste.respostas) ? teste.respostas : JSON.parse(teste.respostas || '[]');
    const calc = calcularResultado(respostas);

    const compR = await poolCore.query(
      `SELECT p.slug FROM usuario_produtos up
         JOIN produtos p ON p.id = up.produto_id
        WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2) AND up.ativo = true`,
      [usuarioId, telefone]
    );
    const slugsComprados = new Set(compR.rows.map(r => r.slug));

    const vigente = calcularJornadaVigente({
      perfil_dominante: calc.perfil_dominante,
      slugsComprados,
    });

    // Dados dos produtos da jornada — fonte: tabela `precos`
    const slugsPassos = vigente.passos.flatMap(p => p.produtos);
    const precosR = await poolComunicacao.query(
      `SELECT key, dados FROM precos WHERE key = ANY($1::text[])`,
      [slugsPassos]
    );
    const precosBySlug = {};
    precosR.rows.forEach(r => { precosBySlug[r.key] = r.dados || {}; });

    const jornada = montarJornadaExibicao(vigente, precosBySlug);

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
