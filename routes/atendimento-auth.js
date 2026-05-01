/* ============================================================
   VIDA MÁGICA — routes/atendimento-auth.js
   Login do painel de atendimento.

   POST /api/atendimento/login
     Body: { senha }
     Valida com process.env.ADMIN_PASSWORD.
     Retorna JWT com role 'atendimento'.

   Banco: nenhum (auth via env vars).
   ============================================================ */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

router.post('/login', async (req, res) => {
  try {
    const { senha } = req.body || {};
    if (!senha) return res.status(400).json({ error: 'Senha obrigatória' });
    if (senha !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }
    const token = jwt.sign(
      { role: 'atendimento', sub: 'admin' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token });
  } catch (err) {
    console.error('❌ /atendimento/login:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
