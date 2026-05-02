// Notificações por e-mail.
// Hoje: lembrete de mensagem não lida da Suellen após 48h.
// Voz da Comunidade Vida Mágica.

const { poolCore, poolMensagens } = require('../db');

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SENDER_EMAIL  = process.env.SENDER_EMAIL  || 'contato@vidamagica.com.br';
const SENDER_NAME   = 'Comunidade Vida Mágica';
const APP_URL       = process.env.APP_URL || 'https://www.vidamagica.com.br';

async function enviarEmailBrevo({ to, toName, subject, htmlContent, textContent }) {
  if (!BREVO_API_KEY) {
    console.warn('[notif-email] BREVO_API_KEY ausente — skip');
    return false;
  }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': BREVO_API_KEY,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: SENDER_EMAIL, name: SENDER_NAME },
      to: [{ email: to, name: toName || to }],
      subject,
      htmlContent,
      textContent,
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    console.error('[notif-email] Brevo erro', r.status, err.slice(0, 200));
    return false;
  }
  return true;
}

// Template do e-mail "A Suellen falou com você"
function templateMsgNaoLida({ nome }) {
  const linkChat = `${APP_URL}/app#view-chat`;
  const primeiro = (nome || '').split(' ')[0] || '';
  const ola = primeiro ? `Oi, ${primeiro}` : 'Oi';
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F5EFDF;color:#3A3429">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#FFFAF0;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(60,40,10,0.10)">
        <tr><td style="padding:32px 32px 8px">
          <p style="margin:0 0 4px;font-size:0.78rem;letter-spacing:0.12em;text-transform:uppercase;color:#C8922A;font-weight:700">Vida Mágica</p>
          <h1 style="margin:0;font-size:1.45rem;color:#3A3429;font-weight:600;line-height:1.3">A Suellen te respondeu</h1>
        </td></tr>
        <tr><td style="padding:18px 32px 8px;font-size:0.95rem;line-height:1.55;color:#5F5E5A">
          ${ola}, a Suellen mandou uma mensagem pra você há 2 dias e você ainda não leu.
        </td></tr>
        <tr><td style="padding:24px 32px 36px" align="left">
          <a href="${linkChat}" style="display:inline-block;padding:13px 28px;background:#C8922A;color:#FFFAF0;font-weight:600;text-decoration:none;border-radius:10px;font-size:0.95rem">Abrir conversa</a>
        </td></tr>
        <tr><td style="padding:0 32px 28px;border-top:1px solid rgba(200,146,42,0.18);padding-top:18px;font-size:0.72rem;color:#8B8675;line-height:1.5">
          — Comunidade Vida Mágica
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${ola}, a Suellen mandou uma mensagem pra você há 2 dias e você ainda não leu.

Abrir conversa: ${linkChat}

— Comunidade Vida Mágica`;

  return {
    subject: 'A Suellen te respondeu na Vida Mágica',
    html,
    text,
  };
}

// Roda periodicamente — busca msgs do atendimento ainda NÃO LIDAS com mais de 48h,
// que ainda não receberam o e-mail (controlado por flag).
// Para evitar spam: só envia 1 vez por mensagem (flag email_lembrete_enviado_em).
async function tickLembrete48h() {
  if (!BREVO_API_KEY) return; // sem brevo configurado, skip silencioso

  // Adicionamos coluna na 1ª execução pra controlar quem já recebeu lembrete
  try {
    await poolMensagens.query(
      `ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS email_lembrete_em TIMESTAMPTZ`
    );
  } catch (_) {}

  // Busca msgs candidatas: do atendimento, não lidas, criadas há mais de 48h, sem lembrete
  const r = await poolMensagens.query(`
    SELECT m.id, m.conversa_id, m.usuario_id, m.conteudo, m.criado_em
      FROM chat_mensagens m
     WHERE m.remetente IN ('suellen','suporte')
       AND m.lida = FALSE
       AND m.criado_em < NOW() - INTERVAL '48 hours'
       AND m.email_lembrete_em IS NULL
     ORDER BY m.usuario_id, m.criado_em ASC
     LIMIT 200
  `);
  if (!r.rows.length) return;

  // Dedupe por usuario_id (1 e-mail por aluna por rodada, mesmo se ela tiver várias msgs)
  const porAluna = {};
  for (const m of r.rows) {
    if (!porAluna[m.usuario_id]) porAluna[m.usuario_id] = [];
    porAluna[m.usuario_id].push(m);
  }

  for (const usuarioId of Object.keys(porAluna)) {
    const msgs = porAluna[usuarioId];
    const u = await poolCore.query(
      `SELECT id, nome, email, status FROM usuarios WHERE id=$1`,
      [usuarioId]
    );
    const aluna = u.rows[0];
    if (!aluna || !aluna.email || aluna.status === 'arquivada') {
      // marca como tratada pra não tentar de novo
      const ids = msgs.map(m => m.id);
      await poolMensagens.query(
        `UPDATE chat_mensagens SET email_lembrete_em=NOW() WHERE id = ANY($1::int[])`,
        [ids]
      );
      continue;
    }
    const t = templateMsgNaoLida({ nome: aluna.nome });
    const ok = await enviarEmailBrevo({
      to: aluna.email,
      toName: aluna.nome,
      subject: t.subject,
      htmlContent: t.html,
      textContent: t.text,
    });
    if (ok) {
      const ids = msgs.map(m => m.id);
      await poolMensagens.query(
        `UPDATE chat_mensagens SET email_lembrete_em=NOW() WHERE id = ANY($1::int[])`,
        [ids]
      );
      console.log(`[notif-email] Enviado pra ${aluna.email} (${msgs.length} msg(s))`);
    }
  }
}

let _intervaloLembrete = null;

function iniciarSchedulerLembrete() {
  if (_intervaloLembrete) return;
  // Roda a cada 1 hora. Primeira execução: 60s após boot.
  setTimeout(() => {
    tickLembrete48h().catch(err => console.error('[notif-email tick]', err.message));
  }, 60 * 1000);
  _intervaloLembrete = setInterval(() => {
    tickLembrete48h().catch(err => console.error('[notif-email tick]', err.message));
  }, 60 * 60 * 1000);
  console.log('📨 Scheduler de lembrete por e-mail (48h) iniciado');
}

function pararSchedulerLembrete() {
  if (_intervaloLembrete) clearInterval(_intervaloLembrete);
  _intervaloLembrete = null;
}

module.exports = {
  iniciarSchedulerLembrete,
  pararSchedulerLembrete,
  tickLembrete48h,
};
