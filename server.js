const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const path       = require('path');
const http       = require('http');
const { WebSocketServer } = require('ws');
require('dotenv').config();

const { initDb, buscarUsuarioPorId } = require('./db');
const precosRoutes      = require('./routes/precos');
const depoimentosRoutes = require('./routes/depoimentos');
const seedRoutes        = require('./routes/seed');
const configRoutes      = require('./routes/config');
const authRoutes        = require('./routes/auth');
const adminRoutes       = require('./routes/admin');
const { router: feedRoutes, initFeed }       = require('./routes/feed');
const { router: gatewayRouter, iniciarGateway } = require('./routes/gateway');
const {
  router: chatRouter, initChat,
  registrarWs, removerWs,
  emitirParaSuellen,
} = require('./routes/chat');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ── SEGURANÇA ──
app.use(helmet({ contentSecurityPolicy: false }));
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

// ── LOG ──
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ── ESTÁTICOS ──
app.use(express.static(path.join(__dirname, 'public')));

// ── BASIC AUTH ──
const { autenticar: basicAuth } = require('./routes/precos');

// ── JWT MIDDLEWARE para chat da aluna — usa o mesmo do sistema ──
const { autenticar: jwtAuth } = require('./middleware/autenticar');

// ── PÁGINAS ──
app.get('/admin',    basicAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/suellen',  basicAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'suellen.html')));
app.get('/auth',               (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));
app.get('/cadastro',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'cadastro.html')));
app.get('/app',                (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// ── API PÚBLICA ──
app.use('/api', precosRoutes);
app.use('/api', depoimentosRoutes);
app.use('/api', configRoutes);
app.use('/api', seedRoutes);
app.use('/api', feedRoutes);
app.use('/api/chat', (req, res, next) => {
  // Rotas públicas do chat (vapid key)
  if (req.path === '/vapid-public-key') return next();
  jwtAuth(req, res, next);
}, chatRouter);

// ── API AUTH ──
app.use('/api/auth', authRoutes);

// ── API ADMIN ──
app.use('/api/admin', basicAuth, adminRoutes);
app.use('/api/admin', basicAuth, feedRoutes);

// ── API SUELLEN (chat superadmin) ──
app.use('/api/suellen/chat', basicAuth, chatRouter);

// ── GATEWAY ──
app.use('/', gatewayRouter);

// ── HEALTH ──
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Vida Mágica API', timestamp: new Date().toISOString() });
});

// ── SPA FALLBACK ──
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Rota não encontrada' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── ERROS ──
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.message);
  res.status(500).json({ error: 'Erro interno' });
});

// ════════════════════════════════════════════════
// WEBSOCKET — chat em tempo real
// ════════════════════════════════════════════════
const wss = new WebSocketServer({ server, path: '/ws/chat' });

wss.on('connection', async (ws, req) => {
  const url    = new URL(req.url, `http://localhost`);
  const token  = url.searchParams.get('token');
  const modo   = url.searchParams.get('modo'); // 'aluna' | 'suellen'

  // Autentica
  let identidade = null;
  try {
    if (modo === 'suellen') {
      // Suellen autentica via Basic Auth encoded no token param
      const decoded = Buffer.from(token, 'base64').toString();
      const [u, p]  = decoded.split(':');
      if (u !== process.env.ADMIN_USER || p !== process.env.ADMIN_PASS) throw new Error('auth');
      identidade = 'suellen';
    } else {
      // Aluna autentica via JWT — usa o mesmo secret do middleware
      const { JWT_SECRET } = require('./middleware/autenticar');
      const payload = require('jsonwebtoken').verify(token, JWT_SECRET);
      identidade = `aluna:${payload.id}`;
    }
  } catch {
    ws.close(1008, 'Não autorizado');
    return;
  }

  registrarWs(identidade, ws);
  console.log(`[WS Chat] conectado: ${identidade}`);

  ws.on('close', () => {
    removerWs(identidade);
    console.log(`[WS Chat] desconectado: ${identidade}`);
  });

  ws.on('error', (err) => {
    console.error(`[WS Chat] erro ${identidade}:`, err.message);
  });

  // Ping para manter conexão viva no Railway
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat a cada 30s para evitar timeout
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// ── START ──
server.listen(PORT, async () => {
  console.log(`
🚀 Vida Mágica API — porta ${PORT}
🏥  GET  /health
📡  GET  /api/feed
🔐  *    /api/auth/*
💬  *    /api/chat/*   (JWT)
🌸  *    /api/suellen/chat/* (Basic Auth)
🛡️   *    /api/admin/*  (Basic Auth)
🌐  GET  /
🖥️   GET  /admin
🌸  GET  /suellen
🌳  GET  /app
🔌  WS   /ws/chat
  `);
  await initDb();
  iniciarGateway();
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
