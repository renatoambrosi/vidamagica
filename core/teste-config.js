/* ============================================================
   VIDA MÁGICA — core/teste-config.js
   Chaves do Teste do Subconsciente, ligadas pelo painel admin.

   Banco: poolComunicacao, tabela `config`.

   Modo dev (chave 'teste_modo_dev'):
   Desligado (padrão): o fim do teste abre o checkout e o resultado
   só aparece com pagamento confirmado.
   Ligado: o fim do teste vai direto pro resultado, sem cobrar.

   Mostrar log (chave 'teste_mostrar_log'):
   Ligado: a página de resultado mostra o box Log com as respostas.
   Desligado (padrão): o log nem sai do servidor.

   Sem configuração salva ou com erro de leitura, vale desligado.
   ============================================================ */

const { poolComunicacao } = require('../db');

const CHAVE_MODO_DEV = 'teste_modo_dev';
const CHAVE_MOSTRAR_LOG = 'teste_mostrar_log';

async function lerChave(chave) {
  try {
    const r = await poolComunicacao.query(`SELECT dados FROM config WHERE chave = $1`, [chave]);
    return !!(r.rows[0] && r.rows[0].dados && r.rows[0].dados.ativo === true);
  } catch (e) {
    console.warn(`⚠️ [teste-config] falha ao ler ${chave}, mantendo desligado:`, e.message);
    return false;
  }
}

async function salvarChave(chave, ativo) {
  await poolComunicacao.query(
    `INSERT INTO config (chave, dados, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave) DO UPDATE SET dados = $2, atualizado_em = NOW()`,
    [chave, JSON.stringify({ ativo: ativo === true })]
  );
}

const lerModoDevTeste = () => lerChave(CHAVE_MODO_DEV);
const salvarModoDevTeste = (ativo) => salvarChave(CHAVE_MODO_DEV, ativo);
const lerMostrarLogTeste = () => lerChave(CHAVE_MOSTRAR_LOG);
const salvarMostrarLogTeste = (ativo) => salvarChave(CHAVE_MOSTRAR_LOG, ativo);

module.exports = {
  lerModoDevTeste,
  salvarModoDevTeste,
  lerMostrarLogTeste,
  salvarMostrarLogTeste,
};
