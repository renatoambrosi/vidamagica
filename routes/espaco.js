/* ============================================================
   VIDA MÁGICA — routes/espaco.js
   Endpoints do Espaço da Manifestação (lado da aluna).

   Bancos:
   - poolEspaco → dados do Espaço (tema, manifestações, cartas do tempo…)
   - poolCore   → identidade da aluna (nome, sementes, plano) — só LEITURA

   Auth: todos os endpoints usam `autenticar` (JWT Bearer da aluna).
   Mount em server.js como `app.use('/api/app/espaco', require('./routes/espaco'))`.

   Cruzamento poolEspaco × poolCore é feito em CÓDIGO (sem JOIN entre bancos).
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolEspaco, poolCore } = require('../db');
const { autenticar } = require('../middleware/autenticar');

const TEMAS_VALIDOS = new Set(['vida_magica', 'magico', 'universo', 'medieval']);

function erro(res, code, msg) { return res.status(code).json({ ok: false, erro: msg }); }
function tag(id) { return String(id || '?').slice(0, 8); }

// ════════════════════════════════════════════════════════════
// CONTEXTO — tudo que o espaco.html precisa no load (1 chamada)
// ════════════════════════════════════════════════════════════
router.get('/contexto', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;

    // Identidade (poolCore) — nome, sementes, plano, foto
    const u = await poolCore.query(
      `SELECT nome, sementes, plano, foto_url FROM usuarios WHERE id = $1`,
      [usuarioId]
    );
    const aluna = u.rows[0] || {};
    const plano = String(aluna.plano || 'gratuito').toLowerCase();

    // Tema escolhido (poolEspaco) — default 'vida_magica'
    const t = await poolEspaco.query(
      `SELECT tema FROM espaco_pref_aluna WHERE usuario_id = $1`,
      [usuarioId]
    );
    const tema = t.rows[0]?.tema || 'vida_magica';

    return res.json({
      ok: true,
      aluna: {
        nome: aluna.nome || null,
        sementes: aluna.sementes || 0,
        foto_url: aluna.foto_url || null,
      },
      tem_clube: plano !== 'gratuito',
      tema,
    });
  } catch (e) {
    console.error(`❌ [espaco] GET /contexto u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao carregar contexto');
  }
});

// ════════════════════════════════════════════════════════════
// TEMA — salvar a escolha da aluna (vira o default dela)
// ════════════════════════════════════════════════════════════
router.put('/tema', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const tema = String(req.body?.tema || '');
    if (!TEMAS_VALIDOS.has(tema)) return erro(res, 400, 'tema inválido');

    await poolEspaco.query(
      `INSERT INTO espaco_pref_aluna (usuario_id, tema)
       VALUES ($1, $2)
       ON CONFLICT (usuario_id) DO UPDATE
         SET tema = EXCLUDED.tema, atualizado_em = NOW()`,
      [usuarioId, tema]
    );
    console.log(`🎨 ${tag(usuarioId)} escolheu tema do Espaço: ${tema}`);
    return res.json({ ok: true, tema });
  } catch (e) {
    console.error(`❌ [espaco] PUT /tema u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao salvar tema');
  }
});

module.exports = router;
