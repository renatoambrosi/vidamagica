/* ============================================================
   VIDA MÁGICA — routes/chat.js
   Chat entre aluna e Suellen
   - Basic: fila normal, mensagens ilimitadas
   - Prioritário: R$9,90 → 30 interações OU 24h
   - WebSocket tempo real
   - Web Push para notificar a Suellen
   ============================================================ */

const express  = require('express');
const router   = express.Router();
const webpush  = require('web-push');
const { pool } = require('../db');

/* ── Web Push config (variáveis de ambiente) ── */
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'contato@vidamagica.com.br'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/* ── Init tabelas ── */
async function initChat(client) {
  // Conversas — uma por aluna
  await client.query(`
    CREATE TABLE IF NOT EXISTS chat_conversas (
      id                    SERIAL PRIMARY KEY,
      usuario_id            UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      plano_chat            VARCHAR(20) DEFAULT 'basic' CHECK (plano_chat IN ('basic','prioritario')),
      interacoes_restantes  INTEGER DEFAULT NULL,
      prioritario_expira_em TIMESTAMPTZ DEFAULT NULL,
      prioritario_ativado_em TIMESTAMPTZ DEFAULT NULL,
      bloqueada             BOOLEAN DEFAULT FALSE,
      ultima_mensagem_em    TIMESTAMPTZ DEFAULT NOW(),
      ultima_preview        TEXT DEFAULT NULL,
      nao_lidas_suellen     INTEGER DEFAULT 0,
      nao_lidas_aluna       INTEGER DEFAULT 0,
      criado_em             TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(usuario_id)
    )
  `);

  // Mensagens
  await client.query(`
    CREATE TABLE IF NOT EXISTS chat_mensagens (
      id           SERIAL PRIMARY KEY,
      conversa_id  INTEGER NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
      remetente    VARCHAR(10) NOT NULL CHECK (remetente IN ('aluna','suellen')),
      tipo         VARCHAR(10) NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','imagem','audio','arquivo')),
      conteudo     TEXT,
      url          TEXT,
      lida         BOOLEAN DEFAULT FALSE,
      reply_to_id  INTEGER REFERENCES chat_mensagens(id) ON DELETE SET NULL,
      criado_em    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Garante coluna em bancos já existentes
  await client.query(`ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES chat_mensagens(id) ON DELETE SET NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_msgs_conversa ON chat_mensagens(conversa_id, criado_em DESC)`);

  // Pacotes prioritários comprados
  await client.query(`
    CREATE TABLE IF NOT EXISTS chat_pacotes (
      id           SERIAL PRIMARY KEY,
      usuario_id   UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      conversa_id  INTEGER NOT NULL REFERENCES chat_conversas(id),
      valor        NUMERIC(10,2) DEFAULT 9.90,
      interacoes   INTEGER DEFAULT 30,
      duracao_h    INTEGER DEFAULT 24,
      status       VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo','esgotado','expirado','cortesia')),
      ativado_em   TIMESTAMPTZ DEFAULT NOW(),
      expira_em    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
      esgotado_em  TIMESTAMPTZ DEFAULT NULL,
      origem       VARCHAR(20) DEFAULT 'pagamento' CHECK (origem IN ('pagamento','cortesia','admin'))
    )
  `);

  // Push subscriptions da Suellen
  await client.query(`
    CREATE TABLE IF NOT EXISTS chat_push_subscriptions (
      id           SERIAL PRIMARY KEY,
      endpoint     TEXT UNIQUE NOT NULL,
      keys         JSONB NOT NULL,
      user_agent   TEXT,
      criado_em    TIMESTAMPTZ DEFAULT NOW(),
      ativo        BOOLEAN DEFAULT TRUE
    )
  `);

  console.log('✅ Chat: tabelas OK');
}

/* ── Helpers ── */

// Retorna ou cria conversa da aluna
async function getOuCriarConversa(usuario_id) {
  let r = await pool.query(`SELECT * FROM chat_conversas WHERE usuario_id=$1`, [usuario_id]);
  if (r.rows.length) return r.rows[0];
  r = await pool.query(`INSERT INTO chat_conversas (usuario_id) VALUES ($1) RETURNING *`, [usuario_id]);
  return r.rows[0];
}

// Verifica se prioritário ainda é válido e atualiza se não for
async function verificarPrioritario(conversa) {
  if (conversa.plano_chat !== 'prioritario') return conversa;
  const agora = new Date();
  const expirou = conversa.prioritario_expira_em && new Date(conversa.prioritario_expira_em) < agora;
  const semInteracoes = conversa.interacoes_restantes !== null && conversa.interacoes_restantes <= 0;
  if (expirou || semInteracoes) {
    const motivo = expirou ? 'expirado' : 'esgotado';
    await pool.query(`
      UPDATE chat_conversas SET plano_chat='basic', interacoes_restantes=NULL, prioritario_expira_em=NULL, atualizado_em=NOW()
      WHERE id=$1`, [conversa.id]);
    await pool.query(`
      UPDATE chat_pacotes SET status=$1, esgotado_em=NOW() WHERE conversa_id=$2 AND status='ativo'`,
      [motivo, conversa.id]);
    conversa.plano_chat = 'basic';
    conversa.interacoes_restantes = null;
    conversa.prioritario_expira_em = null;
  }
  return conversa;
}

// Tempo relativo — "agora", "5min", "2h", "1 dia", "3 dias", "1 sem", "2 sem", "1 mês"...
function tempoRelativo(data) {
  const diff = Date.now() - new Date(data).getTime();
  const min  = Math.floor(diff / 60000);
  const h    = Math.floor(diff / 3600000);
  const dias = Math.floor(diff / 86400000);
  const sem  = Math.floor(dias / 7);
  const mes  = Math.floor(dias / 30);
  const anos = Math.floor(dias / 365);
  if (min < 1)   return 'agora';
  if (min < 60)  return `${min}min`;
  if (h < 24)    return `${h}h`;
  if (dias < 7)  return `${dias} dia${dias>1?'s':''}`;
  if (sem < 4)   return `${sem} sem`;
  if (mes < 12)  return `${mes} ${mes>1?'meses':'mês'}`;
  return `${anos} ano${anos>1?'s':''}`;
}

// Manda Web Push para todas as subscriptions ativas da Suellen
async function notificarSuellen(payload) {
  try {
    const r = await pool.query(`SELECT * FROM chat_push_subscriptions WHERE ativo=TRUE`);
    for (const sub of r.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload)
        );
      } catch (err) {
        // Se subscription inválida, desativa
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query(`UPDATE chat_push_subscriptions SET ativo=FALSE WHERE id=$1`, [sub.id]);
        }
      }
    }
  } catch (err) {
    console.error('[Chat Push]', err.message);
  }
}

// WebSocket clients da Suellen e das alunas
// Gerenciado pelo server.js via chatWs
const wsClients = new Map(); // chave: 'suellen' | `aluna:${usuario_id}`

function registrarWs(chave, ws) { wsClients.set(chave, ws); }
function removerWs(chave)       { wsClients.delete(chave); }
function emitirParaAluna(usuario_id, evento, dados) {
  const ws = wsClients.get(`aluna:${usuario_id}`);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ evento, ...dados }));
}
function emitirParaSuellen(evento, dados) {
  const ws = wsClients.get('suellen');
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ evento, ...dados }));
}

/* ════════════════════════════════════════════════════════════
   ROTAS — ALUNA (autenticadas via JWT no server.js)
   ════════════════════════════════════════════════════════════ */

// GET /api/chat/conversa — retorna (ou cria) a conversa da aluna logada
router.get('/conversa', async (req, res) => {
  try {
    let conv = await getOuCriarConversa(req.usuario.sub);
    conv = await verificarPrioritario(conv);

    // Busca últimas 50 mensagens
    const msgs = await pool.query(`
      SELECT m.*,
        r.conteudo   AS reply_to_conteudo,
        r.remetente  AS reply_to_remetente
      FROM chat_mensagens m
      LEFT JOIN chat_mensagens r ON r.id = m.reply_to_id
      WHERE m.conversa_id=$1
      ORDER BY m.criado_em ASC LIMIT 50`, [conv.id]);

    // Marca mensagens da Suellen como lidas
    await pool.query(`
      UPDATE chat_mensagens SET lida=TRUE
      WHERE conversa_id=$1 AND remetente='suellen' AND lida=FALSE`, [conv.id]);
    await pool.query(`UPDATE chat_conversas SET nao_lidas_aluna=0 WHERE id=$1`, [conv.id]);

    res.json({
      conversa: {
        ...conv,
        tempo: tempoRelativo(conv.ultima_mensagem_em),
      },
      mensagens: msgs.rows,
    });
  } catch (err) {
    console.error('[Chat] GET conversa:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/mensagem — aluna envia mensagem
router.post('/mensagem', async (req, res) => {
  const { conteudo, tipo = 'texto', url } = req.body;
  if (!conteudo && !url) return res.status(400).json({ error: 'conteudo ou url obrigatório' });

  try {
    let conv = await getOuCriarConversa(req.usuario.sub);
    conv = await verificarPrioritario(conv);

    if (conv.bloqueada) return res.status(403).json({ error: 'Chat bloqueado' });

    // Desconta interação se for prioritário
    if (conv.plano_chat === 'prioritario' && conv.interacoes_restantes !== null) {
      const novas = conv.interacoes_restantes - 1;
      await pool.query(`
        UPDATE chat_conversas SET interacoes_restantes=$1, atualizado_em=NOW() WHERE id=$2`,
        [novas, conv.id]);
      conv.interacoes_restantes = novas;
      // Verifica se esgotou
      if (novas <= 0) {
        await pool.query(`
          UPDATE chat_conversas SET plano_chat='basic', interacoes_restantes=NULL,
          prioritario_expira_em=NULL, atualizado_em=NOW() WHERE id=$1`, [conv.id]);
        await pool.query(`
          UPDATE chat_pacotes SET status='esgotado', esgotado_em=NOW()
          WHERE conversa_id=$1 AND status='ativo'`, [conv.id]);
        conv.plano_chat = 'basic';
      }
    }

    const preview = conteudo ? conteudo.substring(0, 80) : (tipo === 'imagem' ? '📷 Imagem' : tipo === 'audio' ? '🎤 Áudio' : '📎 Arquivo');

    // Salva mensagem
    const r = await pool.query(`
      INSERT INTO chat_mensagens (conversa_id, remetente, tipo, conteudo, url)
      VALUES ($1,'aluna',$2,$3,$4) RETURNING *`,
      [conv.id, tipo, conteudo || null, url || null]);
    const msg = r.rows[0];

    // Atualiza conversa
    await pool.query(`
      UPDATE chat_conversas SET ultima_mensagem_em=NOW(), ultima_preview=$1,
      nao_lidas_suellen=nao_lidas_suellen+1, atualizado_em=NOW() WHERE id=$2`,
      [preview, conv.id]);

    // Emite via WebSocket para a Suellen
    emitirParaSuellen('nova_mensagem', {
      conversa_id:  conv.id,
      usuario_id:   req.usuario.sub,
      nome:         req.usuario.nome,
      foto_url:     req.usuario.foto_url,
      plano_chat:   conv.plano_chat,
      mensagem:     msg,
      preview,
      tempo:        'agora',
    });

    // Web Push se Suellen não estiver online
    if (!wsClients.has('suellen')) {
      await notificarSuellen({
        title: conv.plano_chat === 'prioritario' ? `⭐ ${req.usuario.nome}` : req.usuario.nome,
        body:  preview,
        data:  { conversa_id: conv.id, url: '/suellen' },
      });
    }

    res.json({
      mensagem: msg,
      conversa: {
        plano_chat:           conv.plano_chat,
        interacoes_restantes: conv.interacoes_restantes,
        prioritario_expira_em: conv.prioritario_expira_em,
      },
    });
  } catch (err) {
    console.error('[Chat] POST mensagem:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/ativar-prioritario — ativa pacote pago
router.post('/ativar-prioritario', async (req, res) => {
  const { origem = 'pagamento' } = req.body;
  try {
    let conv = await getOuCriarConversa(req.usuario.sub);
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(`
      UPDATE chat_conversas SET
        plano_chat='prioritario',
        interacoes_restantes=30,
        prioritario_expira_em=$1,
        prioritario_ativado_em=NOW(),
        atualizado_em=NOW()
      WHERE id=$2`, [expira, conv.id]);

    await pool.query(`
      INSERT INTO chat_pacotes (usuario_id, conversa_id, status, ativado_em, expira_em, origem)
      VALUES ($1,$2,'ativo',NOW(),$3,$4)`,
      [req.usuario.sub, conv.id, expira, origem]);

    res.json({ success: true, expira_em: expira, interacoes: 30 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/status — status atual do chat da aluna
router.get('/status', async (req, res) => {
  try {
    let conv = await getOuCriarConversa(req.usuario.sub);
    conv = await verificarPrioritario(conv);
    res.json({
      plano_chat:            conv.plano_chat,
      interacoes_restantes:  conv.interacoes_restantes,
      prioritario_expira_em: conv.prioritario_expira_em,
      bloqueada:             conv.bloqueada,
      nao_lidas:             conv.nao_lidas_aluna,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════
   ROTAS — SUELLEN (Basic Auth via server.js)
   ════════════════════════════════════════════════════════════ */

// GET /api/suellen/chat/conversas — lista todas as conversas
router.get('/conversas', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        c.*,
        u.nome, u.foto_url, u.telefone_formatado,
        u.perfil_teste, u.sementes
      FROM chat_conversas c
      JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY
        CASE WHEN c.plano_chat='prioritario' THEN 0 ELSE 1 END ASC,
        c.ultima_mensagem_em DESC
    `);
    res.json(r.rows.map(row => ({
      ...row,
      tempo: tempoRelativo(row.ultima_mensagem_em),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suellen/chat/conversa/:id — abre uma conversa
router.get('/conversa/:id', async (req, res) => {
  try {
    const conv = await pool.query(`
      SELECT c.*, u.nome, u.foto_url, u.telefone_formatado, u.email,
             u.perfil_teste, u.percentual_prosperidade, u.sementes, u.plano
      FROM chat_conversas c JOIN usuarios u ON u.id=c.usuario_id
      WHERE c.id=$1`, [req.params.id]);
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });

    const msgs = await pool.query(`
      SELECT m.*,
        r.conteudo   AS reply_to_conteudo,
        r.remetente  AS reply_to_remetente
      FROM chat_mensagens m
      LEFT JOIN chat_mensagens r ON r.id = m.reply_to_id
      WHERE m.conversa_id=$1
      ORDER BY m.criado_em ASC`, [req.params.id]);

    // Marca como lidas
    await pool.query(`
      UPDATE chat_mensagens SET lida=TRUE
      WHERE conversa_id=$1 AND remetente='aluna' AND lida=FALSE`, [req.params.id]);
    await pool.query(`UPDATE chat_conversas SET nao_lidas_suellen=0 WHERE id=$1`, [req.params.id]);

    // Histórico de pacotes
    const pacotes = await pool.query(`
      SELECT * FROM chat_pacotes WHERE conversa_id=$1 ORDER BY ativado_em DESC`, [req.params.id]);

    res.json({
      conversa: { ...conv.rows[0], tempo: tempoRelativo(conv.rows[0].ultima_mensagem_em) },
      mensagens: msgs.rows,
      pacotes: pacotes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suellen/chat/mensagem — Suellen responde
router.post('/mensagem', async (req, res) => {
  const { conversa_id, conteudo, tipo = 'texto', url, reply_to_id } = req.body;
  if (!conversa_id || (!conteudo && !url)) return res.status(400).json({ error: 'dados inválidos' });
  try {
    const conv = await pool.query(`SELECT * FROM chat_conversas WHERE id=$1`, [conversa_id]);
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });

    const r = await pool.query(`
      INSERT INTO chat_mensagens (conversa_id, remetente, tipo, conteudo, url, reply_to_id)
      VALUES ($1,'suellen',$2,$3,$4,$5) RETURNING *`,
      [conversa_id, tipo, conteudo || null, url || null, reply_to_id || null]);
    const msg = r.rows[0];

    const preview = conteudo ? conteudo.substring(0, 80) : (tipo === 'imagem' ? '📷 Imagem' : '🎤 Áudio');

    await pool.query(`
      UPDATE chat_conversas SET ultima_mensagem_em=NOW(), ultima_preview=$1,
      nao_lidas_aluna=nao_lidas_aluna+1, atualizado_em=NOW() WHERE id=$2`,
      [preview, conversa_id]);

    // Emite para a aluna via WebSocket
    emitirParaAluna(conv.rows[0].usuario_id, 'nova_mensagem', { mensagem: msg });

    // Web Push para aluna (se não estiver online) — futuro
    // Por ora só WebSocket

    res.json({ mensagem: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SUPERADMIN — controle total ──

// POST /api/suellen/chat/acao — bloquear, dar cortesia, ajustar interações
router.post('/acao', async (req, res) => {
  const { conversa_id, acao, valor } = req.body;
  // acao: 'bloquear' | 'desbloquear' | 'cortesia' | 'ajustar_interacoes' | 'estender_prioritario' | 'rebaixar_basic'
  try {
    switch (acao) {
      case 'bloquear':
        await pool.query(`UPDATE chat_conversas SET bloqueada=TRUE, atualizado_em=NOW() WHERE id=$1`, [conversa_id]);
        break;
      case 'desbloquear':
        await pool.query(`UPDATE chat_conversas SET bloqueada=FALSE, atualizado_em=NOW() WHERE id=$1`, [conversa_id]);
        break;
      case 'cortesia': {
        const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await pool.query(`
          UPDATE chat_conversas SET plano_chat='prioritario', interacoes_restantes=30,
          prioritario_expira_em=$1, prioritario_ativado_em=NOW(), atualizado_em=NOW() WHERE id=$2`,
          [expira, conversa_id]);
        const conv = await pool.query(`SELECT usuario_id FROM chat_conversas WHERE id=$1`, [conversa_id]);
        await pool.query(`
          INSERT INTO chat_pacotes (usuario_id,conversa_id,status,ativado_em,expira_em,origem,valor)
          VALUES ($1,$2,'ativo',NOW(),$3,'cortesia',0)`,
          [conv.rows[0].usuario_id, conversa_id, expira]);
        break;
      }
      case 'ajustar_interacoes':
        await pool.query(`UPDATE chat_conversas SET interacoes_restantes=$1, atualizado_em=NOW() WHERE id=$2`, [valor, conversa_id]);
        break;
      case 'estender_prioritario': {
        const novaExpiracao = new Date(Date.now() + (valor || 24) * 60 * 60 * 1000);
        await pool.query(`UPDATE chat_conversas SET prioritario_expira_em=$1, atualizado_em=NOW() WHERE id=$2`, [novaExpiracao, conversa_id]);
        await pool.query(`UPDATE chat_pacotes SET expira_em=$1 WHERE conversa_id=$2 AND status='ativo'`, [novaExpiracao, conversa_id]);
        break;
      }
      case 'rebaixar_basic':
        await pool.query(`
          UPDATE chat_conversas SET plano_chat='basic', interacoes_restantes=NULL,
          prioritario_expira_em=NULL, atualizado_em=NOW() WHERE id=$1`, [conversa_id]);
        await pool.query(`UPDATE chat_pacotes SET status='esgotado', esgotado_em=NOW() WHERE conversa_id=$1 AND status='ativo'`, [conversa_id]);
        break;
      default:
        return res.status(400).json({ error: 'ação inválida' });
    }
    res.json({ success: true, acao });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suellen/chat/stats — métricas
router.get('/stats', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE plano_chat='prioritario') AS prioritarias,
        COUNT(*) FILTER (WHERE plano_chat='basic') AS basic,
        COUNT(*) FILTER (WHERE nao_lidas_suellen > 0) AS aguardando,
        COUNT(*) FILTER (WHERE bloqueada=TRUE) AS bloqueadas,
        COUNT(*) AS total
      FROM chat_conversas
    `);
    const receita = await pool.query(`
      SELECT COALESCE(SUM(valor),0) as total, COUNT(*) as pacotes
      FROM chat_pacotes WHERE origem='pagamento'
    `);
    res.json({ ...r.rows[0], ...receita.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Web Push — registro de subscription da Suellen ── */
// POST /api/suellen/chat/push-subscribe
router.post('/push-subscribe', async (req, res) => {
  const { endpoint, keys, userAgent } = req.body;
  if (!endpoint || !keys) return res.status(400).json({ error: 'dados inválidos' });
  try {
    await pool.query(`
      INSERT INTO chat_push_subscriptions (endpoint, keys, user_agent)
      VALUES ($1,$2,$3)
      ON CONFLICT (endpoint) DO UPDATE SET keys=$2, ativo=TRUE, user_agent=$3`,
      [endpoint, JSON.stringify(keys), userAgent || null]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/vapid-public-key — chave pública para o frontend
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

module.exports = { router, initChat, registrarWs, removerWs, emitirParaAluna, emitirParaSuellen };
