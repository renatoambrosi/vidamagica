const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { initDb } = require('./db');
const precosRoutes = require('./routes/precos');
const depoimentosRoutes = require('./routes/depoimentos');

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
    'http://localhost:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '1mb' }));

// ── LOG ──
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ── ROTAS ──
app.use('/api', precosRoutes);
app.use('/api', depoimentosRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Vida Mágica API',
    timestamp: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ── ERROS ──
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.message);
  res.status(500).json({ error: 'Erro interno' });
});

// ── INIT ──
app.listen(PORT, async () => {
  console.log(`
🚀 Vida Mágica API
🌐 Porta: ${PORT}
🏥 Health: /health
💰 Preços: /api/precos
💬 Depoimentos: /api/depoimentos
  `);
  await initDb();
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
