/* ============================================================
   VIDA MÁGICA — server.js
   Servidor Express + WebSocket nativo (ws).
   Conecta nos 4 bancos e carrega módulos.

   Fases ativas:
   - Fase 1 — Fundação ✅
   - Fase 2 — Auth ✅ (em /api/auth)
   - Fase 3 — Conteúdo ✅ (precos, depoimentos, feed, config)
   - Fase 4A — Chat (REST + WS) ✅
   - Fase 4B — Painéis Chat ✅ (/atendimento protegido)
   ============================================================ */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const http = require('http');
const url = require('url');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
require('dotenv').config();

const { initDb, checkHealth } = require('./db');
const { autenticarAdmin } = require('./middleware/autenticar');
const chat = require('./routes/chat');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// ── SEGURANÇA ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  permissionsPolicy: false,
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), autoplay=(self)');
  next();
});

app.use(cors({
  origin: [
    'https://vidamagica-production.up.railway.app',
    'https://vidamagica.vercel.app',
    'https://www.vidamagica.com.br',
    'https://vidamagica.com.br',
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOG ────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (!req.path.startsWith('/ws')) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});

// ── HEALTH ─────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const bancos = await checkHealth();
  const tudoOk = Object.values(bancos).every(s => s === 'ok');
  res.status(tudoOk ? 200 : 503).json({
    status: tudoOk ? 'OK' : 'DEGRADED',
    service: 'Vida Mágica API',
    timestamp: new Date().toISOString(),
    bancos,
  });
});

// ── PÁGINAS PROTEGIDAS (antes do static!) ──────────────────
app.get('/atendimento', autenticarAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'atendimento.html'));
});

// ── MÓDULOS DA API ─────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api',      require('./routes/precos'));
app.use('/api',      require('./routes/depoimentos'));
app.use('/api',      require('./routes/feed'));
app.use('/api',      require('./routes/config'));
app.use('/api/chat',              chat.routerAluna);
app.use('/api/atendimento/chat',  chat.routerAtendimento);

// ── ESTÁTICOS ──────────────────────────────────────────────
// IMPORTANTE: o atendimento.html foi movido pra rota protegida acima.
// Mas como ele AINDA está em public/, qualquer pessoa poderia acessar
// /atendimento.html direto. Vamos bloquear esse caminho:
app.get('/atendimento.html', (req, res) => res.redirect('/atendimento'));

app.use(express.static(path.join(__dirname, 'public')));

// ── PÁGINAS ESTÁTICAS PÚBLICAS ─────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── 404 PARA /api ──────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ── SPA FALLBACK ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── ERROS ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.message);
  res.status(500).json({ error: 'Erro interno' });
});

// ──────────────────────────────────────────────────────────
// WEBSOCKET — /ws/chat
// ──────────────────────────────────────────────────────────

const wss = new WebSocket.Server({ noServer: true });

function autenticarWsAluna(token) {
  if (!token || !JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_) { return null; }
}

function autenticarWsAtendimento(token) {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const [user, pass] = decoded.split(':');
    return user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD;
  } catch (_) { return false; }
}

server.on('upgrade', (req, socket, head) => {
  const { pathname, query } = url.parse(req.url, true);
  if (pathname !== '/ws/chat') {
    socket.destroy();
    return;
  }
  const { token, modo } = query;

  if (modo === 'aluna') {
    const payload = autenticarWsAluna(token);
    if (!payload) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.usuarioId = payload.sub;
      ws.modo = 'aluna';
      chat.registrarWsAluna(payload.sub, ws);
      ws.send(JSON.stringify({ evento: 'conectado', modo: 'aluna' }));
    });
    return;
  }

  if (modo === 'atendimento' || modo === 'suellen') {
    if (!autenticarWsAtendimento(token)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.modo = 'atendimento';
      chat.registrarWsAtendimento(ws);
      ws.send(JSON.stringify({ evento: 'conectado', modo: 'atendimento' }));
    });
    return;
  }

  socket.destroy();
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
}, 30000);
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});
wss.on('close', () => clearInterval(heartbeat));

// ── START ──────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`
🚀 Vida Mágica API
🌐 Porta: ${PORT}
🏥 Health:        GET  /health
🔐 Auth:               /api/auth/*
💰 Preços:        GET  /api/precos
💬 Depoimentos:   GET  /api/depoimentos
📰 Feed:          GET  /api/feed
⚙️  Config:        GET  /api/config
✦  Chat aluna:         /api/chat/*           (JWT)
✦  Chat atend.:        /api/atendimento/chat/* (Basic Auth)
🖥️  Painel:        GET  /atendimento  (Basic Auth)
🔌 WebSocket:     WS   /ws/chat
  `);
  try {
    await initDb();
  } catch (err) {
    console.error('💥 Falha ao iniciar bancos:', err.message);
    process.exit(1);
  }
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
process.on('uncaughtException', err => console.error('💥 uncaughtException:', err));
process.on('unhandledRejection', err => console.error('💥 unhandledRejection:', err));
