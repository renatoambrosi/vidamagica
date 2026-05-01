/* ============================================================
   VIDA MÁGICA — core/utils.js
   Funções compartilhadas entre todos os módulos.

   Banco: nenhum (utilitários puros).

   Regras desta camada:
   - Toda normalização de telefone passa por aqui.
   - Toda formatação canônica passa por aqui.
   - Nenhum módulo deve reimplementar essas funções.
   ============================================================ */

/**
 * Normaliza telefone brasileiro para o formato canônico do sistema.
 * Formato canônico: 55 + DDD + número (apenas dígitos).
 * Ex: '(62) 98308-6320' → '5562983086320'
 *
 * @param {string|number} telefone
 * @returns {string} telefone canônico
 */
function formatarTelefone(telefone) {
  if (telefone === null || telefone === undefined) return '';
  const num = String(telefone).replace(/\D/g, '');
  if (!num) return '';
  if (num.startsWith('55')) return num;
  if (num.startsWith('0')) return `55${num.slice(1)}`;
  return `55${num}`;
}

/**
 * Variação do telefone para comparação com participantes do WhatsApp.
 * O WhatsApp às vezes guarda o número sem o 9 do celular.
 * Esta função remove DDI e (se aplicável) o 9 inicial pra permitir match.
 *
 * Use APENAS para comparação, nunca para gravar.
 *
 * @param {string|number} telefone
 * @returns {string}
 */
function telefoneParaComparacao(telefone) {
  let s = String(telefone || '').replace(/\D/g, '');
  if (s.startsWith('55')) s = s.slice(2);
  if (s.length === 11 && s[2] === '9') s = s.slice(0, 2) + s.slice(3);
  return s;
}

/**
 * Valida se um telefone canônico tem formato razoável.
 * Aceita 12 ou 13 dígitos (DDI + DDD + 8 ou 9 dígitos).
 */
function telefoneValido(telefone) {
  const s = String(telefone || '').replace(/\D/g, '');
  return /^55\d{10,11}$/.test(s);
}

/**
 * Escapa string para HTML (uso em renderização de templates).
 */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  formatarTelefone,
  telefoneParaComparacao,
  telefoneValido,
  escHtml,
};
