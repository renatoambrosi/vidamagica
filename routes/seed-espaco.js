/* ============================================================
   VIDA MÁGICA — routes/seed-espaco.js
   Seeds / migrações do Espaço da Manifestação.

   Bancos: poolComunicacao (origem: caderno_afirmacoes — catálogo antigo)
           poolEspaco       (destino: afirmacoes — catálogo novo)
           seed_log vive em poolComunicacao (controle de "já rodou").

   migrarAfirmacoesParaEspaco():
   - Copia as afirmações do Caderno antigo (caderno_afirmacoes) pro catálogo
     novo do Espaço (afirmacoes), preservando texto/categoria/ordem.
   - audio_arquivo entra NULL — o Renato vincula o MP3 depois no admin.
   - Idempotente: trava por seed_log ('migracao_afirmacoes_espaco_v1') E só
     copia se a tabela de destino estiver vazia (não duplica nem atropela
     edições já feitas). Roda 1x no boot, no próximo deploy.
   - NÃO apaga nada do Caderno (a deleção do Caderno é no final da missão geral).
   ============================================================ */

const { poolComunicacao, poolEspaco } = require('../db');

const SEED_KEY = 'migracao_afirmacoes_espaco_v1';

async function migrarAfirmacoesParaEspaco() {
  // Já rodou?
  const jaRodou = await poolComunicacao.query(
    `SELECT 1 FROM seed_log WHERE seed_key = $1`, [SEED_KEY]
  );
  if (jaRodou.rows[0]) return { ja_rodou: true };

  // Destino já tem dados? Então não migra (evita duplicar / atropelar edição).
  const destino = await poolEspaco.query(`SELECT COUNT(*)::int AS n FROM afirmacoes`);
  if (destino.rows[0].n > 0) {
    await poolComunicacao.query(
      `INSERT INTO seed_log (seed_key) VALUES ($1) ON CONFLICT DO NOTHING`, [SEED_KEY]
    );
    return { pulou: true, motivo: 'destino já tinha afirmações', destino: destino.rows[0].n };
  }

  // Lê o catálogo antigo.
  const origem = await poolComunicacao.query(
    `SELECT texto, categoria, ordem, ativo FROM caderno_afirmacoes ORDER BY categoria NULLS FIRST, ordem, id`
  );

  // Copia (transação no banco de destino).
  let inseridas = 0;
  if (origem.rows.length > 0) {
    const client = await poolEspaco.connect();
    try {
      await client.query('BEGIN');
      for (const a of origem.rows) {
        await client.query(
          `INSERT INTO afirmacoes (texto, categoria, audio_arquivo, ordem, ativo)
           VALUES ($1, $2, NULL, $3, $4)`,
          [a.texto, a.categoria || null, a.ordem || 99, a.ativo !== false]
        );
        inseridas++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Marca como rodado SÓ depois do sucesso da cópia.
  await poolComunicacao.query(
    `INSERT INTO seed_log (seed_key) VALUES ($1) ON CONFLICT DO NOTHING`, [SEED_KEY]
  );

  console.log(`✨ Migração de afirmações Caderno→Espaço: ${inseridas} copiadas.`);
  return { ok: true, inseridas };
}

module.exports = { migrarAfirmacoesParaEspaco };
