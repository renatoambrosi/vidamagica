const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const {
  buscarUsuarioPorTelefone, buscarUsuarioPorId, criarOuAtualizarUsuario, atualizarUsuario,
  criarOTP, validarOTP, limparOTPsExpirados,
  upsertDispositivo, listarDispositivosUsuario, revogarDispositivo,
  criarSessao, buscarSessaoPorRefreshToken, renovarSessao,
  revogarSessao, revogarTodasSessoesUsuario,
} = require('../db');
const { enviar: gatewayEnviar } = require('./gateway');
const { gerarAccessToken, autenticar } = require('../middleware/autenticar');

// ── HELPERS ──────────────────────────────────────────────────────────────────

function formatarTelefone(tel) {
  const num = String(tel).replace(/\D/g, '');
  if (num.startsWith('55')) return num;
  if (num.startsWith('0')) return `55${num.slice(1)}`;
  return `55${num}`;
}

function gerarOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function detectarTipo(ua = '') {
  return /android|iphone|ipad|ipod|mobile|blackberry|opera mini/i.test(ua) ? 'mobile' : 'desktop';
}

function nomearDispositivo(ua = '') {
  let os = 'Desconhecido', browser = 'Navegador';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh/i.test(ua)) os = 'Mac';
  else if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Linux/i.test(ua)) os = 'Linux';
  if (/Chrome/i.test(ua) && !/Edge|Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Edge/i.test(ua)) browser = 'Edge';
  return `${browser} · ${os}`;
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
}

async function enviarOTPWhatsApp(telefone, codigo, nome) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV] OTP para ${telefone}: ${codigo}`);
  }
  const saudacao = nome ? `Olá, ${nome.split(' ')[0]}!` : 'Olá!';
  const mensagem = `${saudacao} 🔐\n\nSeu código de acesso ao *Vida Mágica* é:\n\n*${codigo}*\n\nVálido por 10 minutos. Não compartilhe com ninguém.\n\n— Vida Mágica`;
  try {
    await gatewayEnviar({ telefone, mensagem, nome: nome || telefone, origem: 'auth-otp', imediato: true });
    console.log(`✅ OTP enfileirado para ${telefone}`);
    return true;
  } catch (err) {
    console.error(`❌ Erro ao enfileirar OTP:`, err.message);
    return false;
  }
}

async function enviarOTPEmail(email, codigo, nome) {
  const axios = require('axios');
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL || 'sistema@suellenseragi.com.br';
  if (!apiKey || !email) return false;
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Vida Mágica', email: senderEmail },
      to: [{ email }],
      subject: `${codigo} — seu código de acesso`,
      htmlContent: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0a1628;border-radius:12px">
          <h2 style="color:#E8C97A;font-size:18px;margin:0 0 12px">Olá, ${nome || 'você'}!</h2>
          <p style="color:#c8c0a8;font-size:14px;margin:0 0 20px">Seu código de acesso ao Vida Mágica:</p>
          <div style="background:#1a2a4a;border:1px solid rgba(200,146,42,0.3);border-radius:8px;padding:20px;text-align:center;margin-bottom:20px">
            <span style="font-size:34px;font-weight:700;letter-spacing:8px;color:#E8C97A">${codigo}</span>
          </div>
          <p style="color:#888;font-size:12px;margin:0">Válido por 10 minutos. Não compartilhe este código.</p>
        </div>`,
    }, {
      headers: { 'accept': 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    });
    return true;
  } catch (err) {
    console.error('❌ Erro OTP email:', err.message);
    return false;
  }
}

// Rate limit simples em memória
const rateMap = new Map();
function checarRate(chave, max = 3, janelaMs = 60000) {
  const agora = Date.now();
  const e = rateMap.get(chave) || { count: 0, reset: agora + janelaMs };
  if (agora > e.reset) { e.count = 0; e.reset = agora + janelaMs; }
  e.count++;
  rateMap.set(chave, e);
  return e.count <= max;
}

function resUsuario(u) {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    email_verificado: u.email_verificado,
    plano: u.plano,
    perfil_teste: u.perfil_teste,
    percentual_prosperidade: u.percentual_prosperidade,
    sementes: u.sementes,
    estagio_arvore: u.estagio_arvore,
  };
}

// ── 1. SOLICITAR OTP (WhatsApp) ───────────────────────────────────────────────
router.post('/solicitar-otp', async (req, res) => {
  try {
    const { telefone } = req.body;
    if (!telefone) return res.status(400).json({ error: 'Telefone obrigatório' });

    const tel = formatarTelefone(telefone);
    if (!checarRate(`otp:${tel}`, 3, 60000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    }

    const usuario = await criarOuAtualizarUsuario({ telefone: tel, telefone_formatado: tel });
    const codigo = gerarOTP();
    await criarOTP(tel, codigo, 'whatsapp', 10);
    await enviarOTPWhatsApp(tel, codigo, usuario.nome);
    limparOTPsExpirados().catch(() => {});

    res.json({
      success: true,
      message: 'Código enviado via WhatsApp',
    });
  } catch (err) {
    console.error('❌ /solicitar-otp:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 2. SOLICITAR OTP (Email) ──────────────────────────────────────────────────
router.post('/solicitar-otp-email', autenticar, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });

    const usuario_id = req.usuario.sub;
    if (!checarRate(`otp-email:${usuario_id}`, 3, 60000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    }

    const usuario = await buscarUsuarioPorId(usuario_id);
    const codigo = gerarOTP();
    await criarOTP(email, codigo, 'email', 10);
    await enviarOTPEmail(email, codigo, usuario?.nome);

    res.json({ success: true, message: 'Código enviado por email' });
  } catch (err) {
    console.error('❌ /solicitar-otp-email:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 3. VERIFICAR OTP + LOGIN/CADASTRO ────────────────────────────────────────
// RETORNA novo_usuario: true quando é o primeiro acesso (sem nome cadastrado)
// O frontend cadastro.html usa esse campo para decidir se vai para o step 3
router.post('/verificar-otp', async (req, res) => {
  try {
    const { telefone, codigo, device_fingerprint } = req.body;
    if (!telefone || !codigo) return res.status(400).json({ error: 'Telefone e código obrigatórios' });

    const tel = formatarTelefone(telefone);
    if (!checarRate(`verify:${tel}`, 5, 60000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    }

    const valido = await validarOTP(tel, codigo);
    if (!valido) return res.status(401).json({ error: 'Código inválido ou expirado' });

    const usuario = await buscarUsuarioPorTelefone(tel);
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });

    const ua = req.headers['user-agent'] || '';
    const tipo = detectarTipo(ua);
    const nome_amigavel = nomearDispositivo(ua);
    const device_id = device_fingerprint?.device_id || uuidv4();
    const ip = getIP(req);

    const dispositivo = await upsertDispositivo({
      usuario_id: usuario.id,
      tipo,
      device_id,
      fingerprint: device_fingerprint || { ua: ua.substring(0, 200) },
      nome_amigavel,
      ip,
    });

    const access_token = gerarAccessToken(usuario);
    const refresh_token = uuidv4();

    await criarSessao({
      usuario_id: usuario.id,
      device_id: dispositivo.id,
      refresh_token,
      ip,
      user_agent: ua.substring(0, 500),
      diasExpiracao: 30,
    });

    // novo_usuario = true quando ainda não tem nome (nunca completou o cadastro)
    const novo_usuario = !usuario.nome;

    console.log(`✅ Login: ${tel} | ${tipo} | ${nome_amigavel} | novo: ${novo_usuario}`);

    res.json({
      success: true,
      access_token,
      refresh_token,
      expires_in: 900,
      usuario: resUsuario(usuario),
      dispositivo: { tipo, nome: nome_amigavel },
      novo_usuario,
    });
  } catch (err) {
    console.error('❌ /verificar-otp:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 4. VERIFICAR OTP DE EMAIL ─────────────────────────────────────────────────
router.post('/verificar-otp-email', autenticar, async (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!email || !codigo) return res.status(400).json({ error: 'Email e código obrigatórios' });

    const valido = await validarOTP(email, codigo);
    if (!valido) return res.status(401).json({ error: 'Código inválido ou expirado' });

    const usuario = await atualizarUsuario(req.usuario.sub, {
      email: email.toLowerCase().trim(),
      email_verificado: true,
    });

    res.json({ success: true, usuario: resUsuario(usuario) });
  } catch (err) {
    console.error('❌ /verificar-otp-email:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 5. RENOVAR ACCESS TOKEN ───────────────────────────────────────────────────
router.post('/renovar', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token obrigatório' });

    const sessao = await buscarSessaoPorRefreshToken(refresh_token);
    if (!sessao) return res.status(401).json({ error: 'Sessão inválida ou expirada', code: 'SESSION_EXPIRED' });

    await renovarSessao(refresh_token);

    const access_token = gerarAccessToken({
      id: sessao.uid,
      telefone_formatado: sessao.telefone_formatado,
      plano: sessao.plano,
      nome: sessao.nome,
    });

    res.json({
      success: true,
      access_token,
      expires_in: 900,
      usuario: {
        id: sessao.uid,
        nome: sessao.nome,
        email: sessao.email,
        plano: sessao.plano,
        perfil_teste: sessao.perfil_teste,
        percentual_prosperidade: sessao.percentual_prosperidade,
        sementes: sessao.sementes,
        estagio_arvore: sessao.estagio_arvore,
      },
    });
  } catch (err) {
    console.error('❌ /renovar:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 6. COMPLETAR PERFIL ───────────────────────────────────────────────────────
router.put('/perfil', autenticar, async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    const campos = {};

    if (nome) campos.nome = nome.trim();
    if (email) campos.email = email.trim().toLowerCase();
    if (senha) {
      if (senha.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });
      campos.senha_hash = await bcrypt.hash(senha, 12);
    }

    if (!Object.keys(campos).length) return res.status(400).json({ error: 'Nada para atualizar' });

    if (campos.email) campos.email_verificado = false;

    const usuario = await atualizarUsuario(req.usuario.sub, campos);
    res.json({ success: true, usuario: resUsuario(usuario) });
  } catch (err) {
    console.error('❌ /perfil:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 7. LOGIN COM SENHA (alternativo) ─────────────────────────────────────────
router.post('/login-senha', async (req, res) => {
  try {
    const { telefone, senha, device_fingerprint } = req.body;
    if (!telefone || !senha) return res.status(400).json({ error: 'Telefone e senha obrigatórios' });

    const tel = formatarTelefone(telefone);
    if (!checarRate(`senha:${tel}`, 5, 120000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 2 minutos.' });
    }

    const usuario = await buscarUsuarioPorTelefone(tel);
    if (!usuario || !usuario.senha_hash) {
      return res.status(401).json({ error: 'Telefone ou senha incorretos' });
    }

    const ok = await bcrypt.compare(senha, usuario.senha_hash);
    if (!ok) return res.status(401).json({ error: 'Telefone ou senha incorretos' });

    const ua = req.headers['user-agent'] || '';
    const tipo = detectarTipo(ua);
    const device_id = device_fingerprint?.device_id || uuidv4();
    const ip = getIP(req);

    const dispositivo = await upsertDispositivo({
      usuario_id: usuario.id, tipo, device_id,
      fingerprint: device_fingerprint || { ua: ua.substring(0, 200) },
      nome_amigavel: nomearDispositivo(ua), ip,
    });

    const access_token = gerarAccessToken(usuario);
    const refresh_token = uuidv4();

    await criarSessao({
      usuario_id: usuario.id, device_id: dispositivo.id,
      refresh_token, ip, user_agent: ua.substring(0, 500), diasExpiracao: 30,
    });

    res.json({
      success: true, access_token, refresh_token, expires_in: 900,
      usuario: resUsuario(usuario),
      novo_usuario: false,
    });
  } catch (err) {
    console.error('❌ /login-senha:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 8. LOGOUT ─────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) await revogarSessao(refresh_token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 9. LOGOUT DE TODOS OS DISPOSITIVOS ───────────────────────────────────────
router.post('/logout-todos', autenticar, async (req, res) => {
  try {
    await revogarTodasSessoesUsuario(req.usuario.sub);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 10. LISTAR DISPOSITIVOS ───────────────────────────────────────────────────
router.get('/dispositivos', autenticar, async (req, res) => {
  try {
    const lista = await listarDispositivosUsuario(req.usuario.sub);
    res.json(lista.map(d => ({
      id: d.id,
      tipo: d.tipo,
      nome: d.nome_amigavel,
      ultimo_acesso: d.ultimo_acesso,
      ativo: d.ativo,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 11. REVOGAR DISPOSITIVO ───────────────────────────────────────────────────
router.delete('/dispositivos/:id', autenticar, async (req, res) => {
  try {
    const lista = await listarDispositivosUsuario(req.usuario.sub);
    const disp = lista.find(d => d.id === req.params.id);
    if (!disp) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    await revogarDispositivo(disp.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 12. ME ────────────────────────────────────────────────────────────────────
router.get('/me', autenticar, async (req, res) => {
  try {
    const usuario = await buscarUsuarioPorId(req.usuario.sub);
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(resUsuario(usuario));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
