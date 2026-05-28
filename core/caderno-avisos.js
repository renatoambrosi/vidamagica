/* === VIDA MÁGICA — core/caderno-avisos.js ===
   Banco: poolCore + poolComunicacao (via gateway)

   Worker que dispara avisos quando uma Cápsula do Tempo fica madura
   (abrir_em <= NOW() e aviso_enviado_em IS NULL).

   Canais (todos idempotentes via tabela caderno_capsula_avisos com
   UNIQUE(capsula_id, canal)):

   1. WhatsApp — enfileira no gateway (categoria 'caderno_capsula', ativo)
   2. Email   — Brevo direto (mesmo padrão de routes/auth.js)
   3. In-app  — não dispara nada; o /api/app/contexto já entrega o
                indicador `caderno.capsula_madura_pendente` toda vez
                que a aluna abre o app. O banner dourado aparece
                automaticamente. Marcamos aqui pro histórico.
   4. Push    — placeholder. VAPID pra aluna não existe ainda. Quando
                rolar, é só ligar aqui.

   Roda em loop a cada 10 minutos. Cápsulas podem maturar a qualquer hora,
   mas latência de 10min é aceitável (não é mensagem em tempo real).

   IMPORTANT: depois de marcar aviso_enviado_em, a próxima visita da
   aluna mostra o banner E o app já avisou pelos canais externos.
   === */

const axios = require('axios');
const { poolCore } = require('../db');
const { enfileirarAtendimento } = require('./gateway');

const APP_URL = process.env.APP_URL || 'https://www.vidamagica.com.br';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'sistema@suellenseragi.com.br';
const BREVO_API_KEY = process.env.BREVO_API_KEY;

let intervalId = null;
const INTERVALO_MS = 10 * 60 * 1000; // 10 minutos

// ── ENVIO POR CANAL ────────────────────────────────────────

async function enviarWhatsApp(capsula, usuario) {
  if (!usuario.telefone) return { canal: 'whatsapp', ok: false, motivo: 'sem_telefone' };

  // Idempotência: insere registro ANTES de enfileirar. Se já existe (UNIQUE),
  // não dispara de novo. Garante "exactly once" mesmo com worker rodando 2x.
  try {
    const ins = await poolCore.query(
      `INSERT INTO caderno_capsula_avisos (capsula_id, canal, status)
       VALUES ($1, 'whatsapp', 'enfileirando')
       ON CONFLICT (capsula_id, canal) DO NOTHING
       RETURNING id`,
      [capsula.id]
    );
    if (!ins.rows[0]) {
      return { canal: 'whatsapp', ok: true, motivo: 'ja_enviado' };
    }

    const primeiroNome = (usuario.nome || '').split(' ')[0] || 'amor';
    const titulo = capsula.titulo ? `"${capsula.titulo}"` : '';

    const mensagens = [
      `Oi ${primeiroNome} 💛`,
      `Sua Cápsula do Tempo ${titulo} chegou!\n\nVocê escreveu pra esse momento. Quer ler agora?\n\n👉 ${APP_URL}/app/caderno`,
    ];

    await enfileirarAtendimento({
      telefone: usuario.telefone,
      tipo: 'ativo',
      categoria: 'caderno_capsula',
      mensagens: mensagens.map(texto => ({ texto, midias: [] })),
    });

    await poolCore.query(
      `UPDATE caderno_capsula_avisos SET status = 'enfileirado', enviado_em = NOW()
        WHERE capsula_id = $1 AND canal = 'whatsapp'`,
      [capsula.id]
    );
    return { canal: 'whatsapp', ok: true };
  } catch (err) {
    console.error('[caderno-avisos] WhatsApp erro:', err.message);
    await poolCore.query(
      `UPDATE caderno_capsula_avisos SET status = 'erro', detalhe = $2
        WHERE capsula_id = $1 AND canal = 'whatsapp'`,
      [capsula.id, err.message.slice(0, 500)]
    ).catch(() => {});
    return { canal: 'whatsapp', ok: false, erro: err.message };
  }
}

async function enviarEmail(capsula, usuario) {
  if (!usuario.email || !BREVO_API_KEY) {
    return { canal: 'email', ok: false, motivo: !usuario.email ? 'sem_email' : 'sem_brevo_key' };
  }

  try {
    const ins = await poolCore.query(
      `INSERT INTO caderno_capsula_avisos (capsula_id, canal, status)
       VALUES ($1, 'email', 'enviando')
       ON CONFLICT (capsula_id, canal) DO NOTHING
       RETURNING id`,
      [capsula.id]
    );
    if (!ins.rows[0]) {
      return { canal: 'email', ok: true, motivo: 'ja_enviado' };
    }

    const primeiroNome = (usuario.nome || '').split(' ')[0] || 'você';
    const tituloShow = capsula.titulo || 'Sua Cápsula do Tempo';
    const link = `${APP_URL}/app/caderno`;

    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Vida Mágica', email: SENDER_EMAIL },
      to: [{ email: usuario.email, name: primeiroNome }],
      subject: `💌 ${tituloShow} chegou`,
      htmlContent: `
        <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:40px 28px;background:linear-gradient(135deg,#FFF6E0,#FAE9B0);border-radius:18px;border:1px solid #C8922A">
          <div style="text-align:center;font-size:48px;margin-bottom:8px">💌</div>
          <h2 style="color:#3D2E1A;font-size:22px;margin:0 0 16px;text-align:center;font-weight:700">Sua Cápsula chegou, ${primeiroNome}!</h2>
          <p style="color:#6B5436;font-size:15px;line-height:1.5;margin:0 0 24px;text-align:center">
            Você escreveu pra esse momento. A carta que você lacrou está esperando você abrir.
          </p>
          <div style="text-align:center;margin:28px 0">
            <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#C8922A,#A17523);color:white;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700;font-size:15px;box-shadow:0 4px 18px rgba(200,146,42,0.4)">Abrir minha cápsula</a>
          </div>
          <p style="color:#A17523;font-size:13px;margin:24px 0 0;text-align:center;font-style:italic">
            "${tituloShow}"
          </p>
          <hr style="margin:24px 0;border:none;border-top:1px solid rgba(200,146,42,0.3)">
          <p style="color:#888;font-size:11px;margin:0;text-align:center">
            Você está recebendo este email porque marcou pra ser avisada quando uma Cápsula do Tempo do Vida Mágica ficasse pronta.
          </p>
        </div>
      `,
    }, {
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
    });

    await poolCore.query(
      `UPDATE caderno_capsula_avisos SET status = 'enviado', enviado_em = NOW()
        WHERE capsula_id = $1 AND canal = 'email'`,
      [capsula.id]
    );
    return { canal: 'email', ok: true };
  } catch (err) {
    console.error('[caderno-avisos] Email erro:', err.message);
    await poolCore.query(
      `UPDATE caderno_capsula_avisos SET status = 'erro', detalhe = $2
        WHERE capsula_id = $1 AND canal = 'email'`,
      [capsula.id, err.message.slice(0, 500)]
    ).catch(() => {});
    return { canal: 'email', ok: false, erro: err.message };
  }
}

async function marcarInApp(capsula) {
  // In-app é "automatically delivered" via /contexto. Aqui só registra
  // que essa cápsula entrou em estado madura — UI pega via banner.
  try {
    await poolCore.query(
      `INSERT INTO caderno_capsula_avisos (capsula_id, canal, status)
       VALUES ($1, 'in_app', 'pronto')
       ON CONFLICT (capsula_id, canal) DO NOTHING`,
      [capsula.id]
    );
    return { canal: 'in_app', ok: true };
  } catch (err) {
    return { canal: 'in_app', ok: false, erro: err.message };
  }
}

// ── PROCESSAMENTO ──────────────────────────────────────────

/**
 * Acha cápsulas maduras sem aviso disparado e dispara nos 3 canais.
 * Retorna número de cápsulas processadas.
 */
async function processarCapsulasMaduras() {
  try {
    // Pega cápsulas elegíveis (limite 50 por rodada pra não travar)
    const r = await poolCore.query(
      `SELECT c.id, c.titulo, c.conteudo, c.abrir_em, c.usuario_id,
              u.nome, u.telefone, u.email, u.arquivada, u.status
         FROM caderno_capsulas c
         JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.abrir_em <= NOW()
          AND c.aviso_enviado_em IS NULL
          AND COALESCE(u.arquivada, FALSE) = FALSE
          AND u.status NOT IN ('legado','banido')
        ORDER BY c.abrir_em ASC
        LIMIT 50`
    );

    if (r.rows.length === 0) return 0;

    let processadas = 0;
    for (const capsula of r.rows) {
      const usuario = {
        nome: capsula.nome,
        telefone: capsula.telefone,
        email: capsula.email,
      };

      const resultados = await Promise.all([
        enviarWhatsApp(capsula, usuario),
        enviarEmail(capsula, usuario),
        marcarInApp(capsula),
      ]);

      const algumOk = resultados.some(r => r.ok);
      if (algumOk) {
        await poolCore.query(
          `UPDATE caderno_capsulas SET aviso_enviado_em = NOW() WHERE id = $1`,
          [capsula.id]
        );
        processadas++;
        console.log(`📬 Cápsula ${capsula.id} avisada — ${resultados.map(r => `${r.canal}:${r.ok ? 'ok' : 'falha'}`).join(', ')}`);
      } else {
        console.warn(`⚠️ Cápsula ${capsula.id}: nenhum canal funcionou`);
      }
    }
    return processadas;
  } catch (err) {
    console.error('[caderno-avisos] processarCapsulasMaduras erro:', err.message);
    return 0;
  }
}

// ── WORKER ─────────────────────────────────────────────────

function iniciarWorkerCapsulas() {
  if (intervalId) return;
  console.log(`📬 Worker de cápsulas do Caderno iniciado (loop a cada ${INTERVALO_MS / 60000} min)`);
  // Roda 1x logo após iniciar (sem esperar 10min do primeiro tick)
  setTimeout(() => { processarCapsulasMaduras().catch(() => {}); }, 30000);
  intervalId = setInterval(() => {
    processarCapsulasMaduras().catch(() => {});
  }, INTERVALO_MS);
}

function pararWorkerCapsulas() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('📬 Worker de cápsulas parado');
  }
}

module.exports = {
  processarCapsulasMaduras,
  iniciarWorkerCapsulas,
  pararWorkerCapsulas,
  enviarWhatsApp,
  enviarEmail,
};
