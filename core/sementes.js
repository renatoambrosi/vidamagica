/* === VIDA MÁGICA — core/sementes.js ===
   Banco: poolCore.

   Helper CENTRAL pra toda movimentação de sementes. Sementes são MOEDA REAL
   (vão poder ser usadas pra comprar produtos), então toda alteração de saldo
   passa por aqui — sem exceção.

   Regras inegociáveis:
   - Servidor é fonte única de verdade. Cliente nunca incrementa sozinho.
   - Toda movimentação grava no ledger `sementes_movimentacoes` (auditoria).
   - Rodam em transação (idempotência fica por conta do CHAMADOR).
   - SELECT FOR UPDATE no `usuarios` evita race condition entre 2 requisições.
   - Saldo nunca fica negativo (lança erro se débito > saldo).

   Uso típico — o chamador abre client+BEGIN, faz o INSERT de idempotência
   (ex.: tesouros_resgatados ou compras_produto), passa esse client aqui:

     const client = await poolCore.connect();
     await client.query('BEGIN');
     try {
       const ins = await client.query(
         'INSERT INTO tesouros_resgatados ... ON CONFLICT DO NOTHING RETURNING id'
       );
       if (!ins.rows[0]) { await client.query('COMMIT'); ... }
       const { saldo_atual, movimentacao_id } = await creditarSementes({
         client, usuario_id, delta: 1,
         motivo: 'resgate_tesouro', origem_tipo: 'feed', origem_id: feedId
       });
       await client.query('COMMIT');
     } catch (e) { await client.query('ROLLBACK'); throw e; }
     finally { client.release(); }

   ── Motivos válidos ──
   - 'resgate_tesouro'  (+) crédito ao resgatar tesouro do dia
   - 'compra_produto'   (−) débito ao comprar com sementes
   - 'cortesia_admin'   (±) ajuste manual via painel
   - 'bonus_*'          (+) bônus genéricos (a definir)
   === */

const { poolCore } = require('../db');

const MOTIVOS_VALIDOS = new Set([
  'resgate_tesouro',
  'compra_produto',
  'cortesia_admin',
  'bonus_indicacao',
  'bonus_evento',
  'estorno',
]);

/**
 * Aplica uma movimentação de sementes dentro de uma transação.
 * @param {Object} args
 * @param {Object} args.client       - Cliente Postgres com BEGIN já aberto (poolCore)
 * @param {string} args.usuario_id   - UUID da aluna
 * @param {number} args.delta        - Inteiro: positivo = crédito, negativo = débito
 * @param {string} args.motivo       - Veja MOTIVOS_VALIDOS
 * @param {string} [args.origem_tipo]
 * @param {number|string} [args.origem_id]
 * @returns {Promise<{ saldo_atual: number, movimentacao_id: number, delta: number }>}
 */
async function aplicarMovimentacao({ client, usuario_id, delta, motivo, origem_tipo = null, origem_id = null }) {
  if (!client) throw new Error('[sementes] client de transação é obrigatório');
  if (!usuario_id) throw new Error('[sementes] usuario_id é obrigatório');
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error('[sementes] delta deve ser inteiro diferente de zero');
  }
  if (!MOTIVOS_VALIDOS.has(motivo)) {
    throw new Error(`[sementes] motivo inválido: ${motivo}`);
  }

  // Lock pessimista no usuário — evita 2 requisições concorrentes lerem o
  // mesmo saldo e gravarem em cima uma da outra.
  const lock = await client.query(
    `SELECT sementes FROM usuarios WHERE id = $1 FOR UPDATE`,
    [usuario_id]
  );
  if (!lock.rows[0]) {
    throw new Error(`[sementes] usuário ${usuario_id} não encontrado`);
  }
  const saldoAntes = Number(lock.rows[0].sementes) || 0;
  const saldoDepois = saldoAntes + delta;

  if (saldoDepois < 0) {
    const err = new Error('saldo insuficiente');
    err.code = 'SALDO_INSUFICIENTE';
    err.saldo_atual = saldoAntes;
    throw err;
  }

  // Atualiza saldo
  await client.query(
    `UPDATE usuarios SET sementes = $1, atualizado_em = NOW() WHERE id = $2`,
    [saldoDepois, usuario_id]
  );

  // Grava no ledger
  const mov = await client.query(
    `INSERT INTO sementes_movimentacoes
       (usuario_id, delta, motivo, origem_tipo, origem_id, saldo_apos)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [usuario_id, delta, motivo, origem_tipo, origem_id != null ? String(origem_id) : null, saldoDepois]
  );

  return {
    saldo_atual: saldoDepois,
    movimentacao_id: mov.rows[0].id,
    delta,
  };
}

/**
 * Wrapper semântico — crédito (delta positivo).
 */
async function creditarSementes({ client, usuario_id, delta, motivo, origem_tipo, origem_id }) {
  if (!Number.isInteger(delta) || delta <= 0) {
    throw new Error('[sementes] creditarSementes exige delta inteiro positivo');
  }
  return aplicarMovimentacao({ client, usuario_id, delta, motivo, origem_tipo, origem_id });
}

/**
 * Wrapper semântico — débito (passa delta positivo, vira negativo internamente).
 */
async function debitarSementes({ client, usuario_id, delta, motivo, origem_tipo, origem_id }) {
  if (!Number.isInteger(delta) || delta <= 0) {
    throw new Error('[sementes] debitarSementes exige delta inteiro positivo (o sinal é interno)');
  }
  return aplicarMovimentacao({ client, usuario_id, delta: -delta, motivo, origem_tipo, origem_id });
}

/**
 * Conveniência — saldo atual fora de transação (leitura simples).
 */
async function lerSaldo(usuario_id) {
  const r = await poolCore.query(`SELECT sementes FROM usuarios WHERE id = $1`, [usuario_id]);
  return r.rows[0] ? Number(r.rows[0].sementes) || 0 : 0;
}

module.exports = {
  creditarSementes,
  debitarSementes,
  aplicarMovimentacao,
  lerSaldo,
  MOTIVOS_VALIDOS,
};
