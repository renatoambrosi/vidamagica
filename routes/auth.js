/* ============================================================
   VIDA MÁGICA — routes/auth.js
   Auth da aluna: OTP (WhatsApp + Email), login com senha,
   esqueci/redefinir senha, dispositivos, sessões.

   Banco: poolCore (via core/usuarios.js).
   Envio de WhatsApp: usa core/whatsapp.js (envio direto Evolution).
                       Quando a Fase de Comunidade subir, troca pra
                       gateway com fila + cooldown.
   Envio de Email: Brevo direto.
   ============================================================ */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const { poolCore } = require('../db');
const {
  buscarUsuarioPorTelefone, buscarUsuarioPorId, criarOuAtualizarUsuario, atualizarUsuario,
  criarOTP, validarOTP, limparOTPsExpirados,
  criarMagicToken, validarMagicToken,
  criarSolicitacaoAcesso, buscarSolicitacaoPorToken,
  marcarComoAtiva,
  upsertDispositivo, listarDispositivosUsuario, revogarDispositivo,
  criarSessao, buscarSessaoPorRefreshToken, renovarSessao,
  revogarSessao, revogarTodasSessoesUsuario,
  arquivarUsuario, ehArquivadaPorAluna, reativarAlunaSilenciosa,
  ehLegado, ehBanido, reativarContaLegado,
  verificarBanimento, registrarTentativaBanido,
} = require('../core/usuarios');
const { enfileirarAtendimento } = require('../core/gateway');
const { gerarAccessToken, autenticar } = require('../middleware/autenticar');

// ── HELPERS ───────────────────────────────────────────────

function formatarTelefone(tel) {
  const num = String(tel).replace(/\D/g, '');
  if (num.startsWith('55')) return num;
  if (num.startsWith('0')) return `55${num.slice(1)}`;
  return `55${num}`;
}

function gerarOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Detecta o tipo de dispositivo a partir do User-Agent.
// Tipos suportados: 'mobile' | 'tablet' | 'desktop'.
// Ordem importa: tablets primeiro (regras mais específicas) — Android tablet
// é Android SEM a palavra "Mobile"; iPad/Kindle/Silk são tablets explícitos.
// iPadOS 13+ em Safari mente identificando-se como Mac (caso de borda comum,
// fica em 'desktop' sem detecção via touch-points no client).
function detectarTipo(ua = '') {
  const s = String(ua);
  if (/ipad|tablet|kindle|silk|playbook|sm-t\d/i.test(s)) return 'tablet';
  if (/android(?!.*mobile)/i.test(s)) return 'tablet';
  if (/android|iphone|ipod|mobile|blackberry|opera mini/i.test(s)) return 'mobile';
  return 'desktop';
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

async function enviarOTPEmail(email, codigo, nome) {
  const axios = require('axios');
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.SENDER_EMAIL || 'contato@suellenseragi.com.br';
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

function resUsuario(u) {
  return {
    id: u.id,
    nome: u.nome,
    nome_preferencia: u.nome_preferencia || null,
    genero: u.genero || null,
    ocupacao: u.ocupacao || null,
    cpf: u.cpf || null,
    data_nascimento: u.data_nascimento || null,
    email: u.email,
    telefone_formatado: u.telefone_formatado,
    email_verificado: !!u.email_verificado,
    // Telefone verificado: deriva de telefone_validado_em IS NOT NULL.
    // A conta só vai pra status='ativa' depois de validar telefone via magic.
    telefone_verificado: !!u.telefone_validado_em,
    foto_url: u.foto_url || null,
    plano: u.plano,
    perfil_teste: u.perfil_teste,
    percentual_prosperidade: u.percentual_prosperidade,
    sementes: u.sementes,
    estagio_arvore: u.estagio_arvore,
  };
}

// Busca por identificador flexível: telefone, email ou vm_id
async function buscarUsuarioPorIdentificador(id) {
  if (id.includes('@')) {
    const r = await poolCore.query(
      `SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)`,
      [id]
    );
    if (r.rows[0]) return r.rows[0];
  }

  const digits = id.replace(/\D/g, '');
  if (digits.length >= 8) {
    let r = await poolCore.query(
      `SELECT * FROM usuarios WHERE telefone_formatado = $1`,
      [digits]
    );
    if (r.rows[0]) return r.rows[0];

    if (!digits.startsWith('55')) {
      r = await poolCore.query(
        `SELECT * FROM usuarios WHERE telefone_formatado = $1`,
        [`55${digits}`]
      );
      if (r.rows[0]) return r.rows[0];
    }

    if (digits.startsWith('55') && digits.length > 11) {
      r = await poolCore.query(
        `SELECT * FROM usuarios WHERE telefone_formatado = $1`,
        [digits.slice(2)]
      );
      if (r.rows[0]) return r.rows[0];
    }
  }

  if (/^VM-\d+$/i.test(id)) {
    try {
      const r = await poolCore.query(
        `SELECT * FROM usuarios WHERE UPPER(vm_id) = UPPER($1)`,
        [id]
      );
      if (r.rows[0]) return r.rows[0];
    } catch (_) {}
  }

  return null;
}

// ──────────────────────────────────────────────────────────
// 1. SOLICITAR OTP (WhatsApp)
// ──────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────
// 0. VERIFICAR EXISTÊNCIA (público, sem expor dados sensíveis)
// Usado pelo /auth pra checar se a "lembrança" do navegador (vm_u no
// localStorage) ainda corresponde a uma conta válida. Se Renato apaga
// a conta no admin OU se a aluna pediu exclusão, o cache local do
// navegador continua mostrando "Olá, Fulano" — sem essa verificação.
// ──────────────────────────────────────────────────────────
router.post('/verificar-existencia', async (req, res) => {
  try {
    const { telefone, email } = req.body || {};
    if (!telefone && !email) {
      return res.status(400).json({ error: 'Telefone ou email obrigatório' });
    }

    let usuario = null;
    if (telefone) {
      const tel = formatarTelefone(telefone);
      // Rate limit (impede abuse de descoberta em massa)
      if (!checarRate(`verif-exist:${tel}`, 10, 60000)) {
        return res.status(429).json({ error: 'Muitas tentativas' });
      }
      usuario = await buscarUsuarioPorTelefone(tel);
    } else if (email) {
      const emailLimpo = String(email).trim().toLowerCase();
      if (!checarRate(`verif-exist:${emailLimpo}`, 10, 60000)) {
        return res.status(429).json({ error: 'Muitas tentativas' });
      }
      const r = await poolCore.query(
        `SELECT id, status FROM usuarios WHERE LOWER(email) = $1 LIMIT 1`,
        [emailLimpo]
      );
      usuario = r.rows[0] || null;
    }

    // Verifica banimento pelos vínculos (telefone OU email digitado). Se
    // bate, registra tentativa e retorna code BANIDO — front mostra mensagem
    // de suporte (contato@vidamagica.com.br).
    const banido = await verificarBanimento({
      telefone: telefone ? formatarTelefone(telefone) : null,
      email: email ? String(email).trim().toLowerCase() : null,
    });
    if (banido) {
      await registrarTentativaBanido(banido.banimento_id, {
        rota: '/verificar-existencia',
        vinculo_bateu: banido.vinculo_bateu,
        valor_bateu: banido.valor_bateu,
        ip: getIP(req),
        user_agent: req.headers['user-agent'],
      });
      return res.status(200).json({ existe: false, code: 'BANIDO' });
    }

    // Conta arquivada/legado conta como "não existe" pra UX da tela /auth —
    // a aluna não consegue logar com fluxo de "Olá, fulano". Pra arquivada-
    // por-aluna ou legado, ela passa pelo cadastro normal (que reativa
    // silenciosamente OU cria conta limpa, respectivamente).
    const escondida = usuario && (usuario.status === 'arquivada' || usuario.status === 'legado' || usuario.status === 'banido');
    const existe = !!(usuario && !escondida);
    return res.json({ existe });
  } catch (err) {
    console.error('❌ /verificar-existencia:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/solicitar-otp', async (req, res) => {
  try {
    const { telefone, modo, nome, email, senha, device_fingerprint } = req.body;
    if (!telefone) return res.status(400).json({ error: 'Telefone obrigatório' });

    const tel = formatarTelefone(telefone);
    if (!checarRate(`magic:${tel}`, 3, 60000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    }

    const ehCadastro = modo === 'cadastro';

    // Verifica banimento por telefone (sempre) + email (se modo cadastro).
    // Banido vê mensagem genérica de suporte na UI; registra tentativa.
    const emailParaCheck = ehCadastro && email ? String(email).trim().toLowerCase() : null;
    const banido = await verificarBanimento({ telefone: tel, email: emailParaCheck });
    if (banido) {
      await registrarTentativaBanido(banido.banimento_id, {
        rota: '/solicitar-otp',
        vinculo_bateu: banido.vinculo_bateu,
        valor_bateu: banido.valor_bateu,
        ip: getIP(req),
        user_agent: req.headers['user-agent'],
        fingerprint: device_fingerprint,
      });
      return res.status(403).json({
        error: 'Conta excluída. Entre em contato com o suporte através de contato@vidamagica.com.br.',
        code: 'BANIDO',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // MODO CADASTRO
    // Aluna preencheu nome+email+tel+senha no /auth. AGORA:
    //  1. Backend grava/agrega os dados em `usuarios` (camadas)
    //  2. Backend gera um token de solicitação (acesso_solicitacoes)
    //  3. Retorna wa_url pro frontend abrir o WhatsApp da aluna
    //  4. Aluna manda o zap pra Suellen
    //  5. Webhook recebe → vê que a conta existe → enfileira magic link
    //  6. Aluna toca no link → /login-magic → marcarComoAtiva → /app
    //
    // BACKEND NÃO MANDA MENSAGEM AQUI. A aluna que inicia a conversa.
    // ─────────────────────────────────────────────────────────────
    if (ehCadastro) {
      const nomeLimpo  = (nome  || '').toString().trim();
      const emailLimpo = (email || '').toString().trim().toLowerCase();
      const senhaLimpa = (senha || '').toString();
      if (!nomeLimpo)  return res.status(400).json({ error: 'Nome obrigatório' });
      if (!emailLimpo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
        return res.status(400).json({ error: 'E-mail inválido' });
      }
      if (!senhaLimpa || senhaLimpa.length < 6) {
        return res.status(400).json({ error: 'Senha mínima: 6 caracteres' });
      }

      // 1. Grava/agrega usuário (modelo de camadas)
      let usuario = await buscarUsuarioPorTelefone(tel);
      if (!usuario) {
        usuario = await criarOuAtualizarUsuario({
          telefone: tel,
          telefone_formatado: tel,
          nome: nomeLimpo,
          email: emailLimpo,
          origem_cadastro: 'cadastro_direto',
        });
      } else if (usuario.status === 'legado') {
        // Aluna em legado voltando pelo cadastro — pra ela é conta nova.
        // Sobrescreve nome/email/senha com os novos que ela digitou. Os dados
        // antigos (jornada, relatos, materiais) seguem com eh_legado=TRUE,
        // invisíveis pra ela.
        const senha_hash = await bcrypt.hash(senhaLimpa, 12);
        usuario = await atualizarUsuario(usuario.id, {
          nome: nomeLimpo,
          email: emailLimpo,
          email_verificado: false,
          senha_hash,
        });
      } else {
        const camposPraAtualizar = {};
        if (!usuario.nome)  camposPraAtualizar.nome  = nomeLimpo;
        if (!usuario.email) camposPraAtualizar.email = emailLimpo;
        if (Object.keys(camposPraAtualizar).length) {
          usuario = await atualizarUsuario(usuario.id, camposPraAtualizar);
        }
      }
      if (!usuario.senha_hash) {
        const senha_hash = await bcrypt.hash(senhaLimpa, 12);
        usuario = await atualizarUsuario(usuario.id, { senha_hash });
      }

      // 2. Gera token de solicitação com fingerprint do dispositivo que pediu.
      //    Magic link gerado pelo webhook herda esse fingerprint — só funciona aqui.
      const sol = await criarSolicitacaoAcesso(tel, 5, device_fingerprint || null);
      const mensagemPre =
        `Quero criar minha conta no Vida Mágica\n` +
        `Cadastro · ${sol.token}`;
      const waUrl = `https://wa.me/${NUMERO_COMUNIDADE}?text=${encodeURIComponent(mensagemPre)}`;

      return res.json({
        success: true,
        token: sol.token,
        wa_url: waUrl,
        expira_em: sol.expira_em,
        ttl_segundos: 300,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // MODO LOGIN (modo ausente / qualquer outro)
    // Comportamento legado: aluna informa só telefone, se a conta
    // existir manda magic link via gateway. Se não, 404 (frontend
    // direciona pra criar conta).
    // ─────────────────────────────────────────────────────────────
    const usuario = await buscarUsuarioPorTelefone(tel);
    if (!usuario) {
      return res.status(404).json({
        error: 'Não encontramos sua conta com esse telefone.',
        code: 'CONTA_NAO_EXISTE',
      });
    }
    // Aluna que desativou/excluiu aparece como "não existe" no MODO LOGIN —
    // front direciona pra criar conta nova:
    //   - arquivada-por-aluna: /verificar-otp e /login-magic reativam silencioso
    //     quando ela completar cadastro
    //   - legado: cadastro novo reaproveita o registro com dados limpos
    if (ehArquivadaPorAluna(usuario) || ehLegado(usuario)) {
      return res.status(404).json({
        error: 'Não encontramos sua conta com esse telefone.',
        code: 'CONTA_NAO_EXISTE',
      });
    }

    const cadastroIncompleto = !usuario.nome || !usuario.email || !usuario.senha_hash;
    const tipoMagic = cadastroIncompleto ? 'magic_boas_vindas' : 'magic_login';
    const templateMsg1 = cadastroIncompleto ? 'magic_boas_vindas_msg1' : 'magic_login_msg1';

    const token = await criarMagicToken(tel, tipoMagic, 10);
    const baseUrl = process.env.APP_URL || 'https://www.vidamagica.com.br';
    const link = `${baseUrl}/auth?magic=${token}`;
    const primeiroNome = (usuario.nome || '').split(' ')[0] || '';

    await enfileirarAtendimento({
      telefone: tel,
      tipo: 'reativo',
      origem: 'auth-magic-link',
      nome: primeiroNome,
      mensagens: [
        { template: templateMsg1, variaveis: { nome: primeiroNome } },
        { texto: link },
      ],
    });

    limparOTPsExpirados().catch(() => {});

    res.json({
      success: true,
      message: 'Link de acesso enviado pelo WhatsApp',
      cadastroIncompleto,
    });
  } catch (err) {
    console.error('❌ /solicitar-otp:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 2. SOLICITAR OTP (Email — para verificar email já logado)
// ──────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────
// 3. VERIFICAR OTP + LOGIN/CADASTRO
// ──────────────────────────────────────────────────────────

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

    // Banimento na entrada do telefone (raro chegar até aqui se a UI bloqueia,
    // mas defesa em profundidade).
    const banido = await verificarBanimento({ telefone: tel });
    if (banido) {
      await registrarTentativaBanido(banido.banimento_id, {
        rota: '/verificar-otp',
        vinculo_bateu: banido.vinculo_bateu,
        valor_bateu: banido.valor_bateu,
        ip: getIP(req),
        user_agent: req.headers['user-agent'],
        fingerprint: device_fingerprint,
      });
      return res.status(403).json({
        error: 'Conta excluída. Entre em contato com o suporte através de contato@vidamagica.com.br.',
        code: 'BANIDO',
      });
    }

    let usuario = await buscarUsuarioPorTelefone(tel);
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Status='banido' (sem cair em vínculo extra mas registro está banido):
    if (ehBanido(usuario)) {
      return res.status(403).json({
        error: 'Conta excluída. Entre em contato com o suporte através de contato@vidamagica.com.br.',
        code: 'BANIDO',
      });
    }

    // Reativação silenciosa: aluna que desativou (caminho A/B) validou
    // telefone. Restaura status + relatos + re-entrega produtos não-legado
    // via atualizacoes_pendentes (animação "Sincronizando produtos Kiwify ·
    // Vida Mágica" no /app). A aluna NÃO vê nada disso — fluxo normal.
    if (ehArquivadaPorAluna(usuario)) {
      await reativarAlunaSilenciosa(usuario.id);
      usuario = await buscarUsuarioPorTelefone(tel);
    } else if (ehLegado(usuario)) {
      // Caminho C: muda status pra 'ativa' sem mexer em mais nada. Pra aluna
      // é cadastro novo; dados antigos seguem com eh_legado=TRUE (invisíveis).
      await reativarContaLegado(usuario.id);
      usuario = await buscarUsuarioPorTelefone(tel);
    }

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

// ──────────────────────────────────────────────────────────
// 3.5. LOGIN VIA MAGIC LINK
// Aluna toca o link que recebeu no zap → cai em /auth?magic=xxx
// Frontend chama este endpoint passando { token, device_fingerprint }
// ──────────────────────────────────────────────────────────

router.post('/login-magic', async (req, res) => {
  try {
    const { token, device_fingerprint } = req.body;
    if (!token) return res.status(400).json({ error: 'Token obrigatório' });

    const registro = await validarMagicToken(token, ['magic_login', 'magic_boas_vindas']);
    if (!registro) {
      return res.status(401).json({
        error: 'Link inválido, já usado ou expirado.',
        code: 'TOKEN_INVALIDO',
      });
    }

    // ── VALIDAÇÃO DE DISPOSITIVO ────────────────────────────────────
    // Magic link só vale no MESMO dispositivo que solicitou o acesso.
    // Compara device_id do request com device_id salvo no token (herdado da
    // solicitação original via webhook). Se aluna encaminhou o link pra outro
    // dispositivo, esse outro NÃO entra.
    //
    // Se o magic token foi gerado SEM fingerprint (ex: admin disparou manual
    // via "📲 Enviar magic link"), aceita qualquer dispositivo — a aluna está
    // recebendo o link de cortesia, não amarrado a hardware.
    if (registro.device_fingerprint && registro.device_fingerprint.device_id) {
      const fpEsperado = registro.device_fingerprint.device_id;
      const fpRecebido = device_fingerprint?.device_id;
      if (!fpRecebido || fpRecebido !== fpEsperado) {
        console.warn(`[login-magic] device_id não bate (esperado=${fpEsperado} recebido=${fpRecebido || 'nenhum'}) — recusando`);
        return res.status(403).json({
          error: 'Esse link foi gerado pra outro dispositivo. Volte ao /auth no dispositivo original e peça acesso de novo.',
          code: 'DISPOSITIVO_INCORRETO',
        });
      }
    }

    const tel = registro.telefone;
    let usuario = await buscarUsuarioPorTelefone(tel);
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Banido: bloqueia (mensagem de suporte).
    const banido = await verificarBanimento({ telefone: tel });
    if (banido || ehBanido(usuario)) {
      if (banido) {
        await registrarTentativaBanido(banido.banimento_id, {
          rota: '/login-magic',
          vinculo_bateu: banido.vinculo_bateu,
          valor_bateu: banido.valor_bateu,
          ip: getIP(req),
          user_agent: req.headers['user-agent'],
          fingerprint: device_fingerprint,
        });
      }
      return res.status(403).json({
        error: 'Conta excluída. Entre em contato com o suporte através de contato@vidamagica.com.br.',
        code: 'BANIDO',
      });
    }

    // Aluna que desativou (caminho A/B): reativa silenciosamente.
    // Legado (caminho C): muda status pra ativa, dados antigos seguem invisíveis.
    // Arquivamento pelo admin: segue bloqueado (só admin desarquiva).
    if (ehArquivadaPorAluna(usuario)) {
      await reativarAlunaSilenciosa(usuario.id);
      usuario = await buscarUsuarioPorTelefone(tel);
    } else if (ehLegado(usuario)) {
      await reativarContaLegado(usuario.id);
      usuario = await buscarUsuarioPorTelefone(tel);
    } else if (usuario.arquivada || usuario.status === 'arquivada') {
      return res.status(403).json({
        error: 'Esta conta está inativa. Entre em contato com a Comunidade pra reativar.',
        code: 'CONTA_ARQUIVADA',
      });
    }

    // Tocar o magic link valida o telefone — conta vira ATIVA aqui.
    // (Pode estar 'incompleta' por origem Kiwify/manual — agora ela validou.)
    if (usuario.status !== 'ativa') {
      await marcarComoAtiva(usuario.id);
      usuario.status = 'ativa';
    }

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
      diasExpiracao: 30,
    });

    // Sinaliza pro frontend se cadastro ainda está incompleto (precisa completar)
    const cadastroIncompleto = !usuario.nome || !usuario.email || !usuario.senha_hash;
    console.log(`✅ Magic link login: ${tel} | ${tipo} | ${nome_amigavel} | incompleto: ${cadastroIncompleto}`);

    res.json({
      success: true,
      access_token,
      refresh_token,
      expires_in: 900,
      usuario: resUsuario(usuario),
      dispositivo: { tipo, nome: nome_amigavel },
      cadastroIncompleto,
      tipo_login: registro.tipo,  // 'magic_login' ou 'magic_boas_vindas'
    });
  } catch (err) {
    console.error('❌ /login-magic:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 3.6. PREPARAR ACESSO (botão "Solicite entrar pelo seu Whatsapp")
// Gera token de 5min, retorna {token, wa_url, mensagem_pre}
// Aluna toca → abre wa.me com texto contendo o token → manda zap
// Webhook do Evolution recebe → valida token + telefone → enfileira magic link
// ──────────────────────────────────────────────────────────

const NUMERO_COMUNIDADE = process.env.WA_COMUNIDADE_NUMERO || '5562999884411';

// ──────────────────────────────────────────────────────────
// 3.6.b. PREPARAR RECUPERAÇÃO DE SENHA (botão "Esqueci minha senha")
//
// Espelho do /preparar-acesso. A única diferença é que grava intent=
// 'reset_senha' na solicitação. Quando o webhook receber o zap dela, vai
// gerar magic token tipo 'reset_senha' (em vez de magic_login) e enviar
// template reset_senha_msg1 com URL `?token=...` que cai na tela de
// definir nova senha (t-nova-senha), não no /app direto.
//
// IMPORTANTE: NÃO envia mensagem via gateway aqui. A aluna SEMPRE inicia
// a conversa (regra inviolável de auth). O backend só prepara o token.
// ──────────────────────────────────────────────────────────
router.post('/preparar-recuperacao', async (req, res) => {
  try {
    const { telefone, device_fingerprint } = req.body;
    if (!telefone) return res.status(400).json({ error: 'Telefone obrigatório' });

    const tel = formatarTelefone(telefone);
    if (!tel || tel.length < 12 || tel.length > 14) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }

    // Rate limit dedicado pra recuperação (mais restritivo, 3 em 5min).
    if (!checarRate(`prep-recuperacao:${tel}`, 3, 300000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 5 minutos.' });
    }

    // Banido: bloqueia antes (mesma proteção do /preparar-acesso).
    const banidoPrep = await verificarBanimento({ telefone: tel });
    if (banidoPrep) {
      await registrarTentativaBanido(banidoPrep.banimento_id, {
        rota: '/preparar-recuperacao',
        vinculo_bateu: banidoPrep.vinculo_bateu,
        valor_bateu: banidoPrep.valor_bateu,
        ip: getIP(req),
        user_agent: req.headers['user-agent'],
        fingerprint: device_fingerprint,
      });
      return res.status(403).json({
        error: 'Conta excluída. Entre em contato com o suporte através de contato@vidamagica.com.br.',
        code: 'BANIDO',
      });
    }

    // ⚠️ NÃO confirma se a conta existe. Resposta sempre genérica por
    // segurança. Mesmo se telefone não tem conta, gera o token e o wa_url
    // normalmente. Quando ela mandar o zap, o webhook simplesmente não
    // vai achar conta e ignora — silencioso.
    const sol = await criarSolicitacaoAcesso(tel, 5, device_fingerprint || null, { intent: 'reset_senha' });

    const mensagemPre =
      `Esqueci minha senha\n` +
      `Solicitação de Recuperação · ${sol.token}`;

    const waUrl = `https://wa.me/${NUMERO_COMUNIDADE}?text=${encodeURIComponent(mensagemPre)}`;

    res.json({
      success: true,
      token: sol.token,
      wa_url: waUrl,
      expira_em: sol.expira_em,
      ttl_segundos: 300,
    });
  } catch (err) {
    console.error('❌ /preparar-recuperacao:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/preparar-acesso', async (req, res) => {
  try {
    const { telefone, device_fingerprint } = req.body;
    if (!telefone) return res.status(400).json({ error: 'Telefone obrigatório' });

    const tel = formatarTelefone(telefone);
    if (!tel || tel.length < 12 || tel.length > 14) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }

    // Rate limit por telefone (impede abuse)
    if (!checarRate(`prep-acesso:${tel}`, 5, 60000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    }

    // Banido: bloqueia antes de gerar token (evita mandar a aluna pro
    // WhatsApp pensando que vai acontecer algo). Webhook tb tem proteção,
    // mas falhar cedo é melhor UX.
    const banidoPrep = await verificarBanimento({ telefone: tel });
    if (banidoPrep) {
      await registrarTentativaBanido(banidoPrep.banimento_id, {
        rota: '/preparar-acesso',
        vinculo_bateu: banidoPrep.vinculo_bateu,
        valor_bateu: banidoPrep.valor_bateu,
        ip: getIP(req),
        user_agent: req.headers['user-agent'],
        fingerprint: device_fingerprint,
      });
      return res.status(403).json({
        error: 'Conta excluída. Entre em contato com o suporte através de contato@vidamagica.com.br.',
        code: 'BANIDO',
      });
    }

    // Salva fingerprint do dispositivo que está pedindo. Magic link gerado
    // pelo webhook herda isso. /login-magic valida match — link só funciona
    // no dispositivo que pediu.
    const sol = await criarSolicitacaoAcesso(tel, 5, device_fingerprint || null);

    const mensagemPre =
      `Quero entrar no Vida Mágica\n` +
      `Solicitação de Magic Link · ${sol.token}`;

    const waUrl = `https://wa.me/${NUMERO_COMUNIDADE}?text=${encodeURIComponent(mensagemPre)}`;

    res.json({
      success: true,
      token: sol.token,
      wa_url: waUrl,
      expira_em: sol.expira_em,
      ttl_segundos: 300,
    });
  } catch (err) {
    console.error('❌ /preparar-acesso:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 3.7. AGUARDANDO (polling do frontend)
// Frontend chama a cada 2s pra saber se o webhook já recebeu o zap dela.
// Status:
//   'aguardando' → token existe, ainda não usado, dentro do prazo
//   'enviado'    → token foi usado, magic link já foi mandado pra ela
//   'expirado'   → token venceu sem ser usado
//   'invalido'   → token não existe (sumiu ou nunca foi criado)
// ──────────────────────────────────────────────────────────

router.get('/aguardando/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token obrigatório' });

    const sol = await buscarSolicitacaoPorToken(token);
    if (!sol) return res.json({ status: 'invalido' });

    if (sol.usado) {
      return res.json({
        status: 'enviado',
        webhook_recebido_em: sol.webhook_recebido_em,
      });
    }

    if (new Date(sol.expira_em) <= new Date()) {
      return res.json({ status: 'expirado' });
    }

    res.json({ status: 'aguardando' });
  } catch (err) {
    console.error('❌ /aguardando:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 4. VERIFICAR OTP DE EMAIL
// ──────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────
// 5. RENOVAR ACCESS TOKEN
// ──────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────
// 6. COMPLETAR / ATUALIZAR PERFIL
// ──────────────────────────────────────────────────────────

router.put('/perfil', autenticar, async (req, res) => {
  try {
    const {
      nome, email, senha, senha_atual, foto_url,
      nome_preferencia, genero, ocupacao, cpf, data_nascimento,
    } = req.body;
    const campos = {};

    if (nome !== undefined) campos.nome = (nome || '').trim() || null;
    if (email) campos.email = email.trim().toLowerCase();
    if (senha) {
      if (senha.length < 6) return res.status(400).json({ error: 'Senha mínima: 6 caracteres' });
      // Se aluna já tem senha, exige `senha_atual` pra trocar (anti-sequestro
      // de sessão). Aluna que só usa OTP pode definir senha pela primeira vez
      // sem confirmar — senha_hash é null, então não há o que confirmar.
      const r = await poolCore.query(`SELECT senha_hash FROM usuarios WHERE id=$1`, [req.usuario.sub]);
      const hashAtual = r.rows[0]?.senha_hash || null;
      if (hashAtual) {
        if (!senha_atual) return res.status(400).json({ error: 'Informe sua senha atual' });
        const ok = await bcrypt.compare(senha_atual, hashAtual);
        if (!ok) return res.status(400).json({ error: 'Senha atual incorreta' });
      }
      campos.senha_hash = await bcrypt.hash(senha, 12);
    }
    // foto_url: aceita URL do Cloudinary (do POST /api/upload/imagem) ou null pra remover.
    if (foto_url !== undefined) campos.foto_url = foto_url || null;

    // Campos do perfil pessoal — Informações do meu perfil (Seção 2026-05-20).
    if (nome_preferencia !== undefined) campos.nome_preferencia = (nome_preferencia || '').trim() || null;
    if (genero !== undefined) {
      const g = (genero || '').toLowerCase();
      if (g && !['feminino', 'masculino', 'outro'].includes(g)) {
        return res.status(400).json({ error: 'Gênero inválido' });
      }
      campos.genero = g || null;
    }
    if (ocupacao !== undefined) campos.ocupacao = (ocupacao || '').trim().slice(0, 500) || null;
    if (cpf !== undefined) {
      // Aceita vazio (limpa) OU com formato. Normaliza pra dígitos puros.
      const c = (cpf || '').replace(/\D/g, '');
      campos.cpf = c || null;
    }
    if (data_nascimento !== undefined) {
      // Aceita YYYY-MM-DD ou vazio
      const d = (data_nascimento || '').trim();
      campos.data_nascimento = d || null;
    }

    if (!Object.keys(campos).length) return res.status(400).json({ error: 'Nada para atualizar' });
    // Mudou email? Reseta verificação (precisa re-verificar via OTP por email)
    if (campos.email) campos.email_verificado = false;

    const usuario = await atualizarUsuario(req.usuario.sub, campos);
    res.json({ success: true, usuario: resUsuario(usuario) });
  } catch (err) {
    console.error('❌ /perfil:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 7. LOGIN COM SENHA
// ──────────────────────────────────────────────────────────

router.post('/login-senha', async (req, res) => {
  try {
    const { identificador, telefone, senha, device_fingerprint } = req.body;

    const id = (identificador || telefone || '').trim();
    if (!id || !senha) {
      return res.status(400).json({ error: 'Informe seu WhatsApp ou e-mail e sua senha.' });
    }

    if (!checarRate(`senha:${id}`, 5, 120000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 2 minutos.' });
    }

    let usuario = await buscarUsuarioPorIdentificador(id);

    if (!usuario) {
      return res.status(401).json({ error: 'Dados incorretos. Verifique seu WhatsApp/e-mail e a senha.' });
    }

    // Aluna existe mas nunca definiu senha (caso transitório do legado).
    // Frontend trata esse code mostrando opção de receber magic link pra
    // completar o cadastro / definir senha.
    if (!usuario.senha_hash) {
      return res.status(401).json({
        error: 'Você ainda não definiu uma senha. Entre pelo WhatsApp pra criar a sua.',
        code: 'SEM_SENHA',
      });
    }

    const ok = await bcrypt.compare(senha, usuario.senha_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Dados incorretos. Verifique seu WhatsApp/e-mail e a senha.' });
    }

    // Banido: mensagem de suporte.
    const banidoLogin = await verificarBanimento({
      telefone: usuario.telefone,
      email: usuario.email,
      cpf: usuario.cpf,
    });
    if (banidoLogin || ehBanido(usuario)) {
      if (banidoLogin) {
        await registrarTentativaBanido(banidoLogin.banimento_id, {
          rota: '/login-senha',
          vinculo_bateu: banidoLogin.vinculo_bateu,
          valor_bateu: banidoLogin.valor_bateu,
          ip: getIP(req),
          user_agent: req.headers['user-agent'],
          fingerprint: device_fingerprint,
        });
      }
      return res.status(403).json({
        error: 'Conta excluída. Entre em contato com o suporte através de contato@vidamagica.com.br.',
        code: 'BANIDO',
      });
    }

    // Aluna que desativou (caminho A/B) sabe a senha → reativa silenciosa.
    // Legado (caminho C) → reativa silencioso pra legado (sem animação).
    // Arquivamento pelo admin segue bloqueado.
    if (ehArquivadaPorAluna(usuario)) {
      await reativarAlunaSilenciosa(usuario.id);
      usuario = await buscarUsuarioPorIdentificador(id);
    } else if (ehLegado(usuario)) {
      await reativarContaLegado(usuario.id);
      usuario = await buscarUsuarioPorIdentificador(id);
    } else if (usuario.arquivada || usuario.status === 'arquivada') {
      return res.status(403).json({
        error: 'Esta conta está inativa. Entre em contato com a Comunidade pra reativar.',
        code: 'CONTA_ARQUIVADA',
      });
    }

    if (usuario.status === 'incompleta') {
      return res.status(403).json({
        error: 'Sua conta ainda não foi ativada. Solicite seu acesso pelo WhatsApp.',
        code: 'CONTA_INCOMPLETA',
      });
    }

    const ua = req.headers['user-agent'] || '';
    const tipo = detectarTipo(ua);
    const device_id = device_fingerprint?.device_id || uuidv4();
    const ip = getIP(req);

    // Limite 1 mobile + 1 desktop
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

// ──────────────────────────────────────────────────────────
// 9. REDEFINIR SENHA (via magic token tipo 'reset_senha')
//
// Fluxo único: a aluna passou pelo /preparar-recuperacao → mandou zap →
// webhook gerou magic token reset_senha em otp_tokens → ela toca no link
// → cai em /auth?token=... → tela t-nova-senha → POST aqui.
// ──────────────────────────────────────────────────────────

router.post('/redefinir-senha', async (req, res) => {
  try {
    const { token, nova_senha, device_fingerprint } = req.body;
    if (!token || !nova_senha) return res.status(400).json({ error: 'Token e nova senha obrigatórios' });
    if (nova_senha.length < 8) return res.status(400).json({ error: 'Senha mínima: 8 caracteres' });

    // Magic token reset_senha em otp_tokens. Tem device_fingerprint herdado
    // da solicitação — link só vale no MESMO dispositivo que pediu.
    const magic = await validarMagicToken(token, ['reset_senha']);
    if (!magic) {
      return res.status(401).json({ error: 'Link inválido ou expirado. Solicite um novo.' });
    }
    if (magic.device_fingerprint && magic.device_fingerprint.device_id) {
      const fpEsperado = magic.device_fingerprint.device_id;
      const fpRecebido = device_fingerprint?.device_id;
      if (!fpRecebido || fpRecebido !== fpEsperado) {
        console.warn(`[redefinir-senha] device_id não bate — recusando`);
        return res.status(403).json({
          error: 'Esse link foi gerado pra outro dispositivo. Volte ao /auth no dispositivo original e peça recuperação de novo.',
          code: 'DISPOSITIVO_INCORRETO',
        });
      }
    }

    let usuario = null;
    try {
      const r = await poolCore.query(
        `SELECT * FROM usuarios WHERE telefone=$1 OR telefone_formatado=$1 LIMIT 1`,
        [magic.telefone]
      );
      usuario = r.rows[0] || null;
    } catch (_) {
      return res.status(500).json({ error: 'Erro interno' });
    }

    if (!usuario) return res.status(401).json({ error: 'Link inválido ou expirado. Solicite um novo.' });

    const senha_hash = await bcrypt.hash(nova_senha, 12);
    const updated = await atualizarUsuario(usuario.id, { senha_hash });

    await revogarTodasSessoesUsuario(usuario.id);

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

// ──────────────────────────────────────────────────────────
// 10. LOGOUT
// ──────────────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) await revogarSessao(refresh_token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 10.5. TROCAR TELEFONE (aluna logada)
// Reusa o trilho de magic link via WhatsApp que já existe:
//  1. Aluna logada chama POST /perfil/trocar-telefone-iniciar { novo_telefone }
//  2. Backend cria acesso_solicitacoes com intent='trocar_telefone',
//     usuario_id=aluna, telefone=NOVO_telefone, gera wa_url
//  3. Aluna abre wa.me do NOVO número, envia zap pra Suellen com o token
//  4. Webhook (routes/webhook-evolution.js) reconhece intent='trocar_telefone'
//     e gera magic link tipo='magic_trocar_telefone' pro NOVO número
//  5. Aluna toca link → POST /perfil/trocar-telefone-confirmar
//  6. Backend valida e executa trocarTelefonePrincipal — telefone antigo
//     vai pra telefones_historicos.ativo=TRUE (preserva histórico)
// ──────────────────────────────────────────────────────────

router.post('/perfil/trocar-telefone-iniciar', autenticar, async (req, res) => {
  try {
    const { novo_telefone, device_fingerprint } = req.body || {};
    if (!novo_telefone) return res.status(400).json({ error: 'Novo telefone obrigatório' });

    const novoTel = formatarTelefone(novo_telefone);
    if (!novoTel || novoTel.length < 12 || novoTel.length > 14) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }

    // Não deixar trocar pro mesmo número
    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id=$1`, [req.usuario.sub]);
    if (!u.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (u.rows[0].telefone === novoTel) {
      return res.status(400).json({ error: 'Esse já é seu telefone atual' });
    }

    // Banimento por vínculo no novo número
    const banido = await verificarBanimento({ telefone: novoTel });
    if (banido) {
      await registrarTentativaBanido(banido.banimento_id, {
        rota: '/perfil/trocar-telefone-iniciar',
        vinculo_bateu: banido.vinculo_bateu,
        valor_bateu: banido.valor_bateu,
        ip: getIP(req),
        user_agent: req.headers['user-agent'],
        fingerprint: device_fingerprint,
      });
      return res.status(403).json({
        error: 'Não conseguimos validar esse telefone. Entre em contato com o suporte.',
        code: 'BANIDO',
      });
    }

    // Telefone novo já pertence a OUTRA conta ativa? bloqueia
    const dono = await poolCore.query(
      `SELECT id FROM usuarios WHERE telefone=$1 AND id<>$2`,
      [novoTel, req.usuario.sub]
    );
    if (dono.rows.length) {
      return res.status(409).json({
        error: 'Esse telefone já está vinculado a outra conta.',
        code: 'TELEFONE_EM_USO',
      });
    }

    if (!checarRate(`troca-tel:${req.usuario.sub}`, 5, 60000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
    }

    // Cria solicitação com intent específico — webhook reconhece pela coluna intent
    const sol = await criarSolicitacaoAcesso(novoTel, 5, device_fingerprint || null, {
      intent: 'trocar_telefone',
      usuario_id: req.usuario.sub,
    });

    const mensagemPre =
      `Quero alterar meu telefone no Vida Mágica\n` +
      `Confirmação · ${sol.token}`;
    const waUrl = `https://wa.me/${NUMERO_COMUNIDADE}?text=${encodeURIComponent(mensagemPre)}`;

    res.json({
      success: true,
      token: sol.token,
      wa_url: waUrl,
      expira_em: sol.expira_em,
      ttl_segundos: 300,
      novo_telefone: novoTel,
    });
  } catch (err) {
    console.error('❌ /perfil/trocar-telefone-iniciar:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/perfil/trocar-telefone-confirmar', autenticar, async (req, res) => {
  try {
    const { token, device_fingerprint } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Token obrigatório' });

    const registro = await validarMagicToken(token, ['magic_trocar_telefone']);
    if (!registro) {
      return res.status(401).json({
        error: 'Link inválido, já usado ou expirado.',
        code: 'TOKEN_INVALIDO',
      });
    }

    // Confere fingerprint (mesma regra do /login-magic)
    if (registro.device_fingerprint && registro.device_fingerprint.device_id) {
      const fpEsperado = registro.device_fingerprint.device_id;
      const fpRecebido = device_fingerprint?.device_id;
      if (!fpRecebido || fpRecebido !== fpEsperado) {
        return res.status(403).json({
          error: 'Esse link foi gerado pra outro dispositivo.',
          code: 'DISPOSITIVO_INCORRETO',
        });
      }
    }

    const novoTel = registro.telefone;
    // Executa a troca usando o helper existente — preserva histórico
    const { trocarTelefonePrincipal } = require('../core/usuarios');
    await trocarTelefonePrincipal(req.usuario.sub, novoTel, novoTel);

    const usuario = await buscarUsuarioPorId(req.usuario.sub);
    res.json({ success: true, usuario: resUsuario(usuario) });
  } catch (err) {
    console.error('❌ /perfil/trocar-telefone-confirmar:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 11. EXCLUIR CONTA (vocabulário pra aluna)
// Aluna NUNCA apaga de verdade — arquiva (caminho A/B) ou vai pra legado
// (caminho C). Apenas admin tem "Apagar permanentemente" (DELETE em cascata).
//
// Body (espelha os 2 slides do modal de "Desativar conta"):
//   - deseja_excluir: boolean (slide 1 — "Deseja excluir [Jornada, Materiais,
//     Relatos]?"). Se TRUE, dispara legado nesses blocos.
//   - deletar_dados_pessoais: boolean (slide 2 — só faz sentido com slide 1=Sim).
//     TRUE = status='legado' (cadastro novo no retorno). FALSE = status=
//     'arquivada' (reativa silenciosa via OTP).
//   - motivo: string opcional, vem do textarea/rádio do slide 1.
// ──────────────────────────────────────────────────────────

router.post('/excluir-conta', autenticar, async (req, res) => {
  try {
    const { motivo, deseja_excluir, deletar_dados_pessoais } = req.body || {};
    await arquivarUsuario(req.usuario.sub, {
      por: 'aluna',
      motivo: motivo ? String(motivo).slice(0, 500) : null,
      deseja_excluir: !!deseja_excluir,
      deletar_dados_pessoais: !!deletar_dados_pessoais,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /excluir-conta:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/logout-todos', autenticar, async (req, res) => {
  try {
    await revogarTodasSessoesUsuario(req.usuario.sub);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 12. LISTAR DISPOSITIVOS
// ──────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────
// 14. ME
// ──────────────────────────────────────────────────────────

router.get('/me', autenticar, async (req, res) => {
  try {
    const usuario = await buscarUsuarioPorId(req.usuario.sub);
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(resUsuario(usuario));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// 15. TESTES — lista testes de prosperidade da aluna
// ──────────────────────────────────────────────────────────

router.get('/testes', autenticar, async (req, res) => {
  try {
    const { poolTeste } = require('../db');

    // O teste pode ter sido feito ANTES do cadastro (lead anônimo, identificado
    // só por telefone). Pra cobrir esses casos, busca por usuario_id OU pelo
    // telefone canônico do usuário logado. Em `usuarios`, o telefone JÁ é o
    // canônico (E.164 sem +) — a coluna é só `telefone`, não `telefone_canonico`.
    const usuario = await buscarUsuarioPorId(req.usuario.sub);
    const telefone = usuario?.telefone || null;

    const r = await poolTeste.query(
      `SELECT id, perfil_dominante, percentual_prosperidade, nivel_prosperidade,
              respostas, contagem, percentuais, feito_em, visto_em, ativou_trilha, pago
       FROM testes
       WHERE usuario_id = $1
          OR ($2::text IS NOT NULL AND telefone_canonico = $2)
       ORDER BY feito_em DESC NULLS LAST`,
      [req.usuario.sub, telefone]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('❌ /testes:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
