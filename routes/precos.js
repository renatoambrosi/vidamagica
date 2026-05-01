/* ============================================================
   VIDA MÁGICA — routes/precos.js
   Port fiel do antigo. Banco: poolComunicacao.

   Endpoints:
   - GET  /api/precos          → público (com cálculos de exibição)
   - GET  /api/admin/precos    → admin (cru)
   - POST /api/admin/precos    → admin (salva)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');

// ── HELPERS ──
function calcularDesconto(de, por) {
  const a = parseFloat(String(de).replace(',', '.'));
  const b = parseFloat(String(por).replace(',', '.'));
  if (!a || !b || b >= a) return null;
  return Math.round(((a - b) / a) * 100);
}

function processarPrecos(precos) {
  Object.keys(precos).forEach(key => {
    const p = precos[key];

    if (p.tipo === 'promo') {
      if (p.mostrar_promo) {
        p.exibir_de = p.preco_padrao;
        p.exibir_avista = p.preco_promo;
        p.desconto_pct = calcularDesconto(p.preco_padrao, p.preco_promo);
      } else {
        p.exibir_de = null;
        p.exibir_avista = p.preco_padrao;
        p.desconto_pct = null;
      }

    } else if (p.tipo === 'curso') {
      if (p.mostrar_promo) {
        p.exibir_de = p.preco_padrao;
        p.exibir_avista = p.preco_promo;
        p.exibir_parcelas_qtd = p.parcelas_qtd_promo || p.parcelas_qtd;
        p.exibir_parcelas_valor = p.parcelas_valor_promo;
        p.desconto_pct = calcularDesconto(p.preco_padrao, p.preco_promo);
      } else {
        p.exibir_de = null;
        p.exibir_avista = p.preco_padrao;
        p.exibir_parcelas_qtd = p.parcelas_qtd;
        p.exibir_parcelas_valor = p.parcelas_valor_padrao;
        p.desconto_pct = null;
      }
      p.alunos_desconto_pct = calcularDesconto(p.preco_padrao, p.preco_alunos);
      p.alunos_parcelas_qtd = p.parcelas_qtd_alunos || p.parcelas_qtd;

    } else if (p.tipo === 'comunidade') {
      if (p.mostrar_promo_ouro) {
        p.exibir_ouro = p.preco_ouro_promo;
        p.exibir_de_ouro = p.preco_ouro;
        p.desconto_ouro_pct = calcularDesconto(p.preco_ouro, p.preco_ouro_promo);
      } else {
        p.exibir_ouro = p.preco_ouro;
        p.exibir_de_ouro = null;
        p.desconto_ouro_pct = null;
      }
      if (p.mostrar_promo_magico) {
        p.exibir_magico = p.preco_magico_promo;
        p.exibir_de_magico = p.preco_magico;
        p.desconto_magico_pct = calcularDesconto(p.preco_magico, p.preco_magico_promo);
      } else {
        p.exibir_magico = p.preco_magico;
        p.exibir_de_magico = null;
        p.desconto_magico_pct = null;
      }
    }
  });
  return precos;
}

// ── PÚBLICO ──
router.get('/precos', async (req, res) => {
  try {
    const result = await poolComunicacao.query('SELECT key, dados FROM precos ORDER BY key');
    const precos = {};
    result.rows.forEach(row => { precos[row.key] = row.dados; });
    res.json(processarPrecos(precos));
  } catch (err) {
    console.error('❌ Erro ao buscar preços:', err.message);
    res.status(500).json({ error: 'Erro ao carregar preços' });
  }
});

// ── ADMIN: LER ──
router.get('/admin/precos', autenticarPainel('admin'), async (req, res) => {
  try {
    const result = await poolComunicacao.query('SELECT key, dados FROM precos ORDER BY key');
    const precos = {};
    result.rows.forEach(row => { precos[row.key] = row.dados; });
    res.json(precos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: SALVAR ──
router.post('/admin/precos', autenticarPainel('admin'), async (req, res) => {
  const dados = req.body;
  if (!dados || typeof dados !== 'object') {
    return res.status(400).json({ error: 'Dados inválidos' });
  }
  const client = await poolComunicacao.connect();
  try {
    await client.query('BEGIN');
    for (const [key, valor] of Object.entries(dados)) {
      await client.query(`
        INSERT INTO precos (key, dados, atualizado_em)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET dados = $2, atualizado_em = NOW()
      `, [key, JSON.stringify(valor)]);
    }
    await client.query('COMMIT');
    console.log('✅ Preços atualizados');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao salvar preços:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
