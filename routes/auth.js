/* ============================================================
   VIDA MÁGICA — routes/auth.js
   Módulo de identidade: OTP, login, refresh, dispositivos.

   Banco: poolCore (usuarios, otp_tokens, dispositivos, sessoes).

   Fluxo OTP:
     1) POST /api/auth/otp/solicitar { telefone }
        - Cria OTP de 6 dígitos, expira em 5min
        - Envia via WhatsApp (Evolution)
     2) POST /api/auth/otp/validar { telefone, codigo, device_id, tipo }
        - Valida OTP, cria/recupera usuário
        - Cria/atualiza dispositivo e sessão
        - Retorna { access, refresh, usuario }
     3) POST /api/auth/refresh { refresh_token }
        - Renova access token (15min)
     4) POST /api/auth/logout { refresh_token }
        - Revoga sessão

   Regras:
     - Telefone sempre canônico (formatarTelefone) antes de gravar/buscar.
     - Access token: 15min. Refresh token: 30 dias.
     - 1 dispositivo por tipo (mobile/desktop) por usuário.
     - 5 tentativas máximas de OTP antes de invalidar.
   ============================================================ */

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();

const { poolCore } = require('../db');
const { formatarTelefone, telefoneValido } = require('../core/utils');
const { enviarTexto } = require('../core/whatsapp');
const { autenticar } = require('../middleware/autenticar');

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_EXPIRA = '15m';
const REFRESH_DIAS = 30;
const OTP_EXPIRA_MIN = 5;
const OTP_MAX_TENTATIVAS = 5;

// ── HELPERS ────────────────────────────────────────────────

function gerarOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function gerarRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

function gerarAccessToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, telefone: usuario.telefone, nome: usuario.nome },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRA }
  );
}

function dataDaqui(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d;
}

// ── 1. SOLICITAR OTP ────────────────────────────────────────

router.post('/otp/solicitar', async (req, res) => {
  try {
    const { telefone } = req.body;
    if (!telefone) return res.status(400).json({ error: 'Telefone obrigatório' });

    const tel = formatarTelefone(telefone);
    if (!telefoneValido(tel)) return res.status(400).json({ error: 'Telefone inválido' });

    // Invalida OTPs anteriores não usados
    await poolCore.query(
      `UPDATE otp_tokens SET usado = TRUE WHERE telefone = $1 AND usado = FALSE`,
      [tel]
    );

    const codigo = gerarOTP();
    const expira = new Date(Date.now() + OTP_EXPIRA_MIN * 60 * 1000);

    await poolCore.query(
      `INSERT INTO otp_tokens (telefone, codigo, expira_em) VALUES ($1, $2, $3)`,
      [tel, codigo, expira]
    );

    const mensagem =
      `🔐 Vida Mágica — código de acesso\n\n` +
      `${codigo}\n\n` +
      `Esse código expira em ${OTP_EXPIRA_MIN} minutos.\n` +
      `Se você não solicitou, ignore esta mensagem.`;

    const enviado = await enviarTexto(tel, mensagem);
    if (!enviado) {
      return res.status(502).json({ error: 'Falha ao enviar código pelo WhatsApp' });
    }

    res.json({ success: true, telefone: tel, expira_em_segundos: OTP_EXPIRA_MIN * 60 });
  } catch (err) {
    console.error('❌ /otp/solicitar:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 2. VALIDAR OTP ──────────────────────────────────────────

router.post('/otp/validar', async (req, res) => {
  const c = await poolCore.connect();
  try {
    const { telefone, codigo, device_id, tipo, fingerprint, nome_amigavel } = req.body;
    if (!telefone || !codigo) return res.status(400).json({ error: 'Telefone e código obrigatórios' });
    if (!device_id) return res.status(400).json({ error: 'device_id obrigatório' });
    if (!['mobile', 'desktop'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo deve ser mobile ou desktop' });
    }

    const tel = formatarTelefone(telefone);

    await c.query('BEGIN');

    // Busca OTP válido
    const r = await c.query(
      `SELECT id, codigo, tentativas FROM otp_tokens
       WHERE telefone = $1 AND usado = FALSE AND expira_em > NOW()
       ORDER BY criado_em DESC LIMIT 1`,
      [tel]
    );

    if (!r.rows.length) {
      await c.query('ROLLBACK');
      return res.status(400).json({ error: 'Código expirado ou não solicitado' });
    }

    const otp = r.rows[0];

    if (otp.tentativas >= OTP_MAX_TENTATIVAS) {
      await c.query(`UPDATE otp_tokens SET usado = TRUE WHERE id = $1`, [otp.id]);
      await c.query('COMMIT');
      return res.status(400).json({ error: 'Muitas tentativas. Solicite um novo código.' });
    }

    if (String(codigo).trim() !== otp.codigo) {
      await c.query(`UPDATE otp_tokens SET tentativas = tentativas + 1 WHERE id = $1`, [otp.id]);
      await c.query('COMMIT');
      return res.status(400).json({ error: 'Código incorreto' });
    }

    // OTP válido — marca como usado
    await c.query(`UPDATE otp_tokens SET usado = TRUE WHERE id = $1`, [otp.id]);

    // Cria ou recupera usuário
    let usuario;
    const u = await c.query(`SELECT * FROM usuarios WHERE telefone = $1`, [tel]);
    if (u.rows.length) {
      usuario = u.rows[0];
    } else {
      const novo = await c.query(
        `INSERT INTO usuarios (telefone, telefone_formatado)
         VALUES ($1, $1) RETURNING *`,
        [tel]
      );
      usuario = novo.rows[0];
    }

    // Upsert dispositivo
    const dev = await c.query(
      `INSERT INTO dispositivos (usuario_id, tipo, device_id, fingerprint, nome_amigavel, ip_primeiro_acesso, ultimo_acesso, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), TRUE)
       ON CONFLICT (usuario_id, tipo) DO UPDATE SET
         device_id = EXCLUDED.device_id,
         fingerprint = EXCLUDED.fingerprint,
         nome_amigavel = COALESCE(EXCLUDED.nome_amigavel, dispositivos.nome_amigavel),
         ultimo_acesso = NOW(),
         ativo = TRUE
       RETURNING id`,
      [usuario.id, tipo, device_id, fingerprint || null, nome_amigavel || null, req.ip || null]
    );
    const dispositivoId = dev.rows[0].id;

    // Cria sessão (refresh token)
    const refreshToken = gerarRefreshToken();
    const expiraRefresh = dataDaqui(REFRESH_DIAS);

    await c.query(
      `INSERT INTO sessoes (usuario_id, device_id, refresh_token, ip, user_agent, expira_em)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuario.id, dispositivoId, refreshToken, req.ip || null, req.headers['user-agent'] || null, expiraRefresh]
    );

    const accessToken = gerarAccessToken(usuario);

    await c.query('COMMIT');

    res.json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      usuario: {
        id: usuario.id,
        telefone: usuario.telefone,
        nome: usuario.nome,
        email: usuario.email,
        foto_url: usuario.foto_url,
        plano: usuario.plano,
        sementes: usuario.sementes,
        estagio_arvore: usuario.estagio_arvore,
        perfil_teste: usuario.perfil_teste,
      },
    });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('❌ /otp/validar:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  } finally {
    c.release();
  }
});

// ── 3. REFRESH ──────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token obrigatório' });

    const r = await poolCore.query(
      `SELECT s.*, u.id AS uid, u.telefone, u.nome
         FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.refresh_token = $1 AND s.revogada = FALSE AND s.expira_em > NOW()`,
      [refresh_token]
    );

    if (!r.rows.length) return res.status(401).json({ error: 'Refresh token inválido ou expirado' });

    const s = r.rows[0];
    const usuario = { id: s.uid, telefone: s.telefone, nome: s.nome };
    const accessToken = gerarAccessToken(usuario);

    await poolCore.query(`UPDATE sessoes SET ultimo_uso = NOW() WHERE id = $1`, [s.id]);

    res.json({ success: true, access_token: accessToken });
  } catch (err) {
    console.error('❌ /refresh:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 4. LOGOUT ───────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token obrigatório' });
    await poolCore.query(
      `UPDATE sessoes SET revogada = TRUE WHERE refresh_token = $1`,
      [refresh_token]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /logout:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 5. ME (dados do usuário logado) ─────────────────────────

router.get('/me', autenticar, async (req, res) => {
  try {
    const r = await poolCore.query(
      `SELECT id, telefone, nome, email, foto_url, plano, plano_expira_em,
              perfil_teste, percentual_prosperidade, sementes, estagio_arvore,
              criado_em
         FROM usuarios WHERE id = $1`,
      [req.usuario.sub]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ usuario: r.rows[0] });
  } catch (err) {
    console.error('❌ /me:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 6. ATUALIZAR PERFIL ─────────────────────────────────────

router.put('/me', autenticar, async (req, res) => {
  try {
    const { nome, email, foto_url } = req.body;
    const r = await poolCore.query(
      `UPDATE usuarios SET
         nome = COALESCE($1, nome),
         email = COALESCE($2, email),
         foto_url = COALESCE($3, foto_url),
         atualizado_em = NOW()
       WHERE id = $4
       RETURNING id, telefone, nome, email, foto_url, plano, sementes, estagio_arvore`,
      [nome ?? null, email ?? null, foto_url ?? null, req.usuario.sub]
    );
    res.json({ success: true, usuario: r.rows[0] });
  } catch (err) {
    console.error('❌ PUT /me:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 7. LISTAR DISPOSITIVOS ──────────────────────────────────

router.get('/dispositivos', autenticar, async (req, res) => {
  try {
    const r = await poolCore.query(
      `SELECT id, tipo, nome_amigavel, ip_primeiro_acesso, ultimo_acesso, ativo, criado_em
         FROM dispositivos WHERE usuario_id = $1 ORDER BY ultimo_acesso DESC`,
      [req.usuario.sub]
    );
    res.json({ dispositivos: r.rows });
  } catch (err) {
    console.error('❌ /dispositivos:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── 8. REVOGAR DISPOSITIVO ──────────────────────────────────

router.delete('/dispositivos/:id', autenticar, async (req, res) => {
  try {
    await poolCore.query(
      `UPDATE dispositivos SET ativo = FALSE WHERE id = $1 AND usuario_id = $2`,
      [req.params.id, req.usuario.sub]
    );
    await poolCore.query(
      `UPDATE sessoes SET revogada = TRUE WHERE device_id = $1 AND usuario_id = $2`,
      [req.params.id, req.usuario.sub]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('❌ DELETE /dispositivos:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
