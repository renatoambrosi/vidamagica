/* ============================================================
   VIDA MÁGICA — routes/chat.js
   Chat entre aluna e Atendimento (Suellen / Equipe Vida Mágica).

   Banco: poolMensagens (chat_conversas, chat_mensagens, chat_pacotes,
                         chat_push_subscriptions).
   Para validar usuario_id, consulta poolCore (usuarios).

   Rotas montadas em:
     /api/chat              → ALUNA (JWT)
     /api/atendimento/chat  → ATENDIMENTO (JWT role 'atendimento')

   Web Push:
     - GET  /api/chat/vapid-public-key     (público)
     - POST /api/atendimento/chat/push-subscribe  (atendimento)
     - notificarAtendimento() chamada quando aluna manda msg
   ============================================================ */

const express = require('express');
const router = express.Router();
const webpush = require('web-push');

const { poolCore, poolMensagens } = require('../db');
const { autenticar, autenticarPainel } = require('../middleware/autenticar');

// ── WEB PUSH CONFIG ───────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'contato@vidamagica.com.br'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('⚠️ VAPID keys não configuradas — push notifications desativadas');
}

// ──────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────

async function getOuCriarConversa(usuarioId, tipo = 'suellen') {
  const r = await poolMensagens.query(
    `SELECT * FROM chat_conversas WHERE usuario_id = $1 AND tipo = $2`,
    [usuarioId, tipo]
  );
  if (r.rows.length) return r.rows[0];

  const novo = await poolMensagens.query(
    `INSERT INTO chat_conversas (usuario_id, tipo) VALUES ($1, $2) RETURNING *`,
    [usuarioId, tipo]
  );
  return novo.rows[0];
}

async function buscarUsuarioBasico(usuarioId) {
  const r = await poolCore.query(
    `SELECT id, nome, foto_url, plano, telefone FROM usuarios WHERE id = $1`,
    [usuarioId]
  );
  return r.rows[0] || null;
}

async function tipoPlanoAluna(conversa, usuario) {
  if (
    conversa.plano_chat === 'prioritario' &&
    conversa.prioritario_expira_em &&
    new Date(conversa.prioritario_expira_em) > new Date() &&
    (conversa.interacoes_restantes ?? 0) > 0
  ) {
    return 'prioritario';
  }
  if (usuario && usuario.plano && usuario.plano !== 'gratuito') return 'basic_vm';
  return 'free';
}

async function notificarAtendimento(payload) {
  try {
    const r = await poolMensagens.query(
      `SELECT * FROM chat_push_subscriptions WHERE ativo = TRUE`
    );
    for (const sub of r.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload)
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await poolMensagens.query(
            `UPDATE chat_push_subscriptions SET ativo = FALSE WHERE id = $1`,
            [sub.id]
          );
        }
      }
    }
  } catch (err) {
    console.error('[Chat Push]', err.message);
  }
}

// ──────────────────────────────────────────────────────────
// ROUTER ALUNA — exige JWT
// ──────────────────────────────────────────────────────────

const routerAluna = express.Router();

// VAPID public key — endpoint PÚBLICO (sem auth)
routerAluna.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// As demais rotas exigem autenticação
routerAluna.use(autenticar);

// GET /api/chat/conversa
routerAluna.get('/conversa', async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const conversa = await getOuCriarConversa(usuarioId, 'suellen');
    const usuario = await buscarUsuarioBasico(usuarioId);

    const m = await poolMensagens.query(
      `SELECT * FROM chat_mensagens WHERE conversa_id = $1 ORDER BY criado_em ASC LIMIT 200`,
      [conversa.id]
    );

    const idsParaMarcar = m.rows
      .filter(x => x.remetente === 'suellen' && !x.lida)
      .map(x => x.id);

    if (idsParaMarcar.length) {
      await poolMensagens.query(
        `UPDATE chat_mensagens SET lida = TRUE, lida_em = NOW() WHERE id = ANY($1::int[])`,
        [idsParaMarcar]
      );
      await poolMensagens.query(
        `UPDATE chat_conversas SET nao_lidas_aluna = 0, atualizado_em = NOW() WHERE id = $1`,
        [conversa.id]
      );
      emitirParaAtendimento('mensagens_lidas', {
        conversa_id: conversa.id,
        ids: idsParaMarcar,
        por: 'aluna',
      });
    }

    res.json({
      conversa,
      mensagens: m.rows,
      tipo_plano: await tipoPlanoAluna(conversa, usuario),
    });
  } catch (err) {
    console.error('❌ /chat/conversa:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/chat/mensagem
routerAluna.post('/mensagem', async (req, res) => {
  const c = await poolMensagens.connect();
  try {
    const usuarioId = req.usuario.sub;
    const { conteudo, tipo = 'texto', url, reply_to_id, reply_to_conteudo, reply_to_remetente, reply_to_identidade } = req.body;
    if (!conteudo && !url) return res.status(400).json({ error: 'Mensagem vazia' });

    const conversa = await getOuCriarConversa(usuarioId, 'suellen');
    if (conversa.bloqueada) return res.status(403).json({ error: 'Conversa bloqueada' });

    const usuario = await buscarUsuarioBasico(usuarioId);
    const planoAtual = await tipoPlanoAluna(conversa, usuario);

    await c.query('BEGIN');

    const ins = await c.query(
      `INSERT INTO chat_mensagens
         (conversa_id, usuario_id, remetente, tipo, conteudo, url,
          reply_to_id, reply_to_conteudo, reply_to_remetente, reply_to_identidade)
       VALUES ($1, $2, 'aluna', $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [conversa.id, usuarioId, tipo, conteudo || null, url || null,
       reply_to_id || null, reply_to_conteudo || null, reply_to_remetente || null, reply_to_identidade || null]
    );
    const msg = ins.rows[0];

    const preview = tipo === 'texto'
      ? String(conteudo || '').substring(0, 80)
      : (tipo === 'imagem' ? '📷 Imagem' : '🎤 Áudio');

    await c.query(
      `UPDATE chat_conversas SET
         ultima_mensagem_em = NOW(),
         ultima_preview = $1,
         nao_lidas_suellen = nao_lidas_suellen + 1,
         atualizado_em = NOW()
       WHERE id = $2`,
      [preview, conversa.id]
    );

    if (planoAtual === 'prioritario') {
      await c.query(
        `UPDATE chat_conversas SET interacoes_restantes = GREATEST(interacoes_restantes - 1, 0) WHERE id = $1`,
        [conversa.id]
      );
    }

    await c.query('COMMIT');

    // WS para atendimento
    emitirParaAtendimento('nova_mensagem', {
      conversa_id: conversa.id,
      mensagem: msg,
      usuario: { id: usuario.id, nome: usuario.nome, foto_url: usuario.foto_url, telefone: usuario.telefone },
    });

    // Push notification para atendimento
    notificarAtendimento({
      title: `${usuario.nome || 'Aluna'} enviou uma mensagem`,
      body: preview,
      data: { url: '/atendimento', conversa_id: conversa.id },
    });

    res.json({ mensagem: msg, tipo_plano: planoAtual });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('❌ POST /chat/mensagem:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  } finally {
    c.release();
  }
});

// GET /api/chat/status
routerAluna.get('/status', async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const conversa = await getOuCriarConversa(usuarioId, 'suellen');
    const usuario = await buscarUsuarioBasico(usuarioId);
    res.json({
      tipo_plano: await tipoPlanoAluna(conversa, usuario),
      interacoes_restantes: conversa.interacoes_restantes,
      prioritario_expira_em: conversa.prioritario_expira_em,
      bloqueada: conversa.bloqueada,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// ROUTER ATENDIMENTO — exige JWT role='atendimento'
// ──────────────────────────────────────────────────────────

const routerAtendimento = express.Router();
routerAtendimento.use(autenticarPainel('atendimento'));

// GET /api/atendimento/chat/conversas
routerAtendimento.get('/conversas', async (req, res) => {
  try {
    const r = await poolMensagens.query(
      `SELECT id, usuario_id, tipo, plano_chat, interacoes_restantes,
              prioritario_expira_em, bloqueada, favoritada,
              ultima_mensagem_em, ultima_preview, nao_lidas_suellen, criado_em
         FROM chat_conversas
         ORDER BY plano_chat = 'prioritario' DESC, favoritada DESC, ultima_mensagem_em DESC
         LIMIT 200`
    );

    const ids = r.rows.map(c => c.usuario_id);
    let usuariosMap = {};
    if (ids.length) {
      const u = await poolCore.query(
        `SELECT id, nome, foto_url, telefone, plano FROM usuarios WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      usuariosMap = Object.fromEntries(u.rows.map(x => [x.id, x]));
    }

    const conversas = r.rows.map(c => {
      const u = usuariosMap[c.usuario_id] || { id: c.usuario_id, nome: '(?)' };
      // tier: prioritario | basic_vm | free
      let tier = 'free';
      if (c.plano_chat === 'prioritario' && c.prioritario_expira_em && new Date(c.prioritario_expira_em) > new Date() && (c.interacoes_restantes ?? 0) > 0) {
        tier = 'prioritario';
      } else if (u.plano && u.plano !== 'gratuito') {
        tier = 'basic_vm';
      }
      // Achata os campos do usuário para o painel antigo (que espera c.nome, c.foto_url, etc)
      return {
        ...c,
        tier,
        nome: u.nome,
        foto_url: u.foto_url,
        telefone: u.telefone,
        plano: u.plano,
        usuario: u,
      };
    });

    res.json(conversas);
  } catch (err) {
    console.error('❌ /atendimento/conversas:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/atendimento/chat/conversa/:id
routerAtendimento.get('/conversa/:id', async (req, res) => {
  try {
    const conv = await poolMensagens.query(
      `SELECT * FROM chat_conversas WHERE id = $1`,
      [req.params.id]
    );
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    const conversa = conv.rows[0];

    const m = await poolMensagens.query(
      `SELECT * FROM chat_mensagens WHERE conversa_id = $1 ORDER BY criado_em ASC LIMIT 500`,
      [req.params.id]
    );

    const usuario = await buscarUsuarioBasico(conversa.usuario_id);

    // tier
    let tier = 'free';
    if (conversa.plano_chat === 'prioritario' && conversa.prioritario_expira_em && new Date(conversa.prioritario_expira_em) > new Date() && (conversa.interacoes_restantes ?? 0) > 0) {
      tier = 'prioritario';
    } else if (usuario && usuario.plano && usuario.plano !== 'gratuito') {
      tier = 'basic_vm';
    }

    // pacotes
    const p = await poolMensagens.query(
      `SELECT * FROM chat_pacotes WHERE usuario_id = $1 ORDER BY ativado_em DESC LIMIT 10`,
      [conversa.usuario_id]
    );

    res.json({
      conversa: { ...conversa, tier, foto_url: usuario?.foto_url, nome: usuario?.nome, telefone: usuario?.telefone, plano: usuario?.plano },
      mensagens: m.rows,
      usuario,
      pacotes: p.rows,
    });
  } catch (err) {
    console.error('❌ /atendimento/conversa/:id:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/atendimento/chat/mensagem
routerAtendimento.post('/mensagem', async (req, res) => {
  const c = await poolMensagens.connect();
  try {
    const { conversa_id, conteudo, tipo = 'texto', url, identidade = 'suellen',
            reply_to_id, reply_to_conteudo, reply_to_remetente, reply_to_identidade } = req.body;

    if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatório' });
    if (!conteudo && !url) return res.status(400).json({ error: 'Mensagem vazia' });
    if (!['suellen', 'equipe'].includes(identidade)) {
      return res.status(400).json({ error: 'identidade deve ser suellen ou equipe' });
    }

    const conv = await poolMensagens.query(
      `SELECT * FROM chat_conversas WHERE id = $1`,
      [conversa_id]
    );
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    const conversa = conv.rows[0];

    await c.query('BEGIN');

    const ins = await c.query(
      `INSERT INTO chat_mensagens
         (conversa_id, usuario_id, remetente, identidade, tipo, conteudo, url,
          reply_to_id, reply_to_conteudo, reply_to_remetente, reply_to_identidade)
       VALUES ($1, $2, 'suellen', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [conversa_id, conversa.usuario_id, identidade, tipo, conteudo || null, url || null,
       reply_to_id || null, reply_to_conteudo || null, reply_to_remetente || null, reply_to_identidade || null]
    );
    const msg = ins.rows[0];

    const preview = tipo === 'texto'
      ? String(conteudo || '').substring(0, 80)
      : (tipo === 'imagem' ? '📷 Imagem' : '🎤 Áudio');

    await c.query(
      `UPDATE chat_conversas SET
         ultima_mensagem_em = NOW(),
         ultima_preview = $1,
         nao_lidas_suellen = 0,
         nao_lidas_aluna = nao_lidas_aluna + 1,
         atualizado_em = NOW()
       WHERE id = $2`,
      [preview, conversa_id]
    );

    const lidas = await c.query(
      `UPDATE chat_mensagens
         SET lida = TRUE, lida_em = NOW()
       WHERE conversa_id = $1 AND remetente = 'aluna' AND lida = FALSE
       RETURNING id`,
      [conversa_id]
    );

    await c.query('COMMIT');

    emitirParaAluna(conversa.usuario_id, 'nova_mensagem', { mensagem: msg });
    if (lidas.rows.length) {
      emitirParaAluna(conversa.usuario_id, 'mensagens_lidas', {
        conversa_id,
        ids: lidas.rows.map(r => r.id),
        por: 'suellen',
      });
    }

    res.json({ mensagem: msg });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('❌ POST /atendimento/mensagem:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  } finally {
    c.release();
  }
});

// POST /api/atendimento/chat/favoritar
routerAtendimento.post('/favoritar', async (req, res) => {
  try {
    const { conversa_id, favoritada } = req.body;
    await poolMensagens.query(
      `UPDATE chat_conversas SET favoritada = $1, atualizado_em = NOW() WHERE id = $2`,
      [!!favoritada, conversa_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/atendimento/chat/acao
routerAtendimento.post('/acao', async (req, res) => {
  try {
    const { conversa_id, acao, valor } = req.body;
    switch (acao) {
      case 'bloquear':
        await poolMensagens.query(`UPDATE chat_conversas SET bloqueada=TRUE, atualizado_em=NOW() WHERE id=$1`, [conversa_id]);
        break;
      case 'desbloquear':
        await poolMensagens.query(`UPDATE chat_conversas SET bloqueada=FALSE, atualizado_em=NOW() WHERE id=$1`, [conversa_id]);
        break;
      case 'cortesia': {
        const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await poolMensagens.query(
          `UPDATE chat_conversas SET plano_chat='prioritario', interacoes_restantes=30,
             prioritario_expira_em=$1, prioritario_ativado_em=NOW(), atualizado_em=NOW()
           WHERE id=$2`,
          [expira, conversa_id]
        );
        const conv = await poolMensagens.query(`SELECT usuario_id FROM chat_conversas WHERE id=$1`, [conversa_id]);
        await poolMensagens.query(
          `INSERT INTO chat_pacotes (usuario_id, interacoes, valor_pago, expira_em, status)
           VALUES ($1, 30, 0, $2, 'ativo')`,
          [conv.rows[0].usuario_id, expira]
        );
        break;
      }
      case 'ajustar_interacoes':
        await poolMensagens.query(
          `UPDATE chat_conversas SET interacoes_restantes=$1, atualizado_em=NOW() WHERE id=$2`,
          [Number(valor) || 0, conversa_id]
        );
        break;
      case 'estender_prioritario': {
        const novaExpiracao = new Date(Date.now() + (Number(valor) || 24) * 60 * 60 * 1000);
        await poolMensagens.query(
          `UPDATE chat_conversas SET prioritario_expira_em=$1, atualizado_em=NOW() WHERE id=$2`,
          [novaExpiracao, conversa_id]
        );
        break;
      }
      case 'rebaixar_basic':
        await poolMensagens.query(
          `UPDATE chat_conversas SET plano_chat='basic', interacoes_restantes=NULL,
             prioritario_expira_em=NULL, atualizado_em=NOW() WHERE id=$1`,
          [conversa_id]
        );
        break;
      default:
        return res.status(400).json({ error: 'Ação inválida' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /atendimento/acao:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/atendimento/chat/stats
routerAtendimento.get('/stats', async (req, res) => {
  try {
    const r = await poolMensagens.query(`
      SELECT
        COUNT(*) FILTER (WHERE plano_chat = 'prioritario' AND prioritario_expira_em > NOW()) AS prioritarios_ativos,
        COUNT(*) AS total_conversas,
        SUM(nao_lidas_suellen) AS total_nao_lidas
      FROM chat_conversas
    `);
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/atendimento/chat/push-subscribe — registra device para push
routerAtendimento.post('/push-subscribe', async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys) return res.status(400).json({ error: 'endpoint e keys obrigatórios' });
    const ua = req.headers['user-agent'] || null;
    await poolMensagens.query(
      `INSERT INTO chat_push_subscriptions (endpoint, keys, user_agent, ativo)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (endpoint) DO UPDATE SET keys = EXCLUDED.keys, user_agent = EXCLUDED.user_agent, ativo = TRUE`,
      [endpoint, keys, ua]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ push-subscribe:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// WEBSOCKET
// ──────────────────────────────────────────────────────────

const wsClientesAlunas = new Map();
const wsClientesAtendimento = new Set();

function emitirParaAluna(usuarioId, evento, dados) {
  const conjunto = wsClientesAlunas.get(usuarioId);
  if (!conjunto) return;
  const payload = JSON.stringify({ evento, ...dados });
  for (const ws of conjunto) {
    try { ws.send(payload); } catch (_) {}
  }
}

function emitirParaAtendimento(evento, dados) {
  const payload = JSON.stringify({ evento, ...dados });
  for (const ws of wsClientesAtendimento) {
    try { ws.send(payload); } catch (_) {}
  }
}

function registrarWsAluna(usuarioId, ws) {
  if (!wsClientesAlunas.has(usuarioId)) wsClientesAlunas.set(usuarioId, new Set());
  wsClientesAlunas.get(usuarioId).add(ws);
  ws.on('close', () => {
    const set = wsClientesAlunas.get(usuarioId);
    if (set) {
      set.delete(ws);
      if (!set.size) wsClientesAlunas.delete(usuarioId);
    }
  });
}

function registrarWsAtendimento(ws) {
  wsClientesAtendimento.add(ws);
  ws.on('close', () => wsClientesAtendimento.delete(ws));
}

module.exports = {
  routerAluna,
  routerAtendimento,
  registrarWsAluna,
  registrarWsAtendimento,
  emitirParaAluna,
  emitirParaAtendimento,
};
