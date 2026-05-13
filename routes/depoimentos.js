/* ============================================================
   VIDA MÁGICA — routes/depoimentos.js
   Banco: poolComunicacao.

   Endpoints:
   - GET  /api/depoimentos           → público (apenas ativos)
       • aceita ?tag=NOME (filtra por tag específica)
       • sem tag → retorna todos os ativos
   - GET  /api/admin/depoimentos     → admin (todos, com id e ordem)
   - POST /api/admin/depoimentos     → admin (substitui lista completa)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');

// ── PÚBLICO ──
// Aceita ?tag=NOME para filtrar depoimentos por tag específica.
// Tags são guardadas em lowercase no banco; normaliza a query antes da busca.
router.get('/depoimentos', async (req, res) => {
  try {
    const tagRaw = (req.query.tag || '').toString().trim().toLowerCase();

    let result;
    if (tagRaw) {
      // tags é text[] no Postgres — usamos = ANY(tags) para buscar
      result = await poolComunicacao.query(
        `SELECT nome, cidade, texto, tags
           FROM depoimentos
          WHERE ativo = TRUE
            AND $1 = ANY(tags)
          ORDER BY ordem ASC, id ASC`,
        [tagRaw]
      );
    } else {
      result = await poolComunicacao.query(
        `SELECT nome, cidade, texto, tags
           FROM depoimentos
          WHERE ativo = TRUE
          ORDER BY ordem ASC, id ASC`
      );
    }
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
// Normaliza tags para lowercase + trim, garantindo busca consistente no público.
router.post('/admin/depoimentos', autenticarPainel('admin'), async (req, res) => {
  const lista = req.body;
  if (!Array.isArray(lista)) return res.status(400).json({ error: 'Dados inválidos' });

  const client = await poolComunicacao.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM depoimentos');
    for (let i = 0; i < lista.length; i++) {
      const { nome, cidade, texto, tags = [], ativo = true } = lista[i];
      const tagsArr = Array.isArray(tags)
        ? tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
        : [];
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
