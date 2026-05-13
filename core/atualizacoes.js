/* ============================================================
   VIDA MÁGICA — core/atualizacoes.js
   Helpers pra criar atualizações pendentes da jornada.

   Atualizações pendentes geram experiência de celebração no app:
   - banner na Home
   - aviso no sino
   - splash com barra de progresso animada (0 → percentual atual)

   Tipos suportados:
   - 'teste'   → ativação de trilha (criado por routes/teste.js)
   - 'compra'  → produto adquirido (criado pelo webhook do gateway)

   Quando o webhook do Kiwify (ou outro gateway) entrar em produção,
   chame `criarAtualizacaoCompra` logo após criar a linha em
   usuario_produtos. Isso garante que a aluna vê a celebração na
   próxima visita ao app.
   ============================================================ */

const { poolCore } = require('../db');

/**
 * Cria uma atualização pendente do tipo 'compra'.
 * Use ao processar o webhook de pagamento confirmado.
 *
 * @param {string} usuarioId - UUID do usuário (banco Core)
 * @param {object} payload - Dados contextuais
 * @param {string} payload.produto_slug - slug do produto comprado (ex: 'vencendo_medo')
 * @param {string} [payload.produto_nome] - nome amigável (ex: 'E-Book Vencendo o Medo')
 * @param {string} [payload.origem] - 'kiwify' | 'manual' | etc
 * @returns {Promise<{id: string} | null>} - ID da atualização criada
 *
 * Exemplo de uso (no webhook do Kiwify):
 *
 *   await criarUsuarioProduto({ ... });  // libera o produto
 *   await criarAtualizacaoCompra(usuario.id, {
 *     produto_slug: 'vencendo_medo',
 *     produto_nome: 'E-Book Vencendo o Medo',
 *     origem: 'kiwify',
 *   });
 */
async function criarAtualizacaoCompra(usuarioId, payload = {}) {
  if (!usuarioId) return null;
  try {
    const r = await poolCore.query(
      `INSERT INTO atualizacoes_pendentes (usuario_id, tipo, payload)
       VALUES ($1, 'compra', $2)
       RETURNING id`,
      [usuarioId, JSON.stringify(payload)]
    );
    return { id: r.rows[0].id };
  } catch (err) {
    console.error('[atualizacoes.criarAtualizacaoCompra] erro:', err);
    return null;
  }
}

/**
 * Cria uma atualização pendente do tipo 'teste'.
 * Use ao ativar a trilha (em routes/teste.js).
 *
 * @param {string} usuarioId - UUID do usuário (banco Core)
 * @param {object} payload - Dados contextuais
 * @param {string} payload.teste_id - UUID do teste
 * @param {string} payload.contexto - 'criando' (1º teste) | 'atualizando' (re-teste)
 */
async function criarAtualizacaoTeste(usuarioId, payload = {}) {
  if (!usuarioId) return null;
  try {
    const r = await poolCore.query(
      `INSERT INTO atualizacoes_pendentes (usuario_id, tipo, payload)
       VALUES ($1, 'teste', $2)
       RETURNING id`,
      [usuarioId, JSON.stringify(payload)]
    );
    return { id: r.rows[0].id };
  } catch (err) {
    console.error('[atualizacoes.criarAtualizacaoTeste] erro:', err);
    return null;
  }
}

module.exports = {
  criarAtualizacaoCompra,
  criarAtualizacaoTeste,
};
