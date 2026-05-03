/* ============================================================
   VIDA MÁGICA — middleware/autenticar.js
   Middlewares de autenticação:

   - autenticar (aluna)              → JWT Bearer
   - autenticarPainel(escopo)        → JWT Bearer com role='admin' e escopo
                                        ('admin' ou 'atendimento')
   - autenticarAdmin (Basic legado)  → mantido pro caso de algum endpoint
                                        ainda usar Basic admin/admin (depreciado)

   Todos retornam 401 JSON simples (sem WWW-Authenticate).
   Navegador NUNCA abre popup nativo.
   ============================================================ */

const jwt = require('jsonwebtoken');
const { buscarSessaoAdmin, tocarSessaoAdmin } = require('../core/admins');

const JWT_SECRET = process.env.JWT_SECRET || 'vida-magica-secret-troque-em-producao';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET não configurado — usando default inseguro');
}

/**
 * Gera access token (15 min) para a aluna.
 */
function gerarAccessToken(usuario) {
  return jwt.sign(
    {
      sub: usuario.id,
      tel: usuario.telefone_formatado,
      plano: usuario.plano,
      nome: usuario.nome,
    },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

/**
 * Gera token de painel (30 dias) para admin/atendimento.
 * Inclui sessao_id pra validação contra banco e escopo.
 */
function gerarTokenPainel({ admin_id, escopo, sessao_id }) {
  return jwt.sign(
    { sub: admin_id, role: 'admin', escopo, sid: sessao_id },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ── ALUNA ────────────────────────────────────────────────

function autenticar(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }
  const token = auth.slice(7).trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// ── PAINEL (admin/atendimento) ───────────────────────────

function autenticarPainel(escopoRequerido) {
  return async function (req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }
    const token = auth.slice(7).trim();
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Sessão expirada', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Token inválido' });
    }

    // Valida role e escopo
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (payload.escopo !== escopoRequerido) {
      return res.status(403).json({ error: 'Escopo incorreto' });
    }
    if (!payload.sid) {
      return res.status(401).json({ error: 'Token inválido (sem sessão)' });
    }

    // Valida sessão no banco (não revogada, não expirada)
    try {
      const sessao = await buscarSessaoAdmin(payload.sid);
      if (!sessao) {
        return res.status(401).json({ error: 'Sessão revogada ou expirada', code: 'SESSION_EXPIRED' });
      }
      if (sessao.escopo !== escopoRequerido) {
        return res.status(403).json({ error: 'Escopo incorreto' });
      }
      // Toca último uso (não bloqueia se falhar)
      tocarSessaoAdmin(payload.sid).catch(() => {});
      req.admin = { id: payload.sub, escopo: payload.escopo, sessao_id: payload.sid };
      next();
    } catch (err) {
      console.error('❌ autenticarPainel:', err.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  };
}

// ── BASIC AUTH LEGADO (depreciado, mantido pra retrocompatibilidade) ──

function autenticarAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  try {
    const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) {
      return next();
    }
  } catch (_) {}
  return res.status(401).json({ error: 'Não autorizado' });
}

// ── JWT ATENDIMENTO LEGADO (era usado antes da Etapa 1, mantido por enquanto) ──

function autenticarAtendimento(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token obrigatório' });
  }
  const token = auth.slice(7).trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'atendimento' && payload.role !== 'suellen' && payload.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    req.atendimento = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = {
  autenticar,
  autenticarPainel,
  autenticarAdmin,
  autenticarAtendimento,
  gerarAccessToken,
  gerarTokenPainel,
  JWT_SECRET,
};
