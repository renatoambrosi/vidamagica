/* ============================================================
   VIDA MÁGICA — routes/seed.js
   Seed inicial dos preços. Idempotente — não sobrescreve.

   Endpoint: POST /api/admin/seed (idempotente — não sobrescreve)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');

const PRECOS_INICIAIS = {
  // ── COMUNIDADE ──
  clube_vida_magica: {
    nome: 'Vida Mágica - Comunidade Suellen Seragi',
    tipo: 'comunidade',
    imagem_url: '/assets/products/clube-vida-magica.png',
    link_checkout_padrao: 'https://pay.kiwify.com.br/4QyFVj2',
    link_checkout_aluno: '',
    mostrar_promo_ouro: false,
    preco_ouro: '59,90',
    preco_ouro_promo: '49,90',
    mostrar_promo_magico: false,
    preco_magico: '89,90',
    preco_magico_promo: '79,90'
  },
  // ── TESTES ──
  teste_prosperidade: {
    nome: 'Teste de Prosperidade',
    tipo: 'promo',
    imagem_url: '/assets/products/teste-prosperidade.png',
    link_checkout_padrao: '',
    link_checkout_aluno: '',
    mostrar_promo: false,
    preco_padrao: '19,00',
    preco_promo: '9,00'
  },
  teste_subconsciente: {
    nome: 'Teste do Subconsciente',
    tipo: 'promo',
    imagem_url: '/assets/products/teste-subconsciente.png',
    link_checkout_padrao: '',
    link_checkout_aluno: '',
    mostrar_promo: false,
    preco_padrao: '19,00',
    preco_promo: '9,00'
  },
  // ── SÉRIE CONHECER E DESPERTAR (4 LIVROS — em sequência) ──
  vencendo_medo: {
    nome: 'E-Book Vencendo o Medo - Série Conhecer e Despertar',
    tipo: 'curso',
    imagem_url: '/assets/products/ebook-vencendoomedo.png',
    link_checkout_padrao: 'https://pay.kiwify.com.br/zr8CnoD',
    link_checkout_aluno: 'https://pay.kiwify.com.br/3Rsvddn',
    mostrar_promo: false,
    preco_padrao: '59,90',
    parcelas_qtd: 10,
    parcelas_valor_padrao: '5,90',
    preco_promo: '39,90',
    parcelas_valor_promo: '5,12',
    parcelas_qtd_promo: 9,
    preco_alunos: '59,90',
    parcelas_valor_alunos: '5,90',
    parcelas_qtd_alunos: 10
  },
  vencendo_desordem: {
    nome: 'E-Book Vencendo a Desordem - Série Conhecer e Despertar',
    tipo: 'curso',
    imagem_url: '/assets/products/ebook-vencendoadesordem.png',
    link_checkout_padrao: '',
    link_checkout_aluno: '',
    mostrar_promo: false,
    preco_padrao: '59,90',
    parcelas_qtd: 10,
    parcelas_valor_padrao: '5,90',
    preco_promo: '39,90',
    parcelas_valor_promo: '5,12',
    parcelas_qtd_promo: 9,
    preco_alunos: '59,90',
    parcelas_valor_alunos: '5,90',
    parcelas_qtd_alunos: 10
  },
  vencendo_validacao: {
    nome: 'E-Book Vencendo a Validação - Série Conhecer e Despertar',
    tipo: 'curso',
    imagem_url: '/assets/products/ebook-vencendoavalidacao.png',
    link_checkout_padrao: '',
    link_checkout_aluno: '',
    mostrar_promo: false,
    preco_padrao: '59,90',
    parcelas_qtd: 10,
    parcelas_valor_padrao: '5,90',
    preco_promo: '39,90',
    parcelas_valor_promo: '5,12',
    parcelas_qtd_promo: 9,
    preco_alunos: '59,90',
    parcelas_valor_alunos: '5,90',
    parcelas_qtd_alunos: 10
  },
  vencendo_sobrevivencia: {
    nome: 'E-Book Vencendo a Sobrevivência - Série Conhecer e Despertar',
    tipo: 'curso',
    imagem_url: '/assets/products/ebook-vencendoasobrevivencia.png',
    link_checkout_padrao: '',
    link_checkout_aluno: '',
    mostrar_promo: false,
    preco_padrao: '59,90',
    parcelas_qtd: 10,
    parcelas_valor_padrao: '5,90',
    preco_promo: '39,90',
    parcelas_valor_promo: '5,12',
    parcelas_qtd_promo: 9,
    preco_alunos: '59,90',
    parcelas_valor_alunos: '5,90',
    parcelas_qtd_alunos: 10
  },
  // ── GUIAS ──
  magica_fluir: {
    nome: 'Guia de Bolso Mágica do Fluir',
    tipo: 'curso',
    imagem_url: '/assets/products/magica-fluir.png',
    link_checkout_padrao: '',
    link_checkout_aluno: '',
    mostrar_promo: false,
    preco_padrao: '20,00',
    parcelas_qtd: 4,
    parcelas_valor_padrao: '5,20',
    preco_promo: '10,00',
    parcelas_valor_promo: '5,80',
    parcelas_qtd_promo: 2,
    preco_alunos: '8,00',
    parcelas_valor_alunos: null,
    parcelas_qtd_alunos: null
  },
  guia_pratico: {
    nome: 'Guia Prático para Reprogramar a Mente',
    tipo: 'curso',
    imagem_url: '/assets/products/guia-pratico.png',
    link_checkout_padrao: 'https://pay.kiwify.com.br/itNhMPe',
    link_checkout_aluno: 'https://pay.kiwify.com.br/YG9kuOH',
    mostrar_promo: false,
    preco_padrao: '84,11',
    parcelas_qtd: 12,
    parcelas_valor_padrao: '8,70',
    preco_promo: '60,00',
    parcelas_valor_promo: '6,00',
    preco_alunos: '70,40',
    parcelas_valor_alunos: '7,28'
  },
  atal_maneira_livro: {
    nome: 'Livro Digital A Tal Maneira 3 - Leis para a Riqueza e para a Vida',
    tipo: 'curso',
    imagem_url: '/assets/products/atal-maneira-livro.png',
    link_checkout_padrao: 'https://pay.kiwify.com.br/IId7xgS',
    link_checkout_aluno: 'https://pay.kiwify.com.br/fZCFTb6',
    mostrar_promo: false,
    preco_padrao: '137,88',
    parcelas_qtd: 12,
    parcelas_valor_padrao: '14,26',
    preco_promo: '100,00',
    parcelas_valor_promo: '10,00',
    preco_alunos: '121,48',
    parcelas_valor_alunos: '12,56'
  },
  // ── CURSOS DE REPROGRAMAÇÃO ──
  ouro_reprogramacao: {
    nome: 'Curso O Ouro da Reprogramação Mental',
    tipo: 'curso',
    imagem_url: '/assets/products/ouro-reprogramacao.png',
    link_checkout_padrao: 'https://pay.kiwify.com.br/F62VNpy',
    link_checkout_aluno: 'https://pay.kiwify.com.br/VYTiaCm',
    mostrar_promo: false,
    preco_padrao: '711,00',
    parcelas_qtd: 12,
    parcelas_valor_padrao: '52,85',
    preco_promo: '511,00',
    parcelas_valor_promo: '52,85',
    preco_alunos: '411,00',
    parcelas_valor_alunos: '42,51'
  },
  lda_biblica: {
    nome: 'Curso Lei da Atração Bíblica (LDA)',
    tipo: 'curso',
    imagem_url: '/assets/products/lda-biblica.png',
    link_checkout_padrao: 'https://pay.kiwify.com.br/8BoTzTD',
    link_checkout_aluno: 'https://pay.kiwify.com.br/k2TZ8cU',
    mostrar_promo: false,
    preco_padrao: '711,00',
    parcelas_qtd: 12,
    parcelas_valor_padrao: '52,85',
    preco_promo: '511,00',
    parcelas_valor_promo: '52,85',
    preco_alunos: '411,00',
    parcelas_valor_alunos: '42,51'
  },
  atal_maneira_curso: {
    nome: 'Curso A Tal Maneira - O Curso Definitivo da Riqueza Bíblica',
    tipo: 'curso',
    imagem_url: '/assets/products/atal-maneira-curso.png',
    link_checkout_padrao: 'https://pay.kiwify.com.br/csxtcEQ',
    link_checkout_aluno: 'https://pay.kiwify.com.br/lT8PPM4',
    mostrar_promo: false,
    preco_padrao: '711,00',
    parcelas_qtd: 12,
    parcelas_valor_padrao: '52,85',
    preco_promo: '511,00',
    parcelas_valor_promo: '52,85',
    preco_alunos: '411,00',
    parcelas_valor_alunos: '42,51'
  },
  // Combo Livro Digital + Curso A Tal Maneira. Preços placeholder —
  // ajustar pelo painel /admin → Preços antes de divulgar. Links Kiwify
  // já apontam pros checkouts corretos do combo.
  atal_maneira_combo: {
    nome: 'Combo A Tal Maneira - Livro Digital + Curso Completo',
    tipo: 'curso',
    imagem_url: '/assets/products/atal-maneira-curso.png',
    link_checkout_padrao: 'https://pay.kiwify.com.br/c7dRjkL',
    link_checkout_aluno: 'https://pay.kiwify.com.br/g47SRft',
    mostrar_promo: false,
    preco_padrao: '0,00',
    parcelas_qtd: 12,
    parcelas_valor_padrao: '0,00',
    preco_promo: '0,00',
    parcelas_valor_promo: '0,00',
    preco_alunos: '0,00',
    parcelas_valor_alunos: '0,00'
  }
};

/* ============================================================
   Função interna — usada também pelo boot do server.js.
   Idempotente:
     - Insere chaves que ainda não existem (sem sobrescrever).
     - Para chaves existentes:
       (a) Adiciona campos NOVOS que não existem ainda
       (b) Preenche campos que existem mas estão VAZIOS (string vazia, null, undefined)
       (c) Atualiza o NOME pro nome canônico (porque o admin não edita o nome
           pelo painel hoje — ele é fixo/sistêmico)
       Campos com valor DIFERENTE de vazio (preço editado, link cadastrado,
       etc) são PRESERVADOS — admin manda no que ele editou.
   ============================================================ */
async function seedPrecos() {
  const client = await poolComunicacao.connect();
  try {
    await client.query('BEGIN');
    let inseridos = 0;
    let migrados = 0;
    // Campos que devem ser "preenchidos automaticamente quando vazios"
    // (não os preços/promo/parcelas que são editados pelo admin)
    const CAMPOS_AUTO_FILL = ['imagem_url', 'link_checkout_padrao', 'link_checkout_aluno'];

    for (const [key, valor] of Object.entries(PRECOS_INICIAIS)) {
      const r = await client.query(`
        INSERT INTO precos (key, dados, atualizado_em)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO NOTHING
      `, [key, JSON.stringify(valor)]);
      if (r.rowCount > 0) {
        inseridos++;
      } else {
        // Já existia — atualizações conservadoras
        const existR = await client.query(`SELECT dados FROM precos WHERE key = $1`, [key]);
        if (existR.rows[0]) {
          const atual = existR.rows[0].dados || {};
          let mudou = false;

          // (a) e (b): pra cada campo do canônico, se atual está vazio/inexistente
          //            E o canônico tem valor, preenche.
          for (const [campo, valorPadrao] of Object.entries(valor)) {
            const valorAtual = atual[campo];
            const estaVazio = (valorAtual === undefined || valorAtual === null || valorAtual === '');
            // Auto-fill: links e imagem podem ser preenchidos quando vazios
            if (CAMPOS_AUTO_FILL.includes(campo) && estaVazio && valorPadrao) {
              atual[campo] = valorPadrao;
              mudou = true;
              continue;
            }
            // Campos novos que não existem no JSON: adiciona
            if (!(campo in atual)) {
              atual[campo] = valorPadrao;
              mudou = true;
            }
          }

          // (c): nome sincroniza com o canônico
          if (atual.nome !== valor.nome) {
            atual.nome = valor.nome;
            mudou = true;
          }

          if (mudou) {
            await client.query(`
              UPDATE precos SET dados = $2, atualizado_em = NOW() WHERE key = $1
            `, [key, JSON.stringify(atual)]);
            migrados++;
          }
        }
      }
    }
    await client.query('COMMIT');
    if (inseridos > 0) {
      console.log(`✅ Seed de preços: ${inseridos} chave(s) nova(s) inserida(s)`);
    }
    if (migrados > 0) {
      console.log(`✅ Seed de preços: ${migrados} chave(s) sincronizada(s) (nome/links/imagem)`);
    }
    return inseridos;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro no seed de preços:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

router.post('/admin/seed', autenticarPainel('admin'), async (req, res) => {
  try {
    const inseridos = await seedPrecos();
    res.json({
      success: true,
      message: `${inseridos} chave(s) nova(s) inserida(s). Existentes não foram alteradas.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.seedPrecos = seedPrecos;
