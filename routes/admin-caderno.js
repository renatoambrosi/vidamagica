/* ============================================================
   VIDA MÁGICA — routes/admin-caderno.js
   CRUDs admin pro Caderno + Gamificação.

   Banco: poolComunicacao (catálogos cadastrados pelo admin)
          poolCore (config de visão geral — ex: total de alunas com escritas)

   Auth: autenticarPainel('admin')
   Mount em server.js como `app.use('/api/admin', require('./routes/admin-caderno'))`

   Endpoints — Caderno:
   - GET/POST/PUT/DELETE /api/admin/caderno/prompts
   - GET/POST/PUT/DELETE /api/admin/caderno/afirmacoes
   - GET/POST/PUT/DELETE /api/admin/caderno/audios

   Endpoints — Gamificação:
   - GET/PUT /api/admin/gamificacao/premios   (editar valor de cada marco)
   - GET/POST/PUT/DELETE /api/admin/gamificacao/missoes
   - POST /api/admin/gamificacao/fechar-ranking/:ano_mes  (manual)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');
const { fecharRankingMensal, calcularRankingMensalPreview } = require('../core/gamificacao');

const adm = autenticarPainel('admin');

function erro(res, code, msg) { return res.status(code).json({ ok: false, erro: msg }); }
function s(v, max) { return String(v || '').slice(0, max).trim(); }

// ════════════════════════════════════════════════════════════
// CADERNO — PROMPTS
// ════════════════════════════════════════════════════════════
router.get('/caderno/prompts', adm, async (req, res) => {
  const r = await poolComunicacao.query(
    `SELECT id, texto, categoria, ordem, ativo, criado_em, atualizado_em
       FROM caderno_prompts ORDER BY ordem, id`
  );
  res.json({ ok: true, prompts: r.rows });
});

router.post('/caderno/prompts', adm, async (req, res) => {
  try {
    const texto = s(req.body?.texto, 1000);
    const categoria = s(req.body?.categoria, 60);
    const ordem = Number(req.body?.ordem) || 99;
    if (!texto) return erro(res, 400, 'texto obrigatório');
    const r = await poolComunicacao.query(
      `INSERT INTO caderno_prompts (texto, categoria, ordem) VALUES ($1,$2,$3) RETURNING *`,
      [texto, categoria || null, ordem]
    );
    res.json({ ok: true, prompt: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

router.put('/caderno/prompts/:id', adm, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const texto = s(req.body?.texto, 1000);
    const categoria = s(req.body?.categoria, 60);
    const ordem = Number(req.body?.ordem) || 99;
    const ativo = req.body?.ativo !== false;
    if (!texto) return erro(res, 400, 'texto obrigatório');
    const r = await poolComunicacao.query(
      `UPDATE caderno_prompts SET texto=$1, categoria=$2, ordem=$3, ativo=$4, atualizado_em=NOW()
        WHERE id=$5 RETURNING *`,
      [texto, categoria || null, ordem, ativo, id]
    );
    if (!r.rows[0]) return erro(res, 404, 'não encontrado');
    res.json({ ok: true, prompt: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

router.delete('/caderno/prompts/:id', adm, async (req, res) => {
  await poolComunicacao.query(`DELETE FROM caderno_prompts WHERE id=$1`, [Number(req.params.id)]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// CADERNO — AFIRMAÇÕES
// ════════════════════════════════════════════════════════════
router.get('/caderno/afirmacoes', adm, async (req, res) => {
  const r = await poolComunicacao.query(
    `SELECT id, texto, categoria, ordem, ativo, criado_em, atualizado_em
       FROM caderno_afirmacoes ORDER BY categoria, ordem, id`
  );
  res.json({ ok: true, afirmacoes: r.rows });
});

router.post('/caderno/afirmacoes', adm, async (req, res) => {
  try {
    const texto = s(req.body?.texto, 1000);
    const categoria = s(req.body?.categoria, 60);
    const ordem = Number(req.body?.ordem) || 99;
    if (!texto) return erro(res, 400, 'texto obrigatório');
    const r = await poolComunicacao.query(
      `INSERT INTO caderno_afirmacoes (texto, categoria, ordem) VALUES ($1,$2,$3) RETURNING *`,
      [texto, categoria || null, ordem]
    );
    res.json({ ok: true, afirmacao: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

router.put('/caderno/afirmacoes/:id', adm, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const texto = s(req.body?.texto, 1000);
    const categoria = s(req.body?.categoria, 60);
    const ordem = Number(req.body?.ordem) || 99;
    const ativo = req.body?.ativo !== false;
    if (!texto) return erro(res, 400, 'texto obrigatório');
    const r = await poolComunicacao.query(
      `UPDATE caderno_afirmacoes SET texto=$1, categoria=$2, ordem=$3, ativo=$4, atualizado_em=NOW()
        WHERE id=$5 RETURNING *`,
      [texto, categoria || null, ordem, ativo, id]
    );
    if (!r.rows[0]) return erro(res, 404, 'não encontrado');
    res.json({ ok: true, afirmacao: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

router.delete('/caderno/afirmacoes/:id', adm, async (req, res) => {
  await poolComunicacao.query(`DELETE FROM caderno_afirmacoes WHERE id=$1`, [Number(req.params.id)]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// CADERNO — ÁUDIOS DE FOCO
// ════════════════════════════════════════════════════════════
router.get('/caderno/audios', adm, async (req, res) => {
  const r = await poolComunicacao.query(
    `SELECT * FROM caderno_audios_foco ORDER BY ordem, id`
  );
  res.json({ ok: true, audios: r.rows });
});

router.post('/caderno/audios', adm, async (req, res) => {
  try {
    const titulo = s(req.body?.titulo, 200);
    const tipo = s(req.body?.tipo, 40);
    const url = s(req.body?.url, 1000);
    const duracao_seg = Number(req.body?.duracao_seg) || null;
    const ordem = Number(req.body?.ordem) || 99;
    if (!titulo || !url) return erro(res, 400, 'titulo e url obrigatórios');
    const r = await poolComunicacao.query(
      `INSERT INTO caderno_audios_foco (titulo, tipo, url, duracao_seg, ordem) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [titulo, tipo || null, url, duracao_seg, ordem]
    );
    res.json({ ok: true, audio: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

router.put('/caderno/audios/:id', adm, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const titulo = s(req.body?.titulo, 200);
    const tipo = s(req.body?.tipo, 40);
    const url = s(req.body?.url, 1000);
    const duracao_seg = Number(req.body?.duracao_seg) || null;
    const ordem = Number(req.body?.ordem) || 99;
    const ativo = req.body?.ativo !== false;
    if (!titulo || !url) return erro(res, 400, 'titulo e url obrigatórios');
    const r = await poolComunicacao.query(
      `UPDATE caderno_audios_foco SET titulo=$1, tipo=$2, url=$3, duracao_seg=$4, ordem=$5, ativo=$6, atualizado_em=NOW()
        WHERE id=$7 RETURNING *`,
      [titulo, tipo || null, url, duracao_seg, ordem, ativo, id]
    );
    if (!r.rows[0]) return erro(res, 404, 'não encontrado');
    res.json({ ok: true, audio: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

router.delete('/caderno/audios/:id', adm, async (req, res) => {
  await poolComunicacao.query(`DELETE FROM caderno_audios_foco WHERE id=$1`, [Number(req.params.id)]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// GAMIFICAÇÃO — TABELA DE PRÊMIOS
// ════════════════════════════════════════════════════════════
router.get('/gamificacao/premios', adm, async (req, res) => {
  const r = await poolComunicacao.query(
    `SELECT id, tipo, marco, sementes, rotulo, descricao, ativo, atualizado_em
       FROM gam_premios_config
      ORDER BY tipo, marco`
  );
  res.json({ ok: true, premios: r.rows });
});

router.put('/gamificacao/premios/:id', adm, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sementes = Number(req.body?.sementes);
    const rotulo = s(req.body?.rotulo, 200);
    const descricao = s(req.body?.descricao, 2000);
    const ativo = req.body?.ativo !== false;
    if (!Number.isFinite(sementes) || sementes < 0) return erro(res, 400, 'sementes inválida');
    const r = await poolComunicacao.query(
      `UPDATE gam_premios_config SET sementes=$1, rotulo=$2, descricao=$3, ativo=$4, atualizado_em=NOW()
        WHERE id=$5 RETURNING *`,
      [sementes, rotulo || null, descricao || null, ativo, id]
    );
    if (!r.rows[0]) return erro(res, 404, 'não encontrado');
    res.json({ ok: true, premio: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

// ════════════════════════════════════════════════════════════
// GAMIFICAÇÃO — MISSÕES
// ════════════════════════════════════════════════════════════
router.get('/gamificacao/missoes', adm, async (req, res) => {
  const r = await poolComunicacao.query(
    `SELECT id, slug, titulo, descricao, jornada_slug, tipo, alvo_tipo, alvo_qtd,
            alvo_filtro, sementes, prioridade, ativa, inicia_em, expira_em,
            criado_em, atualizado_em
       FROM gam_missoes
      ORDER BY ativa DESC, prioridade, id`
  );
  res.json({ ok: true, missoes: r.rows });
});

router.post('/gamificacao/missoes', adm, async (req, res) => {
  try {
    const slug = s(req.body?.slug, 80).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const titulo = s(req.body?.titulo, 200);
    const descricao = s(req.body?.descricao, 2000);
    const jornada_slug = s(req.body?.jornada_slug, 40) || null;
    const tipo = s(req.body?.tipo, 40);
    const alvo_tipo = s(req.body?.alvo_tipo, 40);
    const alvo_qtd = Number(req.body?.alvo_qtd) || 1;
    const sementes = Number(req.body?.sementes) || 0;
    const prioridade = Number(req.body?.prioridade) || 99;
    if (!slug || !titulo || !tipo || !alvo_tipo) {
      return erro(res, 400, 'slug, titulo, tipo e alvo_tipo são obrigatórios');
    }
    if (!['diaria_relampago','jornada','evento'].includes(tipo)) {
      return erro(res, 400, 'tipo inválido');
    }
    const r = await poolComunicacao.query(
      `INSERT INTO gam_missoes (slug, titulo, descricao, jornada_slug, tipo, alvo_tipo, alvo_qtd, sementes, prioridade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [slug, titulo, descricao || null, jornada_slug, tipo, alvo_tipo, alvo_qtd, sementes, prioridade]
    );
    res.json({ ok: true, missao: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

router.put('/gamificacao/missoes/:id', adm, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const titulo = s(req.body?.titulo, 200);
    const descricao = s(req.body?.descricao, 2000);
    const jornada_slug = s(req.body?.jornada_slug, 40) || null;
    const tipo = s(req.body?.tipo, 40);
    const alvo_tipo = s(req.body?.alvo_tipo, 40);
    const alvo_qtd = Number(req.body?.alvo_qtd) || 1;
    const sementes = Number(req.body?.sementes) || 0;
    const prioridade = Number(req.body?.prioridade) || 99;
    const ativa = req.body?.ativa !== false;
    if (!titulo || !tipo || !alvo_tipo) return erro(res, 400, 'campos obrigatórios');
    const r = await poolComunicacao.query(
      `UPDATE gam_missoes
          SET titulo=$1, descricao=$2, jornada_slug=$3, tipo=$4, alvo_tipo=$5,
              alvo_qtd=$6, sementes=$7, prioridade=$8, ativa=$9, atualizado_em=NOW()
        WHERE id=$10 RETURNING *`,
      [titulo, descricao || null, jornada_slug, tipo, alvo_tipo, alvo_qtd, sementes, prioridade, ativa, id]
    );
    if (!r.rows[0]) return erro(res, 404, 'não encontrado');
    res.json({ ok: true, missao: r.rows[0] });
  } catch (e) { erro(res, 500, e.message); }
});

router.delete('/gamificacao/missoes/:id', adm, async (req, res) => {
  await poolComunicacao.query(`DELETE FROM gam_missoes WHERE id=$1`, [Number(req.params.id)]);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// GAMIFICAÇÃO — RANKING (preview + fechar manual)
// ════════════════════════════════════════════════════════════
router.get('/gamificacao/ranking/:ano_mes', adm, async (req, res) => {
  try {
    const ranking = await calcularRankingMensalPreview(req.params.ano_mes, 50);
    res.json({ ok: true, ranking });
  } catch (e) { erro(res, 500, e.message); }
});

router.post('/gamificacao/ranking/:ano_mes/fechar', adm, async (req, res) => {
  try {
    const r = await fecharRankingMensal(req.params.ano_mes);
    res.json({ ok: true, ...r });
  } catch (e) { erro(res, 500, e.message); }
});

module.exports = router;
