/* ============================================================
   VIDA MÁGICA — routes/depoimentos.js
   Port fiel do antigo. Banco: poolComunicacao.

   Endpoints:
   - GET  /api/depoimentos        → público (apenas ativos)
   - GET  /api/admin/depoimentos  → admin (todos)
   - POST /api/admin/depoimentos  → admin (substitui lista completa)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');

// ── PÚBLICO ──
router.get('/depoimentos', async (req, res) => {
  try {
    const result = await poolComunicacao.query(
      'SELECT nome, cidade, texto, tags FROM depoimentos WHERE ativo = TRUE ORDER BY ordem ASC, id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erro ao buscar depoimentos:', err.message);
    res.status(500).json({ error: 'Erro ao carregar depoimentos' });
  }
});

// ── ADMIN: LER ──
router.get('/admin/depoimentos', autenticarPainel('admin'), async (req, res) => {
  try {
    const result = await poolComunicacao.query(
      'SELECT id, nome, cidade, texto, tags, ordem, ativo FROM depoimentos ORDER BY ordem ASC, id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: SALVAR LISTA COMPLETA ──
router.post('/admin/depoimentos', autenticarPainel('admin'), async (req, res) => {
  const lista = req.body;
  if (!Array.isArray(lista)) return res.status(400).json({ error: 'Dados inválidos' });

  const client = await poolComunicacao.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM depoimentos');
    for (let i = 0; i < lista.length; i++) {
      const { nome, cidade, texto, tags = [], ativo = true } = lista[i];
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
