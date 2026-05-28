/* ============================================================
   VIDA MÁGICA — routes/gamificacao.js
   Endpoints da gamificação da plataforma (lado da aluna).

   Bancos:
   - poolCore         → estado da aluna (streak, prêmios, missões, ranking)
   - poolComunicacao  → catálogos do admin (missões, config de prêmios)

   Auth: todos usam `autenticar` (JWT Bearer da aluna).
   Mount em server.js como `app.use('/api/app/gamificacao', require('./routes/gamificacao'))`.

   Endpoints:
   - GET /missoes   — missões ativas + progresso da aluna
   - GET /premios   — histórico de prêmios recebidos (paginado)
   - GET /ranking   — top 10 do mês corrente + minha posição
   - GET /status    — streak + recordes + ciclo atual (espelho do contexto)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolCore, poolComunicacao } = require('../db');
const { autenticar } = require('../middleware/autenticar');
const {
  lerStreak,
  calcularRankingMensalPreview,
  isoMonth,
} = require('../core/gamificacao');
const { calcularJornadaVigente } = require('../core/jornadas');

function erro(res, code, msg) {
  return res.status(code).json({ ok: false, erro: msg });
}
function tag(usuario_id) { return String(usuario_id || '?').slice(0, 8); }

// ── GET /status ──────────────────────────────────────────
// Espelho do que vai em /api/app/contexto.gamificacao + recordes.
router.get('/status', autenticar, async (req, res) => {
  try {
    const s = await lerStreak(req.usuario.sub);
    return res.json({ ok: true, status: s });
  } catch (e) {
    console.error('[gam] GET /status:', e.message);
    return erro(res, 500, 'erro ao ler status');
  }
});

// ── GET /missoes ─────────────────────────────────────────
// Lista missões ativas + progresso da aluna. Filtra por jornada vigente
// (NULL = pra todas) + por janela (inicia_em/expira_em).
router.get('/missoes', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;

    // Descobre jornada vigente — wrapper defensivo
    let jornadaSlug = null;
    try {
      const uR = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
      const tel = uR.rows[0]?.telefone;
      const { poolTeste } = require('../db');
      const tR = await poolTeste.query(
        `SELECT perfil_dominante, percentuais, nivel_prosperidade
           FROM testes
          WHERE (usuario_id = $1 OR telefone_canonico = $2)
          ORDER BY feito_em DESC LIMIT 1`,
        [usuarioId, tel]
      );
      if (tR.rows[0]) {
        const t = tR.rows[0];
        const pR = await poolCore.query(
          `SELECT p.slug FROM usuario_produtos up
           LEFT JOIN produtos p ON p.id = up.produto_id
           WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2) AND up.ativo = true`,
          [usuarioId, tel]
        );
        const slugsComprados = new Set(pR.rows.map(r => r.slug).filter(Boolean));
        const j = calcularJornadaVigente({
          perfil_dominante: t.perfil_dominante,
          perfil_dominante_bruto: (t.perfil_dominante || '').replace(/_nv\d$/, ''),
          percentuais_exibicao: t.percentuais || {},
          nivel_prosperidade: t.nivel_prosperidade || 0,
          slugsComprados,
        });
        jornadaSlug = j?.slug || null;
      }
    } catch (_) {}

    // Missões ativas: da jornada vigente OU universais (NULL)
    const missoesR = await poolComunicacao.query(
      `SELECT id, slug, titulo, descricao, tipo, alvo_qtd, sementes,
              prioridade, inicia_em, expira_em
         FROM gam_missoes
        WHERE ativa = TRUE
          AND (jornada_slug IS NULL OR jornada_slug = $1)
          AND (inicia_em IS NULL OR inicia_em <= NOW())
          AND (expira_em IS NULL OR expira_em > NOW())
        ORDER BY prioridade ASC, id ASC`,
      [jornadaSlug]
    );

    // Progresso da aluna em cada uma
    const ids = missoesR.rows.map(m => m.id);
    let progressoMap = new Map();
    if (ids.length > 0) {
      const pR = await poolCore.query(
        `SELECT missao_id, progresso, alvo, completada_em
           FROM gam_missao_progresso
          WHERE usuario_id = $1 AND missao_id = ANY($2::int[])`,
        [usuarioId, ids]
      );
      progressoMap = new Map(pR.rows.map(p => [p.missao_id, p]));
    }

    const missoes = missoesR.rows.map(m => {
      const p = progressoMap.get(m.id);
      return {
        id: m.id,
        slug: m.slug,
        titulo: m.titulo,
        descricao: m.descricao,
        tipo: m.tipo,
        alvo: p?.alvo || m.alvo_qtd || 1,
        progresso: p?.progresso || 0,
        completada_em: p?.completada_em || null,
        sementes: m.sementes,
      };
    });

    console.log(`🏆 ${tag(usuarioId)} consultou missões (jornada=${jornadaSlug || 'universal'}, ${missoes.length} ativas)`);
    return res.json({ ok: true, missoes, jornada_slug: jornadaSlug });
  } catch (e) {
    console.error(`❌ [gam] GET /missoes u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao listar missões');
  }
});

// ── GET /premios ─────────────────────────────────────────
// Histórico de prêmios recebidos pela aluna (mais recentes primeiro).
router.get('/premios', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    const r = await poolCore.query(
      `SELECT id, tipo, marco, ciclo_id, sementes_creditadas, recebido_em
         FROM gam_premios_recebidos
        WHERE usuario_id = $1
        ORDER BY recebido_em DESC
        LIMIT $2`,
      [usuarioId, limit]
    );

    if (r.rows.length === 0) return res.json({ ok: true, premios: [] });

    // Enriquece com rótulos da config (1 query no poolComunicacao)
    const chaves = r.rows.map(p => [p.tipo, p.marco]);
    const tiposUnicos = [...new Set(r.rows.map(p => p.tipo))];
    const marcosUnicos = [...new Set(r.rows.map(p => p.marco))];

    const cfgR = await poolComunicacao.query(
      `SELECT tipo, marco, rotulo, descricao
         FROM gam_premios_config
        WHERE tipo = ANY($1::text[]) AND marco = ANY($2::text[])`,
      [tiposUnicos, marcosUnicos]
    );
    const cfgMap = new Map(cfgR.rows.map(c => [`${c.tipo}|${c.marco}`, c]));

    const premios = r.rows.map(p => {
      const cfg = cfgMap.get(`${p.tipo}|${p.marco}`);
      return {
        id: p.id,
        tipo: p.tipo,
        marco: p.marco,
        sementes_creditadas: p.sementes_creditadas,
        recebido_em: p.recebido_em,
        rotulo: cfg?.rotulo || `${p.tipo} · ${p.marco}`,
        descricao: cfg?.descricao || null,
      };
    });

    return res.json({ ok: true, premios });
  } catch (e) {
    console.error(`❌ [gam] GET /premios u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao listar prêmios');
  }
});

// ── GET /ranking ─────────────────────────────────────────
// Top 10 do mês corrente (preview ao vivo — o snapshot final só é
// gravado em gam_ranking_mensal quando o mês fecha).
router.get('/ranking', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const mes = String(req.query.mes || isoMonth());

    const ranking = await calcularRankingMensalPreview(mes, 10);

    if (ranking.length === 0) {
      return res.json({ ok: true, mes, ranking: [] });
    }

    // Enriquece com nome da aluna (poolCore)
    const ids = ranking.map(r => r.usuario_id);
    const nR = await poolCore.query(
      `SELECT id, nome, nome_preferencia FROM usuarios WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    const nomeMap = new Map(nR.rows.map(u => [u.id, (u.nome_preferencia || u.nome || '').split(' ')[0] || 'Aluna']));

    const enriquecido = ranking.map(r => ({
      posicao: r.posicao,
      usuario_id: r.usuario_id,
      nome: nomeMap.get(r.usuario_id) || 'Aluna',
      pontos: r.pontos,
      eu: r.usuario_id === usuarioId,
    }));

    // Se a aluna não está no top 10, calcula sua posição real
    let minhaPosicao = null;
    if (!enriquecido.some(r => r.eu)) {
      const inicio = `${mes}-01`;
      const fim = `${mes.slice(0, 4)}-${String(Number(mes.slice(5, 7)) + 1).padStart(2, '0')}-01`;
      const totalR = await poolCore.query(
        `SELECT COUNT(*)::int AS pontos
           FROM gam_login_diario
          WHERE usuario_id = $1 AND dia >= $2 AND dia < $3`,
        [usuarioId, inicio, fim]
      );
      const meusPontos = totalR.rows[0]?.pontos || 0;
      const acimaR = await poolCore.query(
        `SELECT COUNT(*)::int AS qt FROM (
           SELECT usuario_id, COUNT(*) AS p
             FROM gam_login_diario
            WHERE dia >= $1 AND dia < $2
            GROUP BY usuario_id
           HAVING COUNT(*) > $3
         ) x`,
        [inicio, fim, meusPontos]
      );
      minhaPosicao = (acimaR.rows[0]?.qt || 0) + 1;
    }

    return res.json({
      ok: true,
      mes,
      ranking: enriquecido,
      minha_posicao_fora_top: minhaPosicao,
    });
  } catch (e) {
    console.error(`❌ [gam] GET /ranking u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao calcular ranking');
  }
});

module.exports = router;
