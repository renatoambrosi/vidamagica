/* ============================================================
   VIDA MÁGICA — core/teste-avisos.js
   Mensagens do Teste do Subconsciente (WhatsApp + e-mail) e o registro de
   TUDO que o sistema disparou para cada pessoa.

   Bancos: poolTeste (testes, teste_leads, teste_respostas, teste_avisos),
           poolCore (usuarios — Novidades de teste sem lead),
           poolComunicacao (precos, fila do gateway). Sem JOIN entre bancos.

   Regras (Renato, 2026-11-09) — textos e e-mails validados na prévia
   privado/texto-mensagens-teste.html:
   A  Terminou as 15 com pagamento obrigatório → na hora, WhatsApp + e-mail
      com o link de pagamento DESSE teste. Transacional: sai sempre.
   B  Pagamento confirmado (marcar-pago) → na hora, WhatsApp + e-mail com o
      resultado. Transacional: sai sempre.
   C  Parou no meio → 15 min depois da última resposta, WhatsApp + e-mail com
      o vídeo da Suellen e o link que abre o teste na pergunta onde ela parou.
      Respeita Novidades.
   D  Terminou e não pagou → 15 min depois, WhatsApp + e-mail com o vídeo e o
      link de pagamento. Respeita Novidades. Quem já recebeu a C não recebe D.
   E  Pagou → 20 min depois: WhatsApp (vídeo), e-mail de pesquisa e e-mail
      com os materiais indicados no resultado. Respeita Novidades.
   - Tudo que sai (ou deixa de sair, com o motivo) vira linha em teste_avisos.
     O status real do WhatsApp vem da fila do gateway (atendimento_id).
   - WhatsApp sempre pelo gateway, categoria 'teste_mensagens' (pausável no
     admin). A e B saem como reativos (resposta a uma ação dela); C, D e E
     como ativos. Botão do admin usa 'manual_admin'.
   - E-mail não mostra WEBP: logo do Teste e capas vão em PNG
     (public/assets/email/).
   ============================================================ */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { poolTeste, poolCore, poolComunicacao } = require('../db');
const { enfileirarAtendimento } = require('./gateway');
const { lerModoDevTeste } = require('./teste-config');

const APP_URL = process.env.APP_URL || 'https://www.vidamagica.com.br';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'contato@suellenseragi.com.br';
const CATEGORIA = 'teste_mensagens';
const INTERVALO_MS = 60 * 1000;
const MIN_RECUPERACAO = 15;  // C e D
const MIN_POS_COMPRA = 20;   // E
// Regra do Renato: nunca ativar gente antiga, nem depois de o robô ficar
// parado. Só sai o que venceu AGORA (até 5 min de folga para o worker de
// 1 min e reinício do servidor); venceu antes disso, não sai nunca mais.
const FOLGA_MIN = 5;

const VIDEO_RECUPERACAO = 'https://youtube.com/shorts/jPRfc5NqPJg';
const VIDEO_POS_COMPRA = 'https://youtube.com/shorts/lgzOMxmPmqo?feature=share';
const thumb = id => `https://i.ytimg.com/vi/${id}/oardefault.jpg`;
const THUMB_RECUPERACAO = thumb('jPRfc5NqPJg');
const THUMB_POS_COMPRA = thumb('lgzOMxmPmqo');

const LOGO_VM = `${APP_URL}/assets/logo-vertical.png`;
const LOGO_TESTE = `${APP_URL}/assets/email/logo-teste-pura.png`;
const SUPORTE_WA = 'https://wa.me/5562999884411';
const SUPORTE_EMAIL = 'contato@suellenseragi.com.br';

// ── DADOS ───────────────────────────────────────────────────
async function carregarTeste(testeId) {
  const r = await poolTeste.query(
    `SELECT t.id, t.usuario_id, t.lead_id, t.telefone_canonico, t.pago, t.modo_dev, t.feito_em, t.respostas,
            l.nome, l.email, l.aceite_marketing
       FROM testes t LEFT JOIN teste_leads l ON l.id = t.lead_id
      WHERE t.id = $1`,
    [testeId]
  );
  const t = r.rows[0];
  if (!t) return null;
  let aceite = t.lead_id ? !!t.aceite_marketing : false;
  // Teste sem lead: Novidades, nome e e-mail vêm do cadastro.
  if (!t.lead_id && t.usuario_id) {
    const u = await poolCore.query(`SELECT nome, email, aceite_marketing FROM usuarios WHERE id = $1`, [t.usuario_id]).catch(() => ({ rows: [] }));
    if (u.rows[0]) {
      aceite = !!u.rows[0].aceite_marketing;
      t.nome = t.nome || u.rows[0].nome;
      t.email = t.email || u.rows[0].email;
    }
  }
  return { ...t, aceite_marketing: aceite };
}

async function carregarLead(leadId) {
  const r = await poolTeste.query(
    `SELECT id, nome, email, telefone_canonico, aceite_marketing FROM teste_leads WHERE id = $1`, [leadId]
  );
  return r.rows[0] || null;
}

async function produtoTeste() {
  const r = await poolComunicacao.query(`SELECT dados FROM precos WHERE key = 'teste_subconsciente'`);
  return (r.rows[0] && r.rows[0].dados) || {};
}

// Mesmo link do fim do Teste: Promo ligada = link da Promo, senão o padrão.
async function linkPagamento(testeId) {
  const p = await produtoTeste();
  const base = String((p.mostrar_promo && String(p.link_checkout_promo || '').trim()) || p.link_checkout_padrao || '').trim();
  if (!base) return null;
  try {
    const u = new URL(base);
    u.searchParams.set('uid', 'VM' + testeId);
    return u.toString();
  } catch {
    return base + (base.includes('?') ? '&' : '?') + 'uid=VM' + encodeURIComponent(testeId);
  }
}

// Preço que aparece no ticket do e-mail A: Promo ligada = preço da Promo.
async function precoTeste() {
  const p = await produtoTeste();
  return String((p.mostrar_promo && p.preco_promo) || p.preco_padrao || '').trim();
}

// Link que vai nas mensagens: /pagar/<id> mostra a prévia do Teste do
// Subconsciente no WhatsApp e abre na hora o mesmo checkout do fim do teste.
const linkPagar = testeId => `${APP_URL}/pagar/${testeId}`;
const linkResultado = testeId => `${APP_URL}/resultado/${testeId}`;
const linkContinuar = leadId => `${APP_URL}/teste?continuar=${leadId}`;
const linkPesquisa = testeId => `${APP_URL}/pesquisa/${testeId}`;
const linkCancelar = leadId => (leadId ? `${APP_URL}/cancelar-inscricao/${leadId}` : '');
const primeiroNome = nome => (String(nome || '').trim().split(/\s+/)[0] || '');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// "Oi, Ana!" — sem nome vira "Oi!"
const saudacao = (oi, nome) => (nome ? `${oi}, ${nome}!` : `${oi}!`);

// Capa em PNG para o e-mail (public/assets/email/<arquivo>.png); sem PNG, nenhuma.
function capaPng(imagemUrl) {
  const base = path.basename(String(imagemUrl || '')).replace(/\.[a-z0-9]+$/i, '');
  if (!base) return '';
  const arq = path.join(__dirname, '..', 'public', 'assets', 'email', base + '.png');
  return fs.existsSync(arq) ? `${APP_URL}/assets/email/${base}.png` : '';
}

// ── REGISTRO (teste_avisos) ─────────────────────────────────
// Automático reserva a linha antes de enviar: a chave única impede envio
// duplo. Devolve o id ou null se já existia. Manual não tem chave.
async function reservar({ chave = null, teste_id = null, lead_id = null, momento, canal, conteudo, destino = null }) {
  const r = await poolTeste.query(
    `INSERT INTO teste_avisos (chave, teste_id, lead_id, momento, canal, conteudo, status, destino)
     VALUES ($1, $2, $3, $4, $5, $6, 'enviando', $7)
     ON CONFLICT (chave) WHERE chave IS NOT NULL DO NOTHING
     RETURNING id`,
    [chave, teste_id, lead_id, momento, canal, conteudo, destino]
  );
  return r.rows[0] ? r.rows[0].id : null;
}

async function concluir(id, { status, motivo = null, texto = null, atendimento_id = null }) {
  await poolTeste.query(
    `UPDATE teste_avisos SET status = $2, motivo = $3, texto = $4, atendimento_id = $5 WHERE id = $1`,
    [id, status, motivo, texto, atendimento_id]
  );
}

async function naoEnviado(dados, motivo) {
  const id = await reservar(dados);
  if (id) await concluir(id, { status: 'nao_enviado', motivo });
}

// ── ENVIO ───────────────────────────────────────────────────
async function enviarBrevo(para, nome, subject, htmlContent) {
  if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY ausente');
  await axios.post('https://api.brevo.com/v3/smtp/email', {
    sender: { name: 'Vida Mágica', email: SENDER_EMAIL },
    to: [{ email: para, name: nome || undefined }],
    subject, htmlContent,
  }, { headers: { accept: 'application/json', 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' }, timeout: 15000 });
}

// WhatsApp pausado no gateway (geral ou a categoria)? Então a mensagem nem
// entra na fila: ficaria parada e sairia atrasada quando voltasse, ativando
// gente antiga. Registra "não enviado" e pronto.
async function whatsappPausado(categoria) {
  const r = await poolComunicacao.query(
    `SELECT
       COALESCE((SELECT valor FROM gateway_config WHERE chave = 'pausado_geral'), 'false') = 'true' AS geral,
       COALESCE((SELECT pausado FROM gateway_categorias WHERE chave = $1), FALSE) AS categoria`,
    [categoria]
  );
  return r.rows[0].geral || r.rows[0].categoria;
}

// Envia UMA peça (1 canal) e registra. `peca` = { canal, conteudo, texto?, email?: {subject, html, resumo} }.
// `texto` pode ser uma lista: cada item vira uma mensagem do mesmo atendimento.
// marketing=true respeita Novidades.
async function enviarPeca(reg, pessoa, peca, { marketing, tipo, categoria, origem }) {
  const destino = peca.canal === 'whatsapp' ? pessoa.telefone_canonico : pessoa.email;
  const id = await reservar({ ...reg, canal: peca.canal, conteudo: peca.conteudo, destino });
  if (!id) return { ok: false, erro: 'já enviado' };
  try {
    if (marketing && !pessoa.aceite_marketing) {
      await concluir(id, { status: 'nao_enviado', motivo: 'marcou Não em Novidades' });
      return { ok: false, erro: 'Ela marcou Não em Novidades' };
    }
    if (!destino) {
      const m = peca.canal === 'whatsapp' ? 'sem telefone' : 'sem e-mail';
      await concluir(id, { status: 'nao_enviado', motivo: m });
      return { ok: false, erro: m };
    }
    if (peca.canal === 'whatsapp') {
      if (await whatsappPausado(categoria)) {
        await concluir(id, { status: 'nao_enviado', motivo: 'WhatsApp pausado no gateway' });
        return { ok: false, erro: 'WhatsApp pausado no gateway' };
      }
      const textos = Array.isArray(peca.texto) ? peca.texto : [peca.texto];
      const { atendimento_id } = await enfileirarAtendimento({
        telefone: destino, tipo, categoria, origem, nome: pessoa.nome || null,
        mensagens: textos.map(texto => ({ texto })),
      });
      await concluir(id, { status: 'na_fila', texto: textos.join('\n\n— — —\n\n'), atendimento_id });
    } else {
      await enviarBrevo(destino, pessoa.nome, peca.email.subject, peca.email.html);
      await concluir(id, { status: 'enviado', texto: peca.email.subject + '\n\n' + peca.email.resumo });
    }
    return { ok: true };
  } catch (e) {
    const msg = (e.response && JSON.stringify(e.response.data)) || e.message;
    await concluir(id, { status: 'erro', motivo: msg }).catch(() => {});
    return { ok: false, erro: 'Falha ao enviar' };
  }
}

// ── E-MAILS (HTML validado na prévia) ───────────────────────
const P = 'color:#c8c0a8;font-size:14px';
const pUrl = url => `<p style="color:#8a7d66;font-size:12px;margin:0;word-break:break-all">${esc(url)}</p>`;
const botaoOuro = (url, txt) =>
  `<div style="text-align:center;margin-bottom:20px"><a href="${esc(url)}" style="display:inline-block;background:#E8C97A;color:#1A1205;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none">${esc(txt)}</a></div>`;
const botaoAzul = (url, txt) =>
  `<a href="${esc(url)}" style="display:inline-block;white-space:nowrap;background:#2ba5e8;background-image:linear-gradient(135deg,#5cc2f0 0%,#2ba5e8 100%);color:#051929;font-family:Montserrat,Arial,sans-serif;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:11px 28px;border-radius:999px;text-decoration:none;box-shadow:0 6px 18px rgba(43,165,232,.4)">${esc(txt)} &rarr;</a>`;
const video = (url, img) =>
  `<div style="text-align:center;margin-bottom:20px"><a href="${esc(url)}"><img src="${esc(img)}" alt="Recado da Suellen" width="200" style="width:200px;max-width:100%;border-radius:10px;display:inline-block;border:0"></a><br><a href="${esc(url)}" style="color:#E8C97A;font-size:13px">Assistir ao recado da Suellen</a></div>`;
const linhaSuporte = margem =>
  `<p style="color:#8a7d66;font-size:11px;line-height:1.5;margin:${margem} 0 0">Precisa de suporte? Fale com a gente pelo <a href="${SUPORTE_WA}" style="color:#E8C97A;text-decoration:none">WhatsApp (62) 99988-4411</a> ou <a href="mailto:${SUPORTE_EMAIL}" style="color:#E8C97A;text-decoration:none">${SUPORTE_EMAIL}</a></p>`;
const linhaCopyright = margem =>
  `<p style="color:#8a7d66;font-size:11px;line-height:1.5;margin:${margem} 0 0">© ${new Date().getFullYear()} Vida Mágica - Suellen Seragi. Todos os direitos reservados.</p>`;

// Rodapé com a logo pequena no fim; "Cancelar inscrição" só nos que não são transacionais.
function rodapeLogo(cancelar) {
  const sair = cancelar
    ? `<p style="color:#8a7d66;font-size:11px;line-height:1.5;margin:8px 0 0">Não quer mais receber nossos e-mails? <a href="${esc(cancelar)}" style="color:#8a7d66;text-decoration:underline">Cancelar inscrição</a></p>${linhaCopyright('6px')}`
    : linhaCopyright('8px');
  return `<div style="border-top:1px solid #3a2c14;margin-top:24px;padding-top:18px;text-align:center"><img src="${LOGO_VM}" alt="Vida Mágica" width="64" style="width:64px;height:auto;display:inline-block;border:0">${linhaSuporte('12px')}${sair}</div>`;
}

// Box do Teste com a frase do resultado e o "Clique aqui" (o mesmo em B e no reenvio do admin).
const boxResultado = link =>
  `<div style="background:#0a2d44;background-image:linear-gradient(180deg,#0a2d44 0%,#051929 100%);border:1px solid rgba(43,165,232,.35);border-radius:14px;padding:22px 16px 22px;margin:0 0 18px;text-align:center"><img src="${LOGO_TESTE}" alt="Teste do Subconsciente" width="150" style="width:150px;height:auto;display:inline-block;margin:0 0 14px;border:0"><p style="color:rgba(245,240,232,.85);font-size:14px;margin:0 0 18px">Chegouu! Aqui está o link do seu resultado do Teste do Subconsciente:</p>${botaoAzul(link, 'Clique aqui')}</div>`;

function documento(miolo) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:20px 12px;background:#e9e6df"><div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#1A1205;border-radius:12px">${miolo}</div></body></html>`;
}

// A — link de pagamento (ingresso: box do Teste em cima, picote, canhoto com o PIX)
function emailA(nome, link, preco) {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:20px 12px;background:#e9e6df"><div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:20px 22px 18px;background:#1A1205;border-radius:12px">
<div style="text-align:center;margin:0 0 12px"><img src="${LOGO_VM}" alt="Vida Mágica" width="64" style="width:64px;height:auto;display:inline-block;border:0"></div>
<div style="border-radius:14px;margin:0 0 12px;text-align:center;overflow:hidden">
<div style="background:#0a2d44;background-image:linear-gradient(180deg,#0a2d44 0%,#051929 100%);padding:22px 16px 20px"><img src="${LOGO_TESTE}" alt="Teste do Subconsciente" width="150" style="width:150px;height:auto;display:inline-block;margin:0 0 14px;border:0"><p style="color:#f5f0e8;font-size:16px;font-weight:700;margin:0 0 8px">${esc(saudacao('Oi', nome))}</p><p style="color:rgba(245,240,232,.88);font-size:14px;line-height:1.5;margin:0 0 6px">Você chegou até aqui e a melhor parte vem agora...</p><p style="color:rgba(245,240,232,.68);font-size:13px;line-height:1.55;margin:0">Finalize seu pagamento no link a seguir e descubra o que o teste revelou sobre seu subconsciente</p></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;border-collapse:collapse"><tr>
<td width="12" valign="middle" style="width:12px;height:28px;padding:0;overflow:hidden"><div style="width:24px;height:24px;border-radius:50%;background:#1A1205;margin-left:-12px"></div></td>
<td valign="middle" style="height:28px;padding:0 6px;font-size:0;line-height:0"><div style="height:0;border-top:2px dashed #cfc6b4"></div></td>
<td width="12" valign="middle" style="width:12px;height:28px;padding:0;overflow:hidden"><div style="width:24px;height:24px;border-radius:50%;background:#1A1205;margin-right:-12px"></div></td>
</tr></table>
<div style="background:#f5f0e8;padding:10px 18px 18px">
<div style="width:30px;height:30px;border-radius:50%;background:#C8922A;margin:0 auto 6px;overflow:hidden"><img src="${APP_URL}/assets/email/relogio.png" alt="" width="16" height="16" style="display:block;margin:7px auto 0;border:0"></div>
<p style="color:#1A1205;font-size:16px;font-weight:700;margin:0 0 10px">Aguardando pagamento</p>
<p style="color:#6b6355;font-size:12px;margin:0 0 2px">Teste do Subconsciente</p>
${preco ? `<p style="color:#1A1205;font-size:28px;font-weight:700;margin:0 0 12px;letter-spacing:-.3px">R$ ${esc(preco)}</p>` : ''}
${botaoAzul(link, 'Fazer PIX')}
</div></div>
<p style="color:#8a7d66;font-size:12px;margin:0 0 4px"><strong>Link direto do pagamento:</strong></p>
${pUrl(link)}
<div style="color:#8a7d66;font-size:11px;line-height:1.5;margin:14px 0 0;text-align:center;border-top:1px solid #3a2c14;padding-top:12px">${linhaSuporte('0')}${linhaCopyright('12px')}</div>
</div></body></html>`;
  return {
    subject: 'Falta só o pagamento para ver seu resultado',
    html,
    resumo: `${saudacao('Oi', nome)} Você chegou até aqui e a melhor parte vem agora... Finalize seu pagamento no link a seguir e descubra o que o teste revelou sobre seu subconsciente\n${link}`,
  };
}

// B — resultado (pagamento confirmado)
function emailB(nome, link) {
  return {
    subject: 'Seu resultado do Teste do Subconsciente',
    html: documento(`<h2 style="color:#E8C97A;font-size:18px;margin:0 0 12px">${esc(saudacao('Olá', nome))}</h2>
<p style="${P};margin:0 0 16px">Seu pagamento foi confirmado e o seu resultado já está liberado.</p>
${boxResultado(link)}${pUrl(link)}${rodapeLogo(null)}`),
    resumo: `Seu pagamento foi confirmado e o seu resultado já está liberado.\n${link}`,
  };
}

// Reenvio do resultado pelo botão do admin
function emailReenvio(nome, link) {
  return {
    subject: 'Seu resultado do Teste do Subconsciente',
    html: documento(`<h2 style="color:#E8C97A;font-size:18px;margin:0 0 12px">${esc(saudacao('Olá', nome))}</h2>
<p style="${P};margin:0 0 16px">Reenviando seu resultado.</p>
${boxResultado(link)}${pUrl(link)}${rodapeLogo(null)}`),
    resumo: `Reenviando seu resultado.\n${link}`,
  };
}

// C e D — recuperação (mesmo texto; muda o link e o botão)
function emailRecuperacao(nome, link, botao, cancelar) {
  return {
    subject: 'Seu Teste do Subconsciente está esperando por você',
    html: documento(`<h2 style="color:#E8C97A;font-size:18px;margin:0 0 12px">${esc(saudacao('Oi', nome))}</h2>
<p style="${P};margin:0 0 16px">Sua mente sentiu vontade de começar o teste, mas por algum motivo você não finalizou.<br>Então a Suellen tem um recado para você:</p>
${video(VIDEO_RECUPERACAO, THUMB_RECUPERACAO)}
<p style="${P};margin:0 0 16px">Não precisa começar de novo! Você pode continuar de onde parou, clicando aqui:</p>
${botaoOuro(link, botao)}${pUrl(link)}${rodapeLogo(cancelar)}`),
    resumo: `Sua mente sentiu vontade de começar o teste, mas por algum motivo você não finalizou.\n${link}`,
  };
}

// E — e-mail 1: pesquisa
function emailPesquisa(nome, link, cancelar) {
  return {
    subject: 'O que você achou do seu resultado?',
    html: documento(`<h2 style="color:#E8C97A;font-size:18px;margin:0 0 4px">${esc(nome ? `Olá, ${nome},` : 'Olá,')}</h2>
<p style="color:#f5f0e8;font-size:15.5px;font-weight:600;margin:0 0 14px">Suellen e Renato aqui!</p>
<p style="${P};margin:0 0 12px">O que achou do resultado do seu teste do subconsciente, fez sentido?</p>
<p style="${P};margin:0 0 16px">Nós amamos cada feedback.<br>Você poderia fortalecer nosso trabalho contando para nós e para outras pessoas no nosso site?🤩👇🏻</p>
<div style="text-align:center;margin-bottom:20px"><a href="${esc(link)}" style="display:block;box-sizing:border-box;width:100%;background:#2a1f0e;border:1px solid #E8C97A;border-radius:14px;padding:14px 12px 12px;text-align:center;text-decoration:none"><span style="display:block;color:#E8C97A;font-size:30px;line-height:1;letter-spacing:5px;padding-left:5px">&#9733;&#9733;&#9733;&#9733;&#9733;</span><span style="display:block;color:#f5f0e8;font-size:13px;font-weight:700;margin-top:8px">Avaliar meu teste</span></a></div>
${pUrl(link)}${rodapeLogo(cancelar)}`),
    resumo: `O que achou do resultado do seu teste do subconsciente, fez sentido?\n${link}`,
  };
}

// Preço no formato do resultado: de/por + % OFF + justificativa, parcelas em destaque, à vista embaixo.
function blocoPreco(p) {
  let h = '';
  if (p.de) {
    h += `<p style="color:#8a7d66;font-size:12px;margin:0 0 2px">de <s>R$ ${esc(p.de)}</s> por${p.pct ? ` <span style="background:rgba(232,201,122,.15);color:#E8C97A;font-weight:700;font-size:10px;padding:1px 6px;border-radius:999px">${esc(p.pct)}% OFF</span>` : ''}</p>`;
    if (p.pct) h += `<p style="color:#8a7d66;font-size:11px;font-style:italic;margin:0 0 4px">${p.black ? 'Preço da Black November' : 'Desconto do Teste do Subconsciente'}</p>`;
  }
  if (p.parcelasQtd && p.parcelasValor) {
    h += `<p style="color:#E8C97A;font-size:22px;font-weight:700;line-height:1.2;margin:0">${esc(p.parcelasQtd)}x <span style="font-size:14px">R$</span> ${esc(p.parcelasValor)}</p>`;
    if (p.avista) h += `<p style="color:#c8c0a8;font-size:12px;margin:0 0 12px">ou R$ ${esc(p.avista)} à vista</p>`;
  } else if (p.avista) {
    h += `<p style="color:#E8C97A;font-size:22px;font-weight:700;line-height:1.2;margin:0 0 12px">R$ ${esc(p.avista)}</p>`;
  }
  return h;
}

function cartaoProduto({ tag, capa, nome, preco, link, botao }, ultimo) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${ultimo ? '' : 'margin-bottom:12px;'}background:#2a1f0e;border:1px solid #3a2c14;border-radius:12px"><tr>
<td align="center" style="padding:14px 16px 16px">
<span style="display:inline-block;background:rgba(232,201,122,.15);color:#E8C97A;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;padding:3px 8px;border-radius:4px;margin-bottom:10px">${esc(tag)}</span>
${capa ? `<img src="${esc(capa)}" alt="" width="96" style="display:block;width:96px;height:96px;border-radius:8px;margin:0 auto 10px;border:0">` : ''}
<p style="color:#f5f0e8;font-size:15px;font-weight:700;line-height:1.3;margin:0 0 8px">${esc(nome)}</p>
${blocoPreco(preco)}
${link ? `<a href="${esc(link)}" style="display:block;background:#E8C97A;color:#1A1205;font-weight:700;font-size:14px;padding:10px 16px;border-radius:8px;text-decoration:none">${esc(botao)}</a>` : ''}
</td></tr></table>`;
}

// E — e-mail 2: recado + materiais indicados no resultado dela
function emailRecomendacao(nome, materiais, cancelar) {
  const cartoes = materiais.map((m, i) => cartaoProduto(m, i === materiais.length - 1)).join('');
  return {
    subject: 'Os materiais indicados para o seu resultado',
    html: documento(`<h2 style="color:#E8C97A;font-size:18px;margin:0 0 12px">${esc(saudacao('Olá', nome))}</h2>
<p style="${P};margin:0 0 12px">Parabéns por esse passo em direção à sua mudança.</p>
<p style="${P};margin:0 0 16px">Agora que você terminou, a Suellen tem um recado especial para você</p>
${video(VIDEO_POS_COMPRA, THUMB_POS_COMPRA)}
${cartoes ? `<p style="color:#E8C97A;font-size:15px;font-weight:700;margin:0 0 12px">Materiais indicados para o seu resultado</p>${cartoes}` : ''}
${rodapeLogo(cancelar)}`),
    resumo: 'Parabéns por esse passo em direção à sua mudança.\n' + materiais.map(m => `${m.nome}: ${m.link}`).join('\n'),
  };
}

// Materiais indicados: mesma regra e mesmo preço da página do resultado
// (GET /api/teste/resultado/:id) — curso + e-book/livro do perfil dominante.
async function materiaisDoTeste(t) {
  const { calcularResultado, montarLivrosRecomendados, aplicarPrecoDeAluno } = require('./teste-resultado');
  const { indicacaoDoPerfil } = require('./jornadas');
  const { processarProdutos, aplicarPrecoDoTeste } = require('../routes/produtos');
  const { lerBlackNoAr } = require('./campanha');

  const respostas = Array.isArray(t.respostas) ? t.respostas : JSON.parse(t.respostas || '[]');
  const resultado = calcularResultado(respostas);
  const r = await poolComunicacao.query(
    `SELECT key, dados FROM precos
      WHERE key IN ('vencendo_medo','vencendo_desordem','vencendo_validacao','vencendo_sobrevivencia',
                    'guia_pratico','atal_maneira_livro','magica_fluir',
                    'ouro_reprogramacao','lda_biblica','atal_maneira_curso')`
  );
  const precos = {};
  r.rows.forEach(x => { precos[x.key] = x.dados || {}; });
  processarProdutos(precos);
  aplicarPrecoDoTeste(precos);
  aplicarPrecoDeAluno(precos, { blackNoAr: (await lerBlackNoAr()).ativa });

  const out = [];
  const slugCurso = indicacaoDoPerfil(resultado.perfil_dominante).curso;
  const curso = slugCurso && precos[slugCurso];
  if (curso && curso.nome) {
    out.push({
      tag: 'Seu próximo passo', capa: capaPng(curso.imagem_url), nome: curso.nome,
      link: curso.link_checkout_exibir || '', botao: 'Quero este curso',
      preco: { de: curso.exibir_de, pct: curso.desconto_pct, black: curso.black === true,
               parcelasQtd: curso.exibir_parcelas_qtd, parcelasValor: curso.exibir_parcelas_valor,
               avista: curso.exibir_avista || curso.preco_padrao },
    });
  }
  const livro = montarLivrosRecomendados(precos, resultado)[0];
  if (livro && livro.titulo) {
    out.push({
      tag: out.length ? 'Opção econômica' : 'Seu próximo passo', capa: capaPng(livro.capa_url), nome: livro.titulo,
      // Único livro é o A Tal Maneira (livro digital); o resto é e-book.
      link: livro.link_checkout || '', botao: livro.slug === 'atal_maneira_livro' ? 'Quero este livro' : 'Quero este e-book',
      preco: { de: livro.preco_de, pct: livro.desconto_pct, black: livro.black,
               parcelasQtd: livro.parcelas_qtd, parcelasValor: livro.parcelas_valor, avista: livro.preco_padrao },
    });
  }
  return out;
}

// ── TEXTOS DO WHATSAPP ──────────────────────────────────────
// Saudação, cada frase e cada link em linha própria (WhatsApp sem parágrafo fica corrido).
const waA = (nome, link) => `${saudacao('Oi', nome)}\n\nVocê chegou até aqui e a melhor parte vem agora...\n\nFinalize seu pagamento no link a seguir e descubra o que o teste revelou sobre seu subconsciente:\n${link}`;
const waB = link => `Chegouu! Aqui está o link do seu resultado do Teste do Subconsciente:\n${link}`;
// Recuperação (C e D) sai em 2 mensagens: o recado com o vídeo, depois o link.
const waRecuperacao = (nome, link) => [
  `${saudacao('Oi', nome)}\n\nSua mente sentiu vontade de começar o teste, mas por algum motivo você não finalizou.\n\nEntão a Suellen tem um recado para você:\n${VIDEO_RECUPERACAO}`,
  `Não precisa começar de novo! Você pode continuar de onde parou, clicando aqui:\n${link}`,
];
const waE = () => `Parabéns por esse passo em direção à sua mudança.\n\nAgora que você terminou, a Suellen tem um recado especial para você\n\n${VIDEO_POS_COMPRA}`;
const waReenvio = (nome, link) => `${saudacao('Oi', nome)}\n\nAqui está o link do seu resultado no Teste do Subconsciente:\n${link}`;

// ── A: na hora em que ela termina (pagamento obrigatório) ───
// Chamado por routes/teste.js sem esperar (não atrasa a ida pro checkout).
async function dispararNaHora(testeId) {
  try {
    const t = await carregarTeste(testeId);
    if (!t || t.pago || t.modo_dev) return;
    const checkout = await linkPagamento(t.id);
    const link = linkPagar(t.id);
    const nome = primeiroNome(t.nome);
    const reg = c => ({ chave: `A:${t.id}:${c}`, teste_id: t.id, lead_id: t.lead_id, momento: 'pagamento' });
    if (!checkout) {
      for (const c of ['whatsapp', 'email']) {
        const id = await reservar({ ...reg(c), canal: c, conteudo: 'pagamento' });
        if (id) await concluir(id, { status: 'erro', motivo: 'produto Teste sem link de checkout no admin' });
      }
      return;
    }
    const opts = { marketing: false, tipo: 'reativo', categoria: CATEGORIA, origem: 'teste-avisos-pagamento' };
    await enviarPeca(reg('whatsapp'), t, { canal: 'whatsapp', conteudo: 'pagamento', texto: waA(nome, link) }, opts);
    await enviarPeca(reg('email'), t, { canal: 'email', conteudo: 'pagamento', email: emailA(nome, link, await precoTeste()) }, opts);
  } catch (e) {
    console.error('❌ [teste-avisos] A (pagamento):', e.message);
  }
}

// ── B: pagamento confirmado ─────────────────────────────────
// Chamado por POST /api/teste/marcar-pago (pode chegar mais de uma vez: a
// chave única garante 1 envio por canal).
async function dispararPago(testeId) {
  try {
    const t = await carregarTeste(testeId);
    if (!t || !t.pago) return;
    const link = linkResultado(t.id);
    const nome = primeiroNome(t.nome);
    const reg = c => ({ chave: `B:${t.id}:${c}`, teste_id: t.id, lead_id: t.lead_id, momento: 'resultado' });
    const opts = { marketing: false, tipo: 'reativo', categoria: CATEGORIA, origem: 'teste-avisos-resultado' };
    await enviarPeca(reg('whatsapp'), t, { canal: 'whatsapp', conteudo: 'resultado', texto: waB(link) }, opts);
    await enviarPeca(reg('email'), t, { canal: 'email', conteudo: 'resultado', email: emailB(nome, link) }, opts);
  } catch (e) {
    console.error('❌ [teste-avisos] B (resultado):', e.message);
  }
}

// ── MANUAL (botões do admin) ────────────────────────────────
// Pendente até 15 min depois de terminar = o mesmo A (transacional).
// Pendente há mais de 15 min = a mesma recuperação D (respeita Novidades).
// Pago (ou resultado aberto) = reenvio do resultado.
async function enviarManual(testeId, canal) {
  const t = await carregarTeste(testeId);
  if (!t) return { ok: false, status: 404, erro: 'Teste não encontrado' };
  const aberto = t.pago || t.modo_dev || (await lerModoDevTeste());
  const nome = primeiroNome(t.nome);
  const reg = { teste_id: t.id, lead_id: t.lead_id, momento: 'manual' };
  const opts = { marketing: false, tipo: 'ativo', categoria: 'manual_admin', origem: 'admin_testes_resultados' };
  let r;
  if (!aberto) {
    if (!(await linkPagamento(t.id))) return { ok: false, status: 400, erro: 'Produto Teste sem link de checkout no admin' };
    const link = linkPagar(t.id);
    const recuperacao = Date.now() - new Date(t.feito_em).getTime() >= MIN_RECUPERACAO * 60 * 1000;
    if (recuperacao) {
      const optsRec = { ...opts, marketing: true };
      r = canal === 'whatsapp'
        ? await enviarPeca(reg, t, { canal, conteudo: 'recuperacao', texto: waRecuperacao(nome, link) }, optsRec)
        : await enviarPeca(reg, t, { canal, conteudo: 'recuperacao', email: emailRecuperacao(nome, link, 'Finalizar pagamento', linkCancelar(t.lead_id)) }, optsRec);
      return r.ok ? { ok: true, conteudo: 'recuperacao' } : { ok: false, status: 400, erro: r.erro };
    }
    r = canal === 'whatsapp'
      ? await enviarPeca(reg, t, { canal, conteudo: 'pagamento', texto: waA(nome, link) }, opts)
      : await enviarPeca(reg, t, { canal, conteudo: 'pagamento', email: emailA(nome, link, await precoTeste()) }, opts);
    return r.ok ? { ok: true, conteudo: 'pagamento' } : { ok: false, status: 400, erro: r.erro };
  }
  const link = linkResultado(t.id);
  r = canal === 'whatsapp'
    ? await enviarPeca(reg, t, { canal, conteudo: 'resultado', texto: waReenvio(nome, link) }, opts)
    : await enviarPeca(reg, t, { canal, conteudo: 'resultado', email: emailReenvio(nome, link) }, opts);
  return r.ok ? { ok: true, conteudo: 'resultado' } : { ok: false, status: 400, erro: r.erro };
}

// ── WORKER: C, D e E ────────────────────────────────────────
let intervalId = null;
let rodando = false;

// C — rodada incompleta (menos de 15 respostas e mais nova que o último teste
// do lead), última atividade há 15 min. 1 por rodada (rodada = hora do formulário).
async function tickC() {
  const r = await poolTeste.query(
    `SELECT l.id, l.atualizado_em AS rodada
       FROM teste_leads l
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS n, MAX(respondido_em) AS ultima FROM teste_respostas WHERE lead_id = l.id
       ) r ON TRUE
       LEFT JOIN LATERAL (SELECT MAX(feito_em) AS ultimo FROM testes WHERE lead_id = l.id) ut ON TRUE
      WHERE COALESCE(r.n, 0) < 15
        AND (ut.ultimo IS NULL OR GREATEST(l.atualizado_em, COALESCE(r.ultima, l.atualizado_em)) > ut.ultimo + INTERVAL '2 seconds')
        AND GREATEST(l.atualizado_em, COALESCE(r.ultima, l.atualizado_em)) <= NOW() - make_interval(mins => $1)
        AND GREATEST(l.atualizado_em, COALESCE(r.ultima, l.atualizado_em)) >= NOW() - make_interval(mins => $1) - make_interval(mins => $2)
      LIMIT 50`,
    [MIN_RECUPERACAO, FOLGA_MIN]
  );
  for (const row of r.rows) {
    const lead = await carregarLead(row.id);
    if (!lead) continue;
    const rodada = new Date(row.rodada).toISOString();
    const nome = primeiroNome(lead.nome);
    const link = linkContinuar(lead.id);
    const reg = c => ({ chave: `C:${lead.id}:${rodada}:${c}`, lead_id: lead.id, momento: 'recuperacao_meio' });
    const opts = { marketing: true, tipo: 'ativo', categoria: CATEGORIA, origem: 'teste-avisos-recuperacao' };
    await enviarPeca(reg('whatsapp'), lead, { canal: 'whatsapp', conteudo: 'continuar', texto: waRecuperacao(nome, link) }, opts);
    await enviarPeca(reg('email'), lead, { canal: 'email', conteudo: 'continuar', email: emailRecuperacao(nome, link, 'Continuar meu teste', linkCancelar(lead.id)) }, opts);
  }
}

// D — terminou e não pagou há 15 min. Não sai para quem recebeu a C antes de terminar.
async function tickD() {
  const r = await poolTeste.query(
    `SELECT t.id, t.lead_id, t.feito_em
       FROM testes t
      WHERE t.pago = FALSE AND t.modo_dev = FALSE AND t.eh_legado = FALSE
        AND t.feito_em <= NOW() - make_interval(mins => $1)
        AND t.feito_em >= NOW() - make_interval(mins => $1) - make_interval(mins => $2)
        AND NOT EXISTS (SELECT 1 FROM teste_avisos a WHERE a.teste_id = t.id AND a.momento = 'recuperacao_pagamento')
      ORDER BY t.feito_em
      LIMIT 50`,
    [MIN_RECUPERACAO, FOLGA_MIN]
  );
  if (!r.rows.length) return;
  const modoDevAdmin = await lerModoDevTeste();
  for (const row of r.rows) {
    const reg = c => ({ chave: `D:${row.id}:${c}`, teste_id: row.id, lead_id: row.lead_id, momento: 'recuperacao_pagamento' });
    const motivoGeral = modoDevAdmin ? 'Modo dev ligado (resultado aberto)' : null;
    let motivo = motivoGeral;
    if (!motivo && row.lead_id) {
      const c = await poolTeste.query(
        `SELECT 1 FROM teste_avisos WHERE lead_id = $1 AND momento = 'recuperacao_meio'
            AND status IN ('enviado','na_fila') AND criado_em < $2 LIMIT 1`,
        [row.lead_id, row.feito_em]
      );
      if (c.rows[0]) motivo = 'já recebeu a recuperação de quem parou no meio';
    }
    if (motivo) {
      for (const c of ['whatsapp', 'email']) await naoEnviado({ ...reg(c), canal: c, conteudo: 'pagamento' }, motivo);
      continue;
    }
    const t = await carregarTeste(row.id);
    if (!t || t.pago) continue; // pagou entre a busca e agora
    if (!(await linkPagamento(t.id))) continue;
    const link = linkPagar(t.id);
    const nome = primeiroNome(t.nome);
    const opts = { marketing: true, tipo: 'ativo', categoria: CATEGORIA, origem: 'teste-avisos-recuperacao' };
    await enviarPeca(reg('whatsapp'), t, { canal: 'whatsapp', conteudo: 'pagamento', texto: waRecuperacao(nome, link) }, opts);
    await enviarPeca(reg('email'), t, { canal: 'email', conteudo: 'pagamento', email: emailRecuperacao(nome, link, 'Finalizar pagamento', linkCancelar(t.lead_id)) }, opts);
  }
}

// E — 20 min depois do pagamento (hora do primeiro registro da B).
async function tickE() {
  const r = await poolTeste.query(
    `SELECT b.teste_id, MIN(b.criado_em) AS pago_em
       FROM teste_avisos b
      WHERE b.momento = 'resultado' AND b.teste_id IS NOT NULL
      GROUP BY b.teste_id
     HAVING MIN(b.criado_em) <= NOW() - make_interval(mins => $1)
        AND MIN(b.criado_em) >= NOW() - make_interval(mins => $1) - make_interval(mins => $2)
        AND NOT EXISTS (SELECT 1 FROM teste_avisos e WHERE e.teste_id = b.teste_id AND e.momento = 'pos_compra')
      LIMIT 50`,
    [MIN_POS_COMPRA, FOLGA_MIN]
  );
  for (const row of r.rows) {
    const t = await carregarTeste(row.teste_id);
    if (!t) continue;
    const nome = primeiroNome(t.nome);
    const cancelar = linkCancelar(t.lead_id);
    const reg = k => ({ chave: `E:${t.id}:${k}`, teste_id: t.id, lead_id: t.lead_id, momento: 'pos_compra' });
    const opts = { marketing: true, tipo: 'ativo', categoria: CATEGORIA, origem: 'teste-avisos-pos-compra' };
    await enviarPeca(reg('whatsapp'), t, { canal: 'whatsapp', conteudo: 'video', texto: waE() }, opts);
    await enviarPeca(reg('pesquisa'), t, { canal: 'email', conteudo: 'pesquisa', email: emailPesquisa(nome, linkPesquisa(t.id), cancelar) }, opts);
    let materiais = [];
    try { materiais = await materiaisDoTeste(t); } catch (e) { console.warn('⚠️ [teste-avisos] materiais:', e.message); }
    await enviarPeca(reg('recomendacao'), t, { canal: 'email', conteudo: 'materiais', email: emailRecomendacao(nome, materiais, cancelar) }, opts);
  }
}

async function tick() {
  if (rodando) return;
  rodando = true;
  try {
    for (const [nome, fn] of [['C', tickC], ['D', tickD], ['E', tickE]]) {
      try { await fn(); } catch (e) { console.error(`❌ [teste-avisos] ${nome}:`, e.message); }
    }
  } finally {
    rodando = false;
  }
}

function iniciarWorkerAvisos() {
  if (intervalId) return;
  intervalId = setInterval(tick, INTERVALO_MS);
  setTimeout(tick, 30 * 1000);
  console.log('💳 [teste-avisos] worker das mensagens do Teste iniciado (a cada 1 min)');
}
function pararWorkerAvisos() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}

// ── HISTÓRICO (admin) ───────────────────────────────────────
// Tudo que foi registrado, por teste ou por lead (incompletos), com o status
// real do WhatsApp lido da fila do gateway.
async function historico(coluna, ids) {
  if (!ids.length) return {};
  const r = await poolTeste.query(
    `SELECT id, teste_id, lead_id, momento, canal, conteudo, status, motivo, destino, texto, atendimento_id, criado_em
       FROM teste_avisos WHERE ${coluna} = ANY($1::uuid[]) ORDER BY criado_em, id`,
    [ids]
  );
  const atend = r.rows.map(a => a.atendimento_id).filter(Boolean);
  const fila = {};
  if (atend.length) {
    const f = await poolComunicacao.query(
      `SELECT atendimento_id, status, enviado_em, erro FROM fila_mensagens WHERE atendimento_id = ANY($1::uuid[])`,
      [atend]
    );
    for (const m of f.rows) (fila[m.atendimento_id] = fila[m.atendimento_id] || []).push(m);
  }
  const por = {};
  for (const a of r.rows) {
    let status = a.status;
    let quando = a.criado_em;
    let motivo = a.motivo;
    if (a.status === 'na_fila' && a.atendimento_id) {
      const msgs = fila[a.atendimento_id] || [];
      const erro = msgs.find(m => m.status === 'erro' || m.status === 'cancelado');
      if (erro) { status = 'erro'; motivo = erro.erro || 'falha no WhatsApp'; }
      else if (msgs.length && msgs.every(m => m.status === 'enviado')) {
        status = 'enviado';
        quando = msgs.map(m => m.enviado_em).sort().pop() || quando;
      }
    }
    (por[a[coluna]] = por[a[coluna]] || []).push({
      momento: a.momento, canal: a.canal, conteudo: a.conteudo, status, motivo,
      destino: a.destino, texto: a.texto, registrado_em: a.criado_em, quando,
    });
  }
  return por;
}
const historicoDosTestes = ids => historico('teste_id', ids);
const historicoDosLeads = ids => historico('lead_id', ids);

// ── CANCELAR INSCRIÇÃO e PESQUISA (páginas públicas) ────────
// Marca Não em Novidades no lead e no cadastro dela.
async function cancelarInscricao(leadId) {
  const r = await poolTeste.query(
    `UPDATE teste_leads SET aceite_marketing = FALSE, atualizado_em = atualizado_em WHERE id = $1 RETURNING usuario_id`,
    [leadId]
  );
  if (!r.rows[0]) return false;
  if (r.rows[0].usuario_id) {
    await poolCore.query(`UPDATE usuarios SET aceite_marketing = FALSE, atualizado_em = NOW() WHERE id = $1`, [r.rows[0].usuario_id])
      .catch(e => console.warn('⚠️ [teste-avisos] cancelar inscrição (usuario):', e.message));
  }
  return true;
}

async function dadosPesquisa(testeId) {
  const t = await carregarTeste(testeId);
  if (!t) return null;
  const a = await poolTeste.query(`SELECT nota, comentario FROM teste_avaliacoes WHERE teste_id = $1`, [testeId]).catch(() => ({ rows: [] }));
  return { nome: primeiroNome(t.nome), nota: a.rows[0] ? a.rows[0].nota : null };
}

// ── /pagar/:id (link das mensagens de pagamento) ────────────
// Prévia do WhatsApp com o título e a imagem da página do Teste; quem toca
// cai na hora no mesmo checkout do fim do teste (?uid=VM<id>).
// Devolve null quando o teste não existe ou o produto está sem link.
async function paginaPagar(testeId) {
  const t = await poolTeste.query(`SELECT 1 FROM testes WHERE id = $1`, [testeId]);
  if (!t.rows[0]) return null;
  const checkout = await linkPagamento(testeId);
  if (!checkout) return null;
  const c = esc(checkout);
  const titulo = 'Teste do Subconsciente | Vida Mágica - Suellen Seragi';
  const descricao = 'Finalize seu pagamento e descubra o que o teste revelou sobre seu subconsciente.';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${titulo}</title>
<meta name="description" content="${descricao}">
<meta property="og:site_name" content="Vida Mágica - Suellen Seragi">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:url" content="${esc(linkPagar(testeId))}">
<meta property="og:title" content="${titulo}">
<meta property="og:description" content="${descricao}">
<meta property="og:image" content="https://vidamagica.com.br/assets/compartilhar-vida-magica.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#1A1205; color:#f5f0e8; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; min-height:100vh; line-height:1.6; }
  .wrap { max-width:440px; margin:0 auto; padding:32px 20px 48px; text-align:center; }
  .logo { display:block; height:32px; width:auto; margin:0 auto 28px; }
  p { color:#c8c0a8; font-size:15px; margin-bottom:20px; }
  a.botao { display:inline-block; padding:12px 28px; background:#E8C97A; color:#1A1205; border-radius:8px; font-weight:700; font-size:14px; text-decoration:none; }
</style>
<script>location.replace(${JSON.stringify(checkout)});</script>
</head>
<body>
<main class="wrap">
  <img class="logo" src="/assets/logo-horizontal.webp" alt="Vida Mágica">
  <p>Abrindo o pagamento do seu Teste do Subconsciente…</p>
  <a class="botao" href="${c}">Finalizar pagamento</a>
</main>
</body>
</html>`;
}

// ── AMOSTRAS (admin → "Testar mensagens") ───────────────────
// Manda UMA peça, exatamente como sai de verdade, para o telefone/e-mail que
// o Renato digitar. Os links usam o teste mais recente desse telefone (os
// testes que ele mesmo faz); sem teste dele, o mais recente do sistema.
// Não grava em teste_avisos (não suja o histórico). WhatsApp pelo gateway,
// categoria 'manual_admin'.
const AMOSTRAS = {
  A_whatsapp: 'A · WhatsApp', A_email: 'A · E-mail',
  B_whatsapp: 'B · WhatsApp', B_email: 'B · E-mail',
  C_whatsapp: 'C · WhatsApp', C_email: 'C · E-mail',
  D_whatsapp: 'D · WhatsApp', D_email: 'D · E-mail',
  E_whatsapp: 'E · WhatsApp', E_pesquisa: 'E · E-mail de pesquisa', E_materiais: 'E · E-mail de materiais',
  R_whatsapp: 'Reenvio do resultado · WhatsApp', R_email: 'Reenvio do resultado · E-mail',
};
const CANCELAR_AMOSTRA = `${APP_URL}/cancelar-inscricao/00000000-0000-0000-0000-000000000000`;

async function enviarAmostra({ peca, telefone, email, nome }) {
  if (!AMOSTRAS[peca]) return { ok: false, erro: 'Mensagem desconhecida' };
  const canal = /_whatsapp$/.test(peca) ? 'whatsapp' : 'email';
  const { formatarTelefone } = require('./utils');
  const tel = telefone ? formatarTelefone(telefone) : '';
  if (canal === 'whatsapp' && !tel) return { ok: false, erro: 'Digite o telefone' };
  if (canal === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) return { ok: false, erro: 'Digite o e-mail' };

  let r = tel ? await poolTeste.query(`SELECT id FROM testes WHERE telefone_canonico = $1 ORDER BY feito_em DESC LIMIT 1`, [tel]) : { rows: [] };
  if (!r.rows[0]) r = await poolTeste.query(`SELECT id FROM testes ORDER BY feito_em DESC LIMIT 1`);
  if (!r.rows[0]) return { ok: false, erro: 'Nenhum teste no sistema para montar os links' };
  const t = await carregarTeste(r.rows[0].id);
  const n = primeiroNome(nome) || primeiroNome(t.nome);
  const pagar = linkPagar(t.id);
  const resultado = linkResultado(t.id);

  let texto = null;
  let mail = null;
  switch (peca) {
    case 'A_whatsapp': texto = waA(n, pagar); break;
    case 'A_email': mail = emailA(n, pagar, await precoTeste()); break;
    case 'B_whatsapp': texto = waB(resultado); break;
    case 'B_email': mail = emailB(n, resultado); break;
    case 'C_whatsapp': texto = waRecuperacao(n, t.lead_id ? linkContinuar(t.lead_id) : `${APP_URL}/teste`); break;
    case 'C_email': mail = emailRecuperacao(n, t.lead_id ? linkContinuar(t.lead_id) : `${APP_URL}/teste`, 'Continuar meu teste', CANCELAR_AMOSTRA); break;
    case 'D_whatsapp': texto = waRecuperacao(n, pagar); break;
    case 'D_email': mail = emailRecuperacao(n, pagar, 'Finalizar pagamento', CANCELAR_AMOSTRA); break;
    case 'E_whatsapp': texto = waE(); break;
    case 'E_pesquisa': mail = emailPesquisa(n, linkPesquisa(t.id), CANCELAR_AMOSTRA); break;
    case 'E_materiais': mail = emailRecomendacao(n, await materiaisDoTeste(t), CANCELAR_AMOSTRA); break;
    case 'R_whatsapp': texto = waReenvio(n, resultado); break;
    case 'R_email': mail = emailReenvio(n, resultado); break;
  }
  try {
    if (canal === 'whatsapp') {
      if (await whatsappPausado('manual_admin')) return { ok: false, erro: 'WhatsApp pausado no gateway' };
      const textos = Array.isArray(texto) ? texto : [texto];
      await enfileirarAtendimento({
        telefone: tel, tipo: 'ativo', categoria: 'manual_admin', origem: 'admin-amostra-teste',
        nome: n || null, mensagens: textos.map(x => ({ texto: x })),
      });
    } else {
      await enviarBrevo(email, n, mail.subject, mail.html);
    }
    return { ok: true, nome: AMOSTRAS[peca] };
  } catch (e) {
    console.error('❌ [teste-avisos] amostra:', (e.response && JSON.stringify(e.response.data)) || e.message);
    return { ok: false, erro: 'Falha ao enviar' };
  }
}

module.exports = {
  enviarAmostra,
  paginaPagar,
  dispararNaHora,
  dispararPago,
  enviarManual,
  historicoDosTestes,
  historicoDosLeads,
  cancelarInscricao,
  dadosPesquisa,
  iniciarWorkerAvisos,
  pararWorkerAvisos,
  rodarAgora: tick,
  // prévia/testes
  _emails: { emailA, emailB, emailReenvio, emailRecuperacao, emailPesquisa, emailRecomendacao, materiaisDoTeste },
};
