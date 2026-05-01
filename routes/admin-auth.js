/* ============================================================
   VIDA MÁGICA — routes/admin-auth.js
   Login do painel (admin + atendimento) via OTP no WhatsApp.

   Banco: poolComunicacao (admins, admin_otp_tokens, admin_sessoes).
   WhatsApp: core/whatsapp.js (envio direto Evolution).

   Endpoints:
     POST /api/painel/solicitar-otp
       Body: { telefone, escopo: 'admin' | 'atendimento' }
       Verifica se telefone está em `admins` ativo.
       Manda OTP por WhatsApp. Não vaza se número não existe.

     POST /api/painel/verificar-otp
       Body: { telefone, codigo, escopo }
       Valida OTP, cria sessão no banco, retorna JWT.

     GET  /api/painel/me
       Header: Authorization: Bearer <token>
       Retorna dados do admin + escopo atual.

     POST /api/painel/logout
       Revoga a sessão atual.
   ============================================================ */

const express = require('express');
const router = express.Router();

const {
  buscarAdminPorTelefone,
  buscarAdminPorId,
  marcarAcessoAdmin,
  criarOtpAdmin,
  validarOtpAdmin,
  limparOtpAdminExpirados,
  criarSessaoAdmin,
  revogarSessaoAdmin,
} = require('../core/admins');

const { enviarTexto: enviarWhatsAppDireto } = require('../core/whatsapp');
const { gerarTokenPainel, autenticarPainel } = require('../middleware/autenticar');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/autenticar');

// ── HELPERS ──

function formatarTelefone(tel) {
  const num = String(tel).replace(/\D/g, '');
  if (num.startsWith('55')) return num;
  if (num.startsWith('0')) return `55${num.slice(1)}`;
  return `55${num}`;
}

function gerarOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
}

// Rate limit em memória
const rateMap = new Map();
function checarRate(chave, max = 3, janelaMs = 60000) {
  const agora = Date.now();
  const e = rateMap.get(chave) || { count: 0, reset: agora + janelaMs };
  if (agora > e.reset) { e.count = 0; e.reset = agora + janelaMs; }
  e.count++;
  rateMap.set(chave, e);
  return e.count <= max;
}

async function enviarOtpAdminWhatsApp(telefone, codigo, nome, escopo) {
  const saudacao = nome ? `Olá, ${nome.split(' ')[0]}!` : 'Olá!';
  const onde = escopo === 'admin' ? 'Painel Admin' : 'Painel de Atendimento';
  const mensagem = `${saudacao} 🔐\n\nSeu código de acesso ao *${onde} — Vida Mágica*:\n\n*${codigo}*\n\nVálido por 10 minutos. Não compartilhe com ninguém.\n\n— Vida Mágica`;
  try {
    await enviarWhatsAppDireto(telefone, mensagem);
    return true;
  } catch (err) {
    console.error('❌ Erro ao enviar OTP admin:', err.message);
    return false;
  }
}

function escopoValido(s) {
  return s === 'admin' || s === 'atendimento';
}

// ──────────────────────────────────────────────────────────
// 1. SOLICITAR OTP
// ──────────────────────────────────────────────────────────

router.post('/solicitar-otp', async (req, res) => {
  try {
    const { telefone, escopo } = req.body || {};
    if (!telefone) return res.status(400).json({ error: 'Telefone obrigatório' });
    if (!escopoValido(escopo)) return res.status(400).json({ error: 'Escopo inválido' });

    const tel = formatarTelefone(telefone);

    if (!checarRate(`painel-otp:${tel}`, 3, 60000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    }

    // Verifica se está em admins
    const admin = await buscarAdminPorTelefone(tel);
    if (!admin) {
      // Resposta genérica por segurança
      console.log(`⚠️  Tentativa de login admin com telefone NÃO autorizado: ${tel}`);
      return res.json({ success: true, message: 'Se autorizado, você receberá um código' });
    }

    const codigo = gerarOTP();
    await criarOtpAdmin(tel, codigo, 10);
    await enviarOtpAdminWhatsApp(tel, codigo, admin.nome, escopo);
    limparOtpAdminExpirados().catch(() => {});

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] OTP painel ${escopo} para ${tel}: ${codigo}`);
    }

    res.json({ success: true, message: 'Código enviado via WhatsApp' });
  } catch (err) {
    console.error('❌ /painel/solicitar-otp:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 2. VERIFICAR OTP — login
// ──────────────────────────────────────────────────────────

router.post('/verificar-otp', async (req, res) => {
  try {
    const { telefone, codigo, escopo, device_fingerprint } = req.body || {};
    if (!telefone || !codigo) return res.status(400).json({ error: 'Telefone e código obrigatórios' });
    if (!escopoValido(escopo)) return res.status(400).json({ error: 'Escopo inválido' });

    const tel = formatarTelefone(telefone);

    if (!checarRate(`painel-verify:${tel}`, 5, 60000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    }

    // Confirma admin (caso tenha sido desativado entre o OTP e a verificação)
    const admin = await buscarAdminPorTelefone(tel);
    if (!admin) return res.status(401).json({ error: 'Não autorizado' });

    const valido = await validarOtpAdmin(tel, codigo);
    if (!valido) return res.status(401).json({ error: 'Código inválido ou expirado' });

    // Cria sessão no banco
    const ua = req.headers['user-agent'] || '';
    const ip = getIP(req);
    const sessao = await criarSessaoAdmin({
      admin_id: admin.id,
      escopo,
      device_fingerprint: device_fingerprint ? JSON.stringify(device_fingerprint) : null,
      user_agent: ua.substring(0, 500),
      ip,
      diasExpiracao: 30,
    });

    const token = gerarTokenPainel({ admin_id: admin.id, escopo, sessao_id: sessao.id });
    await marcarAcessoAdmin(admin.id);

    console.log(`✅ Login painel ${escopo}: ${admin.nome} (${tel})`);

    res.json({
      success: true,
      token,
      expires_in: 30 * 24 * 60 * 60,
      admin: {
        id: admin.id,
        nome: admin.nome,
        telefone_canonico: admin.telefone_canonico,
        escopo,
      },
    });
  } catch (err) {
    console.error('❌ /painel/verificar-otp:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 3. ME
// ──────────────────────────────────────────────────────────

// Aceita qualquer escopo — só checa se é JWT admin válido
router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }
  try {
    const payload = jwt.verify(auth.slice(7).trim(), JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    const admin = await buscarAdminPorId(payload.sub);
    if (!admin) return res.status(404).json({ error: 'Admin não encontrado' });
    res.json({
      id: admin.id,
      nome: admin.nome,
      telefone_canonico: admin.telefone_canonico,
      escopo: payload.escopo,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sessão expirada', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
});

// ──────────────────────────────────────────────────────────
// 4. LOGOUT
// ──────────────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.json({ success: true });  // já está deslogado
  }
  try {
    const payload = jwt.verify(auth.slice(7).trim(), JWT_SECRET);
    if (payload.sid) await revogarSessaoAdmin(payload.sid);
  } catch (_) {}
  res.json({ success: true });
});

module.exports = router;
