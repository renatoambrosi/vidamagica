/* ============================================================
   VIDA MÁGICA — routes/config.js
   Config geral do site/app (chave→valor JSON).

   Banco: poolComunicacao (tabela `config`).

   Endpoints:
     GET  /api/config           → público (todas as configs)
     GET  /api/config/:chave    → público (1 config)
     POST /api/admin/config     → admin (upsert por chave)
   ============================================================ */

const express = require('express');
const router = express.Router();

const { poolComunicacao } = require('../db');
const { autenticarAdmin } = require('../middleware/autenticar');

// ── PÚBLICO ────────────────────────────────────────────────

router.get('/config', async (req, res) => {
  try {
    const r = await poolComunicacao.query(`SELECT chave, dados FROM config`);
    const out = {};
    for (const row of r.rows) out[row.chave] = row.dados;
    res.json(out);
  } catch (err) {
    console.error('❌ GET /config:', err.message);
    res.status(500).json({ error: 'Erro ao carregar config' });
  }
});

router.get('/config/:chave', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT dados FROM config WHERE chave = $1`,
      [req.params.chave]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Config não encontrada' });
    res.json(r.rows[0].dados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN ──────────────────────────────────────────────────

router.post('/admin/config', autenticarAdmin, async (req, res) => {
  try {
    const { chave, dados } = req.body;
    if (!chave || dados === undefined) return res.status(400).json({ error: 'chave e dados obrigatórios' });
    await poolComunicacao.query(
      `INSERT INTO config (chave, dados, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (chave) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = NOW()`,
      [chave, dados]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
