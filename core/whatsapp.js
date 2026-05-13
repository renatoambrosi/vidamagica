/* ============================================================
   VIDA MÁGICA — core/whatsapp.js
   Envio de mensagens WhatsApp via Evolution API.

   Banco: nenhum (cliente HTTP puro).

   Esta é a camada de baixo nível: dispara mensagem direto.
   Quem precisa de fila/cooldown deve usar o módulo de fila
   (Banco Comunicação), que internamente chama daqui.

   Regras desta camada:
   - Telefone DEVE estar no formato canônico antes de chamar.
   - Não retenta automaticamente em caso de erro.
   - Loga sucesso/erro mas não persiste (quem chama decide).
   ============================================================ */

const axios = require('axios');

const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE;

function instance() {
  return encodeURIComponent(EVOLUTION_INSTANCE || '');
}

function checaConfig() {
  if (!EVOLUTION_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    throw new Error('EVOLUTION_URL, EVOLUTION_API_KEY ou EVOLUTION_INSTANCE não configurados');
  }
}

/**
 * Envia mensagem de texto via Evolution.
 * @param {string} telefoneCanonico — já normalizado (55+DDD+número)
 * @param {string} mensagem
 * @returns {Promise<boolean>}
 */
async function enviarTexto(telefoneCanonico, mensagem) {
  checaConfig();
  try {
    await axios.post(
      `${EVOLUTION_URL}/message/sendText/${instance()}`,
      { number: telefoneCanonico, text: mensagem },
      {
        headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );
    console.log(`📤 WhatsApp enviado: ${telefoneCanonico}`);
    return true;
  } catch (err) {
    const detalhe = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`❌ Erro WhatsApp (${telefoneCanonico}): ${detalhe}`);
    return false;
  }
}

/**
 * Busca participantes de um grupo.
 * @param {string} groupJid — ex: '120363407525402346@g.us'
 * @returns {Promise<string[]>} array de números (formato bruto da Evolution)
 */
async function listarParticipantesGrupo(groupJid) {
  checaConfig();
  try {
    const resp = await axios.get(
      `${EVOLUTION_URL}/group/participants/${instance()}`,
      {
        params: { groupJid },
        headers: { apikey: EVOLUTION_API_KEY },
        timeout: 10000,
      }
    );
    const participants = resp.data?.participants || [];
    return participants
      .map(p => (p.phoneNumber || p.id || '').replace(/@.*/, ''))
      .filter(Boolean);
  } catch (err) {
    console.error(`❌ Erro ao listar participantes ${groupJid}:`, err.message);
    return [];
  }
}

/**
 * Busca o invite link de um grupo.
 * @param {string} groupJid
 * @returns {Promise<string|null>}
 */
async function buscarInviteLink(groupJid) {
  checaConfig();
  try {
    const resp = await axios.get(
      `${EVOLUTION_URL}/group/inviteCode/${instance()}`,
      {
        params: { groupJid },
        headers: { apikey: EVOLUTION_API_KEY },
        timeout: 10000,
      }
    );
    const code = resp.data?.inviteCode || resp.data?.code;
    return code ? `https://chat.whatsapp.com/${code}` : null;
  } catch (err) {
    console.error(`❌ Erro ao buscar invite ${groupJid}:`, err.message);
    return null;
  }
}

/**
 * Remove participante de um grupo.
 */
async function removerDoGrupo(groupJid, telefoneCanonico) {
  checaConfig();
  try {
    const resp = await axios.post(
      `${EVOLUTION_URL}/group/updateParticipant/${instance()}`,
      { groupJid, action: 'remove', participants: [telefoneCanonico] },
      {
        headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    const data = resp.data;
    const item = Array.isArray(data) ? data[0] : data;
    const status = item?.status || item?.message || '';
    return resp.status === 200 && !String(status).toLowerCase().includes('error');
  } catch (err) {
    console.error(`❌ Erro ao remover ${telefoneCanonico} de ${groupJid}:`, err.message);
    return false;
  }
}

module.exports = {
  enviarTexto,
  listarParticipantesGrupo,
  buscarInviteLink,
  removerDoGrupo,
};
