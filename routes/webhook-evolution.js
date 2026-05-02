/* ============================================================
   VIDA MÁGICA — routes/webhook-evolution.js
   Webhook entrante: WhatsApp → Evolution → este endpoint.

   Único cenário tratado: aluna toca "Solicite entrar pelo seu
   Whatsapp" no /auth, abre wa.me com texto contendo um token
   VMxxxxx, manda o zap. O webhook recebe, valida o token contra
   o telefone de origem, e enfileira o magic link de volta.

   Qualquer outra mensagem entrante (sem token, ou com token de
   outro telefone) é IGNORADA. Sistema fica calado pra ela —
   conversa humana fica entre a aluna e a equipe Su no celular.

   Banco: poolCore (acesso_solicitacoes, usuarios, otp_tokens)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { formatarTelefone } = require('../core/utils');
const {
  detectarTokenNaMensagem,
  marcarSolicitacaoUsada,
  buscarUsuarioPorTelefoneComOrigem,
  criarOuAtualizarUsuario,
  criarMagicToken,
} = require('../core/usuarios');
const { enfileirarAtendimento } = require('../core/gateway');

const APP_URL = process.env.APP_URL || 'https://www.vidamagica.com.br';

/**
 * Extrai o número do remetente do payload do Evolution.
 * Formato típico do Evolution v2: data.key.remoteJid = '5562999111222@s.whatsapp.net'
 */
function extrairTelefone(body) {
  try {
    const data = body?.data || body;
    const remoteJid = data?.key?.remoteJid
      || data?.message?.key?.remoteJid
      || data?.from
      || body?.from;
    if (!remoteJid) return null;
    // Strip "@s.whatsapp.net", "@c.us", etc.
    const num = String(remoteJid).split('@')[0].replace(/\D/g, '');
    return num || null;
  } catch (_) {
    return null;
  }
}

/**
 * Extrai o texto da mensagem do payload Evolution.
 * Cobre: conversation, extendedTextMessage, imageMessage caption, etc.
 */
function extrairTexto(body) {
  try {
    const data = body?.data || body;
    const msg = data?.message || data?.messages?.[0]?.message || {};
    return (
      msg.conversation
      || msg.extendedTextMessage?.text
      || msg.imageMessage?.caption
      || msg.videoMessage?.caption
      || msg.documentMessage?.caption
      || data?.text
      || body?.text
      || ''
    );
  } catch (_) {
    return '';
  }
}

/**
 * Detecta se a mensagem é "fromMe" (enviada por nós, não pela aluna).
 * Importante: Evolution pode mandar todos os eventos, inclusive os nossos.
 */
function ehMensagemNossa(body) {
  try {
    const data = body?.data || body;
    return data?.key?.fromMe === true || data?.fromMe === true;
  } catch (_) {
    return false;
  }
}

/**
 * Compara dois telefones brasileiros tolerando a ausência do "9" no celular.
 * WhatsApp pode entregar o remoteJid sem o 9 mesmo quando o número real tem.
 *
 * Considera equivalentes:
 *  - 5562999884411 (13 dígitos, com 9)  ==  556299884411 (12 dígitos, sem 9)
 *  - 5562983086320 (13)                  ==  556283086320 (12)
 * Não-BR ou já idênticos: comparação direta.
 */
function mesmoTelefoneBR(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Versão sem o 9 inicial do número (após DDI 55 + DDD)
  // Padrão BR celular: 55 (2) + DDD (2) + 9 (1) + 8 dígitos = 13
  // Sem o 9:           55 (2) + DDD (2) + 8 dígitos       = 12
  function semNove(num) {
    if (num.length === 13 && num.startsWith('55') && num[4] === '9') {
      return num.slice(0, 4) + num.slice(5);  // remove o 9 da posição 4
    }
    return num;
  }
  function comNove(num) {
    if (num.length === 12 && num.startsWith('55')) {
      return num.slice(0, 4) + '9' + num.slice(4);  // adiciona 9 na posição 4
    }
    return num;
  }
  return (
    semNove(a) === semNove(b) ||
    comNove(a) === comNove(b)
  );
}

router.post('/evolution', async (req, res) => {
  // RESPONDE 200 IMEDIATAMENTE pra Evolution não dar timeout.
  // Processamento real acontece em background.
  res.status(200).json({ received: true });

  // Validação opcional de token (configure EVOLUTION_WEBHOOK_TOKEN no Railway
  // E o mesmo header customizado no painel da Evolution se quiser proteger)
  const tokenEsperado = process.env.EVOLUTION_WEBHOOK_TOKEN;
  if (tokenEsperado) {
    const tokenRecebido = req.headers['x-evolution-token']
                       || req.headers['authorization']?.replace(/^Bearer\s+/i, '')
                       || req.query?.token;
    if (tokenRecebido !== tokenEsperado) {
      console.warn('[webhook-evolution] token inválido, ignorando');
      return;
    }
  }

  try {
    const body = req.body || {};

    // Ignora eventos que não são mensagem entrante
    const evento = body.event || body.type || '';
    if (evento && !/message/i.test(evento)) {
      return;
    }

    // Ignora mensagens enviadas POR NÓS (fromMe=true)
    if (ehMensagemNossa(body)) return;

    const telefoneOrigem = extrairTelefone(body);
    const texto = extrairTexto(body);

    if (!telefoneOrigem || !texto) {
      console.log('[webhook-evolution] payload sem telefone ou texto, ignorado');
      return;
    }

    console.log(`[webhook-evolution] mensagem de ${telefoneOrigem}: ${texto.slice(0, 80)}`);

    // ── Procurar token na mensagem ──────────────────────────
    const sol = await detectarTokenNaMensagem(texto);
    if (!sol) {
      // Mensagem sem token válido = conversa humana, sistema fica calado
      console.log('[webhook-evolution] sem token válido — ignorando (conversa humana)');
      return;
    }

    // ── Validar telefone bate ───────────────────────────────
    // Token foi gerado pra um telefone específico (digitado no /auth).
    // Origem do zap PRECISA bater. Tolera ausência do "9" no celular BR
    // (WhatsApp legado costuma omitir o 9 inicial em números antigos).
    const telefoneCanonico = formatarTelefone(telefoneOrigem);
    if (!mesmoTelefoneBR(telefoneCanonico, sol.telefone)) {
      console.warn(`[webhook-evolution] token ${sol.token} foi gerado pra ${sol.telefone}, mas zap veio de ${telefoneCanonico} — ignorado`);
      return;
    }

    // A partir daqui usamos o telefone do TOKEN (forma com 9, canônica do site)
    // pra todas as operações de banco e envio. Assim quem assinou no /auth é
    // quem fica registrado nos logs e em quem o magic link é mandado.
    const telefoneFinal = sol.telefone;

    // ── Marcar token como usado ─────────────────────────────
    // Antes de qualquer fila, pra garantir que não responde 2x se o webhook
    // for chamado novamente pelo mesmo evento.
    await marcarSolicitacaoUsada(sol.token);

    // ── Decidir cenário ─────────────────────────────────────
    const match = await buscarUsuarioPorTelefoneComOrigem(telefoneFinal);

    // 1. Telefone bate com HISTÓRICO (aluna trocou de número, mas histórico ativo).
    //    Reconhecemos a conta MAS não autenticamos. Mandamos aviso e paramos.
    if (match && match.origem === 'historico') {
      console.log(`[webhook-evolution] telefone histórico — enviando aviso "telefone_alterado"`);
      await enfileirarAtendimento({
        telefone: telefoneFinal,
        tipo: 'reativo',
        origem: 'webhook-evolution-telefone-alterado',
        nome: (match.usuario.nome || '').split(' ')[0] || '',
        mensagens: [
          { template: 'telefone_alterado', variaveis: {} },
        ],
      });
      return;
    }

    // 1b. Conta arquivada — sistema não responde nada. Conversa humana se ela quiser.
    if (match && match.usuario && (match.usuario.arquivada || match.usuario.status === 'arquivada')) {
      console.log(`[webhook-evolution] conta arquivada (${match.usuario.id}) — ignorando`);
      return;
    }

    // 2. Não achou em lugar nenhum — cria conta incompleta com origem='whatsapp'
    //    e segue pro fluxo normal de boas-vindas (cai na branch 3 abaixo).
    let usuario = match?.usuario || null;
    if (!usuario) {
      console.log(`[webhook-evolution] sem cadastro — criando conta incompleta com origem='whatsapp'`);
      usuario = await criarOuAtualizarUsuario({
        telefone: telefoneFinal,
        telefone_formatado: telefoneFinal,
        origem_cadastro: 'whatsapp',
      });
    }

    // Decide entre magic_login (cadastro completo) ou magic_boas_vindas (incompleto)
    const cadastroIncompleto = !usuario.nome || !usuario.email || !usuario.senha_hash;
    const tipoMagic    = cadastroIncompleto ? 'magic_boas_vindas'     : 'magic_login';
    const templateMsg1 = cadastroIncompleto ? 'magic_boas_vindas_msg1' : 'magic_login_msg1';

    const magicToken = await criarMagicToken(telefoneFinal, tipoMagic, 10);
    const magicUrl = `${APP_URL}/auth?magic=${magicToken}`;
    const primeiroNome = (usuario.nome || '').split(' ')[0] || '';

    await enfileirarAtendimento({
      telefone: telefoneFinal,
      tipo: 'reativo',
      origem: 'webhook-evolution-magic',
      nome: primeiroNome,
      mensagens: [
        { template: templateMsg1, variaveis: { nome: primeiroNome } },
        { texto: magicUrl },
      ],
    });

    // Atualiza solicitação com o magic token gerado (pro frontend saber)
    await marcarSolicitacaoUsada(sol.token, magicToken);

    console.log(`[webhook-evolution] ✅ magic link enfileirado pra ${primeiroNome || telefoneFinal} (${tipoMagic})`);

  } catch (err) {
    console.error('❌ [webhook-evolution]:', err);
  }
});

module.exports = router;
