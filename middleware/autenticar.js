/* ============================================================
   VIDA MÁGICA — middleware/autenticar.js
   Middlewares de autenticação.

   PADRÃO ÚNICO:
   - Aluna: JWT (Bearer) → autenticar
   - Admin: Basic Auth, retorna 401 JSON (sem WWW-Authenticate).
            Navegador NUNCA abre popup nativo. Cada tela admin
            tem login próprio que envia o header Authorization Basic.
   ============================================================ */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET não configurado — autenticação não vai funcionar');
}

/**
 * Valida access token (Bearer) e popula req.usuario.
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
 * Basic Auth admin — sem WWW-Authenticate.
 * Navegador NÃO abre popup. Tela admin trata o 401 sozinha.
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

module.exports = { autenticar, autenticarAdmin };
