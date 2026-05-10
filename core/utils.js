/* ============================================================
   VIDA MÁGICA — utils.js
   Funções compartilhadas entre todos os módulos.

   Banco: nenhum (utilitários puros).

   Regras desta camada:
   - Toda normalização de telefone passa por aqui.
   - Toda formatação canônica passa por aqui.
   - Nenhum módulo deve reimplementar essas funções.
   ============================================================ */

/**
 * Normaliza telefone para o formato canônico do sistema (E.164 sem o '+').
 *
 * A partir desta versão o sistema aceita números INTERNACIONAIS — o public
 * frontend usa intl-tel-input e envia o número já em formato E.164
 * (`+5562983086320`, `+351912345678`, `+12025550100`). Esta função:
 *
 *   1. Remove tudo que não é dígito (incluindo o '+');
 *   2. Se o número não tem DDI (10 ou 11 dígitos), assume Brasil — comportamento
 *      legado pra retrocompatibilidade com formularios antigos sem seletor de país.
 *   3. Caso contrário, retorna o que veio (com DDI).
 *
 * Ex: '(62) 98308-6320'      → '5562983086320'  (legado: assume Brasil)
 *     '+55 62 98308-6320'    → '5562983086320'  (já internacional)
 *     '+351 912 345 678'     → '351912345678'   (Portugal, preserva)
 *     '5562983086320'        → '5562983086320'  (já canônico, identidade)
 *
 * @param {string|number} telefone
 * @returns {string} telefone canônico (DDI + DDD + número, sem '+')
 */
function formatarTelefone(telefone) {
  if (telefone === null || telefone === undefined) return '';
  const num = String(telefone).replace(/\D/g, '');
  if (!num) return '';
  // Heurística retrocompatível: 10 ou 11 dígitos sem DDI → Brasil legado.
  // Forma única só pra clientes antigos. O frontend novo (intl-tel-input)
  // sempre manda com DDI, então cai no `return num` direto.
  if (num.length === 10 || num.length === 11) return `55${num}`;
  if (num.startsWith('0') && (num.length === 11 || num.length === 12)) {
    return `55${num.slice(1)}`;
  }
  return num;
}

/**
 * Variação do telefone para comparação com participantes do WhatsApp.
 * O WhatsApp às vezes guarda o número sem o 9 do celular.
 * Esta função remove DDI e (se aplicável) o 9 inicial pra permitir match.
 *
 * Use APENAS para comparação, nunca para gravar.
 *
 * NOTA: a heurística do "9" só faz sentido para Brasil (DDI 55).
 * Pra outros países, retorna o número sem DDI sem mexer.
 *
 * @param {string|number} telefone
 * @returns {string}
 */
function telefoneParaComparacao(telefone) {
  let s = String(telefone || '').replace(/\D/g, '');
  // Brasil: tira DDI 55 e gambiarra do 9
  if (s.startsWith('55') && (s.length === 12 || s.length === 13)) {
    s = s.slice(2);
    if (s.length === 11 && s[2] === '9') s = s.slice(0, 2) + s.slice(3);
    return s;
  }
  // Outros países: tenta tirar DDI conhecido (1-3 dígitos) — heurística simples.
  // Lista mínima: EUA/Canadá (1), Reino Unido (44), Portugal (351), Espanha (34),
  // Argentina (54), Chile (56), México (52), Itália (39), França (33), Alemanha (49).
  const ddisConhecidos = ['351','44','34','54','56','52','39','33','49','1'];
  for (const d of ddisConhecidos) {
    if (s.startsWith(d) && s.length > d.length + 6) {
      return s.slice(d.length);
    }
  }
  return s;
}

/**
 * Valida se um telefone canônico tem formato razoável.
 * Aceita E.164: 8 a 15 dígitos no total (recomendação ITU-T).
 * Brasil sempre cai em 12 ou 13 dígitos (55 + 10 ou 11).
 */
function telefoneValido(telefone) {
  const s = String(telefone || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(s)) return false;
  // Brasileiro: exige formato exato
  if (s.startsWith('55')) return /^55\d{10,11}$/.test(s);
  // Outros países: aceita qualquer comprimento E.164 válido
  return true;
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
