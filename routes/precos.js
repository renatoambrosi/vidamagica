/* ============================================================
   VIDA MÁGICA — routes/precos.js
   ALIAS LEGADO de routes/produtos.js.

   ⚠️ NÃO REMOVER — vital pra produção:
   - As 7 LPs (index + 6 LPs de produto) chamam /api/precos
   - O frontend do /app, /resultado e relatos-card.js também
   - Webhooks/integrações externas (futuro Kiwify) podem assumir
     que /api/precos existe

   Esses endpoints continuam expostos EXATAMENTE como antes,
   apenas reusando os handlers de produtos.js (fonte única).
   Comportamento, payload e contrato 100% iguais ao histórico.

   Quando todas as LPs forem reescritas pra /api/produtos, esse
   arquivo pode ser removido — mas não agora.

   Endpoints (aliases):
   - GET  /api/precos          → idêntico a GET /api/produtos
   - GET  /api/admin/precos    → idêntico a GET /api/admin/produtos
   - POST /api/admin/precos    → idêntico a POST /api/admin/produtos
   ============================================================ */

const express = require('express');
const router = express.Router();
const { autenticarPainel } = require('../middleware/autenticar');
const produtos = require('./produtos');

// Reusa os MESMOS handlers de produtos.js — sem duplicar lógica
// nem manter divergência possível entre os dois caminhos.
router.get('/precos',                                       produtos.listarPublico);
router.get('/admin/precos',  autenticarPainel('admin'),     produtos.listarAdmin);
router.post('/admin/precos', autenticarPainel('admin'),     produtos.salvarAdmin);

module.exports = router;
