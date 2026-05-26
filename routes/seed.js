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
    imagem_url: '/assets/products/clube-vida-magica.webp',
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
    imagem_url: '/assets/products/teste-prosperidade.webp',
    link_checkout_padrao: '',
    link_checkout_aluno: '',
    mostrar_promo: false,
    preco_padrao: '19,00',
    preco_promo: '9,00'
  },
  teste_subconsciente: {
    nome: 'Teste do Subconsciente',
    tipo: 'promo',
    imagem_url: '/assets/products/teste-subconsciente.webp',
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
    imagem_url: '/assets/products/ebook-vencendoomedo.webp',
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
    imagem_url: '/assets/products/ebook-vencendoadesordem.webp',
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
    imagem_url: '/assets/products/ebook-vencendoavalidacao.webp',
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
    imagem_url: '/assets/products/ebook-vencendoasobrevivencia.webp',
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
  // (definição antiga de `magica_fluir` foi removida daqui — havia outra
  //  declaração mais abaixo com nome/links corretos. A duplicação em JS
  //  fazia a segunda sobrescrever a primeira de qualquer jeito; mantemos
  //  só a versão final pra evitar confusão visual no arquivo. A função
  //  corrigirDuplicacaoMagicaFluir() abaixo limpa o legacy do banco.)
  guia_pratico: {
    nome: 'Guia Prático para Reprogramar a Mente',
    tipo: 'curso',
    imagem_url: '/assets/products/guia-pratico.webp',
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
    imagem_url: '/assets/products/atal-maneira-livro.webp',
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
    imagem_url: '/assets/products/ouro-reprogramacao.webp',
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
    imagem_url: '/assets/products/lda-biblica.webp',
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
    imagem_url: '/assets/products/atal-maneira-curso.webp',
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
  // Combo da Série Conhecer e Despertar. Agrupa os 4 ebooks "vencendo_*"
  // (medo, desordem, validação, sobrevivência) num único produto pra venda
  // combinada. Preço/link a definir pelo admin antes de divulgar.
  serie_conhecer_despertar: {
    nome: 'Série Conhecer e Despertar',
    tipo: 'curso',
    imagem_url: '/assets/products/serie-despertando.webp',
    link_checkout_padrao: '',
    link_checkout_aluno: '',
    mostrar_promo: false,
    preco_padrao: '0,00',
    parcelas_qtd: 12,
    parcelas_valor_padrao: '0,00',
    preco_promo: '0,00',
    parcelas_valor_promo: '0,00',
    preco_alunos: '0,00',
    parcelas_valor_alunos: '0,00'
  },
  // Combo Livro Digital + Curso A Tal Maneira. Preços placeholder —
  // ajustar pelo painel /admin → Preços antes de divulgar. Links Kiwify
  // já apontam pros checkouts corretos do combo.
  atal_maneira_combo: {
    nome: 'Combo A Tal Maneira - Livro Digital + Curso Completo',
    tipo: 'curso',
    imagem_url: '/assets/products/atal-maneira-combo.webp',
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
  },
  // Guia de bolso "A Mágica do Fluir" — Suellen Seragi.
  // Slug igual ao padrão do projeto (sem "_do_"): magica_fluir.
  // Preço placeholder — ajustar pelo /admin → Preços antes de divulgar.
  magica_fluir: {
    nome: 'A Mágica do Fluir - Guia de Bolso',
    tipo: 'curso',
    imagem_url: '/assets/products/magica-fluir.webp',
    link_checkout_padrao: 'https://pay.kiwify.com.br/yl5TJqM',
    link_checkout_aluno: 'https://pay.kiwify.com.br/AkYXx5F',
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
   Classificação inicial pras abas do admin
   (Serviços / Materiais / Cursos / Combos / Legado).
   Aplicada pra produtos que ainda não têm `categoria_admin` ou `eh_legado` no banco.
   Renato pode mover qualquer produto entre abas pelo painel — esses dois mappings
   só populam o estado INICIAL na transição.
   ============================================================ */
const CATEGORIA_ADMIN_INICIAL = {
  clube_vida_magica:        'servicos',
  teste_subconsciente:      'servicos',
  teste_prosperidade:       'servicos',
  ouro_reprogramacao:       'cursos',
  lda_biblica:              'cursos',
  atal_maneira_curso:       'cursos',
  atal_maneira_combo:       'combos',
  serie_conhecer_despertar: 'combos',
  vencendo_medo:            'materiais',
  vencendo_desordem:        'materiais',
  vencendo_validacao:       'materiais',
  vencendo_sobrevivencia:   'materiais',
  guia_pratico:             'materiais',
  atal_maneira_livro:       'materiais',
  magica_fluir:             'materiais',
};
const EH_LEGADO_INICIAL = new Set(['teste_prosperidade']);

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
      // Injeta categoria_admin e eh_legado no canônico antes de aplicar.
      // Produtos novos: ficam com esses campos já no INSERT.
      // Produtos existentes sem o campo: caem na regra (a) "campo novo: adiciona".
      if (valor.categoria_admin === undefined) {
        valor.categoria_admin = CATEGORIA_ADMIN_INICIAL[key] || 'cursos';
      }
      if (valor.eh_legado === undefined) {
        valor.eh_legado = EH_LEGADO_INICIAL.has(key);
      }

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

/* ============================================================
   corrigirDuplicacaoMagicaFluir — limpeza idempotente.

   Histórico do bug: o arquivo seed.js tinha o slug `magica_fluir`
   declarado 2 vezes (JS sobrescrevia silenciosamente), mas o banco
   acumulou 2 produtos relacionados a "Mágica do Fluir" — um com
   preço e SEM link de checkout, outro com link Kiwify e preço 0,00.

   Esta função:
     1) Roda 1 vez no boot (controlada por seed_log).
     2) Lista produtos cuja key OU nome casa com "magica*fluir".
     3) Se houver 2+:
        - Escolhe o "bom" (maior preço_padrao numérico).
        - Copia links de checkout do "ruim" pro "bom" (se faltarem).
        - Apaga os "ruins".
     4) Marca como executada no seed_log.

   Pra forçar re-rodar: DELETE FROM seed_log WHERE seed_key = 'fix_magica_fluir_v1';
   ============================================================ */
async function corrigirDuplicacaoMagicaFluir() {
  const SEED_KEY = 'fix_magica_fluir_v1';
  try {
    const ja = await poolComunicacao.query(
      `SELECT 1 FROM seed_log WHERE seed_key = $1`, [SEED_KEY]
    );
    if (ja.rows.length > 0) return;

    const r = await poolComunicacao.query(`
      SELECT key, dados FROM precos
      WHERE LOWER(key) LIKE '%magica%fluir%'
         OR LOWER(COALESCE(dados->>'nome','')) LIKE '%mágica do fluir%'
         OR LOWER(COALESCE(dados->>'nome','')) LIKE '%magica do fluir%'
    `);

    if (r.rows.length <= 1) {
      // Nada a corrigir — registra que rodou pra não verificar de novo.
      await poolComunicacao.query(
        `INSERT INTO seed_log (seed_key) VALUES ($1) ON CONFLICT DO NOTHING`,
        [SEED_KEY]
      );
      return;
    }

    const parsePreco = (s) => parseFloat(String(s || '0').replace(',', '.')) || 0;

    // Ordena: maior preço primeiro. O primeiro é o "bom", restantes são "ruins".
    const ordenados = r.rows.slice().sort((a, b) =>
      parsePreco(b.dados.preco_padrao) - parsePreco(a.dados.preco_padrao)
    );

    const bom = ordenados[0];
    const ruins = ordenados.slice(1);

    // Merge dos links de checkout (preserva o que o "bom" não tinha).
    const novoBom = { ...bom.dados };
    for (const ruim of ruins) {
      const d = ruim.dados || {};
      if (!novoBom.link_checkout_padrao && d.link_checkout_padrao) {
        novoBom.link_checkout_padrao = d.link_checkout_padrao;
      }
      if (!novoBom.link_checkout_aluno && d.link_checkout_aluno) {
        novoBom.link_checkout_aluno = d.link_checkout_aluno;
      }
    }

    const client = await poolComunicacao.connect();
    try {
      await client.query('BEGIN');
      // Atualiza o "bom" com merge dos links
      await client.query(
        `UPDATE precos SET dados = $2, atualizado_em = NOW() WHERE key = $1`,
        [bom.key, JSON.stringify(novoBom)]
      );
      // Apaga os "ruins"
      for (const ruim of ruins) {
        await client.query(`DELETE FROM precos WHERE key = $1`, [ruim.key]);
      }
      await client.query(
        `INSERT INTO seed_log (seed_key) VALUES ($1) ON CONFLICT DO NOTHING`,
        [SEED_KEY]
      );
      await client.query('COMMIT');

      const apagadas = ruins.map(x => x.key).join(', ');
      console.log(`✅ Mágica do Fluir: duplicação corrigida. Mantida key '${bom.key}'. Apagadas: ${apagadas}.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('⚠️ Falha ao corrigir duplicação Mágica do Fluir:', err.message);
  }
}

module.exports = router;
module.exports.seedPrecos = seedPrecos;
module.exports.corrigirDuplicacaoMagicaFluir = corrigirDuplicacaoMagicaFluir;
