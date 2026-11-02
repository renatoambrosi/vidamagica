/* ============================================================
   VIDA MÁGICA — core/teste-config.js
   Modo dev do Teste do Subconsciente, ligado pelo painel admin.

   Banco: poolComunicacao, tabela `config`, chave 'teste_modo_dev'.

   Desligado (padrão): o fim do teste abre o checkout e o resultado
   só aparece com pagamento confirmado.
   Ligado: o fim do teste vai direto pro resultado, sem cobrar.

   Sem configuração salva ou com erro de leitura, vale desligado
   (cobrança ativa).
   ============================================================ */

const { poolComunicacao } = require('../db');

const CHAVE = 'teste_modo_dev';

async function lerModoDevTeste() {
  try {
    const r = await poolComunicacao.query(`SELECT dados FROM config WHERE chave = $1`, [CHAVE]);
    return !!(r.rows[0] && r.rows[0].dados && r.rows[0].dados.ativo === true);
  } catch (e) {
    console.warn('⚠️ [teste-config] falha ao ler modo dev, mantendo cobrança:', e.message);
    return false;
  }
}

async function salvarModoDevTeste(ativo) {
  await poolComunicacao.query(
    `INSERT INTO config (chave, dados, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave) DO UPDATE SET dados = $2, atualizado_em = NOW()`,
    [CHAVE, JSON.stringify({ ativo: ativo === true })]
  );
}

module.exports = { lerModoDevTeste, salvarModoDevTeste };
