const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar } = require('./precos');

// ── ENDPOINT PÚBLICO ──
router.get('/depoimentos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT nome, cidade, texto, tags FROM depoimentos WHERE ativo = TRUE ORDER BY ordem ASC, id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erro ao buscar depoimentos:', err.message);
    res.status(500).json({ error: 'Erro ao carregar depoimentos' });
  }
});

// ── ADMIN: LER ──
router.get('/admin/depoimentos', autenticar, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nome, cidade, texto, tags, ordem, ativo FROM depoimentos ORDER BY ordem ASC, id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: SALVAR LISTA COMPLETA ──
router.post('/admin/depoimentos', autenticar, async (req, res) => {
  const lista = req.body;
  if (!Array.isArray(lista)) return res.status(400).json({ error: 'Dados inválidos' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM depoimentos');
    for (let i = 0; i < lista.length; i++) {
      const { nome, cidade, texto, tags = [], ativo = true } = lista[i];
      // Garante que tags é array de strings
      const tagsArr = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [];
      await client.query(
        'INSERT INTO depoimentos (nome, cidade, texto, tags, ordem, ativo) VALUES ($1, $2, $3, $4, $5, $6)',
        [nome, cidade || '', texto, tagsArr, i, ativo]
      );
    }
    await client.query('COMMIT');
    console.log(`✅ ${lista.length} depoimentos salvos`);
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao salvar depoimentos:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
