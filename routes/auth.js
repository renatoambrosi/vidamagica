const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const {
  pool,
  buscarUsuarioPorTelefone, buscarUsuarioPorId, criarOuAtualizarUsuario, atualizarUsuario,
  criarOTP, validarOTP, limparOTPsExpirados,
  upsertDispositivo, listarDispositivosUsuario, revogarDispositivo,
  criarSessao, buscarSessaoPorRefreshToken, renovarSessao,
  revogarSessao, revogarTodasSessoesUsuario,
} = require('../db');
const { enviar: gatewayEnviar } = require('./gateway');
const { gerarAccessToken, autenticar } = require('../middleware/autenticar');

// ── HELPERS ───────────────────────────────────────────────────────────────────

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
    telefone_formatado: u.telefone_formatado,
    email_verificado: u.email_verificado,
    plano: u.plano,
    perfil_teste: u.perfil_teste,
    percentual_prosperidade: u.percentual_prosperidade,
    sementes: u.sementes,
    estagio_arvore: u.estagio_arvore,
  };
}

// Busca usuário por identificador flexível: telefone, e-mail ou vm_id
async function buscarUsuarioPorIdentificador(id) {
  // 1. E-mail
  if (id.includes('@')) {
    const r = await pool.query(`SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)`, [id]);
    if (r.rows[0]) return r.rows[0];
  }

  // 2. Telefone — tenta com e sem DDI
  const digits = id.replace(/\D/g, '');
  if (digits.length >= 8) {
    // Tenta o número como veio (pode já ter DDI)
    let r = await pool.query(`SELECT * FROM usuarios WHERE telefone_formatado = $1`, [digits]);
    if (r.rows[0]) return r.rows[0];
    // Tenta com DDI 55 na frente
    if (!digits.startsWith('55')) {
      r = await pool.query(`SELECT * FROM usuarios WHERE telefone_formatado = $1`, [`55${digits}`]);
      if (r.rows[0]) return r.rows[0];
    }
    // Tenta sem DDI (remove 55 do início)
    if (digits.startsWith('55') && digits.length > 11) {
      r = await pool.query(`SELECT * FROM usuarios WHERE telefone_formatado = $1`, [digits.slice(2)]);
      if (r.rows[0]) return r.rows[0];
    }
  }

  // 3. VM-ID (coluna opcional — não quebra se não existir)
  if (/^VM-\d+$/i.test(id)) {
    try {
      const r = await pool.query(`SELECT * FROM usuarios WHERE UPPER(vm_id) = UPPER($1)`, [id]);
      if (r.rows[0]) return r.rows[0];
    } catch (_) {}
  }

  return null;
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

    res.json({ success: true, message: 'Código enviado via WhatsApp' });
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
      usuario_id: usuario.id, tipo, device_id,
      fingerprint: device_fingerprint || { ua: ua.substring(0, 200) },
      nome_amigavel, ip,
    });

    const access_token = gerarAccessToken(usuario);
    const refresh_token = uuidv4();

    await criarSessao({
      usuario_id: usuario.id,
      device_id: dispositivo.id,
      refresh_token, ip,
      user_agent: ua.substring(0, 500),
      diasExpiracao: 365,
    });

    const novo_usuario = !usuario.nome;
    console.log(`✅ OTP Login: ${tel} | ${tipo} | ${nome_amigavel} | novo: ${novo_usuario}`);

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
        telefone_formatado: sessao.telefone_formatado,
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

// ── 6. COMPLETAR/ATUALIZAR PERFIL ────────────────────────────────────────────
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

// ── 7. LOGIN COM SENHA ────────────────────────────────────────────────────────
// Aceita: identificador = WhatsApp (qualquer formato) OU e-mail OU vm_id
router.post('/login-senha', async (req, res) => {
  try {
    const { identificador, telefone, senha, device_fingerprint } = req.body;

    // Compatibilidade: aceita campo antigo "telefone" e novo "identificador"
    const id = (identificador || telefone || '').trim();
    if (!id || !senha) {
      return res.status(400).json({ error: 'Informe seu WhatsApp ou e-mail e sua senha.' });
    }

    if (!checarRate(`senha:${id}`, 5, 120000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 2 minutos.' });
    }

    const usuario = await buscarUsuarioPorIdentificador(id);

    if (!usuario || !usuario.senha_hash) {
      return res.status(401).json({ error: 'Dados incorretos. Verifique seu WhatsApp/e-mail e a senha.' });
    }

    const ok = await bcrypt.compare(senha, usuario.senha_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Dados incorretos. Verifique seu WhatsApp/e-mail e a senha.' });
    }

    const ua = req.headers['user-agent'] || '';
    const tipo = detectarTipo(ua);
    const device_id = device_fingerprint?.device_id || uuidv4();
    const ip = getIP(req);

    // Limite 1 mobile + 1 desktop: revoga dispositivo anterior do mesmo tipo
    const dispositivosAtivos = await listarDispositivosUsuario(usuario.id);
    const mesmotipo = dispositivosAtivos.filter(d => d.ativo && d.tipo === tipo);
    if (mesmotipo.length > 0 && mesmotipo[0].device_id !== device_id) {
      await revogarDispositivo(mesmotipo[0].id);
    }

    const dispositivo = await upsertDispositivo({
      usuario_id: usuario.id, tipo, device_id,
      fingerprint: device_fingerprint || { ua: ua.substring(0, 200) },
      nome_amigavel: nomearDispositivo(ua), ip,
    });

    const access_token = gerarAccessToken(usuario);
    const refresh_token = uuidv4();

    await criarSessao({
      usuario_id: usuario.id,
      device_id: dispositivo.id,
      refresh_token, ip,
      user_agent: ua.substring(0, 500),
      diasExpiracao: 365,
    });

    console.log(`✅ Login senha: ${id} | ${tipo} | ${nomearDispositivo(ua)}`);

    res.json({
      success: true,
      access_token,
      refresh_token,
      expires_in: 900,
      usuario: resUsuario(usuario),
    });
  } catch (err) {
    console.error('❌ /login-senha:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 8. ESQUECI SENHA — envia link pelo WhatsApp ───────────────────────────────
router.post('/esqueci-senha', async (req, res) => {
  try {
    const { identificador } = req.body;
    if (!identificador) return res.status(400).json({ error: 'Identificador obrigatório' });

    if (!checarRate(`reset:${identificador}`, 3, 300000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 5 minutos.' });
    }

    const usuario = await buscarUsuarioPorIdentificador(identificador.trim());

    // Resposta sempre genérica por segurança
    if (!usuario || !usuario.telefone_formatado) {
      return res.json({ success: true });
    }

    const resetToken = uuidv4();
    const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    try {
      await pool.query(
        `UPDATE usuarios SET reset_token=$1, reset_token_expira=$2, atualizado_em=NOW() WHERE id=$3`,
        [resetToken, expira, usuario.id]
      );
    } catch (_) {
      // Coluna reset_token pode não existir ainda — não quebra o servidor
      console.warn('⚠️  Coluna reset_token não encontrada. Adicione ao banco.');
      return res.json({ success: true });
    }

    const baseUrl = process.env.APP_URL || 'https://www.vidamagica.com.br';
    const link = `${baseUrl}/auth?token=${resetToken}`;
    const nome = usuario.nome ? usuario.nome.split(' ')[0] : 'Olá';
    const mensagem = `${nome}! 🔐\n\nVocê solicitou a redefinição de senha do *Vida Mágica*.\n\nClique no link para criar uma nova senha:\n\n${link}\n\n_Válido por 30 minutos. Se não foi você, ignore._\n\n— Vida Mágica`;

    await gatewayEnviar({
      telefone: usuario.telefone_formatado,
      mensagem, nome: usuario.nome || 'usuária',
      origem: 'auth-reset', imediato: true,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ /esqueci-senha:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 9. REDEFINIR SENHA (via token do link) ────────────────────────────────────
router.post('/redefinir-senha', async (req, res) => {
  try {
    const { token, nova_senha } = req.body;
    if (!token || !nova_senha) return res.status(400).json({ error: 'Token e nova senha obrigatórios' });
    if (nova_senha.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });

    let usuario = null;
    try {
      const r = await pool.query(
        `SELECT * FROM usuarios WHERE reset_token=$1 AND reset_token_expira > NOW()`,
        [token]
      );
      usuario = r.rows[0] || null;
    } catch (_) {
      return res.status(500).json({ error: 'Erro interno — coluna reset_token não encontrada.' });
    }

    if (!usuario) return res.status(401).json({ error: 'Link inválido ou expirado. Solicite um novo.' });

    const senha_hash = await bcrypt.hash(nova_senha, 12);
    const updated = await atualizarUsuario(usuario.id, { senha_hash });

    // Limpa o token de recuperação
    await pool.query(
      `UPDATE usuarios SET reset_token=NULL, reset_token_expira=NULL WHERE id=$1`,
      [usuario.id]
    );

    // Revoga todas as sessões antigas por segurança
    await revogarTodasSessoesUsuario(usuario.id);

    // Cria nova sessão automaticamente
    const ua = req.headers['user-agent'] || '';
    const tipo = detectarTipo(ua);
    const device_id = uuidv4();
    const ip = getIP(req);

    const dispositivo = await upsertDispositivo({
      usuario_id: usuario.id, tipo, device_id,
      fingerprint: { ua: ua.substring(0, 200) },
      nome_amigavel: nomearDispositivo(ua), ip,
    });

    const access_token = gerarAccessToken(updated);
    const refresh_token = uuidv4();

    await criarSessao({
      usuario_id: usuario.id,
      device_id: dispositivo.id,
      refresh_token, ip,
      user_agent: ua.substring(0, 500),
      diasExpiracao: 365,
    });

    res.json({ success: true, access_token, refresh_token, expires_in: 900, usuario: resUsuario(updated) });
  } catch (err) {
    console.error('❌ /redefinir-senha:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 10. LOGOUT ────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) await revogarSessao(refresh_token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 11. LOGOUT DE TODOS OS DISPOSITIVOS ──────────────────────────────────────
router.post('/logout-todos', autenticar, async (req, res) => {
  try {
    await revogarTodasSessoesUsuario(req.usuario.sub);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 12. LISTAR DISPOSITIVOS ───────────────────────────────────────────────────
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

// ── 13. REVOGAR DISPOSITIVO ───────────────────────────────────────────────────
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

// ── 14. ME ────────────────────────────────────────────────────────────────────
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
