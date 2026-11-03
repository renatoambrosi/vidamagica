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
   - GET  /llms.txt               → apresentação do site para IAs (montado no server.js)
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

// ── /llms.txt — apresentação do site para as IAs (GEO) ──
// Nome de cada produto vem do admin; descrição e página ficam aqui,
// iguais às descrições aprovadas para o Google.
const BASE_SITE = 'https://vidamagica.com.br';
const LLMS_PRODUTOS = [
  ['teste_subconsciente', '/teste', 'Descubra em 15 perguntas qual padrão do seu subconsciente está no comando. Baseado em lógica comportamental e ciência cognitiva. Resultado na hora.'],
  ['vencendo_medo', '/', 'E-book da Série Conhecer e Despertar, indicado pelo Teste para quem tem o Medo como energia dominante.'],
  ['ouro_reprogramacao', '/ouro-da-reprogramacao-mental', 'Curso de reprogramação mental com base bíblica: 3 módulos e 9 aulas, com linguagem leve e conteúdo profundo.'],
  ['lda_biblica', '/lei-da-atracao-biblica', 'Fé, propósito e os princípios do Grande Livro em um curso com 14 aulas práticas.'],
  ['guia_pratico', '/guia-pratico-reprogramacao-mental', 'A forma mais simples e organizada de começar a reprogramação mental. Método prático baseado no Grande Livro, PNL e neurociência. E-book com exercícios.'],
  ['atal_maneira_livro', '/a-tal-maneira', 'As 3 leis de Suellen Seragi: Imagem Fixa, Fé Firme e Gratidão Plena, de forma prática e com base no Grande Livro.'],
  ['atal_maneira_curso', '/a-tal-maneira', 'O curso das 3 leis de A Tal Maneira, com mentalidade e ação.'],
  ['magica_fluir', '/magica-do-fluir', 'Guia de bolso para quem já despertou e quer viver no fluir, sem forçar. Uma leitura curta para o dia a dia.'],
];

async function llmsTxt(req, res) {
  let produtos = {};
  try {
    const result = await poolComunicacao.query('SELECT key, dados FROM precos');
    result.rows.forEach(row => { produtos[row.key] = row.dados || {}; });
  } catch (err) {
    console.error('❌ Erro ao montar llms.txt:', err.message);
  }
  const itens = LLMS_PRODUTOS
    .filter(([slug]) => produtos[slug] && produtos[slug].nome)
    .map(([slug, caminho, desc]) => `- [${produtos[slug].nome}](${BASE_SITE}${caminho}): ${desc}`);

  const texto = [
    '# Vida Mágica - Suellen Seragi',
    '',
    '> Escola de reprogramação mental bíblica de Suellen e Renato Seragi, com cursos e materiais com base no Grande Livro. Pensar novo é viver o novo.',
    '',
    'Vida Mágica - Suellen Seragi é a escola oficial de Suellen Seragi. Os materiais são digitais (cursos, e-books e guias), e o pagamento é feito pela Kiwify. A porta de entrada é o Teste do Subconsciente, que indica por onde cada pessoa começa.',
    '',
    `- Site oficial da Suellen Seragi: https://www.suellenseragi.com.br/`,
    '- Instagram, YouTube e TikTok: @suellenseragi',
    '- Contato: contato@suellenseragi.com.br',
    '',
    '## Teste, cursos e materiais',
    '',
    ...itens,
    '',
    '## Relatos',
    '',
    `- [Relatos de alunas](${BASE_SITE}/relatos): Histórias reais de alunas que praticaram os cursos e materiais de Suellen Seragi.`,
    '',
    '## Institucional',
    '',
    `- [Política de Privacidade](${BASE_SITE}/privacidade)`,
    `- [Termos de Uso](${BASE_SITE}/termos)`,
    '',
  ].join('\n');

  res.type('text/plain; charset=utf-8').send(texto);
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
module.exports.llmsTxt = llmsTxt;
