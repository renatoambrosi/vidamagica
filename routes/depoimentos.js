/* ============================================================
   VIDA MÁGICA — routes/depoimentos.js
   Depoimentos da landing page.

   Banco: poolComunicacao (tabela `depoimentos`).

   Endpoints:
     GET    /api/depoimentos              → público
     GET    /api/admin/depoimentos        → admin (cru)
     POST   /api/admin/depoimentos        → admin (criar)
     PUT    /api/admin/depoimentos/:id    → admin (atualizar)
     DELETE /api/admin/depoimentos/:id    → admin (apagar)
   ============================================================ */

const express = require('express');
const router = express.Router();

const { poolComunicacao } = require('../db');
const { autenticarAdmin } = require('../middleware/autenticar');

// ── PÚBLICO ────────────────────────────────────────────────

router.get('/depoimentos', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT id, nome, cidade, texto, tags, ordem
         FROM depoimentos WHERE ativo = TRUE
         ORDER BY ordem ASC, criado_em DESC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('❌ GET /depoimentos:', err.message);
    res.status(500).json({ error: 'Erro ao carregar depoimentos' });
  }
});

// ── ADMIN ──────────────────────────────────────────────────

router.get('/admin/depoimentos', autenticarAdmin, async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT * FROM depoimentos ORDER BY ordem ASC, criado_em DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/depoimentos', autenticarAdmin, async (req, res) => {
  try {
    const { nome, cidade, texto, tags = [], ordem = 0, ativo = true } = req.body;
    if (!nome || !texto) return res.status(400).json({ error: 'Nome e texto obrigatórios' });
    const r = await poolComunicacao.query(
      `INSERT INTO depoimentos (nome, cidade, texto, tags, ordem, ativo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [nome, cidade || null, texto, tags, ordem, ativo]
    );
    res.json({ success: true, depoimento: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/depoimentos/:id', autenticarAdmin, async (req, res) => {
  try {
    const { nome, cidade, texto, tags, ordem, ativo } = req.body;
    const r = await poolComunicacao.query(
      `UPDATE depoimentos SET
         nome = COALESCE($1, nome),
         cidade = COALESCE($2, cidade),
         texto = COALESCE($3, texto),
         tags = COALESCE($4, tags),
         ordem = COALESCE($5, ordem),
         ativo = COALESCE($6, ativo)
       WHERE id = $7
       RETURNING *`,
      [nome ?? null, cidade ?? null, texto ?? null, tags ?? null, ordem ?? null, ativo ?? null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Depoimento não encontrado' });
    res.json({ success: true, depoimento: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/depoimentos/:id', autenticarAdmin, async (req, res) => {
  try {
    await poolComunicacao.query(`DELETE FROM depoimentos WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
