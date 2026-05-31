/* ============================================================
   VIDA MÁGICA — server.js
   Servidor Express + WebSocket nativo (ws).
   Conecta nos 4 bancos e carrega módulos.

   Fases ativas:
   - Fase 1 — Fundação ✅
   - Fase 2 — Auth aluna ✅
   - Fase 3 — Conteúdo ✅
   - Fase 4A — Chat (REST + WS) ✅
   - Fase 4B — Painel atendimento ✅ (HTML antigo + login JWT + upload + push)
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
const chat = require('./routes/chat');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// ── SEGURANÇA ──────────────────────────────────────────────
// Helmet com defaults relaxados pra permitir embed de YouTube/Vimeo no /app.
// Quando o iframe do YouTube carrega no /app, o navegador envia headers ao
// YouTube — e o YouTube valida o "Referer" pra autorizar a reprodução.
// Os defaults do helmet 7 (`no-referrer` + Cross-Origin-*=same-origin)
// fazem o YouTube bloquear o embed com erro 153 ("Erro de configuração
// do player"). Aqui afrouxamos só esses 3 — o resto da segurança fica.
app.use(helmet({
  contentSecurityPolicy: false,
  permissionsPolicy: false,
  // Envia origem (não path) pro cross-origin. YouTube precisa pra validar.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Desliga isolamento cross-origin: permite iframes externos (YouTube/Vimeo)
  // se comportarem como esperado.
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));
app.use((req, res, next) => {
  // fullscreen=* libera fullscreen pra iframes cross-origin (Vimeo/YouTube)
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), autoplay=*, fullscreen=*');
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

// ── ROTA AMIGÁVEL: /atendimento serve atendimento.html ─────
app.get('/atendimento', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'atendimento.html'));
});

// ── ROTA AMIGÁVEL: /admin serve admin.html ─────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── ROTA AMIGÁVEL: /auth serve auth.html (login da aluna) ──
app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

// ── ROTA AMIGÁVEL: /cadastro serve cadastro.html ───────────
app.get('/cadastro', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cadastro.html'));
});

// ── ROTA AMIGÁVEL: /teste serve teste.html (LP Teste do Subconsciente) ──
app.get('/teste', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teste.html'));
});

// ── ROTA AMIGÁVEL: /ouro-da-reprogramacao-mental → LP do curso ─────
app.get('/ouro-da-reprogramacao-mental', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ouro-da-reprogramacao-mental.html'));
});

// ── ROTA AMIGÁVEL: /lei-da-atracao-biblica → LP do curso ─────
app.get('/lei-da-atracao-biblica', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lei-da-atracao-biblica.html'));
});

// ── ROTA AMIGÁVEL: /guia-pratico-reprogramacao-mental → LP do produto ──
app.get('/guia-pratico-reprogramacao-mental', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guia-pratico-reprogramacao-mental.html'));
});

// ── ROTA AMIGÁVEL: /a-tal-maneira → LP do método (Livro + Curso + Combo) ──
app.get('/a-tal-maneira', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'a-tal-maneira.html'));
});

// ── ROTA AMIGÁVEL: /magica-do-fluir → LP do guia de bolso ──
app.get('/magica-do-fluir', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'magica-do-fluir.html'));
});

// ── ROTA AMIGÁVEL: /termos serve termos.html ───────────────
app.get('/termos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'termos.html'));
});

// ── ROTA AMIGÁVEL: /relatos → página universal de relatos ──
app.get('/relatos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'relatos.html'));
});

// ── ROTA AMIGÁVEL: /resultado/:id serve resultado.html ─────
// O frontend recebe o ID via window.location e busca via /api/teste/resultado/:id
app.get('/resultado/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'resultado.html'));
});

// ── ROTA AMIGÁVEL: /app e /app/* (exceto arquivos estáticos) → app.html ──
// Permite /app/dashboard, /app/perfil etc. — sem .html
// Exclui /app/app.css, /app/app.js, /app/scene.js, /app/assets/*
app.get(/^\/app(\/(dashboard|perfil|chat|loja|sementes|jornada|conquistas)?)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ── ROTA AMIGÁVEL: /espaco → Espaço da Manifestação (página própria) ──
// Página separada do /app (mais leve). Sub-seções trocadas via JS.
app.get(/^\/espaco(\/(meditar|carta|manifestar|manifestacoes|cartas)?)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'espaco.html'));
});

// ── MÓDULOS DA API ─────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/painel',        require('./routes/admin-auth'));        // OTP do admin/atendimento
app.use('/api/admin',         require('./routes/admin'));             // Painel admin (gateway, templates, usuários)
app.use('/api/admin',         require('./routes/admin-caderno'));     // Painel admin: Caderno (prompts/afirmações/áudios) + Gamificação (prêmios/missões/ranking)
app.use('/api/painel-aluna',  require('./routes/painel-aluna'));      // Produtos+Jornada da aluna (admin OU atendimento)
app.use('/webhook',           require('./routes/webhook-evolution')); // Webhook Evolution (zap entrante)
app.use('/api',               require('./routes/produtos'));     // /api/produtos (canônico)
app.use('/api',               require('./routes/precos'));       // /api/precos (alias legado — não remover)
app.use('/api',               require('./routes/depoimentos'));
app.use('/api',               require('./routes/categorias-relato')); // Fase 2.1a — categorias de vida
app.use('/api',               require('./routes/feed'));
app.use('/api',               require('./routes/config'));
app.use('/api',               require('./routes/seed'));
app.use('/api/chat',              chat.routerAluna);
app.use('/api/atendimento/chat',  chat.routerAtendimento);
app.use('/api/upload',        require('./routes/upload'));
app.use('/api/teste',         require('./routes/teste'));            // Teste do Subconsciente (lado da aluna)
app.use('/api/app',           require('./routes/app'));              // Contexto unificado pro /app (Home, Materiais, Chat)
app.use('/api/app/gamificacao', require('./routes/gamificacao'));     // Conquistas (status, missões, prêmios, ranking mensal)
app.use('/api/app/espaco',      require('./routes/espaco'));          // Espaço da Manifestação (tema, manifestações, cartas do tempo)

// ── ESTÁTICOS ──────────────────────────────────────────────
// Cache-Control no-cache pra HTML + JS/CSS do mini-SPA /app + relatos-card.js.
// "no-cache" NÃO desliga cache: o Safari iOS continua guardando o arquivo,
// mas revalida com o servidor a cada hit (304 vazio quando inalterado, ~200B;
// 200 com corpo completo quando você sobe versão nova). Resolve o problema
// recorrente de Safari iOS rodar app.js antigo após deploy sem nenhum custo
// significativo de banda. Imagens, fontes, áudios e assets fora de /app
// seguem com cache padrão do express.static. Ver CLAUDE.md → iOS Safari.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.html')
        || /\/app\/.*\.(js|css)$/.test(filepath)
        || /\/relatos-card\.js$/.test(filepath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ── PÁGINA INICIAL ─────────────────────────────────────────
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
// Aluna:        wss://.../ws/chat?token=<JWT aluna>&modo=aluna
// Atendimento:  wss://.../ws/chat?token=<JWT atendimento>&modo=atendimento
// ──────────────────────────────────────────────────────────

const wss = new WebSocket.Server({ noServer: true });

function autenticarWsAluna(token) {
  if (!token || !JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_) { return null; }
}

function autenticarWsAtendimento(token) {
  if (!token || !JWT_SECRET) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Aceita: novo formato (role=admin + escopo=atendimento) OU legado (role=atendimento/suellen)
    if (payload.role === 'admin' && payload.escopo === 'atendimento') return payload;
    if (payload.role === 'atendimento' || payload.role === 'suellen') return payload;
    return null;
  } catch (_) { return null; }
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
    const payload = autenticarWsAtendimento(token);
    if (!payload) { socket.destroy(); return; }
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
🔐 Auth aluna:         /api/auth/*
🔑 Login painel:       /api/painel/* (OTP via WhatsApp)
💰 Preços:        GET  /api/precos
💬 Depoimentos:   GET  /api/depoimentos
📰 Feed:          GET  /api/feed
⚙️  Config:        GET  /api/config
✦  Chat aluna:         /api/chat/*
✦  Chat atend.:        /api/atendimento/chat/*
📤 Upload:             /api/upload/*
🛡️  Admin API:    /api/admin/* (gateway, templates, usuários)
🚪 Gateway WA:    fila + cooldown + categorias (worker em loop)
📥 Webhook WA:    POST /webhook/evolution (zap entrante → magic link)
🖥️  Painel:        GET  /atendimento
🛡️  Admin:         GET  /admin
🔌 WebSocket:     WS   /ws/chat
  `);
  try {
    await initDb();

    // Seed idempotente dos preços — garante que produtos novos
    // adicionados em routes/seed.js (PRECOS_INICIAIS) entrem no banco
    // automaticamente no próximo deploy. Não sobrescreve nada que o
    // admin já tenha editado.
    try {
      const seedMod = require('./routes/seed');
      if (typeof seedMod.seedPrecos === 'function') {
        await seedMod.seedPrecos();
      }
    } catch (err) {
      console.error('⚠️ Seed de produtos não rodou:', err.message);
      // Não derruba o servidor — o seed é um nice-to-have, não bloqueante
    }

    // Seed dos temas + relatos iniciais (Fase 1 do refactor de Relatos).
    // - seedTemas: idempotente via ON CONFLICT (slug). Roda sempre, só insere
    //   o que falta.
    // - seedDepoimentos: idempotente via tabela seed_log. Roda 1 vez.
    //   Pra forçar re-rodar, apagar a linha 'depoimentos_v1_fase1' em seed_log.
    try {
      const depMod = require('./routes/depoimentos');
      if (typeof depMod.seedTemas === 'function') await depMod.seedTemas();
      if (typeof depMod.seedDepoimentos === 'function') await depMod.seedDepoimentos();
    } catch (err) {
      console.error('⚠️ Seed de relatos não rodou:', err.message);
    }

    // Fase 2.1a — seed das 10 categorias de vida (idempotente via ON CONFLICT slug).
    try {
      const catMod = require('./routes/categorias-relato');
      if (typeof catMod.seedCategoriasRelato === 'function') await catMod.seedCategoriasRelato();
    } catch (err) {
      console.error('⚠️ Seed de categorias-relato não rodou:', err.message);
    }

    // Seed do Caderno da Mentalização + Gamificação da Plataforma.
    // Idempotente via seed_log key 'caderno_gamificacao_v1'.
    // Inclui prompts, afirmações, áudios placeholder, config de prêmios
    // (30 dias mensal + trimestral + rápida + ranking + ciclo fechado),
    // e missões iniciais. Renato edita TUDO pelo admin depois.
    try {
      const seedCadMod = require('./routes/seed-caderno');
      if (typeof seedCadMod.seedCadernoEGamificacao === 'function') {
        await seedCadMod.seedCadernoEGamificacao();
      }
    } catch (err) {
      console.error('⚠️ Seed do Caderno/Gamificação não rodou:', err.message);
    }

    // Liga o worker do gateway de WhatsApp DEPOIS dos bancos estarem prontos
    const gateway = require('./core/gateway');
    gateway.iniciarWorker();

    // NOTA: o worker de avisos da Cápsula do Tempo (core/caderno-avisos.js) foi
    // REMOVIDO junto com o Caderno. A "Carta do Tempo" do Espaço da Manifestação
    // terá seu próprio worker quando for construída (ver memória da remodelação).
  } catch (err) {
    console.error('💥 Falha ao iniciar bancos:', err.message);
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  try { require('./core/gateway').pararWorker(); } catch (_) {}
  server.close();
  process.exit(0);
});
process.on('SIGINT',  () => {
  try { require('./core/gateway').pararWorker(); } catch (_) {}
  server.close();
  process.exit(0);
});
process.on('uncaughtException', err => console.error('💥 uncaughtException:', err));
process.on('unhandledRejection', err => console.error('💥 unhandledRejection:', err));
