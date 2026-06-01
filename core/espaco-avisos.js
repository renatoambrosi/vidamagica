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
// Remetente VERIFICADO no Brevo = contato@suellenseragi.com.br (a conta "Suellen
// Seragi", que tem o avatar). sistema@ não é verificado — não usar. Pode sobrescrever
// por env SENDER_EMAIL, mas o default agora é o endereço certo.
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'contato@suellenseragi.com.br';
const BREVO_API_KEY = process.env.BREVO_API_KEY;

// Logo Vida Mágica (vertical) no topo do corpo do e-mail. Renato sobe o arquivo
// em public/assets/ como 'logo-vertical.png' (e-mail NÃO renderiza WEBP — tem que
// ser PNG/JPG). Pode trocar por env EMAIL_LOGO_URL. Enquanto o PNG não estiver no
// ar, aparece um ícone de imagem quebrada — então suba o PNG junto com o deploy.
const EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL || `${APP_URL}/assets/logo-vertical.png`;

let intervalId = null;

// ⚠️ MODO DEV ⚠️ — tick rápido (1 min) pra o Renato ver o aviso chegar logo
// depois de lacrar uma carta de teste (preset "Em instantes"). Casado com
// CARTA_DEV_SEM_MINIMO em routes/espaco.js. TROCAR PRA false (volta a 10 min)
// antes de abrir pras alunas reais.
const DEV_TICK_RAPIDO = true;
const INTERVALO_MS = (DEV_TICK_RAPIDO ? 1 : 10) * 60 * 1000;
const PRIMEIRO_RUN_MS = DEV_TICK_RAPIDO ? 15 * 1000 : 30 * 1000;

// ── MONTAGEM DA MENSAGEM (copy + layout FINAIS, voz da Su) ──
// Separado do envio pra que o "ver o que a aluna recebe" (modo dev) e o worker
// de produção usem EXATAMENTE a mesma mensagem. Mudou a copy? Muda aqui, só aqui.

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// WhatsApp: array de mensagens (o gateway manda em sequência, "digitando").
function montarWhatsApp(carta, usuario) {
  const primeiroNome = (usuario.nome || '').split(' ')[0] || 'você';
  const link = `${APP_URL}/espaco?ver=cartas`;
  const sobreTitulo = carta.titulo ? ` — "${carta.titulo}"` : '';
  return [
    `Oi, ${primeiroNome} ✨`,
    `Chegou o dia. 💌\n\nA carta que você guardou no tempo${sobreTitulo} está pronta pra ser aberta. Você escreveu ela pra viver exatamente este momento.\n\nQuer abrir agora?\n👉 ${link}`,
  ];
}

// E-mail: { subject, htmlContent } — layout Vida Mágica (creme + dourado).
function montarEmailCarta(carta, usuario) {
  const primeiroNome = escapeHtml((usuario.nome || '').split(' ')[0] || 'você');
  const tituloShow = escapeHtml(carta.titulo || 'Sua Carta do Tempo');
  const temTitulo = !!carta.titulo;
  const link = `${APP_URL}/espaco?ver=cartas`;

  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- Pede pro cliente NÃO inverter pro modo escuro (Apple Mail / Gmail desktop
       respeitam; Gmail mobile às vezes ignora — limitação conhecida de e-mail). -->
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#FFFFFF;">
    <div style="max-width:560px;margin:0 auto;padding:32px 18px;font-family:Georgia,'Times New Roman',serif;">

      <!-- Topo: logo Vida Mágica vertical (PNG). Centralizada, largura fixa. -->
      <div style="text-align:center;margin-bottom:24px">
        <img src="${EMAIL_LOGO_URL}" alt="Vida Mágica" width="150" style="width:150px;max-width:55%;height:auto;display:inline-block;border:0">
      </div>

      <!-- Cartão -->
      <div style="background:linear-gradient(160deg,#FFFDF6,#FBF0D6);border:1px solid #DDB85E;border-radius:22px;padding:40px 32px;box-shadow:0 14px 40px rgba(120,86,20,0.16)">

        <p style="margin:0 0 14px;text-align:center;color:#A17523;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:700">
          Vida Mágica · Carta do Tempo
        </p>

        <h1 style="margin:0 0 18px;text-align:center;color:#3D2A12;font-size:25px;line-height:1.3;font-weight:700">
          Chegou o dia, ${primeiroNome}.
        </h1>

        <p style="margin:0 0 8px;text-align:center;color:#6B5436;font-size:16px;line-height:1.65;font-family:Arial,Helvetica,sans-serif">
          Há um tempo você sentou, respirou e escreveu uma carta para si mesma — pra ser aberta exatamente agora.
        </p>
        <p style="margin:0 0 28px;text-align:center;color:#6B5436;font-size:16px;line-height:1.65;font-family:Arial,Helvetica,sans-serif">
          Ela esperou por você. Está pronta.
        </p>

        ${temTitulo ? `
        <!-- Selo com o título da carta -->
        <div style="margin:0 auto 30px;max-width:380px;text-align:center;padding:16px 20px;border:1px dashed #C8922A;border-radius:14px;background:rgba(232,201,122,0.16)">
          <span style="display:block;color:#A17523;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Você nomeou de</span>
          <span style="color:#3D2A12;font-size:18px;font-style:italic">"${tituloShow}"</span>
        </div>` : ''}

        <!-- CTA -->
        <div style="text-align:center;margin:6px 0 8px">
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#E0A93A,#A17523);color:#FFFDF6;text-decoration:none;padding:15px 34px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:15px;letter-spacing:0.3px;box-shadow:0 8px 22px rgba(161,117,35,0.42)">
            Abrir minha carta
          </a>
        </div>

        <hr style="margin:30px 0 18px;border:none;border-top:1px solid rgba(200,146,42,0.28)">

        <p style="margin:0;text-align:center;color:#9A8254;font-size:14px;line-height:1.5;font-family:Arial,Helvetica,sans-serif">
          Com você nessa jornada,<br>
          <strong style="color:#7A5E2E">Suellen · Vida Mágica</strong>
        </p>
      </div>

      <p style="margin:18px 0 0;text-align:center;color:#A8946A;font-size:11px;font-family:Arial,Helvetica,sans-serif;line-height:1.5">
        Você recebeu este e-mail porque guardou uma Carta do Tempo no Espaço da Manifestação.
      </p>
    </div>
</body>
</html>`;

  return {
    subject: temTitulo ? `Sua carta "${carta.titulo}" chegou 💌` : 'Sua Carta do Tempo chegou 💌',
    htmlContent,
  };
}

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

    await enfileirarAtendimento({
      telefone: usuario.telefone,
      tipo: 'ativo',
      categoria: 'carta_do_tempo',
      mensagens: montarWhatsApp(carta, usuario).map(texto => ({ texto, midias: [] })),
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

    const { subject, htmlContent } = montarEmailCarta(carta, usuario);
    const primeiroNome = (usuario.nome || '').split(' ')[0] || 'você';
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Suellen · Vida Mágica', email: SENDER_EMAIL },
      to: [{ email: usuario.email, name: primeiroNome }],
      subject,
      htmlContent,
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

// ── "VER O QUE A ALUNA RECEBE" (modo dev) ──────────────────
// Dispara pro PRÓPRIO cadastro a mensagem REAL de carta madura — copy e layout
// idênticos ao que a aluna recebe (montarWhatsApp / montarEmailCarta) — usando
// uma carta de EXEMPLO. SEM idempotência (não grava em cartas_do_tempo_avisos),
// pra poder repetir o teste à vontade. Reporta o motivo se algum canal falhar.

const CARTA_EXEMPLO = { id: 0, titulo: 'Um recado pra mim mesma', abrir_em: new Date().toISOString() };

async function enviarTesteWhatsApp(usuario) {
  if (!usuario.telefone) return { ok: false, motivo: 'sem telefone no cadastro' };
  try {
    await enfileirarAtendimento({
      telefone: usuario.telefone,
      tipo: 'ativo',
      categoria: 'carta_do_tempo',
      mensagens: montarWhatsApp(CARTA_EXEMPLO, usuario).map(texto => ({ texto, midias: [] })),
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
    const { subject, htmlContent } = montarEmailCarta(CARTA_EXEMPLO, usuario);
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Suellen · Vida Mágica', email: SENDER_EMAIL },
      to: [{ email: usuario.email, name: primeiroNome }],
      subject,
      htmlContent,
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
