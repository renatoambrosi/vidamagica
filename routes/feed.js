/* ============================================================
   VIDA MÁGICA — routes/feed.js
   CRUD do Feed do App
   Tipos: video | texto | imagem | link
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { pool } = require('../db');

/* ── Chamada pelo initDb() em db.js ── */
async function initFeed(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS feed (
      id            SERIAL PRIMARY KEY,
      tipo          VARCHAR(20)  NOT NULL CHECK (tipo IN ('video','texto','imagem','link')),
      titulo        TEXT         NOT NULL,
      subtitulo     TEXT,
      corpo         TEXT,
      url           TEXT,
      imagem_url    TEXT,
      destaque      BOOLEAN      DEFAULT FALSE,
      ativo         BOOLEAN      DEFAULT TRUE,
      ordem         INTEGER      DEFAULT 0,
      publicado_em  TIMESTAMPTZ  DEFAULT NOW(),
      criado_em     TIMESTAMPTZ  DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_feed_ativo ON feed(ativo, ordem)`);
}

/* ──────────────────────────────────────────────────
   PÚBLICO — GET /api/feed
   Retorna itens ativos, destaques primeiro
   ────────────────────────────────────────────────── */
router.get('/feed', async (req, res) => {
  try {
    const r = await pool.query(`
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

/* ──────────────────────────────────────────────────
   ADMIN — GET /api/admin/feed  (todos, inclusive inativos)
   ────────────────────────────────────────────────── */
router.get('/feed', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM feed ORDER BY ordem ASC, publicado_em DESC`);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────
   ADMIN — POST /api/admin/feed  (criar)
   ────────────────────────────────────────────────── */
router.post('/feed', async (req, res) => {
  const { tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem, publicado_em } = req.body;
  if (!tipo || !titulo) return res.status(400).json({ error: 'tipo e titulo são obrigatórios' });
  try {
    const r = await pool.query(`
      INSERT INTO feed (tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem, publicado_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [tipo, titulo, subtitulo || null, corpo || null, url || null, imagem_url || null,
        destaque || false, ativo !== false, ordem || 0, publicado_em || new Date()]);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────
   ADMIN — PUT /api/admin/feed/:id  (editar)
   ────────────────────────────────────────────────── */
router.put('/feed/:id', async (req, res) => {
  const { tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem, publicado_em } = req.body;
  try {
    const r = await pool.query(`
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

/* ──────────────────────────────────────────────────
   ADMIN — DELETE /api/admin/feed/:id
   ────────────────────────────────────────────────── */
router.delete('/feed/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM feed WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────────
   ADMIN — POST /api/admin/feed/reordenar
   body: { ids: [3, 1, 5, 2] }  — nova ordem
   ────────────────────────────────────────────────── */
router.post('/feed/reordenar', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids inválido' });
  const client = await pool.connect();
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

module.exports = { router, initFeed };
