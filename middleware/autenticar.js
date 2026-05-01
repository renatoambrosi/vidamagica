/* ============================================================
   VIDA MÁGICA — middleware/autenticar.js
   Middleware JWT para proteger rotas da aluna.

   Banco: nenhum (apenas valida assinatura JWT).

   Como usar nas rotas:
     const { autenticar } = require('../middleware/autenticar');
     router.get('/me', autenticar, (req, res) => { req.usuario.id ... });
   ============================================================ */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET não configurado — autenticação não vai funcionar');
}

/**
 * Middleware que valida o access token (Bearer) e popula req.usuario.
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
 * Middleware Basic Auth para rotas administrativas.
 * Lê ADMIN_USER e ADMIN_PASSWORD do ambiente.
 */
function autenticarAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Acesso negado');
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Usuário ou senha incorretos');
}

module.exports = { autenticar, autenticarAdmin };
