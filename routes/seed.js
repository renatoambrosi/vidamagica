const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { autenticar } = require('./precos');

const PRECOS_INICIAIS = {
  clube_vida_magica: {
    nome: "Clube Vida Mágica",
    tipo: "comunidade",
    mostrar_promo_ouro: false,
    preco_ouro: "59,90",
    preco_ouro_promo: "49,90",
    mostrar_promo_magico: false,
    preco_magico: "89,90",
    preco_magico_promo: "79,90"
  },
  teste_prosperidade: {
    nome: "Teste de Prosperidade",
    tipo: "promo",
    mostrar_promo: false,
    preco_padrao: "19,00",
    preco_promo: "9,00"
  },
  vencendo_medo: {
    nome: "E-book Vencendo o Medo",
    tipo: "curso",
    mostrar_promo: false,
    preco_padrao: "59,90",
    parcelas_qtd: 10,
    parcelas_valor_padrao: "5,90",
    preco_promo: "39,90",
    parcelas_valor_promo: "5,12",
    parcelas_qtd_promo: 9,
    preco_alunos: "59,90",
    parcelas_valor_alunos: "5,90",
    parcelas_qtd_alunos: 10
  },
  magica_fluir: {
    nome: "Guia de Bolso Mágica do Fluir",
    tipo: "curso",
    mostrar_promo: false,
    preco_padrao: "20,00",
    parcelas_qtd: 4,
    parcelas_valor_padrao: "5,20",
    preco_promo: "10,00",
    parcelas_valor_promo: "5,80",
    parcelas_qtd_promo: 2,
    preco_alunos: "8,00",
    parcelas_valor_alunos: null,
    parcelas_qtd_alunos: null
  },
  guia_pratico: {
    nome: "E-Book: Guia Prático para Reprogramar a Mente",
    tipo: "curso",
    mostrar_promo: false,
    preco_padrao: "84,11",
    parcelas_qtd: 12,
    parcelas_valor_padrao: "8,70",
    preco_promo: "60,00",
    parcelas_valor_promo: "6,00",
    preco_alunos: "70,40",
    parcelas_valor_alunos: "7,28"
  },
  atal_maneira_livro: {
    nome: "Livro Digital A Tal Maneira + Audiobook + Aulão",
    tipo: "curso",
    mostrar_promo: false,
    preco_padrao: "137,88",
    parcelas_qtd: 12,
    parcelas_valor_padrao: "14,26",
    preco_promo: "100,00",
    parcelas_valor_promo: "10,00",
    preco_alunos: "121,48",
    parcelas_valor_alunos: "12,56"
  },
  ouro_reprogramacao: {
    nome: "Curso: O Ouro da Reprogramação Mental",
    tipo: "curso",
    mostrar_promo: false,
    preco_padrao: "711,00",
    parcelas_qtd: 12,
    parcelas_valor_padrao: "52,85",
    preco_promo: "511,00",
    parcelas_valor_promo: "52,85",
    preco_alunos: "411,00",
    parcelas_valor_alunos: "42,51"
  },
  lda_biblica: {
    nome: "Curso: LDA Bíblica",
    tipo: "curso",
    mostrar_promo: false,
    preco_padrao: "711,00",
    parcelas_qtd: 12,
    parcelas_valor_padrao: "52,85",
    preco_promo: "511,00",
    parcelas_valor_promo: "52,85",
    preco_alunos: "411,00",
    parcelas_valor_alunos: "42,51"
  },
  atal_maneira_curso: {
    nome: "A Tal Maneira - O Curso Definitivo da Riqueza Bíblica",
    tipo: "curso",
    mostrar_promo: false,
    preco_padrao: "711,00",
    parcelas_qtd: 12,
    parcelas_valor_padrao: "52,85",
    preco_promo: "511,00",
    parcelas_valor_promo: "52,85",
    preco_alunos: "411,00",
    parcelas_valor_alunos: "42,51"
  }
};

// ── SEED — popula preços iniciais ──
router.post('/admin/seed', autenticar, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, valor] of Object.entries(PRECOS_INICIAIS)) {
      await client.query(`
        INSERT INTO precos (key, dados, atualizado_em)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO NOTHING
      `, [key, JSON.stringify(valor)]);
    }
    await client.query('COMMIT');
    console.log('✅ Seed de preços concluído');
    res.json({ success: true, message: `${Object.keys(PRECOS_INICIAIS).length} preços inseridos` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro no seed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
