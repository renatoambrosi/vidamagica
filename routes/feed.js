/* ============================================================
   VIDA MÁGICA — routes/feed.js
   CRUD do Feed do App. Banco: poolComunicacao.
   Tipos: video | texto | imagem | link

   Endpoints:
   - GET    /api/feed                    → público (ativos)
   - GET    /api/admin/feed              → admin (todos)
   - POST   /api/admin/feed              → admin (criar)
   - PUT    /api/admin/feed/:id          → admin (editar)
   - DELETE /api/admin/feed/:id          → admin (apagar)
   - POST   /api/admin/feed/reordenar    → admin (reordenar)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');

// ── PÚBLICO — GET /api/feed ──
router.get('/feed', async (req, res) => {
  try {
    const r = await poolComunicacao.query(`
      SELECT * FROM feed
      WHERE ativo = TRUE
      ORDER BY destaque DESC, ordem ASC, publicado_em DESC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('❌ feed GET público:', err.message);
    res.status(500).json({ error: 'Erro ao carregar feed' });
  }
});

// ── ADMIN — GET /api/admin/feed ──
router.get('/admin/feed', autenticarPainel('admin'), async (req, res) => {
  try {
    const r = await poolComunicacao.query(`SELECT * FROM feed ORDER BY ordem ASC, publicado_em DESC`);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN — POST /api/admin/feed (criar) ──
router.post('/admin/feed', autenticarPainel('admin'), async (req, res) => {
  const { tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem, publicado_em } = req.body;
  if (!tipo || !titulo) return res.status(400).json({ error: 'tipo e titulo são obrigatórios' });
  try {
    const r = await poolComunicacao.query(`
      INSERT INTO feed (tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem, publicado_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [tipo, titulo, subtitulo || null, corpo || null, url || null, imagem_url || null,
        destaque || false, ativo !== false, ordem || 0, publicado_em || new Date()]);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN — PUT /api/admin/feed/:id ──
router.put('/admin/feed/:id', autenticarPainel('admin'), async (req, res) => {
  const { tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem, publicado_em } = req.body;
  try {
    const r = await poolComunicacao.query(`
      UPDATE feed SET
        tipo=$1, titulo=$2, subtitulo=$3, corpo=$4, url=$5, imagem_url=$6,
        destaque=$7, ativo=$8, ordem=$9, publicado_em=$10, atualizado_em=NOW()
      WHERE id=$11 RETURNING *
    `, [tipo, titulo, subtitulo || null, corpo || null, url || null, imagem_url || null,
        destaque || false, ativo !== false, ordem || 0, publicado_em || new Date(), req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Item não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN — DELETE /api/admin/feed/:id ──
router.delete('/admin/feed/:id', autenticarPainel('admin'), async (req, res) => {
  try {
    await poolComunicacao.query('DELETE FROM feed WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN — POST /api/admin/feed/reordenar ──
router.post('/admin/feed/reordenar', autenticarPainel('admin'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids inválido' });
  const client = await poolComunicacao.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE feed SET ordem=$1 WHERE id=$2', [i, ids[i]]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
