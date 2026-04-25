const jwt = require('jsonwebtoken');
const { buscarUsuarioPorId } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'vida-magica-secret-troque-em-producao';

// ── Gera access token (15 min) ──
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

// ── Middleware: verifica access token no header Authorization ──
function autenticar(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token ausente' });
  }
  const token = header.split(' ')[1];
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

// ── Middleware: autenticação opcional (não bloqueia se não tiver token) ──
function autenticarOpcional(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    req.usuario = jwt.verify(header.split(' ')[1], JWT_SECRET);
  } catch (_) {}
  next();
}

// ── Middleware: exige plano mínimo ──
function exigirPlano(...planos) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Não autenticado' });
    if (!planos.includes(req.usuario.plano)) {
      return res.status(403).json({
        error: 'Plano insuficiente',
        plano_atual: req.usuario.plano,
        planos_necessarios: planos,
        code: 'PLANO_INSUFICIENTE'
      });
    }
    next();
  };
}

module.exports = { gerarAccessToken, autenticar, autenticarOpcional, exigirPlano, JWT_SECRET };
