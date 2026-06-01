/* === VIDA MÁGICA — core/espaco-avisos.js ===
   Banco: poolEspaco (cartas) + poolCore (identidade da aluna) + poolComunicacao (via gateway)

   Worker que dispara avisos quando uma CARTA DO TEMPO fica madura
   (abrir_em <= NOW() e aviso_enviado_em IS NULL).

   Canais (todos idempotentes via cartas_do_tempo_avisos com UNIQUE(carta_id, canal)):
   1. WhatsApp — enfileira no gateway (categoria 'carta_do_tempo')
   2. Email    — Brevo direto
   3. In-app   — só marca o registro; o banner virá quando hidratarmos no /contexto
                 da Home (a Carta do Tempo entrega o aviso quando a aluna abrir o app).

   Roda em loop a cada 10 minutos. Cartas podem maturar a qualquer hora,
   latência de 10min é aceitável.

   Adaptado de core/caderno-avisos.js (deletado quando o Caderno saiu).
   === */

const axios = require('axios');
const { poolEspaco, poolCore } = require('../db');
const { enfileirarAtendimento } = require('./gateway');

const APP_URL = process.env.APP_URL || 'https://www.vidamagica.com.br';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'sistema@suellenseragi.com.br';
const BREVO_API_KEY = process.env.BREVO_API_KEY;

let intervalId = null;

// ⚠️ MODO DEV ⚠️ — tick rápido (1 min) pra o Renato ver o aviso chegar logo
// depois de lacrar uma carta de teste (preset "Em instantes"). Casado com
// CARTA_DEV_SEM_MINIMO em routes/espaco.js. TROCAR PRA false (volta a 10 min)
// antes de abrir pras alunas reais.
const DEV_TICK_RAPIDO = true;
const INTERVALO_MS = (DEV_TICK_RAPIDO ? 1 : 10) * 60 * 1000;
const PRIMEIRO_RUN_MS = DEV_TICK_RAPIDO ? 15 * 1000 : 30 * 1000;

// ── ENVIO POR CANAL ────────────────────────────────────────

async function enviarWhatsApp(carta, usuario) {
  if (!usuario.telefone) return { canal: 'whatsapp', ok: false, motivo: 'sem_telefone' };
  try {
    const ins = await poolEspaco.query(
      `INSERT INTO cartas_do_tempo_avisos (carta_id, canal)
       VALUES ($1, 'whatsapp')
       ON CONFLICT (carta_id, canal) DO NOTHING
       RETURNING id`,
      [carta.id]
    );
    if (!ins.rows[0]) return { canal: 'whatsapp', ok: true, motivo: 'ja_enviado' };

    const primeiroNome = (usuario.nome || '').split(' ')[0] || 'você';
    const titulo = carta.titulo ? `"${carta.titulo}"` : '';
    const mensagens = [
      `Oi ${primeiroNome} ✨`,
      `Sua Carta do Tempo ${titulo} chegou.\n\nVocê escreveu pra esse momento. Quer ler agora?\n\n👉 ${APP_URL}/espaco`,
    ];
    await enfileirarAtendimento({
      telefone: usuario.telefone,
      tipo: 'ativo',
      categoria: 'carta_do_tempo',
      mensagens: mensagens.map(texto => ({ texto, midias: [] })),
    });
    return { canal: 'whatsapp', ok: true };
  } catch (err) {
    console.error('[espaco-avisos] WhatsApp erro:', err.message);
    return { canal: 'whatsapp', ok: false, erro: err.message };
  }
}

async function enviarEmail(carta, usuario) {
  if (!usuario.email || !BREVO_API_KEY) {
    return { canal: 'email', ok: false, motivo: !usuario.email ? 'sem_email' : 'sem_brevo_key' };
  }
  try {
    const ins = await poolEspaco.query(
      `INSERT INTO cartas_do_tempo_avisos (carta_id, canal)
       VALUES ($1, 'email')
       ON CONFLICT (carta_id, canal) DO NOTHING
       RETURNING id`,
      [carta.id]
    );
    if (!ins.rows[0]) return { canal: 'email', ok: true, motivo: 'ja_enviado' };

    const primeiroNome = (usuario.nome || '').split(' ')[0] || 'você';
    const tituloShow = carta.titulo || 'Sua Carta do Tempo';
    const link = `${APP_URL}/espaco`;

    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Vida Mágica', email: SENDER_EMAIL },
      to: [{ email: usuario.email, name: primeiroNome }],
      subject: `💌 ${tituloShow} chegou`,
      htmlContent: `
        <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:40px 28px;background:linear-gradient(135deg,#FFF6E0,#FAE9B0);border-radius:18px;border:1px solid #C8922A">
          <div style="text-align:center;font-size:48px;margin-bottom:8px">💌</div>
          <h2 style="color:#3D2E1A;font-size:22px;margin:0 0 16px;text-align:center;font-weight:700">Sua Carta chegou, ${primeiroNome}!</h2>
          <p style="color:#6B5436;font-size:15px;line-height:1.5;margin:0 0 24px;text-align:center">
            Você escreveu pra esse momento. A carta que você lacrou está esperando você abrir.
          </p>
          <div style="text-align:center;margin:28px 0">
            <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#C8922A,#A17523);color:white;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700;font-size:15px;box-shadow:0 4px 18px rgba(200,146,42,0.4)">Abrir minha carta</a>
          </div>
          <p style="color:#A17523;font-size:13px;margin:24px 0 0;text-align:center;font-style:italic">
            "${tituloShow}"
          </p>
          <hr style="margin:24px 0;border:none;border-top:1px solid rgba(200,146,42,0.3)">
          <p style="color:#888;font-size:11px;margin:0;text-align:center">
            Você está recebendo este email porque escreveu uma Carta do Tempo no Vida Mágica.
          </p>
        </div>
      `,
    }, {
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
    });
    return { canal: 'email', ok: true };
  } catch (err) {
    console.error('[espaco-avisos] Email erro:', err.message);
    return { canal: 'email', ok: false, erro: err.message };
  }
}

async function marcarInApp(carta) {
  try {
    await poolEspaco.query(
      `INSERT INTO cartas_do_tempo_avisos (carta_id, canal)
       VALUES ($1, 'in_app')
       ON CONFLICT (carta_id, canal) DO NOTHING`,
      [carta.id]
    );
    return { canal: 'in_app', ok: true };
  } catch (err) {
    return { canal: 'in_app', ok: false, erro: err.message };
  }
}

// ── PROCESSAMENTO ──────────────────────────────────────────

async function processarCartasMaduras() {
  try {
    // 1) Acha cartas maduras (no banco poolEspaco — sem JOIN com poolCore!)
    const rc = await poolEspaco.query(
      `SELECT id, titulo, abrir_em, usuario_id
         FROM cartas_do_tempo
        WHERE abrir_em <= NOW()
          AND aviso_enviado_em IS NULL
        ORDER BY abrir_em ASC
        LIMIT 50`
    );
    if (rc.rows.length === 0) return 0;

    // 2) Busca os usuários correspondentes em poolCore (cruzamento em código)
    const ids = [...new Set(rc.rows.map(c => c.usuario_id))];
    const ru = await poolCore.query(
      `SELECT id, nome, telefone, email, COALESCE(arquivada, FALSE) AS arquivada, status
         FROM usuarios
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    const porId = new Map(ru.rows.map(u => [u.id, u]));

    console.log(`📬 Worker cartas: ${rc.rows.length} carta(s) madura(s) pra processar`);
    let processadas = 0;
    for (const carta of rc.rows) {
      const usuario = porId.get(carta.usuario_id);
      if (!usuario || usuario.arquivada || ['legado','banido'].includes(String(usuario.status || ''))) {
        // Aluna inativa: só marca como avisada pra não reprocessar
        await poolEspaco.query(`UPDATE cartas_do_tempo SET aviso_enviado_em = NOW() WHERE id = $1`, [carta.id]);
        continue;
      }
      const resultados = await Promise.all([
        enviarWhatsApp(carta, usuario),
        enviarEmail(carta, usuario),
        marcarInApp(carta),
      ]);
      const algumOk = resultados.some(r => r.ok);
      if (algumOk) {
        await poolEspaco.query(`UPDATE cartas_do_tempo SET aviso_enviado_em = NOW() WHERE id = $1`, [carta.id]);
        processadas++;
        console.log(`📬 Carta #${carta.id} avisada — ${resultados.map(r => `${r.canal}:${r.ok ? 'ok' : 'falha'}`).join(', ')}`);
      } else {
        console.warn(`⚠️ Carta #${carta.id}: nenhum canal funcionou`);
      }
    }
    return processadas;
  } catch (err) {
    console.error('[espaco-avisos] processarCartasMaduras erro:', err.message);
    return 0;
  }
}

// ── TESTE MANUAL DE ENVIO (modo dev) ───────────────────────
// Dispara um WhatsApp + email de TESTE pro próprio cadastro, SEM carta e SEM
// idempotência (não grava em cartas_do_tempo_avisos). Serve pra o Renato
// confirmar que os dois canais realmente funcionam. Reporta o motivo da falha.

async function enviarTesteWhatsApp(usuario) {
  if (!usuario.telefone) return { ok: false, motivo: 'sem telefone no cadastro' };
  try {
    const primeiroNome = (usuario.nome || '').split(' ')[0] || 'você';
    await enfileirarAtendimento({
      telefone: usuario.telefone,
      tipo: 'ativo',
      categoria: 'carta_do_tempo',
      mensagens: [{
        texto: `Oi ${primeiroNome} ✨\n\nEste é um teste de envio da Carta do Tempo. Se você recebeu isto, o WhatsApp está funcionando.`,
        midias: [],
      }],
    });
    return { ok: true, motivo: 'enfileirado no gateway (deve chegar em segundos)' };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

async function enviarTesteEmail(usuario) {
  if (!usuario.email) return { ok: false, motivo: 'sem email no cadastro' };
  if (!BREVO_API_KEY) return { ok: false, motivo: 'BREVO_API_KEY ausente no ambiente' };
  try {
    const primeiroNome = (usuario.nome || '').split(' ')[0] || 'você';
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Vida Mágica', email: SENDER_EMAIL },
      to: [{ email: usuario.email, name: primeiroNome }],
      subject: '💌 Teste de envio — Carta do Tempo',
      htmlContent: `
        <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:40px 28px;background:linear-gradient(135deg,#FFF6E0,#FAE9B0);border-radius:18px;border:1px solid #C8922A">
          <div style="text-align:center;font-size:48px;margin-bottom:8px">💌</div>
          <h2 style="color:#3D2E1A;font-size:22px;margin:0 0 16px;text-align:center;font-weight:700">Teste de envio</h2>
          <p style="color:#6B5436;font-size:15px;line-height:1.5;margin:0;text-align:center">
            Se você está lendo isto, o e-mail da Carta do Tempo está funcionando, ${primeiroNome}.
          </p>
        </div>`,
    }, {
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
    });
    return { ok: true, motivo: 'aceito pela Brevo (confira caixa de entrada / spam)' };
  } catch (e) {
    return { ok: false, motivo: e.response?.data?.message || e.message };
  }
}

// ── WORKER ─────────────────────────────────────────────────

function iniciarWorkerCartas() {
  if (intervalId) return;
  console.log(`📬 Worker de Cartas do Tempo iniciado (loop a cada ${INTERVALO_MS / 60000} min${DEV_TICK_RAPIDO ? ' — MODO DEV' : ''})`);
  // Roda 1x logo após iniciar (sem esperar o primeiro tick cheio)
  setTimeout(() => { processarCartasMaduras().catch(() => {}); }, PRIMEIRO_RUN_MS);
  intervalId = setInterval(() => { processarCartasMaduras().catch(() => {}); }, INTERVALO_MS);
}

function pararWorkerCartas() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; console.log('📬 Worker de Cartas parado'); }
}

module.exports = { processarCartasMaduras, iniciarWorkerCartas, pararWorkerCartas, enviarWhatsApp, enviarEmail, enviarTesteWhatsApp, enviarTesteEmail };
