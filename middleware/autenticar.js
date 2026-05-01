/* ============================================================
   VIDA MÁGICA — middleware/autenticar.js
   3 middlewares de autenticação:

   - autenticar          → aluna (JWT Bearer, role implícito)
   - autenticarAdmin     → admin (Basic Auth, sem WWW-Authenticate)
   - autenticarAtendimento → painel atendimento (JWT Bearer com role 'atendimento')

   Todos retornam 401 JSON simples (sem WWW-Authenticate).
   Navegador NUNCA abre popup nativo.
   ============================================================ */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET não configurado — autenticação não vai funcionar');
}

/**
 * Aluna — JWT Bearer.
 */
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

/**
 * Admin — Basic Auth (sem popup nativo).
 */
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

/**
 * Atendimento — JWT Bearer com role 'atendimento' ou 'suellen' (compat).
 */
function autenticarAtendimento(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token obrigatório' });
  }
  const token = auth.slice(7).trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'atendimento' && payload.role !== 'suellen') {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    req.atendimento = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = { autenticar, autenticarAdmin, autenticarAtendimento, JWT_SECRET };
