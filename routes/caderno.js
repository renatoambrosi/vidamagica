/* ============================================================
   VIDA MÁGICA — routes/caderno.js
   Endpoints do Caderno da Mentalização (lado da aluna).

   Bancos:
   - poolCore         → dados da aluna (escritas, cápsulas, vision, metas, favoritas)
   - poolComunicacao  → catálogos do admin (prompts, afirmações, áudios)

   Auth: todos os endpoints usam `autenticar` (JWT Bearer da aluna).
   Mount em server.js como `app.use('/api/app/caderno', require('./routes/caderno'))`.

   Quando aluna cria escrita → progresso de missão 'caderno_escrita' avança
   via core/gamificacao.js → progressoEvento.

   Quando aluna cria cápsula → backend agenda aviso (WhatsApp+Brevo+in_app)
   pra disparar quando abrir_em ficar <= NOW(). Worker que dispara avisos
   vive em outro lugar (a integrar no Commit 3 — sistema de avisos).
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolCore, poolComunicacao } = require('../db');
const { autenticar } = require('../middleware/autenticar');
const { progressoEvento } = require('../core/gamificacao');

// ── HELPERS ───────────────────────────────────────────────

function erro(res, code, msg) {
  return res.status(code).json({ ok: false, erro: msg });
}

function clampStr(s, max) {
  return String(s || '').slice(0, max);
}

// Tag curta do usuário pra logs (8 primeiros chars do UUID — suficiente
// pra rastrear no banco sem expor o UUID inteiro nos logs)
function tag(usuario_id) {
  return String(usuario_id || '?').slice(0, 8);
}

// ════════════════════════════════════════════════════════════
// ESCRITAS (scripting)
// ════════════════════════════════════════════════════════════

// Lista escritas (paginadas — 20 por vez)
router.get('/escritas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const r = await poolCore.query(
      `SELECT id, conteudo, prompt_id, criado_em, atualizado_em
         FROM caderno_escritas
        WHERE usuario_id = $1
        ORDER BY criado_em DESC
        LIMIT $2 OFFSET $3`,
      [usuarioId, limit, offset]
    );
    return res.json({ ok: true, escritas: r.rows, limit, offset });
  } catch (e) {
    console.error('[caderno] GET /escritas:', e.message);
    return erro(res, 500, 'erro ao listar escritas');
  }
});

// Cria escrita nova
router.post('/escritas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const conteudo = clampStr(req.body?.conteudo, 10000).trim();
    const promptId = req.body?.prompt_id ? Number(req.body.prompt_id) : null;
    if (!conteudo || conteudo.length < 3) {
      console.log(`📓 ${tag(usuarioId)} escrita rejeitada — texto muito curto (${conteudo.length} chars)`);
      return erro(res, 400, 'escreva pelo menos 3 caracteres');
    }

    const r = await poolCore.query(
      `INSERT INTO caderno_escritas (usuario_id, conteudo, prompt_id)
       VALUES ($1, $2, $3)
       RETURNING id, conteudo, prompt_id, criado_em`,
      [usuarioId, conteudo, promptId]
    );

    console.log(`📓 ${tag(usuarioId)} escreveu #${r.rows[0].id} (${conteudo.length} chars${promptId ? `, prompt=${promptId}` : ''})`);

    // Avança missões que dependem de 'caderno_escrita' (engole erro)
    const missoesCompletadas = await progressoEvento(usuarioId, 'caderno_escrita');
    if (missoesCompletadas.length > 0) {
      console.log(`📓 ${tag(usuarioId)} completou ${missoesCompletadas.length} missão(ões): ${missoesCompletadas.map(m => m.slug).join(', ')}`);
    }

    return res.json({
      ok: true,
      escrita: r.rows[0],
      missoes_completadas: missoesCompletadas,
    });
  } catch (e) {
    console.error(`❌ [caderno] POST /escritas u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao salvar escrita');
  }
});

// Edita escrita existente
router.put('/escritas/:id', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const conteudo = clampStr(req.body?.conteudo, 10000).trim();
    if (!conteudo || conteudo.length < 3) return erro(res, 400, 'escreva pelo menos 3 caracteres');
    const r = await poolCore.query(
      `UPDATE caderno_escritas
          SET conteudo = $1, atualizado_em = NOW()
        WHERE id = $2 AND usuario_id = $3
        RETURNING id, conteudo, atualizado_em`,
      [conteudo, id, usuarioId]
    );
    if (!r.rows[0]) {
      console.log(`📓 ${tag(usuarioId)} tentou editar escrita #${id} — não encontrada/não é dela`);
      return erro(res, 404, 'escrita não encontrada');
    }
    console.log(`📓 ${tag(usuarioId)} editou escrita #${id}`);
    return res.json({ ok: true, escrita: r.rows[0] });
  } catch (e) {
    console.error(`❌ [caderno] PUT /escritas/:id u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao editar');
  }
});

// Apaga escrita
router.delete('/escritas/:id', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const r = await poolCore.query(
      `DELETE FROM caderno_escritas WHERE id = $1 AND usuario_id = $2`,
      [id, usuarioId]
    );
    console.log(`📓 ${tag(usuarioId)} apagou escrita #${id} (linhas=${r.rowCount})`);
    return res.json({ ok: true, apagou: r.rowCount > 0 });
  } catch (e) {
    console.error(`❌ [caderno] DELETE /escritas/:id u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao apagar');
  }
});

// Prompt do dia (determinístico — não muda durante o dia)
router.get('/prompt-do-dia', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const totalP = await poolComunicacao.query(
      `SELECT COUNT(*)::int AS total FROM caderno_prompts WHERE ativo = TRUE`
    );
    const totalPrompts = totalP.rows[0]?.total || 0;
    if (totalPrompts === 0) return res.json({ ok: true, prompt: null });

    const dia = new Date();
    const diaDoAno = Math.floor((dia - new Date(dia.getFullYear(), 0, 0)) / 86400000);
    const charSum = String(usuarioId).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const offset = (diaDoAno + charSum) % totalPrompts;

    const r = await poolComunicacao.query(
      `SELECT id, texto, categoria FROM caderno_prompts
        WHERE ativo = TRUE
        ORDER BY ordem, id
        LIMIT 1 OFFSET $1`,
      [offset]
    );
    return res.json({ ok: true, prompt: r.rows[0] || null });
  } catch (e) {
    console.error('[caderno] GET /prompt-do-dia:', e.message);
    return erro(res, 500, 'erro ao buscar prompt');
  }
});

// ════════════════════════════════════════════════════════════
// CÁPSULAS DO TEMPO
// ════════════════════════════════════════════════════════════

// Lista cápsulas. Conteúdo é OMITIDO se ainda não madura (abrir_em > NOW()).
router.get('/capsulas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const r = await poolCore.query(
      `SELECT id, titulo, abrir_em, aberta_em, aviso_enviado_em, criado_em,
              (abrir_em > NOW()) AS trancada,
              CASE WHEN abrir_em > NOW() THEN NULL ELSE conteudo END AS conteudo
         FROM caderno_capsulas
        WHERE usuario_id = $1
        ORDER BY abrir_em DESC`,
      [usuarioId]
    );
    return res.json({ ok: true, capsulas: r.rows });
  } catch (e) {
    console.error('[caderno] GET /capsulas:', e.message);
    return erro(res, 500, 'erro ao listar cápsulas');
  }
});

// Cria cápsula
router.post('/capsulas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const titulo = clampStr(req.body?.titulo, 200).trim();
    const conteudo = clampStr(req.body?.conteudo, 20000).trim();
    const abrirEm = req.body?.abrir_em ? new Date(req.body.abrir_em) : null;

    if (!conteudo || conteudo.length < 10) return erro(res, 400, 'escreva pelo menos 10 caracteres');
    if (!abrirEm || isNaN(abrirEm)) return erro(res, 400, 'data inválida');
    if (abrirEm.getTime() < Date.now() + 24 * 3600 * 1000) {
      console.log(`📓 ${tag(usuarioId)} cápsula rejeitada — data muito próxima (${req.body?.abrir_em})`);
      return erro(res, 400, 'a cápsula precisa abrir pelo menos 1 dia no futuro');
    }

    const r = await poolCore.query(
      `INSERT INTO caderno_capsulas (usuario_id, titulo, conteudo, abrir_em)
       VALUES ($1, $2, $3, $4)
       RETURNING id, titulo, abrir_em, criado_em`,
      [usuarioId, titulo || null, conteudo, abrirEm.toISOString()]
    );
    console.log(`📓 ${tag(usuarioId)} lacrou cápsula #${r.rows[0].id} pra abrir em ${abrirEm.toISOString().slice(0,10)}`);
    return res.json({ ok: true, capsula: r.rows[0] });
  } catch (e) {
    console.error(`❌ [caderno] POST /capsulas u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao criar cápsula');
  }
});

// Marca cápsula como aberta (aluna abriu pra ler)
router.post('/capsulas/:id/abrir', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const r = await poolCore.query(
      `UPDATE caderno_capsulas
          SET aberta_em = COALESCE(aberta_em, NOW())
        WHERE id = $1 AND usuario_id = $2 AND abrir_em <= NOW()
        RETURNING id, titulo, conteudo, abrir_em, aberta_em`,
      [id, usuarioId]
    );
    if (!r.rows[0]) {
      console.log(`📓 ${tag(usuarioId)} tentou abrir cápsula #${id} — não existe ou ainda trancada`);
      return erro(res, 404, 'cápsula não encontrada ou ainda trancada');
    }
    console.log(`💌 ${tag(usuarioId)} abriu cápsula #${id} "${(r.rows[0].titulo || '').slice(0,40)}"`);
    return res.json({ ok: true, capsula: r.rows[0] });
  } catch (e) {
    console.error(`❌ [caderno] POST /capsulas/:id/abrir u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao abrir cápsula');
  }
});

// Apaga cápsula (só se ainda não foi aberta)
router.delete('/capsulas/:id', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const r = await poolCore.query(
      `DELETE FROM caderno_capsulas
        WHERE id = $1 AND usuario_id = $2 AND aberta_em IS NULL`,
      [id, usuarioId]
    );
    console.log(`📓 ${tag(usuarioId)} apagou cápsula #${id} (linhas=${r.rowCount})`);
    return res.json({ ok: true, apagou: r.rowCount > 0 });
  } catch (e) {
    console.error(`❌ [caderno] DELETE /capsulas/:id u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao apagar cápsula');
  }
});

// ════════════════════════════════════════════════════════════
// VISION BOARD
// ════════════════════════════════════════════════════════════

router.get('/vision', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const status = (req.query.status === 'conquistado') ? 'conquistado' : 'ativo';
    const r = await poolCore.query(
      `SELECT id, imagem_url, titulo, area, ordem, principal, status, conquistado_em, criado_em
         FROM caderno_vision_itens
        WHERE usuario_id = $1 AND status = $2
        ORDER BY principal DESC, ordem ASC, criado_em DESC`,
      [usuarioId, status]
    );
    return res.json({ ok: true, itens: r.rows });
  } catch (e) {
    console.error('[caderno] GET /vision:', e.message);
    return erro(res, 500, 'erro ao listar vision');
  }
});

router.post('/vision', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const imagem_url = clampStr(req.body?.imagem_url, 1000).trim();
    const titulo = clampStr(req.body?.titulo, 200).trim();
    const area = clampStr(req.body?.area, 60).trim();
    const principal = !!req.body?.principal;

    if (!imagem_url) return erro(res, 400, 'imagem é obrigatória');

    const client = await poolCore.connect();
    try {
      await client.query('BEGIN');

      // Se vai ser principal, desmarca o atual
      if (principal) {
        await client.query(
          `UPDATE caderno_vision_itens
              SET principal = FALSE
            WHERE usuario_id = $1 AND principal = TRUE AND status = 'ativo'`,
          [usuarioId]
        );
      }

      const ins = await client.query(
        `INSERT INTO caderno_vision_itens
           (usuario_id, imagem_url, titulo, area, principal)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, imagem_url, titulo, area, principal, status, criado_em`,
        [usuarioId, imagem_url, titulo || null, area || null, principal]
      );
      await client.query('COMMIT');
      console.log(`🖼️  ${tag(usuarioId)} adicionou item vision #${ins.rows[0].id}${principal ? ' (principal)' : ''}${area ? ` area=${area}` : ''}`);
      return res.json({ ok: true, item: ins.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(`❌ [caderno] POST /vision u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao salvar item');
  }
});

// Marca como principal (toggle exclusivo — desmarca os outros)
router.post('/vision/:id/principal', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const client = await poolCore.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE caderno_vision_itens
            SET principal = FALSE
          WHERE usuario_id = $1 AND principal = TRUE AND status = 'ativo'`,
        [usuarioId]
      );
      const r = await client.query(
        `UPDATE caderno_vision_itens
            SET principal = TRUE
          WHERE id = $1 AND usuario_id = $2 AND status = 'ativo'
          RETURNING id`,
        [id, usuarioId]
      );
      await client.query('COMMIT');
      if (!r.rows[0]) return erro(res, 404, 'item não encontrado');
      return res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('[caderno] POST /vision/:id/principal:', e.message);
    return erro(res, 500, 'erro ao marcar principal');
  }
});

// Move pra galeria de conquistas
router.post('/vision/:id/conquistado', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const r = await poolCore.query(
      `UPDATE caderno_vision_itens
          SET status = 'conquistado',
              conquistado_em = NOW(),
              principal = FALSE
        WHERE id = $1 AND usuario_id = $2 AND status = 'ativo'
        RETURNING id, titulo, conquistado_em`,
      [id, usuarioId]
    );
    if (!r.rows[0]) return erro(res, 404, 'item não encontrado');
    console.log(`🏆 ${tag(usuarioId)} conquistou vision #${id} "${(r.rows[0].titulo || '').slice(0,40)}"`);
    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error(`❌ [caderno] POST /vision/:id/conquistado u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao marcar conquistado');
  }
});

router.delete('/vision/:id', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const r = await poolCore.query(
      `DELETE FROM caderno_vision_itens WHERE id = $1 AND usuario_id = $2`,
      [id, usuarioId]
    );
    return res.json({ ok: true, apagou: r.rowCount > 0 });
  } catch (e) {
    console.error('[caderno] DELETE /vision/:id:', e.message);
    return erro(res, 500, 'erro ao apagar');
  }
});

// ════════════════════════════════════════════════════════════
// METAS (Termômetro de Materialização)
// ════════════════════════════════════════════════════════════

const STATUS_META_VALIDOS = new Set(['plantando', 'em_movimento', 'quase_la', 'materializado']);

router.get('/metas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const r = await poolCore.query(
      `SELECT id, titulo, descricao, status, ordem, materializada_em, criado_em, atualizado_em
         FROM caderno_metas
        WHERE usuario_id = $1
        ORDER BY status, ordem ASC, criado_em DESC`,
      [usuarioId]
    );
    return res.json({ ok: true, metas: r.rows });
  } catch (e) {
    console.error('[caderno] GET /metas:', e.message);
    return erro(res, 500, 'erro ao listar metas');
  }
});

router.post('/metas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const titulo = clampStr(req.body?.titulo, 200).trim();
    const descricao = clampStr(req.body?.descricao, 2000).trim();
    if (!titulo) return erro(res, 400, 'título é obrigatório');
    const r = await poolCore.query(
      `INSERT INTO caderno_metas (usuario_id, titulo, descricao)
       VALUES ($1, $2, $3)
       RETURNING id, titulo, descricao, status, criado_em`,
      [usuarioId, titulo, descricao || null]
    );
    console.log(`🌱 ${tag(usuarioId)} plantou meta #${r.rows[0].id} "${titulo.slice(0,40)}"`);
    return res.json({ ok: true, meta: r.rows[0] });
  } catch (e) {
    console.error(`❌ [caderno] POST /metas u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao criar meta');
  }
});

router.put('/metas/:id/status', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const status = String(req.body?.status || '');
    if (!STATUS_META_VALIDOS.has(status)) return erro(res, 400, 'status inválido');
    const materializada = status === 'materializado';
    const r = await poolCore.query(
      `UPDATE caderno_metas
          SET status = $1,
              materializada_em = CASE WHEN $1 = 'materializado' AND materializada_em IS NULL THEN NOW() ELSE materializada_em END,
              atualizado_em = NOW()
        WHERE id = $2 AND usuario_id = $3
        RETURNING id, titulo, status, materializada_em`,
      [status, id, usuarioId]
    );
    if (!r.rows[0]) return erro(res, 404, 'meta não encontrada');
    const emoji = materializada ? '🏆' : '🌿';
    console.log(`${emoji} ${tag(usuarioId)} meta #${id} → ${status}${materializada ? ' (MATERIALIZADA!)' : ''}`);
    return res.json({ ok: true, meta: r.rows[0], materializada });
  } catch (e) {
    console.error(`❌ [caderno] PUT /metas/:id/status u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao atualizar status');
  }
});

router.put('/metas/:id', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const titulo = clampStr(req.body?.titulo, 200).trim();
    const descricao = clampStr(req.body?.descricao, 2000).trim();
    if (!titulo) return erro(res, 400, 'título é obrigatório');
    const r = await poolCore.query(
      `UPDATE caderno_metas
          SET titulo = $1, descricao = $2, atualizado_em = NOW()
        WHERE id = $3 AND usuario_id = $4
        RETURNING id, titulo, descricao, status`,
      [titulo, descricao || null, id, usuarioId]
    );
    if (!r.rows[0]) return erro(res, 404, 'meta não encontrada');
    return res.json({ ok: true, meta: r.rows[0] });
  } catch (e) {
    console.error('[caderno] PUT /metas/:id:', e.message);
    return erro(res, 500, 'erro ao editar meta');
  }
});

router.delete('/metas/:id', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const id = Number(req.params.id);
    const r = await poolCore.query(
      `DELETE FROM caderno_metas WHERE id = $1 AND usuario_id = $2`,
      [id, usuarioId]
    );
    return res.json({ ok: true, apagou: r.rowCount > 0 });
  } catch (e) {
    console.error('[caderno] DELETE /metas/:id:', e.message);
    return erro(res, 500, 'erro ao apagar meta');
  }
});

// ════════════════════════════════════════════════════════════
// AFIRMAÇÕES (catálogo + favoritar)
// ════════════════════════════════════════════════════════════

router.get('/afirmacoes', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const categoria = req.query.categoria ? String(req.query.categoria) : null;
    const apenasFavoritas = req.query.favoritas === 'true';

    let r;
    if (apenasFavoritas) {
      r = await poolCore.query(
        `SELECT afirmacao_id FROM caderno_afirmacoes_favoritas WHERE usuario_id = $1`,
        [usuarioId]
      );
      const ids = r.rows.map(x => x.afirmacao_id);
      if (ids.length === 0) return res.json({ ok: true, afirmacoes: [] });
      const list = await poolComunicacao.query(
        `SELECT id, texto, categoria FROM caderno_afirmacoes
          WHERE id = ANY($1::int[]) AND ativo = TRUE
          ORDER BY categoria, ordem, id`,
        [ids]
      );
      return res.json({ ok: true, afirmacoes: list.rows.map(a => ({ ...a, favoritada: true })) });
    }

    // Catálogo geral (com flag de favorita por aluna)
    const filtroSql = categoria ? `AND categoria = $1` : '';
    const params = categoria ? [categoria] : [];
    const cat = await poolComunicacao.query(
      `SELECT id, texto, categoria FROM caderno_afirmacoes
        WHERE ativo = TRUE ${filtroSql}
        ORDER BY categoria, ordem, id`,
      params
    );

    const favs = await poolCore.query(
      `SELECT afirmacao_id FROM caderno_afirmacoes_favoritas WHERE usuario_id = $1`,
      [usuarioId]
    );
    const setFavs = new Set(favs.rows.map(x => x.afirmacao_id));

    return res.json({
      ok: true,
      afirmacoes: cat.rows.map(a => ({ ...a, favoritada: setFavs.has(a.id) })),
    });
  } catch (e) {
    console.error('[caderno] GET /afirmacoes:', e.message);
    return erro(res, 500, 'erro ao listar afirmações');
  }
});

router.post('/afirmacoes/:id/favoritar', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const afirmacaoId = Number(req.params.id);
    const r = await poolCore.query(
      `INSERT INTO caderno_afirmacoes_favoritas (usuario_id, afirmacao_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [usuarioId, afirmacaoId]
    );
    if (r.rowCount > 0) console.log(`⭐ ${tag(usuarioId)} favoritou afirmação #${afirmacaoId}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error(`❌ [caderno] POST /afirmacoes/:id/favoritar u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao favoritar');
  }
});

router.delete('/afirmacoes/:id/favoritar', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const afirmacaoId = Number(req.params.id);
    const r = await poolCore.query(
      `DELETE FROM caderno_afirmacoes_favoritas WHERE usuario_id = $1 AND afirmacao_id = $2`,
      [usuarioId, afirmacaoId]
    );
    if (r.rowCount > 0) console.log(`📓 ${tag(usuarioId)} desfavoritou afirmação #${afirmacaoId}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error(`❌ [caderno] DELETE /afirmacoes/:id/favoritar u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao desfavoritar');
  }
});

// ════════════════════════════════════════════════════════════
// ÁUDIOS DE FOCO (catálogo + URL própria)
// ════════════════════════════════════════════════════════════

router.get('/audios', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const cat = await poolComunicacao.query(
      `SELECT id, titulo, tipo, url, duracao_seg
         FROM caderno_audios_foco
        WHERE ativo = TRUE
        ORDER BY ordem, id`
    );
    const pref = await poolCore.query(
      `SELECT url_propria, ultimo_audio_id FROM caderno_audio_pref_aluna WHERE usuario_id = $1`,
      [usuarioId]
    );
    return res.json({
      ok: true,
      catalogo: cat.rows,
      url_propria: pref.rows[0]?.url_propria || null,
      ultimo_audio_id: pref.rows[0]?.ultimo_audio_id || null,
    });
  } catch (e) {
    console.error('[caderno] GET /audios:', e.message);
    return erro(res, 500, 'erro ao listar áudios');
  }
});

// Salva URL própria da aluna (Spotify/YouTube/MP3)
router.put('/audios/url-propria', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const url = clampStr(req.body?.url, 1000).trim() || null;
    await poolCore.query(
      `INSERT INTO caderno_audio_pref_aluna (usuario_id, url_propria)
       VALUES ($1, $2)
       ON CONFLICT (usuario_id) DO UPDATE
         SET url_propria = EXCLUDED.url_propria, atualizado_em = NOW()`,
      [usuarioId, url]
    );
    console.log(`🎧 ${tag(usuarioId)} salvou URL própria de áudio: ${url ? url.slice(0, 80) : '(vazio)'}`);
    return res.json({ ok: true, url_propria: url });
  } catch (e) {
    console.error(`❌ [caderno] PUT /audios/url-propria u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao salvar URL');
  }
});

// Marca último áudio do catálogo escolhido (pra pré-selecionar próxima vez)
router.put('/audios/ultimo', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const audioId = req.body?.id ? Number(req.body.id) : null;
    await poolCore.query(
      `INSERT INTO caderno_audio_pref_aluna (usuario_id, ultimo_audio_id)
       VALUES ($1, $2)
       ON CONFLICT (usuario_id) DO UPDATE
         SET ultimo_audio_id = EXCLUDED.ultimo_audio_id, atualizado_em = NOW()`,
      [usuarioId, audioId]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[caderno] PUT /audios/ultimo:', e.message);
    return erro(res, 500, 'erro ao salvar preferência');
  }
});

module.exports = router;
