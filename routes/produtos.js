/* ============================================================
   VIDA MÁGICA — routes/produtos.js
   Banco: poolComunicacao (tabela legacy `precos` — a renomeação
   pra "produtos" foi feita só na superfície; ver CLAUDE.md).

   "Produtos" = entidade canônica do catálogo (livros, cursos,
   ebooks, assinatura do Clube). Cada produto tem nome, imagem,
   tipo, preços (padrão / promo / aluno), parcelas e links de
   checkout. "Preço" é APENAS um campo do produto, não a entidade.

   Endpoints:
   - GET  /api/produtos           → público (com cálculos de exibição)
   - GET  /api/admin/produtos     → admin (cru)
   - POST /api/admin/produtos     → admin (salva)

   Aliases legados em routes/precos.js (mesmos handlers,
   paths antigos /api/precos e /api/admin/precos). Mantidos
   por compat com LPs que ainda não foram atualizadas.
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

function processarProdutos(produtos) {
  Object.keys(produtos).forEach(key => {
    const p = produtos[key];

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

    } else if (p.tipo === 'curso' || p.tipo === 'ebook') {
      // 'ebook' é alias de 'curso' — mesma estrutura de exibição (parcelas + avista + promo)
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
  return produtos;
}

// ── HANDLERS (usados também pelos aliases legados em routes/precos.js) ──

async function listarPublico(req, res) {
  try {
    const result = await poolComunicacao.query('SELECT key, dados FROM precos ORDER BY key');
    const produtos = {};
    result.rows.forEach(row => { produtos[row.key] = row.dados; });
    res.json(processarProdutos(produtos));
  } catch (err) {
    console.error('❌ Erro ao buscar produtos:', err.message);
    res.status(500).json({ error: 'Erro ao carregar produtos' });
  }
}

async function listarAdmin(req, res) {
  try {
    const result = await poolComunicacao.query('SELECT key, dados FROM precos ORDER BY key');
    const produtos = {};
    result.rows.forEach(row => { produtos[row.key] = row.dados; });
    res.json(produtos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function salvarAdmin(req, res) {
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
    console.log('✅ Produtos atualizados');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao salvar produtos:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── ENDPOINTS NOVOS (canônicos) ──
router.get('/produtos',                                       listarPublico);
router.get('/admin/produtos',  autenticarPainel('admin'),     listarAdmin);
router.post('/admin/produtos', autenticarPainel('admin'),     salvarAdmin);

module.exports = router;

// Exporta também os handlers pra que routes/precos.js (aliases legados)
// reuse exatamente o mesmo código — fonte única da verdade.
module.exports.listarPublico = listarPublico;
module.exports.listarAdmin   = listarAdmin;
module.exports.salvarAdmin   = salvarAdmin;
module.exports.processarProdutos = processarProdutos;
