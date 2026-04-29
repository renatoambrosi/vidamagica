/**
 * routes/admin.js
 * Endpoints para a aba WhatsApp do painel admin.
 * Todos protegidos por Basic Auth — registrado no server.js como:
 *   app.use('/api/admin', basicAuth, adminRoutes);
 */

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { pool } = require('../db');

const {
  listarMensagensConfig,
  atualizarMensagemConfig,
  listarExcecoes,
  adicionarExcecao,
  removerExcecao,
  buscarParaRemocao,
  estatisticasMembros,
  atualizarStatusMembro,
  agendarRemocao,
  cancelarRemocao,
  registrarEvento,
  enfileirarMensagem,
  getMensagem,
} = require('../db');

const EVO_URL      = process.env.EVOLUTION_URL;
const EVO_KEY      = process.env.EVOLUTION_API_KEY;
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE;

const GRUPOS = {
  ouro:   '120363407525402346@g.us',
  geral:  '120363424750548764@g.us',
  avisos: '120363424105041817@g.us',
};

// ── HELPER: remover membro de todos os grupos ─────────────────────────────────
// Usa updateParticipant da Evolution API
async function removerDeGrupos(telefone) {
  const resultados = {};
  for (const [nome, groupJid] of Object.entries(GRUPOS)) {
    try {
      const instanceEncoded = encodeURIComponent(EVO_INSTANCE);
      const r = await axios.put(
        `${EVO_URL}/group/updateParticipant/${instanceEncoded}`,
        {
          groupJid,
          action: 'remove',
          participants: [`${telefone}@s.whatsapp.net`],
        },
        { headers: { apikey: EVO_KEY }, timeout: 10000 }
      );
      resultados[nome] = { ok: true, status: r.status };
    } catch (err) {
      resultados[nome] = { ok: false, error: err.response?.data || err.message };
    }
  }
  return resultados;
}

// ── TEMPLATES DE MENSAGEM ─────────────────────────────────────────────────────

// GET /api/admin/mensagens — lista todos os templates
router.get('/mensagens', async (req, res) => {
  try {
    res.json(await listarMensagensConfig());
  } catch (err) {
    console.error('❌ GET /mensagens:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/mensagens/:chave — atualiza um template
router.put('/mensagens/:chave', async (req, res) => {
  try {
    const { texto } = req.body;
    if (texto === undefined || texto === null) {
      return res.status(400).json({ error: 'Campo texto obrigatório' });
    }
    await atualizarMensagemConfig(req.params.chave, texto);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ PUT /mensagens/:chave:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/mensagens/enviar-manual — envia via gateway interno
router.post('/mensagens/enviar-manual', async (req, res) => {
  try {
    let { telefone, nome, mensagem, imediato } = req.body;
    if (!telefone || !mensagem) {
      return res.status(400).json({ error: 'telefone e mensagem são obrigatórios' });
    }

    // Substitui {nome} pelo primeiro nome
    if (nome) {
      mensagem = mensagem.replace(/\{nome\}/gi, nome.split(' ')[0]);
    }

    await enfileirarMensagem({
      telefone,
      mensagem,
      nome: nome || telefone,
      origem: 'admin-manual',
      imediato: !!imediato,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ POST /mensagens/enviar-manual:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MEMBROS ───────────────────────────────────────────────────────────────────

// GET /api/admin/membros/stats — estatísticas gerais
router.get('/membros/stats', async (req, res) => {
  try {
    const [stats, pendentes, excecoes] = await Promise.all([
      estatisticasMembros(),
      buscarParaRemocao(),
      listarExcecoes(),
    ]);

    res.json({
      ativos:     parseInt(stats.ativos)     || 0,
      cancelados: parseInt(stats.cancelados) || 0,
      atrasados:  parseInt(stats.atrasados)  || 0,
      total:      parseInt(stats.total)      || 0,
      pendentes:  pendentes.length,
      excecoes:   excecoes.length,
    });
  } catch (err) {
    console.error('❌ GET /membros/stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/membros/remocao-pendente — lista quem está na fila de remoção
router.get('/membros/remocao-pendente', async (req, res) => {
  try {
    const lista = await buscarParaRemocao();
    res.json(lista);
  } catch (err) {
    console.error('❌ GET /membros/remocao-pendente:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/membros/:id/cancelar-remocao — cancela remoção agendada de um membro
// :id = id numérico do membro na tabela membros
router.post('/membros/:id/cancelar-remocao', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // Busca o subscription_id do membro pelo id numérico
    const r = await pool.query('SELECT subscription_id FROM membros WHERE id=$1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Membro não encontrado' });

    await cancelarRemocao(r.rows[0].subscription_id);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ POST /membros/:id/cancelar-remocao:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/membros/:id/remover-grupos — remove membro dos grupos agora
router.post('/membros/:id/remover-grupos', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const r  = await pool.query('SELECT * FROM membros WHERE id=$1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Membro não encontrado' });

    const membro = r.rows[0];
    const tel    = membro.telefone_formatado || membro.telefone;

    const resultados = await removerDeGrupos(tel);

    // Atualiza status via subscription_id (como a função do db.js espera)
    await atualizarStatusMembro(membro.subscription_id, 'removido');

    // Marca grupos_adicionado = false diretamente (db.js só tem marcarGruposAdicionado=TRUE)
    await pool.query(
      `UPDATE membros SET grupos_adicionado=FALSE, atualizado_em=NOW() WHERE id=$1`,
      [id]
    );

    await registrarEvento({
      subscription_id: membro.subscription_id,
      order_id: membro.order_id,
      telefone: tel,
      nome: membro.nome,
      evento: 'remocao_manual',
      acao: 'remover_grupos',
      sucesso: true,
      detalhes: JSON.stringify(resultados),
    });

    res.json({ success: true, resultados });
  } catch (err) {
    console.error('❌ POST /membros/:id/remover-grupos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SCHEDULER ─────────────────────────────────────────────────────────────────

// POST /api/admin/scheduler/executar — roda o scheduler manualmente
router.post('/scheduler/executar', async (req, res) => {
  try {
    const pendentes = await buscarParaRemocao();
    let removidos = 0;
    const erros   = [];

    for (const membro of pendentes) {
      try {
        const tel = membro.telefone_formatado || membro.telefone;
        await removerDeGrupos(tel);
        await atualizarStatusMembro(membro.subscription_id, 'removido');
        await pool.query(
          `UPDATE membros SET grupos_adicionado=FALSE, atualizado_em=NOW() WHERE id=$1`,
          [membro.id]
        );
        await registrarEvento({
          subscription_id: membro.subscription_id,
          order_id: membro.order_id,
          telefone: tel,
          nome: membro.nome,
          evento: 'remocao_scheduler',
          acao: 'remover_grupos',
          sucesso: true,
          detalhes: 'Executado via admin',
        });
        removidos++;
      } catch (err) {
        console.error(`❌ Erro ao remover membro id=${membro.id}:`, err.message);
        erros.push({ id: membro.id, nome: membro.nome, erro: err.message });
      }
    }

    res.json({ success: true, removidos, erros });
  } catch (err) {
    console.error('❌ POST /scheduler/executar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── EXCEÇÕES ──────────────────────────────────────────────────────────────────

// GET /api/admin/excecoes
router.get('/excecoes', async (req, res) => {
  try {
    res.json(await listarExcecoes());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/excecoes
router.post('/excecoes', async (req, res) => {
  try {
    const { telefone, nome, motivo } = req.body;
    if (!telefone) return res.status(400).json({ error: 'telefone obrigatório' });
    await adicionarExcecao(telefone, nome || '', motivo || '');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ POST /excecoes:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/excecoes/:id
router.delete('/excecoes/:id', async (req, res) => {
  try {
    await removerExcecao(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
