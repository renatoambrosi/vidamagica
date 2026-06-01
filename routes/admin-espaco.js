/* ============================================================
   VIDA MÁGICA — routes/admin-espaco.js
   CRUDs admin do Espaço da Manifestação (catálogos cadastrados pelo admin).

   Banco: poolEspaco (5º Postgres — DATABASE_URL_ESPACO)

   Auth: autenticarPainel('admin')
   Mount em server.js: app.use('/api/admin', require('./routes/admin-espaco'))

   Endpoints (hoje):
   - GET/POST/PUT/DELETE /api/admin/espaco/afirmacoes
     afirmacoes: texto, categoria, audio_arquivo (MP3 em assets/afirmacoes/),
     ordem, ativo. (narração opcional — a aluna pode usar só o slideshow.)

   Futuro (mesma casa): /api/admin/espaco/meditacoes, /api/admin/espaco/playlists.
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolEspaco } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');

const adm = autenticarPainel('admin');

function erro(res, code, msg) { return res.status(code).json({ ok: false, erro: msg }); }
function s(v, max) { return String(v || '').slice(0, max).trim(); }
function admTag(req) { return String(req.admin?.id || '?').slice(0, 8); }

// ════════════════════════════════════════════════════════════
// ESPAÇO — AFIRMAÇÕES (catálogo de frases + áudio opcional)
// ════════════════════════════════════════════════════════════
router.get('/espaco/afirmacoes', adm, async (req, res) => {
  try {
    const r = await poolEspaco.query(
      `SELECT id, texto, categoria, audio_arquivo, ordem, ativo, criado_em, atualizado_em
         FROM afirmacoes ORDER BY categoria NULLS FIRST, ordem, id`
    );
    res.json({ ok: true, afirmacoes: r.rows });
  } catch (e) { console.error(`❌ [admin-espaco] GET /espaco/afirmacoes:`, e.message); erro(res, 500, e.message); }
});

router.post('/espaco/afirmacoes', adm, async (req, res) => {
  try {
    const texto = s(req.body?.texto, 1000);
    const categoria = s(req.body?.categoria, 60);
    const audio_arquivo = s(req.body?.audio_arquivo, 300);
    const ordem = Number(req.body?.ordem) || 99;
    if (!texto) return erro(res, 400, 'texto obrigatório');
    const r = await poolEspaco.query(
      `INSERT INTO afirmacoes (texto, categoria, audio_arquivo, ordem)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [texto, categoria || null, audio_arquivo || null, ordem]
    );
    console.log(`✨ admin ${admTag(req)} criou afirmação #${r.rows[0].id} cat=${categoria || '-'}`);
    res.json({ ok: true, afirmacao: r.rows[0] });
  } catch (e) { console.error(`❌ [admin-espaco] POST /espaco/afirmacoes:`, e.message); erro(res, 500, e.message); }
});

// Lote (raw): cola N afirmações de uma vez. Cada item traz seu PRÓPRIO tema e
// mp3 (o cliente faz o parse do formato "texto""tema""arquivo.mp3" e manda
// como array de { texto, categoria, audio_arquivo }).
router.post('/espaco/afirmacoes/lote', adm, async (req, res) => {
  const client = await poolEspaco.connect();
  try {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    const limpos = itens
      .map(it => ({
        texto: s(it?.texto, 1000),
        categoria: s(it?.categoria, 60),
        audio_arquivo: s(it?.audio_arquivo, 300),
      }))
      .filter(it => it.texto);
    if (!limpos.length) return erro(res, 400, 'cole ao menos uma afirmação válida');
    await client.query('BEGIN');
    for (const it of limpos) {
      await client.query(
        `INSERT INTO afirmacoes (texto, categoria, audio_arquivo, ordem) VALUES ($1,$2,$3,99)`,
        [it.texto, it.categoria || null, it.audio_arquivo || null]
      );
    }
    await client.query('COMMIT');
    console.log(`✨ admin ${admTag(req)} adicionou ${limpos.length} afirmações em lote (raw)`);
    res.json({ ok: true, inseridas: limpos.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`❌ [admin-espaco] POST /espaco/afirmacoes/lote:`, e.message);
    erro(res, 500, e.message);
  } finally {
    client.release();
  }
});

router.put('/espaco/afirmacoes/:id', adm, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const texto = s(req.body?.texto, 1000);
    const categoria = s(req.body?.categoria, 60);
    const audio_arquivo = s(req.body?.audio_arquivo, 300);
    const ordem = Number(req.body?.ordem) || 99;
    const ativo = req.body?.ativo !== false;
    if (!texto) return erro(res, 400, 'texto obrigatório');
    const r = await poolEspaco.query(
      `UPDATE afirmacoes
          SET texto=$1, categoria=$2, audio_arquivo=$3, ordem=$4, ativo=$5, atualizado_em=NOW()
        WHERE id=$6 RETURNING *`,
      [texto, categoria || null, audio_arquivo || null, ordem, ativo, id]
    );
    if (!r.rows[0]) return erro(res, 404, 'não encontrado');
    console.log(`✨ admin ${admTag(req)} editou afirmação #${id} ativo=${ativo}`);
    res.json({ ok: true, afirmacao: r.rows[0] });
  } catch (e) { console.error(`❌ [admin-espaco] PUT /espaco/afirmacoes:`, e.message); erro(res, 500, e.message); }
});

router.delete('/espaco/afirmacoes/:id', adm, async (req, res) => {
  try {
    await poolEspaco.query(`DELETE FROM afirmacoes WHERE id=$1`, [Number(req.params.id)]);
    console.log(`✨ admin ${admTag(req)} apagou afirmação #${req.params.id}`);
    res.json({ ok: true });
  } catch (e) { console.error(`❌ [admin-espaco] DELETE /espaco/afirmacoes:`, e.message); erro(res, 500, e.message); }
});

module.exports = router;
