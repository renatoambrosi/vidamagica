/* ============================================================
   VIDA MÁGICA — routes/migracao.js
   Endpoints de migração de dados entre bancos antigos e novos.

   Use UMA vez para mover dados. Depois desligue/remova.

   Bancos: poolCore (origem) → poolComunicacao (destino)

   Endpoints (todos exigem autenticação admin):
     POST /api/admin/migracao/precos        → copia precos de Core p/ Comunicacao
     POST /api/admin/migracao/depoimentos   → copia depoimentos
     POST /api/admin/migracao/feed          → copia feed
     POST /api/admin/migracao/config        → copia config
     POST /api/admin/migracao/tudo          → tudo de uma vez
     GET  /api/admin/migracao/status        → conta linhas em cada banco
   ============================================================ */

const express = require('express');
const router = express.Router();

const { poolCore, poolComunicacao } = require('../db');
const { autenticarAdmin } = require('../middleware/autenticar');

// ── HELPER ─────────────────────────────────────────────────

async function tabelaExisteNoCore(nome) {
  const r = await poolCore.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [nome]
  );
  return r.rows.length > 0;
}

// ── PREÇOS ─────────────────────────────────────────────────

async function migrarPrecos() {
  if (!(await tabelaExisteNoCore('precos'))) {
    return { ok: true, copiados: 0, motivo: 'tabela precos não existe no Core' };
  }
  const origem = await poolCore.query(`SELECT key, dados FROM precos`);
  let copiados = 0;
  for (const row of origem.rows) {
    await poolComunicacao.query(
      `INSERT INTO precos (key, dados, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = NOW()`,
      [row.key, row.dados]
    );
    copiados++;
  }
  return { ok: true, copiados };
}

// ── DEPOIMENTOS ────────────────────────────────────────────

async function migrarDepoimentos() {
  if (!(await tabelaExisteNoCore('depoimentos'))) {
    return { ok: true, copiados: 0, motivo: 'tabela depoimentos não existe no Core' };
  }
  // Detecta colunas disponíveis (versões antigas podem não ter `tags`)
  const colsR = await poolCore.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'depoimentos'`
  );
  const cols = new Set(colsR.rows.map(r => r.column_name));
  const temTags = cols.has('tags');

  const origem = await poolCore.query(
    `SELECT id, nome, cidade, texto,
            ${temTags ? 'tags' : `'{}'::text[] AS tags`},
            ordem, ativo, criado_em
       FROM depoimentos`
  );

  // Limpa destino e copia preservando IDs
  await poolComunicacao.query(`TRUNCATE depoimentos RESTART IDENTITY`);
  let copiados = 0;
  for (const row of origem.rows) {
    await poolComunicacao.query(
      `INSERT INTO depoimentos (id, nome, cidade, texto, tags, ordem, ativo, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.id, row.nome, row.cidade, row.texto, row.tags || [], row.ordem ?? 0, row.ativo ?? true, row.criado_em]
    );
    copiados++;
  }
  // Avança o sequence pra evitar conflito futuro
  await poolComunicacao.query(`SELECT setval('depoimentos_id_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM depoimentos), 1))`);
  return { ok: true, copiados };
}

// ── FEED ───────────────────────────────────────────────────

async function migrarFeed() {
  if (!(await tabelaExisteNoCore('feed'))) {
    return { ok: true, copiados: 0, motivo: 'tabela feed não existe no Core' };
  }
  const origem = await poolCore.query(`SELECT * FROM feed`);
  await poolComunicacao.query(`TRUNCATE feed RESTART IDENTITY`);
  let copiados = 0;
  for (const row of origem.rows) {
    await poolComunicacao.query(
      `INSERT INTO feed (id, tipo, titulo, subtitulo, corpo, url, imagem_url, destaque, ativo, ordem, publicado_em, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.id, row.tipo, row.titulo, row.subtitulo, row.corpo, row.url, row.imagem_url,
        row.destaque ?? false, row.ativo ?? true, row.ordem ?? 0,
        row.publicado_em || row.criado_em || new Date(),
        row.criado_em || new Date(),
        row.atualizado_em || new Date(),
      ]
    );
    copiados++;
  }
  await poolComunicacao.query(`SELECT setval('feed_id_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM feed), 1))`);
  return { ok: true, copiados };
}

// ── CONFIG ─────────────────────────────────────────────────

async function migrarConfig() {
  if (!(await tabelaExisteNoCore('config'))) {
    return { ok: true, copiados: 0, motivo: 'tabela config não existe no Core' };
  }
  const origem = await poolCore.query(`SELECT chave, dados FROM config`);
  let copiados = 0;
  for (const row of origem.rows) {
    await poolComunicacao.query(
      `INSERT INTO config (chave, dados, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (chave) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = NOW()`,
      [row.chave, row.dados]
    );
    copiados++;
  }
  return { ok: true, copiados };
}

// ── ROTAS ──────────────────────────────────────────────────

router.post('/admin/migracao/precos', autenticarAdmin, async (req, res) => {
  try { res.json(await migrarPrecos()); }
  catch (err) { console.error('❌ migracao/precos:', err); res.status(500).json({ error: err.message }); }
});

router.post('/admin/migracao/depoimentos', autenticarAdmin, async (req, res) => {
  try { res.json(await migrarDepoimentos()); }
  catch (err) { console.error('❌ migracao/depoimentos:', err); res.status(500).json({ error: err.message }); }
});

router.post('/admin/migracao/feed', autenticarAdmin, async (req, res) => {
  try { res.json(await migrarFeed()); }
  catch (err) { console.error('❌ migracao/feed:', err); res.status(500).json({ error: err.message }); }
});

router.post('/admin/migracao/config', autenticarAdmin, async (req, res) => {
  try { res.json(await migrarConfig()); }
  catch (err) { console.error('❌ migracao/config:', err); res.status(500).json({ error: err.message }); }
});

router.post('/admin/migracao/tudo', autenticarAdmin, async (req, res) => {
  try {
    const resultado = {
      precos: await migrarPrecos(),
      depoimentos: await migrarDepoimentos(),
      feed: await migrarFeed(),
      config: await migrarConfig(),
    };
    res.json({ success: true, resultado });
  } catch (err) {
    console.error('❌ migracao/tudo:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/migracao/status', autenticarAdmin, async (req, res) => {
  try {
    const status = {};
    for (const tabela of ['precos', 'depoimentos', 'feed', 'config']) {
      let core = -1, comunicacao = -1;
      if (await tabelaExisteNoCore(tabela)) {
        const r1 = await poolCore.query(`SELECT COUNT(*)::int AS n FROM ${tabela}`);
        core = r1.rows[0].n;
      }
      try {
        const r2 = await poolComunicacao.query(`SELECT COUNT(*)::int AS n FROM ${tabela}`);
        comunicacao = r2.rows[0].n;
      } catch (_) {}
      status[tabela] = { core, comunicacao };
    }
    res.json({ status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
