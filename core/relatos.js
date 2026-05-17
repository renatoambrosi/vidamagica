/* === VIDA MÁGICA — core/relatos.js ===
   Banco: poolComunicacao.

   Helpers de manipulação cross-pool envolvendo a tabela `depoimentos`.
   Existe pra evitar que rotas/funções de OUTROS domínios (ex: core/usuarios.js
   no poolCore) precisem montar SQL na mão pra mexer em depoimentos.

   ── Funções ──
   - ocultarRelatosDeAluna(usuario_id, oculto)
       Marca/desmarca oculto_por_conta_inativa em TODOS os relatos da aluna.
       Chamado por:
         core/usuarios.js → arquivarUsuario   (oculto=TRUE)
         core/usuarios.js → desarquivarUsuario (oculto=FALSE)
       Os endpoints públicos /api/depoimentos* filtram FALSE — quando aluna
       arquiva, os relatos dela somem do site público sem alarde.

   Regra: relatos sem usuario_id (placeholders IA, cadastrados manualmente
   pelo Renato) NÃO são afetados — porque essa função só atualiza WHERE usuario_id=$1.
   === */

const { poolComunicacao } = require('../db');

async function ocultarRelatosDeAluna(usuario_id, oculto) {
  if (!usuario_id) return 0;
  const r = await poolComunicacao.query(
    `UPDATE depoimentos
        SET oculto_por_conta_inativa = $2,
            atualizado_em = NOW()
      WHERE usuario_id = $1
        AND oculto_por_conta_inativa <> $2`,
    [usuario_id, !!oculto]
  );
  return r.rowCount || 0;
}

module.exports = {
  ocultarRelatosDeAluna,
};
