/* ============================================================
   VIDA MÁGICA — routes/chat.js
   Chat aluna ↔ Atendimento (Suellen / Equipe).
   Port fiel do antigo, adaptado pros 4 pools.

   Pools:
   - poolCore       → tabela usuarios (busca info da aluna)
   - poolMensagens  → chat_conversas, chat_mensagens, chat_pacotes,
                       chat_push_subscriptions

   Middleware:
   - routerAluna       → autenticar (JWT aluna)
   - routerAtendimento → autenticarPainel('atendimento') (JWT painel)

   Notas:
   - Schema usa reply_to_* denormalizado (em vez de JOIN do antigo)
   - Timer prioritário só roda quando IDENTIDADE='suellen' (não equipe)
   - WS suellen é registrado por chave 'suellen'
   ============================================================ */

const express = require('express');
const webpush = require('web-push');
const { poolCore, poolMensagens } = require('../db');
const { autenticar, autenticarPainel } = require('../middleware/autenticar');

const routerAluna       = express.Router();
const routerAtendimento = express.Router();

// ── VAPID config ──────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'contato@vidamagica.com.br'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── HELPERS ───────────────────────────────────────────────

async function getOuCriarConversa(usuario_id, tipo = 'suellen') {
  let r = await poolMensagens.query(
    `SELECT * FROM chat_conversas WHERE usuario_id=$1 AND tipo=$2`,
    [usuario_id, tipo]
  );
  if (r.rows.length) return r.rows[0];
  r = await poolMensagens.query(
    `INSERT INTO chat_conversas (usuario_id, tipo) VALUES ($1, $2) RETURNING *`,
    [usuario_id, tipo]
  );
  return r.rows[0];
}

async function verificarPrioritario(conversa) {
  if (conversa.plano_chat !== 'prioritario') return conversa;
  const agora = new Date();
  const expirou = conversa.prioritario_expira_em && new Date(conversa.prioritario_expira_em) < agora;
  const semInteracoes = conversa.interacoes_restantes !== null && conversa.interacoes_restantes <= 0;
  if (expirou || semInteracoes) {
    await poolMensagens.query(`
      UPDATE chat_conversas SET plano_chat='basic', interacoes_restantes=NULL,
        prioritario_expira_em=NULL, atualizado_em=NOW()
      WHERE id=$1`, [conversa.id]);
    // Marca pacotes ativos como expirado/esgotado
    const motivo = expirou ? 'expirado' : 'esgotado';
    await poolMensagens.query(`
      UPDATE chat_pacotes SET status=$1
      WHERE usuario_id=$2 AND status='ativo'`,
      [motivo, conversa.usuario_id]);
    conversa.plano_chat = 'basic';
    conversa.interacoes_restantes = null;
    conversa.prioritario_expira_em = null;
  }
  return conversa;
}

function calcularTier(plano_usuario, plano_chat) {
  if (plano_chat === 'prioritario') return 'prioritario';
  if (!plano_usuario || plano_usuario === 'gratuito') return 'free';
  return 'basic_vm';
}

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

async function buscarUsuarioBasico(usuario_id) {
  const r = await poolCore.query(
    `SELECT id, nome, email, telefone_formatado, foto_url, plano,
            perfil_teste, percentual_prosperidade, sementes
     FROM usuarios WHERE id=$1`,
    [usuario_id]
  );
  return r.rows[0] || null;
}

async function notificarSuellen(payload) {
  try {
    const r = await poolMensagens.query(
      `SELECT * FROM chat_push_subscriptions WHERE ativo=TRUE AND usuario_id IS NULL`
    );
    for (const sub of r.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload)
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await poolMensagens.query(`UPDATE chat_push_subscriptions SET ativo=FALSE WHERE id=$1`, [sub.id]);
        }
      }
    }
  } catch (err) {
    console.error('[Chat Push Suellen]', err.message);
  }
}

// Envia push pra aluna em todos os dispositivos onde ela autorizou.
// Usado quando Suellen responde e a aluna NÃO está com WS conectado (não está vendo o app).
async function notificarAluna(usuarioId, payload) {
  try {
    const r = await poolMensagens.query(
      `SELECT * FROM chat_push_subscriptions WHERE ativo=TRUE AND usuario_id=$1`,
      [usuarioId]
    );
    for (const sub of r.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload)
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await poolMensagens.query(`UPDATE chat_push_subscriptions SET ativo=FALSE WHERE id=$1`, [sub.id]);
        }
      }
    }
  } catch (err) {
    console.error('[Chat Push Aluna]', err.message);
  }
}

// ── WS clients ────────────────────────────────────────────

const wsClients = new Map();
function registrarWs(chave, ws) { wsClients.set(chave, ws); }
function removerWs(chave)       { wsClients.delete(chave); }

// Helpers de compatibilidade com server.js
function registrarWsAluna(usuario_id, ws) {
  const chave = `aluna:${usuario_id}`;
  wsClients.set(chave, ws);
  ws.on('close', () => wsClients.delete(chave));
}
function registrarWsAtendimento(ws) {
  wsClients.set('suellen', ws);
  ws.on('close', () => wsClients.delete('suellen'));
}

function emitirParaAluna(usuario_id, evento, dados) {
  const ws = wsClients.get(`aluna:${usuario_id}`);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ evento, ...dados }));
}
function emitirParaSuellen(evento, dados) {
  const ws = wsClients.get('suellen');
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ evento, ...dados }));
}

// Texto-template: aluna Free clica em "Assinar Vida Mágica"
function gerarMensagemAssinaturaVM() {
  return [
    'Oi, que bom te ver por aqui! 🌟',
    '',
    'O Vida Mágica é o nosso plano de acompanhamento contínuo. Aqui vão os detalhes:',
    '',
    '✨ Vantagens:',
    '• Resposta em até 5 dias úteis',
    '• Acesso completo aos materiais e conteúdos da plataforma',
    '• Acompanhamento das suas Sementes e Prosperidade',
    '• Suporte direto comigo neste chat',
    '',
    '⭐ Quer resposta em até 24h? Você também pode ativar o Atendimento Prioritário (R$ 9,90 por 30 interações em 24h) a qualquer momento.',
    '',
    '👉 Para assinar o Vida Mágica, é só acessar:',
    'https://www.vidamagica.com.br/assinar',
    '',
    'Qualquer dúvida, me chama por aqui! Estou com você nessa jornada. 💛',
  ].join('\n');
}

// ════════════════════════════════════════════════════════════
// ROTAS — ALUNA  (montadas em /api/chat)
// ════════════════════════════════════════════════════════════

// Endpoint público (sem autenticar) — VAPID public key
routerAluna.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// A partir daqui exige auth
routerAluna.use(autenticar);

// ── PUSH NOTIFICATIONS DA ALUNA ────────────────────────────
// Modal "Permita as notificações da Suellen!" pede autorização ao browser.
// Se aluna autoriza → frontend manda subscription pra cá → atrelamos ao usuario_id dela.
// Quando Suellen responde e aluna não está online (sem WS), backend dispara push.

// Status atual: o que mostrar/não mostrar no modal
routerAluna.get('/notif-status', async (req, res) => {
  try {
    const r = await poolCore.query(
      `SELECT notif_status, notif_modal_ultima_em FROM usuarios WHERE id=$1`,
      [req.usuario.sub]
    );
    const u = r.rows[0] || {};
    // Pra mostrar o modal, precisa ser:
    //   - nunca mostrou (notif_status IS NULL)
    //   - OU já tocou "agora não" mas faz mais de 7 dias
    let mostrar_modal = !u.notif_status;
    if (u.notif_status === 'agora_nao' && u.notif_modal_ultima_em) {
      const diff = Date.now() - new Date(u.notif_modal_ultima_em).getTime();
      mostrar_modal = diff > 7 * 24 * 60 * 60 * 1000;
    }
    res.json({
      status: u.notif_status || null,
      ultima_em: u.notif_modal_ultima_em,
      mostrar_modal,
    });
  } catch (err) {
    console.error('[ChatAluna] /notif-status:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Aluna tocou "Agora não" no modal — registra cooldown
routerAluna.post('/notif-status', async (req, res) => {
  const { status } = req.body || {};
  if (!['permitida','recusada','agora_nao'].includes(status)) {
    return res.status(400).json({ error: 'status inválido' });
  }
  try {
    await poolCore.query(
      `UPDATE usuarios
          SET notif_status=$1, notif_modal_ultima_em=NOW(), atualizado_em=NOW()
        WHERE id=$2`,
      [status, req.usuario.sub]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[ChatAluna] /notif-status POST:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Aluna aceitou no browser → manda subscription, atrelamos ao id dela
routerAluna.post('/push-subscribe', async (req, res) => {
  const { endpoint, keys, userAgent } = req.body || {};
  if (!endpoint || !keys) return res.status(400).json({ error: 'dados inválidos' });
  try {
    await poolMensagens.query(
      `INSERT INTO chat_push_subscriptions (endpoint, keys, user_agent, usuario_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET
         keys=$2, user_agent=$3, usuario_id=$4, ativo=TRUE`,
      [endpoint, JSON.stringify(keys), userAgent || null, req.usuario.sub]
    );
    // Marca status na conta
    await poolCore.query(
      `UPDATE usuarios
          SET notif_status='permitida', notif_modal_ultima_em=NOW(), atualizado_em=NOW()
        WHERE id=$1`,
      [req.usuario.sub]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[ChatAluna] /push-subscribe:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Aluna desativou ou desinstalou — remove subscription dela
routerAluna.post('/push-unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint obrigatório' });
  try {
    await poolMensagens.query(
      `UPDATE chat_push_subscriptions SET ativo=FALSE WHERE endpoint=$1 AND usuario_id=$2`,
      [endpoint, req.usuario.sub]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[ChatAluna] /push-unsubscribe:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/conversa  ?tipo=suellen|suporte
routerAluna.get('/conversa', async (req, res) => {
  const tipo = (req.query.tipo === 'suporte') ? 'suporte' : 'suellen';
  try {
    let conv = await getOuCriarConversa(req.usuario.sub, tipo);
    conv = await verificarPrioritario(conv);

    const usuario = await buscarUsuarioBasico(req.usuario.sub);
    const planoUsuario = usuario?.plano || 'gratuito';
    const tier = calcularTier(planoUsuario, conv.plano_chat);

    const msgs = await poolMensagens.query(
      `SELECT * FROM chat_mensagens WHERE conversa_id=$1
       ORDER BY criado_em ASC LIMIT 50`,
      [conv.id]
    );

    // Reações de todas as mensagens dessa conversa, agregadas por mensagem
    const reacoesQ = await poolMensagens.query(
      `SELECT mensagem_id, emoji, autor_tipo, autor_id
         FROM chat_reacoes WHERE conversa_id=$1`,
      [conv.id]
    );
    const reacoesPorMsg = {};
    for (const r of reacoesQ.rows) {
      if (!reacoesPorMsg[r.mensagem_id]) reacoesPorMsg[r.mensagem_id] = {};
      if (!reacoesPorMsg[r.mensagem_id][r.emoji]) {
        reacoesPorMsg[r.mensagem_id][r.emoji] = { count: 0, autores: [] };
      }
      reacoesPorMsg[r.mensagem_id][r.emoji].count++;
      reacoesPorMsg[r.mensagem_id][r.emoji].autores.push({ tipo: r.autor_tipo, id: r.autor_id });
    }
    msgs.rows.forEach(m => { m.reacoes = reacoesPorMsg[m.id] || {}; });

    // REGRA: aluna LENDO (abrindo a conversa) marca as mensagens do atendimento
    // como lidas. O ✓✓ azul aparece pra Suellen/suporte em TEMPO REAL via WebSocket.
    // (Outro lado é diferente: atendimento só marca lida ao RESPONDER — ver POST.)
    const lidas = await poolMensagens.query(
      `UPDATE chat_mensagens SET lida=TRUE, lida_em=NOW()
        WHERE conversa_id=$1 AND remetente IN ('suellen','suporte') AND lida=FALSE
       RETURNING id, remetente, lida_em`,
      [conv.id]
    );
    await poolMensagens.query(
      `UPDATE chat_conversas SET nao_lidas_aluna=0 WHERE id=$1`,
      [conv.id]
    );

    // Emite WebSocket pro painel de atendimento (Suellen + suporte usam o mesmo painel).
    // O frontend filtra pela conversa_id e atualiza visual em tempo real.
    if (lidas.rows.length > 0) {
      const lidaEm = lidas.rows[0].lida_em;
      const ids = lidas.rows.map(r => r.id);
      emitirParaSuellen('mensagens_lidas', { conversa_id: conv.id, ids, lida_em: lidaEm, por: 'aluna' });
    }

    res.json({
      conversa: {
        ...conv,
        tier,
        plano_usuario: planoUsuario,
        tempo: tempoRelativo(conv.ultima_mensagem_em),
      },
      mensagens: msgs.rows,
    });
  } catch (err) {
    console.error('[ChatAluna] GET conversa:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/mensagem  body: { tipo_chat, conteudo, tipo, url, reply_to_id }
routerAluna.post('/mensagem', async (req, res) => {
  const { tipo_chat, conteudo, tipo = 'texto', url, reply_to_id } = req.body || {};
  const tipoChat = (tipo_chat === 'suporte') ? 'suporte' : 'suellen';
  if (!conteudo && !url) return res.status(400).json({ error: 'conteudo ou url obrigatório' });

  try {
    let conv = await getOuCriarConversa(req.usuario.sub, tipoChat);
    conv = await verificarPrioritario(conv);

    if (conv.bloqueada) return res.status(403).json({ error: 'Chat bloqueado' });

    // Decrementa interações se for prioritário
    if (conv.plano_chat === 'prioritario' && conv.interacoes_restantes !== null) {
      const novas = conv.interacoes_restantes - 1;
      await poolMensagens.query(
        `UPDATE chat_conversas SET interacoes_restantes=$1, atualizado_em=NOW() WHERE id=$2`,
        [novas, conv.id]
      );
      conv.interacoes_restantes = novas;
      if (novas <= 0) {
        await poolMensagens.query(
          `UPDATE chat_conversas SET plano_chat='basic', interacoes_restantes=NULL,
             prioritario_expira_em=NULL, atualizado_em=NOW() WHERE id=$1`,
          [conv.id]
        );
        await poolMensagens.query(
          `UPDATE chat_pacotes SET status='esgotado' WHERE usuario_id=$1 AND status='ativo'`,
          [req.usuario.sub]
        );
        conv.plano_chat = 'basic';
      }
    }

    const preview = conteudo ? conteudo.substring(0, 80)
                  : (tipo === 'imagem' ? '📷 Imagem' : tipo === 'audio' ? '🎤 Áudio' : '📎 Arquivo');

    // Buscar dados denormalizados do reply_to (se houver)
    let replyDenorm = { conteudo: null, remetente: null, identidade: null };
    if (reply_to_id) {
      const rep = await poolMensagens.query(
        `SELECT conteudo, remetente, identidade FROM chat_mensagens WHERE id=$1`,
        [reply_to_id]
      );
      if (rep.rows[0]) replyDenorm = rep.rows[0];
    }

    const r = await poolMensagens.query(
      `INSERT INTO chat_mensagens
        (conversa_id, usuario_id, remetente, tipo, conteudo, url, reply_to_id,
         reply_to_conteudo, reply_to_remetente, reply_to_identidade)
       VALUES ($1, $2, 'aluna', $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [conv.id, req.usuario.sub, tipo, conteudo || null, url || null, reply_to_id || null,
       replyDenorm.conteudo, replyDenorm.remetente, replyDenorm.identidade]
    );
    let msg = r.rows[0];

    // ✓✓ ENTREGUE: se atendimento está com WS conectado, marca entregue na hora.
    const atendimentoOnline = wsClients.has('suellen');
    if (atendimentoOnline) {
      const upd = await poolMensagens.query(
        `UPDATE chat_mensagens SET entregue=TRUE, entregue_em=NOW()
          WHERE id=$1 RETURNING entregue, entregue_em`,
        [msg.id]
      );
      msg = { ...msg, ...upd.rows[0] };
    }

    // REGRA: aluna RESPONDEU → marca todas as msgs anteriores do atendimento como lidas.
    // (Isso é o que faz aparecer ✓✓ azul pro lado de quem mandou — Suellen ou suporte.)
    const lidas = await poolMensagens.query(
      `UPDATE chat_mensagens SET lida=TRUE, lida_em=NOW()
       WHERE conversa_id=$1 AND remetente='suellen' AND lida=FALSE
       RETURNING id`,
      [conv.id]
    );
    const lidasIds = lidas.rows.map(x => x.id);

    await poolMensagens.query(
      `UPDATE chat_conversas SET ultima_mensagem_em=NOW(), ultima_preview=$1,
         nao_lidas_suellen=nao_lidas_suellen+1, nao_lidas_aluna=0, atualizado_em=NOW()
       WHERE id=$2`,
      [preview, conv.id]
    );

    // Eventos WS — UM ÚNICO EVENTO ATÔMICO pra evitar dessincronia visual.
    // (Antes eram 2 eventos separados — 'mensagens_lidas' e 'nova_mensagem' — e o
    //  frontend renderizava em frames diferentes, fazendo o ✓✓ azul aparecer DEPOIS
    //  da mensagem nova. Agora vai tudo num só.)
    emitirParaSuellen('resposta_aluna_e_lidas', {
      conversa_id:   conv.id,
      conversa_tipo: tipoChat,
      usuario_id:    req.usuario.sub,
      nome:          req.usuario.nome,
      plano_chat:    conv.plano_chat,
      mensagem:      msg,
      lidas_ids:     lidasIds,           // pintar ✓✓ azul nessas mensagens
      lidas_por:     'aluna',
      preview,
      tempo: 'agora',
    });

    if (!wsClients.has('suellen')) {
      await notificarSuellen({
        title: conv.plano_chat === 'prioritario'
          ? `⭐ ${req.usuario.nome || 'Aluna'}`
          : (req.usuario.nome || 'Aluna'),
        body:  preview,
        data:  { conversa_id: conv.id, url: '/atendimento' },
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
    console.error('[ChatAluna] POST mensagem:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/marcar-lidas  body: { tipo_chat }
// Disparado quando aluna está com chat aberto e recebe msg nova via WS — marca
// como lida instantaneamente (sem precisar fechar/reabrir o chat).
routerAluna.post('/marcar-lidas', async (req, res) => {
  try {
    const tipo = (req.body?.tipo_chat === 'suporte') ? 'suporte' : 'suellen';
    const conv = await getOuCriarConversa(req.usuario.sub, tipo);

    const lidas = await poolMensagens.query(
      `UPDATE chat_mensagens SET lida=TRUE, lida_em=NOW()
        WHERE conversa_id=$1 AND remetente IN ('suellen','suporte') AND lida=FALSE
       RETURNING id, lida_em`,
      [conv.id]
    );
    await poolMensagens.query(
      `UPDATE chat_conversas SET nao_lidas_aluna=0 WHERE id=$1`, [conv.id]
    );

    if (lidas.rows.length > 0) {
      const lidaEm = lidas.rows[0].lida_em;
      const ids = lidas.rows.map(r => r.id);
      emitirParaSuellen('mensagens_lidas', { conversa_id: conv.id, ids, lida_em: lidaEm, por: 'aluna' });
    }
    res.json({ success: true, marcadas: lidas.rows.length });
  } catch (err) {
    console.error('[ChatAluna] /marcar-lidas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/digitando
routerAluna.post('/digitando', async (req, res) => {
  emitirParaSuellen('digitando', {
    usuario_id: req.usuario.sub,
    nome: req.usuario.nome,
  });
  res.json({ ok: true });
});

// POST /api/chat/ativar-prioritario
routerAluna.post('/ativar-prioritario', async (req, res) => {
  const { origem = 'pagamento', tipo_chat } = req.body || {};
  const tipoChat = (tipo_chat === 'suporte') ? 'suporte' : 'suellen';
  try {
    const conv = await getOuCriarConversa(req.usuario.sub, tipoChat);
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await poolMensagens.query(
      `UPDATE chat_conversas SET
         plano_chat='prioritario',
         interacoes_restantes=30,
         prioritario_expira_em=$1,
         prioritario_ativado_em=NOW(),
         atualizado_em=NOW()
       WHERE id=$2`,
      [expira, conv.id]
    );
    await poolMensagens.query(
      `INSERT INTO chat_pacotes (usuario_id, interacoes, valor_pago, status, ativado_em, expira_em)
       VALUES ($1, 30, 9.90, 'ativo', NOW(), $2)`,
      [req.usuario.sub, expira]
    );
    res.json({ success: true, expira_em: expira, interacoes: 30, origem });
  } catch (err) {
    console.error('[ChatAluna] POST ativar-prioritario:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/status  ?tipo=suellen|suporte
routerAluna.get('/status', async (req, res) => {
  const tipo = (req.query.tipo === 'suporte') ? 'suporte' : 'suellen';
  try {
    let conv = await getOuCriarConversa(req.usuario.sub, tipo);
    conv = await verificarPrioritario(conv);
    const usuario = await buscarUsuarioBasico(req.usuario.sub);
    const tier = calcularTier(usuario?.plano, conv.plano_chat);
    res.json({
      tipo,
      plano_chat:            conv.plano_chat,
      plano_usuario:         usuario?.plano || 'gratuito',
      tier,
      interacoes_restantes:  conv.interacoes_restantes,
      prioritario_expira_em: conv.prioritario_expira_em,
      bloqueada:             conv.bloqueada,
      nao_lidas:             conv.nao_lidas_aluna,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/resumo — info dos 2 chats da aluna pra tela de escolha
routerAluna.get('/resumo', async (req, res) => {
  try {
    let convSuellen = await getOuCriarConversa(req.usuario.sub, 'suellen');
    let convSuporte = await getOuCriarConversa(req.usuario.sub, 'suporte');
    convSuellen = await verificarPrioritario(convSuellen);
    convSuporte = await verificarPrioritario(convSuporte);
    const usuario = await buscarUsuarioBasico(req.usuario.sub);
    const planoUsuario = usuario?.plano || 'gratuito';
    res.json({
      plano_usuario: planoUsuario,
      suellen: {
        nao_lidas: convSuellen.nao_lidas_aluna,
        ultima_preview: convSuellen.ultima_preview,
        ultima_mensagem_em: convSuellen.ultima_mensagem_em,
        tier: calcularTier(planoUsuario, convSuellen.plano_chat),
      },
      suporte: {
        nao_lidas: convSuporte.nao_lidas_aluna,
        ultima_preview: convSuporte.ultima_preview,
        ultima_mensagem_em: convSuporte.ultima_mensagem_em,
        tier: calcularTier(planoUsuario, convSuporte.plano_chat),
      },
    });
  } catch (err) {
    console.error('[ChatAluna] GET resumo:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/assinar-vm-template
// Aluna Free clica "Assinar Vida Mágica" → injeta msg da Suellen explicando assinatura
routerAluna.post('/assinar-vm-template', async (req, res) => {
  try {
    const conv = await getOuCriarConversa(req.usuario.sub, 'suellen');
    const conteudo = gerarMensagemAssinaturaVM();
    const r = await poolMensagens.query(
      `INSERT INTO chat_mensagens (conversa_id, usuario_id, remetente, identidade, tipo, conteudo)
       VALUES ($1, $2, 'suellen', 'suellen', 'texto', $3)
       RETURNING *`,
      [conv.id, req.usuario.sub, conteudo]
    );
    const msg = r.rows[0];

    const preview = conteudo.substring(0, 80);
    await poolMensagens.query(
      `UPDATE chat_conversas SET ultima_mensagem_em=NOW(), ultima_preview=$1,
         nao_lidas_aluna=nao_lidas_aluna+1, atualizado_em=NOW()
       WHERE id=$2`,
      [preview, conv.id]
    );

    emitirParaAluna(req.usuario.sub, 'nova_mensagem', { mensagem: msg, conversa_id: conv.id });
    emitirParaSuellen('nova_mensagem', {
      conversa_id: conv.id, conversa_tipo: 'suellen',
      usuario_id: req.usuario.sub, nome: req.usuario.nome,
      mensagem: msg, preview, tempo: 'agora', origem: 'template_assinar_vm',
    });
    res.json({ success: true, mensagem: msg });
  } catch (err) {
    console.error('[ChatAluna] POST assinar-vm-template:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// ROTAS — ATENDIMENTO  (montadas em /api/atendimento/chat)
// ════════════════════════════════════════════════════════════

routerAtendimento.use(autenticarPainel('atendimento'));

routerAtendimento.get('/conversas', async (req, res) => {
  try {
    // 1. Buscar conversas
    const convs = await poolMensagens.query(`
      SELECT * FROM chat_conversas
      ORDER BY favoritada DESC, ultima_mensagem_em DESC
    `);
    if (!convs.rows.length) return res.json([]);

    // 2. Buscar dados dos usuários (no banco Core, sem JOIN entre bancos)
    const userIds = [...new Set(convs.rows.map(c => c.usuario_id))];
    const usuariosResult = await poolCore.query(
      `SELECT id, nome, foto_url, telefone_formatado,
              perfil_teste, sementes, plano AS plano_usuario
       FROM usuarios WHERE id = ANY($1::uuid[])`,
      [userIds]
    );
    const userMap = new Map(usuariosResult.rows.map(u => [u.id, u]));

    // 3. Combinar e ordenar
    const enriched = convs.rows
      .map(c => {
        const u = userMap.get(c.usuario_id) || {};
        return {
          ...c,
          nome: u.nome || null,
          foto_url: u.foto_url || null,
          telefone_formatado: u.telefone_formatado || null,
          perfil_teste: u.perfil_teste || null,
          sementes: u.sementes || 0,
          plano_usuario: u.plano_usuario || 'gratuito',
          tier: calcularTier(u.plano_usuario, c.plano_chat),
          tempo: tempoRelativo(c.ultima_mensagem_em),
        };
      })
      // Ordem final: prioritário primeiro, depois VM, depois free; favoritados sobem
      .sort((a, b) => {
        const peso = (x) => {
          if (x.plano_chat === 'prioritario') return 0;
          if (x.plano_usuario && x.plano_usuario !== 'gratuito') return 1;
          return 2;
        };
        const da = peso(a), db = peso(b);
        if (da !== db) return da - db;
        if (a.favoritada !== b.favoritada) return b.favoritada - a.favoritada;
        return new Date(b.ultima_mensagem_em) - new Date(a.ultima_mensagem_em);
      });

    res.json(enriched);
  } catch (err) {
    console.error('[ChatAtend] GET conversas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

routerAtendimento.get('/conversa/:id', async (req, res) => {
  try {
    const convResult = await poolMensagens.query(
      `SELECT * FROM chat_conversas WHERE id=$1`,
      [req.params.id]
    );
    if (!convResult.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    const conv = convResult.rows[0];

    // Dados do usuário (banco Core)
    const usuario = await buscarUsuarioBasico(conv.usuario_id);

    const msgs = await poolMensagens.query(
      `SELECT * FROM chat_mensagens WHERE conversa_id=$1 ORDER BY criado_em ASC`,
      [req.params.id]
    );

    // Reações agregadas por mensagem
    const reacoesQ = await poolMensagens.query(
      `SELECT mensagem_id, emoji, autor_tipo, autor_id
         FROM chat_reacoes WHERE conversa_id=$1`,
      [req.params.id]
    );
    const reacoesPorMsg = {};
    for (const r of reacoesQ.rows) {
      if (!reacoesPorMsg[r.mensagem_id]) reacoesPorMsg[r.mensagem_id] = {};
      if (!reacoesPorMsg[r.mensagem_id][r.emoji]) {
        reacoesPorMsg[r.mensagem_id][r.emoji] = { count: 0, autores: [] };
      }
      reacoesPorMsg[r.mensagem_id][r.emoji].count++;
      reacoesPorMsg[r.mensagem_id][r.emoji].autores.push({ tipo: r.autor_tipo, id: r.autor_id });
    }
    msgs.rows.forEach(m => { m.reacoes = reacoesPorMsg[m.id] || {}; });

    const pacotes = await poolMensagens.query(
      `SELECT * FROM chat_pacotes WHERE usuario_id=$1 ORDER BY ativado_em DESC`,
      [conv.usuario_id]
    );

    const planoUsuario = usuario?.plano || 'gratuito';
    res.json({
      conversa: {
        ...conv,
        nome: usuario?.nome || null,
        foto_url: usuario?.foto_url || null,
        telefone_formatado: usuario?.telefone_formatado || null,
        email: usuario?.email || null,
        perfil_teste: usuario?.perfil_teste || null,
        percentual_prosperidade: usuario?.percentual_prosperidade || 0,
        sementes: usuario?.sementes || 0,
        plano_usuario: planoUsuario,
        tier: calcularTier(planoUsuario, conv.plano_chat),
        tempo: tempoRelativo(conv.ultima_mensagem_em),
      },
      mensagens: msgs.rows,
      pacotes: pacotes.rows,
    });
  } catch (err) {
    console.error('[ChatAtend] GET conversa/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

routerAtendimento.post('/mensagem', async (req, res) => {
  const { conversa_id, conteudo, tipo = 'texto', url, reply_to_id, identidade } = req.body || {};
  if (!conversa_id || (!conteudo && !url)) {
    return res.status(400).json({ error: 'dados inválidos' });
  }
  const ident = (identidade === 'equipe') ? 'equipe' : 'suellen';

  try {
    const convResult = await poolMensagens.query(
      `SELECT * FROM chat_conversas WHERE id=$1`,
      [conversa_id]
    );
    if (!convResult.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    const conv = convResult.rows[0];

    // 1. Marca mensagens pendentes da aluna como lidas — REGRA DE NEGÓCIO:
    //    - Chat 'suellen' → SÓ a Suellen marca como lida (Equipe NÃO marca, é encaminhamento interno)
    //    - Chat 'suporte' → tanto Suellen quanto Equipe podem marcar (qualquer um do suporte)
    //    Em ambos os casos, marcar como lida acontece na hora em que a resposta é enviada
    //    (não quando a conversa é só aberta).
    const podeMarcarLida =
      (conv.tipo === 'suellen' && ident === 'suellen') ||
      (conv.tipo === 'suporte');

    let lidasIds = [];
    if (podeMarcarLida) {
      const lidas = await poolMensagens.query(
        `UPDATE chat_mensagens SET lida=TRUE, lida_em=NOW()
         WHERE conversa_id=$1 AND remetente='aluna' AND lida=FALSE
         RETURNING id`,
        [conversa_id]
      );
      lidasIds = lidas.rows.map(x => x.id);
    }

    // 2. Reply denormalizado
    let replyDenorm = { conteudo: null, remetente: null, identidade: null };
    if (reply_to_id) {
      const rep = await poolMensagens.query(
        `SELECT conteudo, remetente, identidade FROM chat_mensagens WHERE id=$1`,
        [reply_to_id]
      );
      if (rep.rows[0]) replyDenorm = rep.rows[0];
    }

    // 3. Insere a resposta
    const r = await poolMensagens.query(
      `INSERT INTO chat_mensagens
        (conversa_id, usuario_id, remetente, identidade, tipo, conteudo, url, reply_to_id,
         reply_to_conteudo, reply_to_remetente, reply_to_identidade)
       VALUES ($1, $2, 'suellen', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [conversa_id, conv.usuario_id, ident, tipo, conteudo || null, url || null, reply_to_id || null,
       replyDenorm.conteudo, replyDenorm.remetente, replyDenorm.identidade]
    );
    let msg = r.rows[0];

    // ✓✓ ENTREGUE: se aluna está com WS conectado, marca entregue na hora.
    const alunaOnline = wsClients.has(`aluna:${conv.usuario_id}`);
    if (alunaOnline) {
      const upd = await poolMensagens.query(
        `UPDATE chat_mensagens SET entregue=TRUE, entregue_em=NOW()
          WHERE id=$1 RETURNING entregue, entregue_em`,
        [msg.id]
      );
      msg = { ...msg, ...upd.rows[0] };
    }

    const preview = conteudo ? conteudo.substring(0, 80)
                  : (tipo === 'imagem' ? '📷 Imagem' : '🎤 Áudio');

    // 4. Atualiza conversa
    // ⚠️ TIMER PRIORITÁRIO: só inicia/reseta quando IDENTIDADE='suellen' (no chat suellen)
    // ⚠️ nao_lidas_suellen=0 só quando alguém autorizado marcou como lida
    let updateExtra = '';
    let updateParams = [preview, conversa_id];
    let timer_resetado = false;
    if (ident === 'suellen' && conv.plano_chat === 'prioritario' && conv.tipo === 'suellen') {
      const novaExpira = new Date(Date.now() + 24 * 60 * 60 * 1000);
      updateExtra = `, prioritario_expira_em=$3`;
      updateParams.push(novaExpira);
      timer_resetado = true;
    }
    const setNaoLidasSuellen = podeMarcarLida ? ', nao_lidas_suellen=0' : '';
    await poolMensagens.query(
      `UPDATE chat_conversas SET ultima_mensagem_em=NOW(), ultima_preview=$1,
         nao_lidas_aluna=nao_lidas_aluna+1${setNaoLidasSuellen}, atualizado_em=NOW()
         ${updateExtra}
       WHERE id=$2`,
      updateParams
    );

    // 5. Eventos WS — UM ÚNICO EVENTO ATÔMICO por destinatário.
    //    Evita dessincronia visual: ✓✓ azul + msg nova chegam juntos no mesmo
    //    payload, frontend processa numa única atualização de DOM.
    emitirParaAluna(conv.usuario_id, 'resposta_atendimento_e_lidas', {
      conversa_id,
      mensagem:  msg,
      lidas_ids: lidasIds,            // pintar ✓✓ azul nessas msgs (das aluna)
      lidas_por: 'atendimento',
    });
    // Eco pro próprio painel (atualiza UI da Suellen / suporte que estão na conv)
    if (lidasIds.length > 0) {
      emitirParaSuellen('mensagens_lidas', {
        conversa_id, ids: lidasIds, por: ident,
      });
    }

    // PUSH pra aluna — se ela NÃO está online no app, manda notificação push.
    // Texto fixo (a aluna abre o app pra ler — privacidade): "A Suellen falou com você ✨"
    if (!alunaOnline) {
      notificarAluna(conv.usuario_id, {
        title: 'Vida Mágica',
        body:  'A Suellen falou com você ✨',
        data:  { conversa_id, url: '/app' },
      }).catch(() => {});
    }

    res.json({
      mensagem: msg,
      marcadas_lidas: lidasIds.length,
      timer_resetado,
    });
  } catch (err) {
    console.error('[ChatAtend] POST mensagem:', err.message);
    res.status(500).json({ error: err.message });
  }
});

routerAtendimento.post('/favoritar', async (req, res) => {
  const { conversa_id, favoritada } = req.body || {};
  if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatório' });
  try {
    await poolMensagens.query(
      `UPDATE chat_conversas SET favoritada=$1, atualizado_em=NOW() WHERE id=$2`,
      [!!favoritada, conversa_id]
    );
    res.json({ success: true, favoritada: !!favoritada });
  } catch (err) {
    console.error('[ChatAtend] POST favoritar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

routerAtendimento.post('/digitando-resposta', async (req, res) => {
  const { conversa_id } = req.body || {};
  if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatório' });
  try {
    const r = await poolMensagens.query(
      `SELECT usuario_id FROM chat_conversas WHERE id=$1`,
      [conversa_id]
    );
    if (r.rows[0]) {
      emitirParaAluna(r.rows[0].usuario_id, 'suellen_digitando', { conversa_id });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

routerAtendimento.post('/acao', async (req, res) => {
  const { conversa_id, acao, valor } = req.body || {};
  try {
    const convResult = await poolMensagens.query(
      `SELECT usuario_id FROM chat_conversas WHERE id=$1`,
      [conversa_id]
    );
    const usuario_id = convResult.rows[0]?.usuario_id;

    switch (acao) {
      case 'bloquear':
        await poolMensagens.query(
          `UPDATE chat_conversas SET bloqueada=TRUE, atualizado_em=NOW() WHERE id=$1`,
          [conversa_id]
        );
        break;
      case 'desbloquear':
        await poolMensagens.query(
          `UPDATE chat_conversas SET bloqueada=FALSE, atualizado_em=NOW() WHERE id=$1`,
          [conversa_id]
        );
        break;
      case 'cortesia': {
        if (!usuario_id) return res.status(404).json({ error: 'Conversa sem usuário' });
        const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await poolMensagens.query(
          `UPDATE chat_conversas SET plano_chat='prioritario', interacoes_restantes=30,
             prioritario_expira_em=$1, prioritario_ativado_em=NOW(), atualizado_em=NOW()
           WHERE id=$2`,
          [expira, conversa_id]
        );
        await poolMensagens.query(
          `INSERT INTO chat_pacotes (usuario_id, interacoes, valor_pago, status, ativado_em, expira_em)
           VALUES ($1, 30, 0, 'ativo', NOW(), $2)`,
          [usuario_id, expira]
        );
        break;
      }
      case 'ajustar_interacoes':
        await poolMensagens.query(
          `UPDATE chat_conversas SET interacoes_restantes=$1, atualizado_em=NOW() WHERE id=$2`,
          [valor, conversa_id]
        );
        break;
      case 'estender_prioritario': {
        const novaExpiracao = new Date(Date.now() + (valor || 24) * 60 * 60 * 1000);
        await poolMensagens.query(
          `UPDATE chat_conversas SET prioritario_expira_em=$1, atualizado_em=NOW() WHERE id=$2`,
          [novaExpiracao, conversa_id]
        );
        if (usuario_id) {
          await poolMensagens.query(
            `UPDATE chat_pacotes SET expira_em=$1 WHERE usuario_id=$2 AND status='ativo'`,
            [novaExpiracao, usuario_id]
          );
        }
        break;
      }
      case 'rebaixar_basic':
        await poolMensagens.query(
          `UPDATE chat_conversas SET plano_chat='basic', interacoes_restantes=NULL,
             prioritario_expira_em=NULL, atualizado_em=NOW()
           WHERE id=$1`,
          [conversa_id]
        );
        if (usuario_id) {
          await poolMensagens.query(
            `UPDATE chat_pacotes SET status='esgotado' WHERE usuario_id=$1 AND status='ativo'`,
            [usuario_id]
          );
        }
        break;
      default:
        return res.status(400).json({ error: 'ação inválida' });
    }
    res.json({ success: true, acao });
  } catch (err) {
    console.error('[ChatAtend] POST acao:', err.message);
    res.status(500).json({ error: err.message });
  }
});

routerAtendimento.get('/stats', async (req, res) => {
  try {
    // Stats das conversas (banco Mensagens)
    const convs = await poolMensagens.query(`
      SELECT
        COUNT(*) FILTER (WHERE plano_chat='prioritario') AS prioritarias,
        COUNT(*) FILTER (WHERE plano_chat='basic') AS basic,
        COUNT(*) FILTER (WHERE nao_lidas_suellen > 0) AS aguardando,
        COUNT(*) FILTER (WHERE bloqueada=TRUE) AS bloqueadas,
        COUNT(*) FILTER (WHERE favoritada=TRUE) AS favoritadas,
        COUNT(*) FILTER (WHERE tipo='suellen') AS chats_suellen,
        COUNT(*) FILTER (WHERE tipo='suporte') AS chats_suporte,
        COUNT(*) AS total
      FROM chat_conversas
    `);

    // Receita (banco Mensagens)
    const receita = await poolMensagens.query(`
      SELECT COALESCE(SUM(valor_pago),0) AS total, COUNT(*) AS pacotes
      FROM chat_pacotes WHERE valor_pago > 0
    `);

    res.json({ ...convs.rows[0], ...receita.rows[0] });
  } catch (err) {
    console.error('[ChatAtend] GET stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

routerAtendimento.post('/push-subscribe', async (req, res) => {
  const { endpoint, keys, userAgent } = req.body || {};
  if (!endpoint || !keys) return res.status(400).json({ error: 'dados inválidos' });
  try {
    await poolMensagens.query(
      `INSERT INTO chat_push_subscriptions (endpoint, keys, user_agent)
       VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE SET keys=$2, ativo=TRUE, user_agent=$3`,
      [endpoint, JSON.stringify(keys), userAgent || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[ChatAtend] POST push-subscribe:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// REAÇÕES DE MENSAGEM (modelo Slack: várias por pessoa permitidas)
// ════════════════════════════════════════════════════════════

// Toggle reação: se já existe, remove; se não, adiciona.
// Retorna o estado final agregado da mensagem (todas as reações dela).
async function toggleReacao({ mensagemId, autorTipo, autorId, emoji }) {
  const msg = await poolMensagens.query(
    `SELECT m.id, m.conversa_id, m.usuario_id, c.tipo AS conv_tipo
       FROM chat_mensagens m
       JOIN chat_conversas c ON c.id = m.conversa_id
      WHERE m.id=$1`, [mensagemId]
  );
  if (!msg.rows.length) throw new Error('Mensagem não encontrada');
  const conversa_id = msg.rows[0].conversa_id;
  const aluna_id = msg.rows[0].usuario_id;

  // Verifica se a reação já existe (autor_id NULL pra atendimento)
  const idMatch = autorTipo === 'aluna' ? `autor_id=$3` : `autor_id IS NULL`;
  const params = autorTipo === 'aluna'
    ? [mensagemId, autorTipo, autorId, emoji]
    : [mensagemId, autorTipo, emoji];
  const emojiParamIdx = autorTipo === 'aluna' ? '$4' : '$3';

  const existe = await poolMensagens.query(
    `SELECT id FROM chat_reacoes
      WHERE mensagem_id=$1 AND autor_tipo=$2 AND ${idMatch} AND emoji=${emojiParamIdx}`,
    params
  );

  let acao;
  if (existe.rows.length) {
    await poolMensagens.query(`DELETE FROM chat_reacoes WHERE id=$1`, [existe.rows[0].id]);
    acao = 'removida';
  } else {
    await poolMensagens.query(
      `INSERT INTO chat_reacoes (mensagem_id, conversa_id, autor_tipo, autor_id, emoji)
       VALUES ($1, $2, $3, $4, $5)`,
      [mensagemId, conversa_id, autorTipo, autorTipo === 'aluna' ? autorId : null, emoji]
    );
    acao = 'adicionada';
  }

  // Estado agregado: { emoji: { count, autores: [{tipo, id}] } }
  const todas = await poolMensagens.query(
    `SELECT emoji, autor_tipo, autor_id FROM chat_reacoes WHERE mensagem_id=$1`,
    [mensagemId]
  );
  const agregado = {};
  for (const r of todas.rows) {
    if (!agregado[r.emoji]) agregado[r.emoji] = { count: 0, autores: [] };
    agregado[r.emoji].count++;
    agregado[r.emoji].autores.push({ tipo: r.autor_tipo, id: r.autor_id });
  }

  // Emite WS pros 2 lados em tempo real
  const payload = {
    conversa_id,
    mensagem_id: mensagemId,
    emoji,
    acao,
    autor_tipo: autorTipo,
    reacoes: agregado,
  };
  emitirParaAluna(aluna_id, 'reacao_atualizada', payload);
  emitirParaSuellen('reacao_atualizada', payload);

  return { acao, reacoes: agregado };
}

// POST /api/chat/reacao  body: { mensagem_id, emoji }   (aluna)
routerAluna.post('/reacao', async (req, res) => {
  const { mensagem_id, emoji } = req.body || {};
  if (!mensagem_id || !emoji) return res.status(400).json({ error: 'mensagem_id e emoji obrigatórios' });
  try {
    const r = await toggleReacao({
      mensagemId: parseInt(mensagem_id, 10),
      autorTipo: 'aluna',
      autorId: req.usuario.sub,
      emoji,
    });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[ChatAluna] /reacao:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/atendimento/reacao  body: { mensagem_id, emoji, identidade }
routerAtendimento.post('/reacao', async (req, res) => {
  const { mensagem_id, emoji, identidade } = req.body || {};
  if (!mensagem_id || !emoji) return res.status(400).json({ error: 'mensagem_id e emoji obrigatórios' });
  const ident = (identidade === 'equipe') ? 'equipe' : 'suellen';
  try {
    const r = await toggleReacao({
      mensagemId: parseInt(mensagem_id, 10),
      autorTipo: ident,
      autorId: null,
      emoji,
    });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[ChatAtend] /reacao:', err.message);
    res.status(500).json({ error: err.message });
  }
});



module.exports = {
  routerAluna,
  routerAtendimento,
  registrarWs,
  removerWs,
  registrarWsAluna,
  registrarWsAtendimento,
  emitirParaAluna,
  emitirParaSuellen,
};
