const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar } = require('./precos');

// ── ENDPOINT PÚBLICO: lê config ──
router.get('/config', async (req, res) => {
  try {
    const result = await pool.query('SELECT dados FROM config WHERE chave = $1', ['site']);
    if (result.rows.length === 0) return res.json({});
    res.json(result.rows[0].dados);
  } catch (err) {
    console.error('❌ Erro ao buscar config:', err.message);
    res.status(500).json({ error: 'Erro ao carregar config' });
  }
});

// ── ADMIN: LER config ──
router.get('/admin/config', autenticar, async (req, res) => {
  try {
    const result = await pool.query('SELECT dados FROM config WHERE chave = $1', ['site']);
    if (result.rows.length === 0) return res.json({});
    res.json(result.rows[0].dados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: SALVAR config ──
router.post('/admin/config', autenticar, async (req, res) => {
  const dados = req.body;
  if (!dados || typeof dados !== 'object') return res.status(400).json({ error: 'Dados inválidos' });
  try {
    await pool.query(`
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
