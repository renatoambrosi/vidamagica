const axios = require('axios');
const {
  buscarProximaMensagem, listarFilaPendente,
  marcarMensagemEnviada, marcarMensagemErro,
  cancelarMensagemFila, reordenarFila,
  listarHistoricoMensagens, registrarHistoricoMensagem,
  getGatewayConfig, setGatewayConfig,
  enfileirarMensagem,
} = require('../db');

// ── ESTADO ──────────────────────────────────────────────────────────────────
let processando = false;
let pausado = false;
let cooldownMs = 60 * 1000;
let ultimoEnvio = 0;
let loopAtivo = false;

// ── EVOLUTION API ────────────────────────────────────────────────────────────
async function enviarWhatsApp(telefone, mensagem) {
  const url = process.env.EVOLUTION_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = encodeURIComponent(process.env.EVOLUTION_INSTANCE);
  await axios.post(
    `${url}/message/sendText/${instance}`,
    { number: telefone, text: mensagem },
    { headers: { apikey: apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── LOOP DE PROCESSAMENTO ────────────────────────────────────────────────────
async function processarLoop() {
  if (loopAtivo) return;
  loopAtivo = true;

  while (true) {
    try {
      // Sincroniza config do banco a cada ciclo
      const cfg = await getGatewayConfig();
      cooldownMs = cfg.cooldown_ms;
      pausado = cfg.pausado;

      if (pausado) { await sleep(2000); continue; }

      const msg = await buscarProximaMensagem();
      if (!msg) { await sleep(3000); continue; }

      // Respeita cooldown (exceto imediato)
      if (!msg.imediato && ultimoEnvio > 0) {
        const espera = cooldownMs - (Date.now() - ultimoEnvio);
        if (espera > 0) { await sleep(espera); continue; }
      }

      processando = true;
      console.log(`📤 Enviando para ${msg.nome} (${msg.telefone}) | ${msg.origem}`);

      try {
        await enviarWhatsApp(msg.telefone, msg.mensagem);
        await marcarMensagemEnviada(msg.id);
        await registrarHistoricoMensagem({
          fila_id: msg.id, telefone: msg.telefone, mensagem: msg.mensagem,
          nome: msg.nome, origem: msg.origem, sucesso: true,
        });
        ultimoEnvio = Date.now();
        console.log(`✅ Enviado: ${msg.nome}`);
      } catch (err) {
        await marcarMensagemErro(msg.id, err.message);
        await registrarHistoricoMensagem({
          fila_id: msg.id, telefone: msg.telefone, mensagem: msg.mensagem,
          nome: msg.nome, origem: msg.origem, sucesso: false, erro: err.message,
        });
        ultimoEnvio = Date.now();
        console.error(`❌ Erro ao enviar para ${msg.nome}:`, err.message);
      }
      processando = false;

    } catch (err) {
      console.error('❌ Erro no loop gateway:', err.message);
      await sleep(5000);
    }
  }
}

// ── FUNÇÃO PÚBLICA: enfileirar mensagem ──────────────────────────────────────
async function enviar({ telefone, mensagem, nome, origem, imediato = false }) {
  const item = await enfileirarMensagem({ telefone, mensagem, nome, origem, imediato });
  return item;
}

// ── ESTADO ATUAL (para o monitor) ────────────────────────────────────────────
async function estadoAtual() {
  const [fila, historico, cfg] = await Promise.all([
    listarFilaPendente(),
    listarHistoricoMensagens(50),
    getGatewayConfig(),
  ]);
  return {
    fila,
    historico,
    processando,
    pausado: cfg.pausado,
    cooldownMs: cfg.cooldown_ms,
    ultimoEnvio: ultimoEnvio ? new Date(ultimoEnvio).toISOString() : null,
  };
}

// ── INICIAR ───────────────────────────────────────────────────────────────────
function iniciarGateway() {
  console.log('🚀 Gateway interno iniciado');
  processarLoop().catch(err => console.error('💥 Gateway crash:', err.message));
}

// ── ROTAS DO MONITOR (Basic Auth via middleware) ──────────────────────────────
const express = require('express');
const router = express.Router();
const path = require('path');
const { autenticar: basicAuth } = require('./precos');

// Monitor HTML
router.get('/monitor', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../monitor.html'));
});

// Estado
router.get('/monitor/estado', basicAuth, async (req, res) => {
  try { res.json(await estadoAtual()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Pausar
router.post('/monitor/pausar', basicAuth, async (req, res) => {
  try {
    await setGatewayConfig('pausado', 'true');
    pausado = true;
    res.json({ success: true, pausado: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Retomar
router.post('/monitor/retomar', basicAuth, async (req, res) => {
  try {
    await setGatewayConfig('pausado', 'false');
    pausado = false;
    res.json({ success: true, pausado: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cooldown
router.post('/monitor/cooldown', basicAuth, async (req, res) => {
  try {
    const seg = parseInt(req.body.segundos);
    if (!seg || seg < 10 || seg > 600) return res.status(400).json({ error: 'Mínimo 10s, máximo 600s' });
    await setGatewayConfig('cooldown_segundos', String(seg));
    cooldownMs = seg * 1000;
    res.json({ success: true, cooldownMs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancelar mensagem da fila
router.delete('/monitor/fila/:id', basicAuth, async (req, res) => {
  try {
    await cancelarMensagemFila(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reordenar fila
router.post('/monitor/reordenar', basicAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids inválido' });
    await reordenarFila(ids);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, iniciarGateway, enviar };
