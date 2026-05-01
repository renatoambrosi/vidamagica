/* ============================================================
   VIDA MÁGICA — routes/chat.js
   Chat entre aluna e Atendimento (Suellen / Equipe Vida Mágica).

   Banco: poolMensagens (chat_conversas, chat_mensagens, chat_pacotes).
   Para validar usuario_id, consulta poolCore (usuarios).

   Rotas montadas em:
     /api/chat              → ALUNA (JWT)
     /api/atendimento/chat  → ATENDIMENTO (Basic Auth)

   Regras de negócio:
   - Cada aluna tem 1 conversa do tipo 'suellen' (criada na primeira msg).
   - Plano free (usuarios.plano='gratuito')      → resposta indeterminada
   - Plano basic (usuarios.plano≠'gratuito')     → resposta em até 5 dias
   - Plano prioritário (chat_conversas.plano_chat='prioritario')
       → R$ 9,90 por 30 interações OU 24h
       → resposta em até 24h
   - Aluna abre conversa → marca msgs do atendimento como lidas.
   - Atendimento abre conversa → NÃO marca como lida (só marca ao responder).
   - Identidade da resposta: 'suellen' ou 'equipe' (escolhida no painel).
   ============================================================ */

const express = require('express');
const router = express.Router();

const { poolCore, poolMensagens } = require('../db');
const { autenticar, autenticarAdmin } = require('../middleware/autenticar');

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
  // prioritario tem precedência (paga / cortesia ativa)
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

// ──────────────────────────────────────────────────────────
// ROUTER ALUNA — exige JWT
// ──────────────────────────────────────────────────────────

const routerAluna = express.Router();
routerAluna.use(autenticar);

// GET /api/chat/conversa — abre / cria a conversa, retorna últimas msgs
routerAluna.get('/conversa', async (req, res) => {
  try {
    const usuarioId = req.usuario.sub;
    const conversa = await getOuCriarConversa(usuarioId, 'suellen');
    const usuario = await buscarUsuarioBasico(usuarioId);

    const m = await poolMensagens.query(
      `SELECT * FROM chat_mensagens WHERE conversa_id = $1 ORDER BY criado_em ASC LIMIT 200`,
      [conversa.id]
    );

    // Marca mensagens do atendimento como lidas (a aluna está abrindo)
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
      // Notifica atendimento via WS (se conectado)
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

// POST /api/chat/mensagem — aluna manda mensagem
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

    // Insere mensagem
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

    // Atualiza conversa: incrementa não-lidas do atendimento
    await c.query(
      `UPDATE chat_conversas SET
         ultima_mensagem_em = NOW(),
         ultima_preview = $1,
         nao_lidas_suellen = nao_lidas_suellen + 1,
         atualizado_em = NOW()
       WHERE id = $2`,
      [preview, conversa.id]
    );

    // Decrementa interação se prioritário
    if (planoAtual === 'prioritario') {
      await c.query(
        `UPDATE chat_conversas SET interacoes_restantes = GREATEST(interacoes_restantes - 1, 0) WHERE id = $1`,
        [conversa.id]
      );
    }

    await c.query('COMMIT');

    // Notifica atendimento via WS
    emitirParaAtendimento('nova_mensagem', {
      conversa_id: conversa.id,
      mensagem: msg,
      usuario: { id: usuario.id, nome: usuario.nome, foto_url: usuario.foto_url, telefone: usuario.telefone },
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

// GET /api/chat/status — info do plano atual
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
// ROUTER ATENDIMENTO — exige Basic Auth
// ──────────────────────────────────────────────────────────

const routerAtendimento = express.Router();
routerAtendimento.use(autenticarAdmin);

// GET /api/atendimento/chat/conversas — lista todas
routerAtendimento.get('/conversas', async (req, res) => {
  try {
    const r = await poolMensagens.query(
      `SELECT id, usuario_id, plano_chat, interacoes_restantes,
              prioritario_expira_em, bloqueada, favoritada,
              ultima_mensagem_em, ultima_preview, nao_lidas_suellen, criado_em
         FROM chat_conversas
         ORDER BY plano_chat = 'prioritario' DESC, favoritada DESC, ultima_mensagem_em DESC
         LIMIT 200`
    );

    // Enriquece com dados do usuário (tabela em outro banco — Core)
    const ids = r.rows.map(c => c.usuario_id);
    let usuariosMap = {};
    if (ids.length) {
      const u = await poolCore.query(
        `SELECT id, nome, foto_url, telefone, plano FROM usuarios WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      usuariosMap = Object.fromEntries(u.rows.map(x => [x.id, x]));
    }

    const conversas = r.rows.map(c => ({
      ...c,
      usuario: usuariosMap[c.usuario_id] || { id: c.usuario_id, nome: '(?)' },
    }));

    res.json({ conversas });
  } catch (err) {
    console.error('❌ /atendimento/conversas:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /api/atendimento/chat/conversa/:id — abre conversa específica (NÃO marca como lida)
routerAtendimento.get('/conversa/:id', async (req, res) => {
  try {
    const conv = await poolMensagens.query(
      `SELECT * FROM chat_conversas WHERE id = $1`,
      [req.params.id]
    );
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });

    const m = await poolMensagens.query(
      `SELECT * FROM chat_mensagens WHERE conversa_id = $1 ORDER BY criado_em ASC LIMIT 500`,
      [req.params.id]
    );

    const usuario = await buscarUsuarioBasico(conv.rows[0].usuario_id);

    res.json({ conversa: conv.rows[0], mensagens: m.rows, usuario });
  } catch (err) {
    console.error('❌ /atendimento/conversa/:id:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/atendimento/chat/mensagem — atendimento responde
// Body: { conversa_id, conteudo, tipo, url, identidade ('suellen'|'equipe'), reply_to_* }
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

    // Insere mensagem do atendimento
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

    // Atualiza conversa + zera não lidas do atendimento + incrementa não lidas da aluna
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

    // Marca todas as msgs anteriores DA ALUNA como lidas (a equipe está respondendo,
    // logo viu tudo até aqui)
    const lidas = await c.query(
      `UPDATE chat_mensagens
         SET lida = TRUE, lida_em = NOW()
       WHERE conversa_id = $1 AND remetente = 'aluna' AND lida = FALSE
       RETURNING id`,
      [conversa_id]
    );

    await c.query('COMMIT');

    // Emite eventos via WS
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

// POST /api/atendimento/chat/favoritar — toggle estrela
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

// POST /api/atendimento/chat/acao — superadmin
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

// ──────────────────────────────────────────────────────────
// WEBSOCKET — conexões em memória
// ──────────────────────────────────────────────────────────

const wsClientesAlunas = new Map();        // usuario_id → Set<ws>
const wsClientesAtendimento = new Set();   // ws

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

// ──────────────────────────────────────────────────────────
// EXPORT
// ──────────────────────────────────────────────────────────

module.exports = {
  routerAluna,
  routerAtendimento,
  registrarWsAluna,
  registrarWsAtendimento,
  emitirParaAluna,
  emitirParaAtendimento,
};
