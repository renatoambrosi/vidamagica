/* ============================================================
   VIDA MÁGICA — routes/feed.js
   Feed do app (vídeo, texto, imagem, link).

   Banco: poolComunicacao (tabela `feed`).

   Endpoints:
     GET    /api/feed                  → público (itens ativos)
     GET    /api/admin/feed            → admin (todos)
     POST   /api/admin/feed            → admin (criar)
     PUT    /api/admin/feed/:id        → admin (atualizar)
     DELETE /api/admin/feed/:id        → admin (apagar)
   ============================================================ */

const express = require('express');
const router = express.Router();

const { poolComunicacao } = require('../db');
const { autenticarAdmin } = require('../middleware/autenticar');

// ── PÚBLICO ────────────────────────────────────────────────

router.get('/feed', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT id, tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ordem, publicado_em
         FROM feed WHERE ativo = TRUE
         ORDER BY destaque DESC, ordem ASC, publicado_em DESC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('❌ GET /feed:', err.message);
    res.status(500).json({ error: 'Erro ao carregar feed' });
  }
});

// ── ADMIN ──────────────────────────────────────────────────

router.get('/admin/feed', autenticarAdmin, async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT * FROM feed ORDER BY destaque DESC, ordem ASC, publicado_em DESC`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/feed', autenticarAdmin, async (req, res) => {
  try {
    const { tipo, titulo, subtitulo, corpo, url, imagem_url, destaque = false, ativo = true, ordem = 0 } = req.body;
    if (!tipo || !titulo) return res.status(400).json({ error: 'Tipo e título obrigatórios' });
    if (!['video', 'texto', 'imagem', 'link'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }
    const r = await poolComunicacao.query(
      `INSERT INTO feed (tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [tipo, titulo, subtitulo || null, corpo || null, url || null, imagem_url || null, destaque, ativo, ordem]
    );
    res.json({ success: true, item: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/feed/:id', autenticarAdmin, async (req, res) => {
  try {
    const { tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem } = req.body;
    const r = await poolComunicacao.query(
      `UPDATE feed SET
         tipo = COALESCE($1, tipo),
         titulo = COALESCE($2, titulo),
         subtitulo = COALESCE($3, subtitulo),
         corpo = COALESCE($4, corpo),
         url = COALESCE($5, url),
         imagem_url = COALESCE($6, imagem_url),
         destaque = COALESCE($7, destaque),
         ativo = COALESCE($8, ativo),
         ordem = COALESCE($9, ordem),
         atualizado_em = NOW()
       WHERE id = $10
       RETURNING *`,
      [tipo ?? null, titulo ?? null, subtitulo ?? null, corpo ?? null, url ?? null, imagem_url ?? null, destaque ?? null, ativo ?? null, ordem ?? null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Item não encontrado' });
    res.json({ success: true, item: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/feed/:id', autenticarAdmin, async (req, res) => {
  try {
    await poolComunicacao.query(`DELETE FROM feed WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
