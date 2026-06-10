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

// ⚠️ MODO DEV ⚠️ — relaxa o mínimo de 1 dia da Carta do Tempo pra o Renato testar
// o fluxo de amadurecimento (worker → WhatsApp/email/banner) sem esperar um dia.
// Mesma filosofia do TESOURO_INFINITO_DEV / `|| true` (ver CLAUDE.md "Fase atual").
// Quando true: a carta pode abrir em ~20s. TROCAR PRA false antes de abrir pras
// alunas reais (senão alunas lacram cartas que abrem quase na hora).
// Casado com DEV_TICK_RAPIDO em core/espaco-avisos.js (worker tick de 1 min).
const CARTA_DEV_SEM_MINIMO = true;
const CARTA_MIN_FUTURO_MS = CARTA_DEV_SEM_MINIMO ? 20 * 1000 : 24 * 3600 * 1000;

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
      dev_carta: CARTA_DEV_SEM_MINIMO,   // ⚠️ frontend mostra o preset "Em instantes (teste)"
    });
  } catch (e) {
    console.error(`❌ [espaco] GET /contexto u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao carregar contexto');
  }
});

// ════════════════════════════════════════════════════════════
// AFIRMAÇÕES — catálogo pra aluna (player do Ambiente). Só ativas.
// Base de URL configurável: hoje serve do repo (/assets/afirmacoes/);
// no futuro é só trocar AUDIO_AFIRMACOES_BASE pra um CDN (sem recadastrar —
// o banco guarda só o NOME do arquivo).
// ════════════════════════════════════════════════════════════
const AUDIO_AFIRMACOES_BASE = '/assets/afirmacoes/';
router.get('/afirmacoes', autenticar, async (req, res) => {
  try {
    const r = await poolEspaco.query(
      `SELECT id, texto, categoria, audio_arquivo, ordem
         FROM afirmacoes WHERE ativo = TRUE
        ORDER BY categoria NULLS LAST, ordem, id`
    );
    const afirmacoes = r.rows.map(a => ({
      id: a.id,
      texto: a.texto,
      categoria: a.categoria || 'Outras',
      audio_url: a.audio_arquivo ? (AUDIO_AFIRMACOES_BASE + encodeURIComponent(a.audio_arquivo)) : null,
    }));
    return res.json({ ok: true, base_audio: AUDIO_AFIRMACOES_BASE, afirmacoes });
  } catch (e) {
    console.error(`❌ [espaco] GET /afirmacoes u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao carregar afirmações');
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
    const modo = req.body?.modo === 'salvar' ? 'salvar' : 'enviar';
    const CTX = ['eu_passado', 'eu_presente', 'eu_futuro'];
    const cartaDe = CTX.includes(req.body?.carta_de) ? req.body.carta_de : null;
    const cartaPara = CTX.includes(req.body?.carta_para) ? req.body.carta_para : null;
    // Tipo da carta: tempo (clássica, com de/para) | metas (• checáveis) | gratidao.
    // Subtipo: metas → meta|sonho · gratidao → tenho|quero|ambos.
    const TIPOS = ['tempo', 'metas', 'gratidao'];
    const tipo = TIPOS.includes(req.body?.tipo) ? req.body.tipo : 'tempo';
    const SUBTIPOS = { metas: ['meta', 'sonho'], gratidao: ['tenho', 'quero', 'ambos'] };
    const subtipo = (SUBTIPOS[tipo] || []).includes(req.body?.subtipo) ? req.body.subtipo : null;
    if (!conteudo || conteudo.length < 10) return erro(res, 400, 'escreva pelo menos 10 caracteres');

    // Modo "salvar" = não envia: entra com a data de criação, já madura no Correio,
    // SEM notificação (aviso_enviado_em = agora faz o worker pular). Modo "enviar" = lacra
    // até a data escolhida e o worker avisa quando madura.
    let abrirEm, avisoEnviadoEm;
    if (modo === 'salvar') {
      abrirEm = new Date();
      avisoEnviadoEm = new Date();
    } else {
      abrirEm = req.body?.abrir_em ? new Date(req.body.abrir_em) : null;
      if (!abrirEm || isNaN(abrirEm) || abrirEm.getTime() < Date.now() + CARTA_MIN_FUTURO_MS) {
        return erro(res, 400, CARTA_DEV_SEM_MINIMO ? 'escolha uma data/hora no futuro' : 'a carta precisa abrir pelo menos 1 dia no futuro');
      }
      avisoEnviadoEm = null;
    }

    const r = await poolEspaco.query(
      `INSERT INTO cartas_do_tempo (usuario_id, titulo, conteudo, abrir_em, aviso_enviado_em, carta_de, carta_para, tipo, subtipo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, titulo, abrir_em, criado_em`,
      [usuarioId, titulo || null, conteudo, abrirEm.toISOString(), avisoEnviadoEm ? avisoEnviadoEm.toISOString() : null, cartaDe, cartaPara, tipo, subtipo]
    );
    console.log(`💌 ${tag(usuarioId)} ${modo === 'salvar' ? 'salvou' : 'lacrou'} carta do tempo #${r.rows[0].id}`);

    // Religação do gatilho da ofensiva: a Carta do Tempo é uma "escrita" do Espaço.
    // O alvo_tipo 'caderno_escrita' segue sendo o evento canônico (ver memória
    // project_renomear_caderno_para_espaco.md — não trocar a string, quebra missões).
    // Falha silenciosa: gamificação não pode bloquear o salvar.
    try {
      const { progressoEvento } = require('../core/gamificacao');
      await progressoEvento(usuarioId, 'caderno_escrita');
    } catch (e) { console.warn(`⚠️ [espaco] progressoEvento(carta) falhou:`, e.message); }

    return res.json({ ok: true, carta: r.rows[0] });
  } catch (e) {
    console.error(`❌ [espaco] POST /cartas u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao salvar carta');
  }
});

// ⚠️ MODO DEV — AMADURECE uma carta AGORA: destranca (abrir_em = NOW) + dispara o
// aviso REAL daquela carta (WhatsApp + email + in_app, com o título dela). Faz o
// que o Renato pediu: "o enviar email/whatsapp tem que destrancar a carta" — tudo
// num clique. Só existe enquanto CARTA_DEV_SEM_MINIMO.
router.post('/cartas/:id/amadurecer-teste', autenticar, async (req, res) => {
  if (!CARTA_DEV_SEM_MINIMO) return erro(res, 403, 'modo teste desligado');
  try {
    const usuarioId = req.usuario.sub;
    const cartaId = parseInt(req.params.id, 10);
    if (!cartaId) return erro(res, 400, 'id inválido');

    // 1) Destranca a carta (abrir_em = agora) e zera o aviso pra poder reenviar no teste
    const upd = await poolEspaco.query(
      `UPDATE cartas_do_tempo
          SET abrir_em = NOW(), aviso_enviado_em = NULL
        WHERE id = $1 AND usuario_id = $2
        RETURNING id, titulo, abrir_em, usuario_id`,
      [cartaId, usuarioId]
    );
    if (!upd.rows[0]) return erro(res, 404, 'carta não encontrada');
    const carta = upd.rows[0];

    // 2) Limpa avisos antigos dessa carta (em teste a gente quer reenviar)
    await poolEspaco.query(`DELETE FROM cartas_do_tempo_avisos WHERE carta_id = $1`, [cartaId]);

    // 3) Dispara o aviso REAL (mesmas funções do worker), com os dados da aluna
    const u = await poolCore.query(`SELECT id, nome, telefone, email FROM usuarios WHERE id = $1`, [usuarioId]);
    const usuario = u.rows[0] || {};
    const { enviarWhatsApp, enviarEmail, marcarInApp } = require('../core/espaco-avisos');
    const [whatsapp, email] = await Promise.all([
      enviarWhatsApp(carta, usuario),
      enviarEmail(carta, usuario),
    ]);
    await marcarInApp(carta);
    await poolEspaco.query(`UPDATE cartas_do_tempo SET aviso_enviado_em = NOW() WHERE id = $1`, [cartaId]);

    console.log(`🧪 ${tag(usuarioId)} amadureceu carta #${cartaId} — wa:${whatsapp.ok?'ok':'falha'} email:${email.ok?'ok':'falha'}`);
    return res.json({
      ok: true,
      whatsapp: { ok: whatsapp.ok, motivo: whatsapp.motivo || whatsapp.erro || null },
      email: { ok: email.ok, motivo: email.motivo || email.erro || null },
    });
  } catch (e) {
    console.error(`❌ [espaco] POST /cartas/:id/amadurecer-teste u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao amadurecer carta');
  }
});

// ⚠️ MODO DEV — dispara WhatsApp + email de TESTE pro próprio cadastro AGORA
// e reporta o resultado de cada canal. Só existe enquanto CARTA_DEV_SEM_MINIMO.
router.post('/cartas/testar-envio', autenticar, async (req, res) => {
  if (!CARTA_DEV_SEM_MINIMO) return erro(res, 403, 'modo teste desligado');
  try {
    const usuarioId = req.usuario.sub;
    const u = await poolCore.query(`SELECT nome, telefone, email FROM usuarios WHERE id = $1`, [usuarioId]);
    const usuario = u.rows[0] || {};
    const titulo = (req.body?.titulo || '').toString().slice(0, 120);  // o que ele digitou no form
    const { enviarTesteWhatsApp, enviarTesteEmail } = require('../core/espaco-avisos');
    const [whatsapp, email] = await Promise.all([
      enviarTesteWhatsApp(usuario, titulo),
      enviarTesteEmail(usuario, titulo),
    ]);
    console.log(`🧪 ${tag(usuarioId)} testou envios — wa:${whatsapp.ok?'ok':'falha'} email:${email.ok?'ok':'falha'}`);
    return res.json({
      ok: true,
      whatsapp, email,
      destino: { telefone: usuario.telefone || null, email: usuario.email || null },
    });
  } catch (e) {
    console.error(`❌ [espaco] POST /cartas/testar-envio u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao testar envios');
  }
});

router.get('/cartas', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    // Ordem do acervo (3 grupos):
    //  0) PRONTAS/maduras (já chegaram e ainda não lidas) — no topo;
    //  1) TRANCADAS — as mais próximas de chegar primeiro (abrir_em ASC);
    //  2) LIDAS — por chegada, a mais nova acima (abrir_em DESC).
    const r = await poolEspaco.query(
      `SELECT id, titulo, abrir_em, aberta_em, criado_em, reenviado_em, carta_de, carta_para, tipo, subtipo,
              (abrir_em > NOW()) AS trancada,
              CASE WHEN abrir_em > NOW() THEN NULL ELSE conteudo END AS conteudo
         FROM cartas_do_tempo
        WHERE usuario_id = $1
        ORDER BY
          CASE
            WHEN aberta_em IS NULL AND abrir_em <= NOW() THEN 0
            WHEN aberta_em IS NULL AND abrir_em >  NOW() THEN 1
            ELSE 2
          END,
          CASE WHEN aberta_em IS NULL AND abrir_em > NOW() THEN abrir_em END ASC NULLS LAST,
          abrir_em DESC`,
      [usuarioId]
    );
    return res.json({ ok: true, cartas: r.rows });
  } catch (e) {
    console.error(`❌ [espaco] GET /cartas u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao listar cartas');
  }
});

// Marca uma carta madura como LIDA (1ª abertura). Só se já chegou e ainda não lida.
router.post('/cartas/:id/lida', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const cartaId = parseInt(req.params.id, 10);
    if (!cartaId) return erro(res, 400, 'id inválido');
    await poolEspaco.query(
      `UPDATE cartas_do_tempo SET aberta_em = NOW()
        WHERE id = $1 AND usuario_id = $2 AND abrir_em <= NOW() AND aberta_em IS NULL`,
      [cartaId, usuarioId]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error(`❌ [espaco] POST /cartas/:id/lida u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao marcar lida');
  }
});

// CONTEÚDO — atualiza o texto de uma carta já MADURA. Usado pelos checks das
// "Metas & sonhos": a linha feita troca '• ' por '✓ ' no PRÓPRIO texto da carta
// (sem tabela nova — decisão do Renato: simples de administrar).
router.put('/cartas/:id/conteudo', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const cartaId = parseInt(req.params.id, 10);
    if (!cartaId) return erro(res, 400, 'id inválido');
    const conteudo = String(req.body?.conteudo || '').slice(0, 20000);
    if (!conteudo.trim()) return erro(res, 400, 'conteúdo vazio');
    const r = await poolEspaco.query(
      `UPDATE cartas_do_tempo SET conteudo = $1
        WHERE id = $2 AND usuario_id = $3 AND abrir_em <= NOW()
        RETURNING id`,
      [conteudo, cartaId, usuarioId]
    );
    if (!r.rows[0]) return erro(res, 404, 'carta não encontrada');
    return res.json({ ok: true });
  } catch (e) {
    console.error(`❌ [espaco] PUT /cartas/:id/conteudo u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao salvar');
  }
});

// REENVIAR — manda uma carta (já lida) pro futuro de novo, numa nova data.
// Volta a ser "a caminho" (aberta_em = NULL), guarda reenviado_em, e RESETA o
// ciclo de aviso (aviso_enviado_em = NULL + apaga avisos antigos) pra o worker
// notificar de novo quando ela chegar.
router.post('/cartas/:id/reenviar', autenticar, async (req, res) => {
  const client = await poolEspaco.connect();
  try {
    const usuarioId = req.usuario.sub;
    const cartaId = parseInt(req.params.id, 10);
    if (!cartaId) return erro(res, 400, 'id inválido');
    const abrirEm = req.body?.abrir_em ? new Date(req.body.abrir_em) : null;
    if (!abrirEm || isNaN(abrirEm) || abrirEm.getTime() < Date.now() + CARTA_MIN_FUTURO_MS) {
      return erro(res, 400, CARTA_DEV_SEM_MINIMO ? 'escolha uma data/hora no futuro' : 'a carta precisa abrir pelo menos 1 dia no futuro');
    }
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE cartas_do_tempo
          SET abrir_em = $1, aberta_em = NULL, reenviado_em = NOW(), aviso_enviado_em = NULL
        WHERE id = $2 AND usuario_id = $3
        RETURNING id`,
      [abrirEm.toISOString(), cartaId, usuarioId]
    );
    if (!r.rows[0]) { await client.query('ROLLBACK'); return erro(res, 404, 'carta não encontrada'); }
    await client.query(`DELETE FROM cartas_do_tempo_avisos WHERE carta_id = $1`, [cartaId]);
    await client.query('COMMIT');
    console.log(`📨 ${tag(usuarioId)} reenviou carta #${cartaId} (abre ${abrirEm.toISOString()})`);
    return res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`❌ [espaco] POST /cartas/:id/reenviar u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao reenviar carta');
  } finally {
    client.release();
  }
});

// Exclui uma carta (swipe → Excluir / Cancelar envio temporal). Cascateia avisos (FK).
router.delete('/cartas/:id', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const cartaId = parseInt(req.params.id, 10);
    if (!cartaId) return erro(res, 400, 'id inválido');
    await poolEspaco.query(`DELETE FROM cartas_do_tempo WHERE id = $1 AND usuario_id = $2`, [cartaId, usuarioId]);
    return res.json({ ok: true });
  } catch (e) {
    console.error(`❌ [espaco] DELETE /cartas/:id u=${tag(req.usuario?.sub)}:`, e.message);
    return erro(res, 500, 'erro ao excluir carta');
  }
});

module.exports = router;
