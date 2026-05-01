/* ============================================================
   VIDA MÁGICA — routes/precos.js
   Catálogo de preços (público + admin).

   Banco: poolComunicacao (tabela `precos`).

   Endpoints:
     GET  /api/precos            → público (com cálculos de exibição)
     GET  /api/admin/precos      → admin (cru, pra editar)
     POST /api/admin/precos      → admin (salva o JSON inteiro)

   Compatibilidade: o formato de resposta de GET /api/precos é
   IDÊNTICO ao do sistema antigo. Nada muda no front.
   ============================================================ */

const express = require('express');
const router = express.Router();

const { poolComunicacao } = require('../db');
const { autenticarAdmin } = require('../middleware/autenticar');

// ── HELPER ─────────────────────────────────────────────────

function calcularDesconto(precoDe, precoPor) {
  const de = parseFloat(String(precoDe).replace(',', '.'));
  const por = parseFloat(String(precoPor).replace(',', '.'));
  if (!de || !por || por >= de) return null;
  return Math.round(((de - por) / de) * 100);
}

/**
 * Carrega todos os preços do banco como um único objeto chave→dados.
 */
async function carregarPrecos() {
  const r = await poolComunicacao.query(`SELECT key, dados FROM precos`);
  const out = {};
  for (const row of r.rows) {
    out[row.key] = row.dados;
  }
  return out;
}

/**
 * Salva o objeto inteiro de preços (UPSERT por key).
 */
async function salvarPrecos(obj) {
  const c = await poolComunicacao.connect();
  try {
    await c.query('BEGIN');
    for (const [key, dados] of Object.entries(obj)) {
      await c.query(
        `INSERT INTO precos (key, dados, atualizado_em)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = NOW()`,
        [key, dados]
      );
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

// ── PÚBLICO ────────────────────────────────────────────────

router.get('/precos', async (req, res) => {
  try {
    const precos = await carregarPrecos();

    Object.keys(precos).forEach(key => {
      const p = precos[key];
      if (!p) return;

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

    res.json(precos);
  } catch (err) {
    console.error('❌ GET /precos:', err.message);
    res.status(500).json({ error: 'Erro ao carregar preços' });
  }
});

// ── ADMIN ──────────────────────────────────────────────────

router.get('/admin/precos', autenticarAdmin, async (req, res) => {
  try {
    res.json(await carregarPrecos());
  } catch (err) {
    console.error('❌ GET /admin/precos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/precos', autenticarAdmin, async (req, res) => {
  try {
    const dados = req.body;
    if (!dados || typeof dados !== 'object') {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    await salvarPrecos(dados);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ POST /admin/precos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
