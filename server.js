const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const { initDb } = require('./db');
const precosRoutes      = require('./routes/precos');
const depoimentosRoutes = require('./routes/depoimentos');
const seedRoutes        = require('./routes/seed');
const configRoutes      = require('./routes/config');
const authRoutes        = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ── SEGURANÇA ──
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: [
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

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOG ──
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ── ARQUIVOS ESTÁTICOS (admin, index, assets) ──
app.use(express.static(path.join(__dirname, 'public')));

// ── ADMIN (Basic Auth via routes/precos.js) ──
const { autenticar: basicAuth } = require('./routes/precos');
app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── API PÚBLICA ──
app.use('/api', precosRoutes);
app.use('/api', depoimentosRoutes);
app.use('/api', configRoutes);
app.use('/api', seedRoutes);

// ── API AUTH ──
app.use('/api/auth', authRoutes);

// ── HEALTH ──
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Vida Mágica API', timestamp: new Date().toISOString() });
});

// ── SPA FALLBACK (serve index.html para rotas do frontend) ──
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Rota não encontrada' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── ERROS ──
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.message);
  res.status(500).json({ error: 'Erro interno' });
});

// ── START ──
app.listen(PORT, async () => {
  console.log(`
🚀 Vida Mágica API — porta ${PORT}
🏥 /health
💰 /api/precos
💬 /api/depoimentos
⚙️  /api/config
🔐 /api/auth/*
🖥️  /admin
  `);
  await initDb();
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
