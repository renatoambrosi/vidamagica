/* ============================================================
   VIDA MÁGICA — server.js
   Servidor Express. Conecta nos 4 bancos e carrega módulos.

   Fases ativas:
   - Fase 1 — Fundação ✅
   - Fase 2 — Auth ✅ (em /api/auth)
   - Fase 3 — Conteúdo ✅ (precos, depoimentos, feed, config)
   ============================================================ */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const http = require('http');
require('dotenv').config();

const { initDb, checkHealth } = require('./db');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

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
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
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

// ── MÓDULOS DA API ─────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api',      require('./routes/precos'));
app.use('/api',      require('./routes/depoimentos'));
app.use('/api',      require('./routes/feed'));
app.use('/api',      require('./routes/config'));

// ── ESTÁTICOS PÚBLICOS ─────────────────────────────────────
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
