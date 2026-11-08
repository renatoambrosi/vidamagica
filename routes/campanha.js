/* ============================================================
   VIDA MÁGICA — routes/campanha.js
   Leitura pública da campanha do site (hoje só a Black November).
   Banco: poolComunicacao, tabela `config` (via core/campanha.js).

   Endpoint (novo, só leitura):
   - GET /api/campanha → { ativa, nome, fim }
     ativa = ligada no admin E antes da data final.

   Ligar/desligar e a data final ficam no admin (routes/admin.js,
   /api/admin/campanhas/black). Preço não passa por aqui: a Black
   usa a Promo ligada de cada produto (/api/precos).
   ============================================================ */

const express = require('express');
const router = express.Router();
const { lerBlackNoAr } = require('../core/campanha');

router.get('/campanha', async (req, res) => {
  const black = await lerBlackNoAr();
  res.set('Cache-Control', 'no-cache');
  res.json(black);
});

module.exports = router;
