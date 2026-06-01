/* ============================================================
   VIDA MÁGICA — routes/espaco.js
   Endpoints do Espaço da Manifestação (lado da aluna).

   Bancos:
   - poolEspaco → dados do Espaço (tema, manifestações, cartas do tempo…)
   - poolCore   → identidade da aluna (nome, sementes, plano) — só LEITURA

   Auth: todos os endpoints usam `autenticar` (JWT Bearer da aluna).
   Mount em server.js como `app.use('/api/app/espaco', require('./routes/espaco'))`.

   Cruzamento poolEspaco × poolCore é feito em CÓDIGO (sem JOIN entre bancos).
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolEspaco, poolCore } = require('../db');
const { autenticar } = require('../middleware/autenticar');

const TEMAS_VALIDOS = new Set(['vida_magica', 'magico', 'universo', 'medieval']);

function erro(res, code, msg) { return res.status(code).json({ ok: false, erro: msg }); }
function tag(id) { return String(id || '?').slice(0, 8); }

// ════════════════════════════════════════════════════════════
// CONTEXTO — tudo que o espaco.html precisa no load (1 chamada)
// ════════════════════════════════════════════════════════════
router.get('/contexto', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;

    // Identidade (poolCore) — nome, sementes, plano, foto
    const u = await poolCore.query(
      `SELECT nome, sementes, plano, foto_url FROM usuarios WHERE id = $1`,
      [usuarioId]
    );
    const aluna = u.rows[0] || {};
    const plano = String(aluna.plano || 'gratuito').toLowerCase();

    // Tema escolhido (poolEspaco) — default 'vida_magica'
    const t = await poolEspaco.query(
      `SELECT tema FROM espaco_pref_aluna WHERE usuario_id = $1`,
      [usuarioId]
    );
    const tema = t.rows[0]?.tema || 'vida_magica';

    return res.json({
      ok: true,
      aluna: {
        nome: aluna.nome || null,
        sementes: aluna.sementes || 0,
        foto_url: aluna.foto_url || null,
      },
      tem_clube: plano !== 'gratuito',
      tema,
    });
  } catch (e) {
    console.error(`❌ [espaco] GET /contexto u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao carregar contexto');
  }
});

// ════════════════════════════════════════════════════════════
// TEMA — salvar a escolha da aluna (vira o default dela)
// ════════════════════════════════════════════════════════════
router.put('/tema', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const tema = String(req.body?.tema || '');
    if (!TEMAS_VALIDOS.has(tema)) return erro(res, 400, 'tema inválido');

    await poolEspaco.query(
      `INSERT INTO espaco_pref_aluna (usuario_id, tema)
       VALUES ($1, $2)
       ON CONFLICT (usuario_id) DO UPDATE
         SET tema = EXCLUDED.tema, atualizado_em = NOW()`,
      [usuarioId, tema]
    );
    console.log(`🎨 ${tag(usuarioId)} escolheu tema do Espaço: ${tema}`);
    return res.json({ ok: true, tema });
  } catch (e) {
    console.error(`❌ [espaco] PUT /tema u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao salvar tema');
  }
});

// ════════════════════════════════════════════════════════════
// CARTAS DO TEMPO (caminho "Carta do tempo" — ex-Cápsula do Tempo)
// Conteúdo OMITIDO enquanto abrir_em > NOW() (a aluna não relê antes da hora).
// Aviso quando madura (WhatsApp/email/banner) virá num worker próprio depois.
// ════════════════════════════════════════════════════════════
router.post('/cartas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const titulo = String(req.body?.titulo || '').slice(0, 200).trim();
    const conteudo = String(req.body?.conteudo || '').slice(0, 20000).trim();
    const abrirEm = req.body?.abrir_em ? new Date(req.body.abrir_em) : null;
    if (!conteudo || conteudo.length < 10) return erro(res, 400, 'escreva pelo menos 10 caracteres');
    if (!abrirEm || isNaN(abrirEm) || abrirEm.getTime() < Date.now() + 24 * 3600 * 1000) {
      return erro(res, 400, 'a carta precisa abrir pelo menos 1 dia no futuro');
    }
    const r = await poolEspaco.query(
      `INSERT INTO cartas_do_tempo (usuario_id, titulo, conteudo, abrir_em)
       VALUES ($1, $2, $3, $4)
       RETURNING id, titulo, abrir_em, criado_em`,
      [usuarioId, titulo || null, conteudo, abrirEm.toISOString()]
    );
    console.log(`💌 ${tag(usuarioId)} lacrou carta do tempo #${r.rows[0].id} pra ${abrirEm.toISOString().slice(0,10)}`);
    return res.json({ ok: true, carta: r.rows[0] });
  } catch (e) {
    console.error(`❌ [espaco] POST /cartas u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao salvar carta');
  }
});

router.get('/cartas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const r = await poolEspaco.query(
      `SELECT id, titulo, abrir_em, aberta_em, criado_em,
              (abrir_em > NOW()) AS trancada,
              CASE WHEN abrir_em > NOW() THEN NULL ELSE conteudo END AS conteudo
         FROM cartas_do_tempo
        WHERE usuario_id = $1
        ORDER BY abrir_em DESC`,
      [usuarioId]
    );
    return res.json({ ok: true, cartas: r.rows });
  } catch (e) {
    console.error(`❌ [espaco] GET /cartas u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao listar cartas');
  }
});

module.exports = router;
