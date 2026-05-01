/* ============================================================
   VIDA MÁGICA — routes/config.js
   Config do site/app — armazenada como UMA ÚNICA chave 'site'.
   Banco: poolComunicacao.

   Endpoints:
   - GET  /api/config         → público (objeto inteiro)
   - GET  /api/admin/config   → admin (objeto inteiro)
   - POST /api/admin/config   → admin (substitui objeto inteiro)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarAdmin } = require('../middleware/autenticar');

// ── PÚBLICO ──
router.get('/config', async (req, res) => {
  try {
    const result = await poolComunicacao.query('SELECT dados FROM config WHERE chave = $1', ['site']);
    if (result.rows.length === 0) return res.json({});
    res.json(result.rows[0].dados);
  } catch (err) {
    console.error('❌ Erro ao buscar config:', err.message);
    res.status(500).json({ error: 'Erro ao carregar config' });
  }
});

// ── ADMIN: LER ──
router.get('/admin/config', autenticarAdmin, async (req, res) => {
  try {
    const result = await poolComunicacao.query('SELECT dados FROM config WHERE chave = $1', ['site']);
    if (result.rows.length === 0) return res.json({});
    res.json(result.rows[0].dados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: SALVAR ──
router.post('/admin/config', autenticarAdmin, async (req, res) => {
  const dados = req.body;
  if (!dados || typeof dados !== 'object') return res.status(400).json({ error: 'Dados inválidos' });
  try {
    await poolComunicacao.query(`
      INSERT INTO config (chave, dados, atualizado_em)
      VALUES ($1, $2, NOW())
      ON CONFLICT (chave) DO UPDATE SET dados = $2, atualizado_em = NOW()
    `, ['site', JSON.stringify(dados)]);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erro ao salvar config:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
