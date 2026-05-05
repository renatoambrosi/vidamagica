/* ── VmSession ── */
window.VmSession=(function(){const K='vm_s',P='vm_lembrar';function salvar(d,l){const p=l!==undefined?l:getLembrar();localStorage.setItem(P,p?'1':'0');const s=p?localStorage:sessionStorage,o=p?sessionStorage:localStorage;o.removeItem(K);s.setItem(K,JSON.stringify(d));}function carregar(){try{const r=localStorage.getItem(K)||sessionStorage.getItem(K);return r?JSON.parse(r):null;}catch{return null;}}function destruir(){localStorage.removeItem(K);sessionStorage.removeItem(K);}function getAccess(){return carregar()?.access_token||null;}function getRefresh(){return carregar()?.refresh_token||null;}function getLembrar(){return localStorage.getItem(P)!=='0';}return{salvar,carregar,destruir,getAccess,getRefresh,getLembrar};})();

/* ============================================================
   VIDA MÁGICA — App v9
   ============================================================ */

const API = '';
const LINK_ASSINAR = 'https://www.vidamagica.com.br/assinar';
let usuario  = null;
let chatWs   = null;

let canalAtivo = null;
let chatConv = null;
let mensagensAtuais = [];
let timerInterval = null;
let replyMsgAtual = null;
let ctxMsgAtual = null;

// ── AUTH ────────────────────────────────────────────────────
async function checarAuth() {
  const access = VmSession.getAccess();
  if (!access) { window.location.replace('/auth?intencional'); return null; }
  try {
    const r = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
    if (r.ok) return await r.json();
    if (r.status === 401) {
      const refresh = VmSession.getRefresh();
      if (!refresh) { VmSession.destruir(); window.location.replace('/auth?intencional'); return null; }
      const r2 = await fetch(`${API}/api/auth/renovar`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ refresh_token: refresh }) });
      if (r2.ok) {
        const d = await r2.json();
        VmSession.salvar(d, VmSession.getLembrar());
        const r3 = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${d.access_token}` } });
        if (r3.ok) return await r3.json();
      }
      VmSession.destruir(); window.location.replace('/auth?intencional'); return null;
    }
  } catch {}
  return null;
}

function authHeader() { return { Authorization: `Bearer ${VmSession.getAccess()}` }; }

function hidratarUI(u) {
  if (!u) return;
  usuario = u;
  const nome = (u.nome||'').split(' ')[0] || 'Você';
  const el = document.getElementById('saudacao-nome');
  if (el) el.textContent = `Olá, ${nome}`;
  document.getElementById('badge-sementes').textContent = u.sementes || 0;
  document.getElementById('perfil-nome').textContent    = u.nome || '—';
  document.getElementById('perfil-sementes').textContent = u.sementes || 0;
  if (u.foto_url) {
    const av = document.getElementById('perfil-avatar');
    if (av) av.innerHTML = `<img src="${u.foto_url}" alt="${u.nome}">`;
  }
}

// ── PARTÍCULAS ──────────────────────────────────────────────
function criarParticulas() {
  const c = document.getElementById('particulas');
  if (!c) return;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particula';
    const t = Math.random() * 4 + 2;
    p.style.cssText = `width:${t}px;height:${t}px;left:${Math.random()*100}%;animation-duration:${Math.random()*18+12}s;animation-delay:${Math.random()*20}s;`;
    c.appendChild(p);
  }
}

function criarSprites() {
  const S = [
    {top:'15%',left:'8%',size:18,dur:4.2,delay:0},
    {top:'22%',right:'6%',size:14,dur:5.8,delay:1.4},
    {top:'38%',left:'5%',size:12,dur:6.1,delay:2.2},
    {top:'55%',right:'4%',size:16,dur:4.8,delay:0.8},
    {top:'70%',left:'7%',size:10,dur:7.2,delay:3.1},
    {top:'82%',right:'9%',size:20,dur:5.3,delay:1.9},
  ];
  S.forEach(s => {
    const el = document.createElement('div');
    el.className = 'sprite';
    Object.assign(el.style, { top:s.top||'auto', left:s.left||'auto', right:s.right||'auto', width:s.size+'px', height:s.size+'px', animationDuration:s.dur+'s', animationDelay:s.delay+'s' });
    el.innerHTML = `<svg viewBox="0 0 24 24" width="${s.size}" height="${s.size}" fill="none"><path d="M12 2L13.5 9L20 9L14.5 13.5L16.5 20L12 16L7.5 20L9.5 13.5L4 9L10.5 9Z" fill="rgba(232,201,122,0.7)" stroke="rgba(200,146,42,0.4)" stroke-width="0.5"/></svg>`;
    document.body.appendChild(el);
  });
}

// ── TOAST ────────────────────────────────────────────────────
function toast(msg, tipo='ok') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `show ${tipo}`;
  setTimeout(() => t.className = '', 3000);
}

// ── BOTTOM NAV ───────────────────────────────────────────────
function irPara(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${viewId}`)?.classList.add('active');
  document.querySelector(`.nav-tab[data-view="${viewId}"]`)?.classList.add('active');

  // Esconde header preto quando entra no chat
  if (viewId === 'chat') {
    document.body.classList.add('chat-aberto');
    abrirTelaEscolhaChat();
  } else {
    document.body.classList.remove('chat-aberto');
    // Tira foco do textarea pra fechar teclado se estava aberto
    document.getElementById('chat-input')?.blur();
  }

  if (viewId === 'perfil') renderPerfil();
}
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => irPara(tab.dataset.view));
});
document.querySelector('.nav-tab[data-view="chat"]')?.addEventListener('click', () => {
  document.getElementById('nav-chat-badge').style.display = 'none';
});

// ── MODAIS ───────────────────────────────────────────────────
function abrirModal(id) {
  document.getElementById(id)?.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
}
function fecharModal(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  if (el.id === 'modal-player') pararPlayer();
  el.setAttribute('aria-hidden','true');
  document.body.style.overflow = '';
}
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', e => fecharModal(e.target.closest('.modal')));
});
document.addEventListener('keydown', e => { if (e.key==='Escape') document.querySelectorAll('.modal[aria-hidden="false"]').forEach(m => fecharModal(m)); });

document.getElementById('btn-avisos')?.addEventListener('click', () => { renderAvisos(); abrirModal('modal-avisos'); setTimeout(() => { AVISOS.forEach(a => marcarLido(a.id)); atualizarBadgeAvisos(); }, 2000); });
document.getElementById('btn-sementes')?.addEventListener('click', () => irPara('perfil'));
document.getElementById('menu-testes')?.addEventListener('click',  () => { carregarTestes(); abrirModal('modal-testes'); });
document.getElementById('menu-logout')?.addEventListener('click',  async () => {
  const refresh = VmSession.getRefresh();
  try { await fetch(`${API}/api/auth/logout`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({refresh_token:refresh}) }); } catch {}
  VmSession.destruir();
  window.location.replace('/');
});

// ── PLAYER ───────────────────────────────────────────────────
function embedDeUrl(url) {
  if (!url) return '';
  const origin = encodeURIComponent(window.location.origin);
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0&enablejsapi=1&origin=${origin}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}?autoplay=1`;
  return url;
}
function thumbDeUrl(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/mqdefault.jpg`;
  return null;
}
function abrirPlayer({ titulo, subtitulo, corpo, url }) {
  document.getElementById('player-titulo').textContent = titulo||'';
  document.getElementById('player-sub').textContent    = subtitulo||'';
  document.getElementById('player-corpo').textContent  = corpo||'';
  const wrap = document.querySelector('.player-wrap');
  const iframe = document.getElementById('player-iframe');
  if (url) { iframe.src = embedDeUrl(url); if (wrap) wrap.style.display=''; }
  else      { iframe.src = '';              if (wrap) wrap.style.display='none'; }
  abrirModal('modal-player');
}
function pararPlayer() { const iframe = document.getElementById('player-iframe'); if (iframe) iframe.src=''; }

// ── FEED ─────────────────────────────────────────────────────
function icone(tipo) { return {video:'🎬',texto:'📝',imagem:'🖼️',link:'🔗'}[tipo]||'✦'; }
async function carregarFeed() {
  try {
    const r = await fetch(`${API}/api/feed`);
    if (!r.ok) return;
    const itens = await r.json();
    renderCarrossel(itens.filter(i => i.destaque));
    renderLista(itens.filter(i => !i.destaque));
  } catch {}
}
function renderCarrossel(itens) {
  const wrap=document.getElementById('feed-carrossel-wrap'), car=document.getElementById('feed-carrossel'), dots=document.getElementById('feed-dots');
  if (!itens.length) { wrap.style.display='none'; return; }
  wrap.style.display='';
  car.innerHTML=itens.map(item=>{const thumb=item.imagem_url||thumbDeUrl(item.url),isVid=item.tipo==='video';return`<div class="feed-card-destaque" tabindex="0" data-tipo="${item.tipo}" data-url="${item.url||''}" data-titulo="${encodeURIComponent(item.titulo)}" data-subtitulo="${encodeURIComponent(item.subtitulo||'')}" data-corpo="${encodeURIComponent(item.corpo||'')}"><div class="feed-thumb">${thumb?`<img src="${thumb}" alt="${item.titulo}" loading="lazy">`:`<div class="feed-thumb-placeholder">${icone(item.tipo)}</div>`}${isVid?`<div class="feed-play-overlay"><div class="feed-play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>`:''}</div><div class="feed-card-body">${item.subtitulo?`<div class="feed-card-eyebrow">${item.subtitulo}</div>`:''}<div class="feed-card-titulo">${item.titulo}</div>${item.corpo?`<div class="feed-card-corpo">${item.corpo}</div>`:''}</div></div>`;}).join('');
  dots.innerHTML=itens.map((_,i)=>`<div class="feed-dot${i===0?' ativo':''}" data-idx="${i}"></div>`).join('');
  car.addEventListener('scroll',()=>{const idx=Math.round(car.scrollLeft/car.offsetWidth);dots.querySelectorAll('.feed-dot').forEach((d,i)=>d.classList.toggle('ativo',i===idx));},{passive:true});
  dots.querySelectorAll('.feed-dot').forEach(d=>d.addEventListener('click',()=>{const c=car.children[parseInt(d.dataset.idx)];if(c)c.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'});}));
  car.querySelectorAll('.feed-card-destaque').forEach(c=>c.addEventListener('click',()=>ativarItem(c)));
}
function renderLista(itens) {
  const lista=document.getElementById('feed-lista');if(!lista)return;
  lista.innerHTML=itens.map(item=>{const thumb=item.imagem_url||thumbDeUrl(item.url),isVid=item.tipo==='video';return`<div class="feed-card-lista" tabindex="0" data-tipo="${item.tipo}" data-url="${item.url||''}" data-titulo="${encodeURIComponent(item.titulo)}" data-subtitulo="${encodeURIComponent(item.subtitulo||'')}" data-corpo="${encodeURIComponent(item.corpo||'')}"><div class="feed-lista-thumb">${thumb?`<img src="${thumb}" alt="${item.titulo}" loading="lazy">`:`<div class="feed-lista-thumb-placeholder">${icone(item.tipo)}</div>`}${isVid?`<div class="feed-lista-play"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`:''}</div><div class="feed-lista-info">${item.subtitulo?`<div class="feed-lista-eyebrow">${item.subtitulo}</div>`:''}<div class="feed-lista-titulo">${item.titulo}</div>${item.corpo?`<div class="feed-lista-corpo">${item.corpo}</div>`:''}</div></div>`;}).join('');
  lista.querySelectorAll('.feed-card-lista').forEach(c=>c.addEventListener('click',()=>ativarItem(c)));
}
function ativarItem(card) {
  const tipo=card.dataset.tipo,url=card.dataset.url,titulo=decodeURIComponent(card.dataset.titulo),subtitulo=decodeURIComponent(card.dataset.subtitulo),corpo=decodeURIComponent(card.dataset.corpo);
  if(tipo==='video'&&url) abrirPlayer({titulo,subtitulo,corpo,url});
  else if((tipo==='link'||tipo==='imagem')&&url) window.open(url,'_blank','noopener');
  else abrirPlayer({titulo,subtitulo,corpo,url:null});
}

// ── TESOURO ──────────────────────────────────────────────────
const TESOURO_KEY = 'vm_tesouro_resgatado';
function tesouroJaResgatado(id) { try { return JSON.parse(localStorage.getItem(TESOURO_KEY)||'[]').includes(id); } catch { return false; } }
function marcarTesouroResgatado(id) { try { const l=JSON.parse(localStorage.getItem(TESOURO_KEY)||'[]'); if(!l.includes(id)){l.push(id);localStorage.setItem(TESOURO_KEY,JSON.stringify(l));} } catch {} }
let tesouroAtual = null;
async function carregarTesouro() {
  try {
    const r = await fetch(`${API}/api/feed`); if(!r.ok) return;
    const itens = await r.json();
    const item = itens.find(i => i.ativo && !tesouroJaResgatado(String(i.id)));
    if (!item) { document.getElementById('tesouro-sub').textContent='Nenhum tesouro hoje ainda'; return; }
    tesouroAtual = item;
    document.getElementById('tesouro-btn').classList.add('tem-novidade');
    document.getElementById('tesouro-sub').textContent='Novo! Toque para resgatar ✨';
  } catch {}
}
document.getElementById('tesouro-btn')?.addEventListener('click', () => {
  if (!tesouroAtual) return;
  const conteudo = document.getElementById('modal-tesouro-conteudo');
  conteudo.innerHTML = `
    <div style="padding:1rem 1.25rem 0">
      <div class="feed-card-eyebrow" style="margin-bottom:0.4rem">${tesouroAtual.subtitulo||'Tesouro do Dia'}</div>
      <div class="feed-card-titulo" style="font-size:1.1rem;margin-bottom:0.6rem">${tesouroAtual.titulo}</div>
      ${tesouroAtual.corpo?`<p style="font-size:0.86rem;color:var(--texto-suave);line-height:1.6;margin-bottom:1rem">${tesouroAtual.corpo}</p>`:''}
      <div style="font-size:0.75rem;color:var(--ouro-fundo);font-family:var(--font-display);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.2rem">Recompensa</div>
      <div style="font-size:1.4rem;font-family:var(--font-display);font-weight:900;color:var(--ouro-fundo);margin-bottom:1rem">+1 🌱 Semente</div>
    </div>`;
  abrirModal('modal-tesouro');
});
document.getElementById('modal-tesouro-resgatar')?.addEventListener('click', async () => {
  if (!tesouroAtual || !usuario) return;
  const btn = document.getElementById('modal-tesouro-resgatar');
  btn.disabled = true; btn.textContent = 'Resgatando...';
  marcarTesouroResgatado(String(tesouroAtual.id));
  usuario.sementes = (usuario.sementes||0) + 1;
  document.getElementById('badge-sementes').textContent = usuario.sementes;
  document.getElementById('perfil-sementes').textContent = usuario.sementes;
  fecharModal('modal-tesouro');
  document.getElementById('tesouro-btn').classList.remove('tem-novidade');
  document.getElementById('tesouro-sub').textContent = 'Resgatado! Volte amanhã 🌱';
  tesouroAtual = null;
  btn.disabled = false; btn.textContent = '🌱 Resgatar Tesouro';
});

// ── AVISOS ───────────────────────────────────────────────────
const AVISOS_KEY = 'vm_avisos_lidos';
const AVISOS = [
  {id:'av1',tag:'Tesouro da Su',titulo:'Seu presente chegou! ✨',desc:'Um novo tesouro está disponível para você hoje.',data:'Hoje'},
  {id:'av2',tag:'Comunidade',titulo:'Novo conteúdo disponível',desc:'A Suellen Seragi publicou um conteúdo exclusivo para membros.',data:'1 dia'},
];
function getLidos() { try { return JSON.parse(localStorage.getItem(AVISOS_KEY)||'[]'); } catch { return []; } }
function marcarLido(id) { const l=getLidos(); if(!l.includes(id)){l.push(id);localStorage.setItem(AVISOS_KEY,JSON.stringify(l));} }
function atualizarBadgeAvisos() {
  const badge = document.getElementById('ponto-avisos');
  if (badge) AVISOS.some(a=>!getLidos().includes(a.id)) ? badge.classList.add('visivel') : badge.classList.remove('visivel');
}
function renderAvisos() {
  const corpo = document.getElementById('avisos-corpo'); if (!corpo) return;
  const lidos = getLidos();
  corpo.innerHTML = AVISOS.map(a=>`<div class="aviso-item${!lidos.includes(a.id)?' nao-lido':''}" data-id="${a.id}"><div class="aviso-dot"></div><div class="aviso-corpo"><div class="aviso-tag">${a.tag}</div><div class="aviso-titulo">${a.titulo}</div><div class="aviso-desc">${a.desc}</div><div class="aviso-data">${a.data}</div></div></div>`).join('');
  corpo.querySelectorAll('.aviso-item').forEach(el=>el.addEventListener('click',()=>{marcarLido(el.dataset.id);el.classList.remove('nao-lido');atualizarBadgeAvisos();}));
}

// ── TESTES ───────────────────────────────────────────────────
async function carregarTestes() {
  const corpo = document.getElementById('testes-corpo'); if (!corpo) return;
  corpo.innerHTML = '<div class="loading-inline">Carregando...</div>';
  try {
    const r = await fetch(`${API}/api/auth/testes`, { headers: authHeader() });
    if (!r.ok) throw new Error();
    const testes = await r.json();
    if (!testes.length) { corpo.innerHTML='<div class="loading-inline">Nenhum teste realizado ainda.</div>'; return; }
    corpo.innerHTML = testes.map(t=>`<div class="teste-item"><div class="teste-perfil">${t.perfil_dominante}</div><div class="teste-pct">${t.percentual_prosperidade}<span>%</span></div><div class="teste-data">${new Date(t.feito_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</div></div>`).join('');
  } catch { corpo.innerHTML='<div class="loading-inline">Erro ao carregar.</div>'; }
}

// ── PERFIL ───────────────────────────────────────────────────
function renderPerfil() {
  if (!usuario) return;
  document.getElementById('perfil-nome').textContent     = usuario.nome || '—';
  document.getElementById('perfil-sementes').textContent = usuario.sementes || 0;
}

// ════════════════════════════════════════════════════════════
// CHAT
// ════════════════════════════════════════════════════════════

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function horaFmt(data) { return new Date(data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function fmtTempo(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

// Linkifica URLs num texto, retornando HTML seguro.
function linkificar(texto) {
  const escaped = escHtml(texto || '');
  return escaped.replace(
    /(https?:\/\/[^\s<>]+)/gi,
    (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`
  );
}

// Detecta se a mensagem é o template de assinatura (mostra botão CTA)
function isMensagemAssinatura(msg) {
  if (!msg || msg.remetente !== 'suellen') return false;
  const c = String(msg.conteudo || '');
  return c.includes('vidamagica.com.br/assinar') || c.includes('Para assinar o Vida Mágica');
}

// ── Tela de escolha ──
function abrirTelaEscolhaChat() {
  canalAtivo = null;
  document.getElementById('chat-escolha-tela').style.display = 'flex';
  document.getElementById('chat-conversa-tela').style.display = 'none';
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  carregarResumoChats();
}

async function carregarResumoChats() {
  try {
    const r = await fetch(`${API}/api/chat/resumo`, { headers: authHeader() });
    if (!r.ok) return;
    const dados = await r.json();
    atualizarCardCanal('suellen', dados.suellen);
    atualizarCardCanal('suporte', dados.suporte);
  } catch (err) {
    console.warn('[resumo]', err.message);
  }
}

function atualizarCardCanal(canal, info) {
  const badge = document.getElementById(`canal-${canal}-badge`);
  const preview = document.getElementById(`canal-${canal}-preview`);
  const abaBadge = document.getElementById(`aba-${canal}-badge`);
  if (!info) return;
  const naoLidas = info.nao_lidas || 0;
  if (badge) {
    if (naoLidas > 0) { badge.textContent = naoLidas; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
  if (preview) preview.textContent = info.ultima_preview || '';
  if (abaBadge) {
    if (naoLidas > 0) { abaBadge.textContent = naoLidas; abaBadge.style.display = ''; }
    else abaBadge.style.display = 'none';
  }
}

// ── Abrir canal ──
async function abrirCanal(canal) {
  canalAtivo = canal;
  document.getElementById('chat-escolha-tela').style.display = 'none';
  document.getElementById('chat-conversa-tela').style.display = 'flex';

  const isS = canal === 'suellen';
  const headerImg = document.getElementById('chat-canal-header-img');
  const headerNome = document.getElementById('chat-canal-header-nome');
  const headerStatus = document.getElementById('chat-canal-header-status');
  if (headerImg) headerImg.src = isS ? '/assets/avatar-suellen.jpg' : '/assets/logo-equipe.png';
  if (headerNome) headerNome.textContent = isS ? 'Suellen Seragi' : 'Equipe Vida Mágica';
  if (headerStatus) headerStatus.textContent = isS ? 'Atendimento' : 'Dúvidas e suporte';

  document.querySelectorAll('.chat-aba').forEach(b => {
    b.classList.toggle('ativa', b.dataset.aba === canal);
  });

  await carregarConversaCanal(canal);
}

async function carregarConversaCanal(canal) {
  const loading = document.getElementById('chat-loading');
  const msgsEl = document.getElementById('chat-msgs');
  const inputWrap = document.getElementById('chat-input-wrap');
  const replyBar = document.getElementById('reply-bar');

  loading.style.display = 'flex';
  msgsEl.style.display = 'none';
  inputWrap.style.display = 'none';
  if (replyBar) { replyBar.style.display = 'none'; replyBar.classList.remove('visivel'); }
  replyMsgAtual = null;

  try {
    const r = await fetch(`${API}/api/chat/conversa?tipo=${canal}`, { headers: authHeader() });
    if (!r.ok) throw new Error();
    const dados = await r.json();
    chatConv = dados.conversa;
    mensagensAtuais = dados.mensagens || [];

    msgsEl.innerHTML = '';
    mensagensAtuais.forEach(msg => msgsEl.appendChild(renderMensagem(msg)));

    loading.style.display = 'none';
    msgsEl.style.display = 'flex';
    inputWrap.style.display = '';
    if (replyBar) replyBar.style.display = '';
    scrollChat();
    atualizarBannerPlano(chatConv);
  } catch (err) {
    loading.innerHTML = `<p style="color:var(--texto-mute);font-size:0.82rem;text-align:center;padding:2rem">Erro ao carregar chat.</p>`;
    console.error('[carregarConversaCanal]', err);
  }
}

// ── Banner ──
function atualizarBannerPlano(conv) {
  const banner = document.getElementById('plano-banner');
  const titulo = document.getElementById('plano-banner-titulo');
  const desc = document.getElementById('plano-banner-desc');
  const btn = document.getElementById('plano-banner-acao');
  if (!banner || !titulo || !desc || !btn) return;

  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  banner.classList.remove('tier-free', 'tier-basic_vm', 'tier-prioritario', 'alerta');
  const tier = conv.tier || 'free';

  if (tier === 'prioritario') {
    banner.classList.add('tier-prioritario');
    titulo.innerHTML = '⭐ PRIORITÁRIO';
    btn.style.display = 'none';
    atualizarTimerPrioritario(conv);
    timerInterval = setInterval(() => atualizarTimerPrioritario(conv), 30000);
  } else if (tier === 'basic_vm') {
    banner.classList.add('tier-basic_vm');
    titulo.textContent = 'VIDA MÁGICA';
    desc.textContent = 'Resposta em até 5 dias';
    btn.style.display = '';
    btn.textContent = 'Ativar prioritário';
    btn.onclick = acaoAtivarPrioritario;
  } else {
    banner.classList.add('tier-free');
    titulo.textContent = 'PLANO FREE';
    desc.textContent = 'Tempo de resposta indeterminado';
    btn.style.display = '';
    btn.textContent = 'Assinar Vida Mágica';
    btn.onclick = acaoAssinarVM;
  }
}

function atualizarTimerPrioritario(conv) {
  const desc = document.getElementById('plano-banner-desc');
  const banner = document.getElementById('plano-banner');
  if (!desc) return;
  const interacoes = `${conv.interacoes_restantes ?? 30}/30 interações`;

  if (!conv.prioritario_expira_em) {
    desc.textContent = interacoes;
    return;
  }
  const restMs = new Date(conv.prioritario_expira_em).getTime() - Date.now();
  if (restMs <= 0) {
    desc.textContent = `${interacoes} · expirado`;
    banner.classList.add('alerta');
    return;
  }
  const totalMin = Math.floor(restMs / 60000);
  const horas = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  let tempoStr;
  if (horas > 0) tempoStr = `${horas}h ${min}m`;
  else if (totalMin > 0) tempoStr = `${totalMin}min`;
  else tempoStr = 'expirando';
  desc.textContent = `${interacoes} · ${tempoStr}`;
  if (totalMin < 60) banner.classList.add('alerta');
}

// ── Ações ──
async function acaoAssinarVM() {
  if (canalAtivo !== 'suellen') {
    await abrirCanal('suellen');
  }
  try {
    const r = await fetch(`${API}/api/chat/assinar-vm-template`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error();
    setTimeout(() => carregarConversaCanal('suellen'), 300);
  } catch {
    toast('Erro. Tente novamente.', 'err');
  }
}

async function acaoAtivarPrioritario() {
  if (!confirm('Ativar Atendimento Prioritário (R$ 9,90 · 30 interações em 24h)?')) return;
  try {
    const r = await fetch(`${API}/api/chat/ativar-prioritario`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo_chat: canalAtivo, origem: 'pagamento' }),
    });
    if (!r.ok) throw new Error();
    toast('⭐ Prioritário ativado!');
    carregarConversaCanal(canalAtivo);
  } catch {
    toast('Erro ao ativar', 'err');
  }
}

// ── Render mensagens ──
function gerarWaveform(n=28) {
  const a = [];
  for (let i=0; i<n; i++) a.push(Math.random()*0.7 + 0.18);
  for (let i=1; i<n-1; i++) a[i] = (a[i-1]+a[i]+a[i+1])/3;
  return a;
}

function checkSvg() {
  return `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="2 9 6 13 12 5"/>
    <polyline points="7 13 11 13 17 5"/>
  </svg>`;
}

// Analisa um texto pra detectar se é SÓ emojis (zero letras/números) e quantos.
// Suporta emojis com modificadores (👏🏻 = punho + tom de pele). Conta clusters Unicode.
// Retorna: { soEmojis: bool, qtd: number }
function analisarConteudoEmoji(texto) {
  if (!texto) return { soEmojis: false, qtd: 0 };
  const t = texto.trim();
  if (!t) return { soEmojis: false, qtd: 0 };
  // Se tem letras/números/pontuação que não seja espaço entre emojis → não é "só emoji"
  if (/[\p{L}\p{N}]/u.test(t)) return { soEmojis: false, qtd: 0 };
  // Conta clusters de emoji (cada emoji visível, mesmo composto)
  let qtd = 0;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const _ of seg.segment(t)) qtd++;
  } else {
    // Fallback: conta code points "extended pictographic"
    const sem = t.replace(/\s+/g, '');
    qtd = Array.from(sem).length; // imperfeito mas razoável
  }
  return { soEmojis: qtd > 0 && qtd <= 6, qtd };
}

// Renderiza balãozinhos de reação debaixo da bolha.
function renderReacoesEl(reacoes) {
  if (!reacoes || !Object.keys(reacoes).length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'msg-reacoes';
  for (const emoji of Object.keys(reacoes)) {
    const r = reacoes[emoji];
    const chip = document.createElement('span');
    chip.className = 'msg-reacao-chip';
    chip.dataset.emoji = emoji;
    chip.innerHTML = `<span class="emoji">${emoji}</span>${r.count > 1 ? `<span class="cnt">${r.count}</span>` : ''}`;
    wrap.appendChild(chip);
  }
  return wrap;
}

function renderMensagem(msg) {
  if (msg.tipo === 'audio' && msg.url) return criarBolhaAudio(msg);

  const isAluna = msg.remetente === 'aluna';
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${isAluna ? 'aluna' : 'suellen'}`;
  wrap.dataset.id = msg.id;

  const ident = msg.identidade || 'suellen';
  const nomeIdent = ident === 'equipe' ? 'Equipe Vida Mágica' : 'Suellen Seragi';

  // Reply preview
  let replyHtml = '';
  if (msg.reply_to_conteudo) {
    const replyAutor = msg.reply_to_remetente === 'aluna'
      ? 'Você'
      : (msg.reply_to_identidade === 'equipe' ? 'Equipe Vida Mágica' : 'Suellen Seragi');
    replyHtml = `<div class="msg-reply-preview">
      <span class="reply-autor">${escHtml(replyAutor)}</span>
      <span class="reply-texto">${escHtml((msg.reply_to_conteudo||'').substring(0,100))}</span>
    </div>`;
  }

  if (msg.tipo === 'imagem' && msg.url) {
    const bolha = document.createElement('div');
    bolha.className = 'msg-bolha';
    if (!isAluna) {
      bolha.dataset.identidade = ident;
      bolha.dataset.identidadeNome = nomeIdent;
    }
    bolha.innerHTML = replyHtml + `<div class="msg-imagem"><img src="${escHtml(msg.url)}" loading="lazy"></div>`;
    bolha.querySelector('.msg-imagem')?.addEventListener('click', () => window.open(msg.url, '_blank'));
    setupCtxMenu(bolha, msg);
    wrap.appendChild(bolha);
  } else {
    const bolha = document.createElement('div');
    bolha.className = 'msg-bolha';
    if (!isAluna) {
      bolha.dataset.identidade = ident;
      bolha.dataset.identidadeNome = nomeIdent;
    }
    // Detecta "só emojis" — aplica escala maior na bolha
    const analise = analisarConteudoEmoji(msg.conteudo);
    if (analise.soEmojis && !msg.reply_to_conteudo) {
      // 1 emoji = grande; 2-3 = médio; 4-6 = pequeno-médio
      let escala = 'med';
      if (analise.qtd === 1) escala = 'big';
      else if (analise.qtd <= 3) escala = 'med';
      else escala = 'sm';
      bolha.classList.add('msg-bolha-emoji', `msg-bolha-emoji-${escala}`);
    }
    // Texto com links clicáveis
    const corpoHtml = linkificar(msg.conteudo || '');
    let ctaHtml = '';
    if (isMensagemAssinatura(msg)) {
      ctaHtml = `<a class="msg-cta-btn" href="${LINK_ASSINAR}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Assinar agora</a>`;
    }
    bolha.innerHTML = replyHtml + corpoHtml + ctaHtml;
    setupCtxMenu(bolha, msg);
    wrap.appendChild(bolha);
  }

  // Reações (debaixo da bolha)
  const reacoesEl = renderReacoesEl(msg.reacoes);
  if (reacoesEl) wrap.appendChild(reacoesEl);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'msg-footer';
  footer.innerHTML = `<span class="msg-hora">${horaFmt(msg.criado_em)}</span>`;
  if (isAluna) {
    const checks = document.createElement('span');
    let estado = 'enviada';
    if (msg.lida) estado = 'lida';
    else if (msg.entregue) estado = 'entregue';
    checks.className = `msg-checks ${estado}`;
    checks.dataset.msgId = msg.id;
    checks.innerHTML = checkSvg();
    footer.appendChild(checks);
  }
  wrap.appendChild(footer);

  setupSwipe(wrap, msg);

  return wrap;
}

function criarBolhaAudio(msg) {
  const isAluna = msg.remetente === 'aluna';
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${isAluna ? 'aluna' : 'suellen'}`;
  wrap.dataset.id = msg.id;

  const ident = msg.identidade || 'suellen';
  const nomeIdent = ident === 'equipe' ? 'Equipe Vida Mágica' : 'Suellen Seragi';

  const alturas = msg._alturas || gerarWaveform(28);
  const N = alturas.length;
  const barW = 3, gap = 2, totalW = N * (barW + gap) - gap;
  const barsHtml = alturas.map((h, i) => {
    const bh = Math.max(4, Math.round(h * 22));
    const y = (28 - bh) / 2;
    return `<rect x="${i*(barW+gap)}" y="${y}" width="${barW}" height="${bh}" rx="1.5" class="msg-audio-wave-bar" data-idx="${i}"/>`;
  }).join('');

  const dur = msg.duracao || 0;
  const durFmt = fmtTempo(dur);

  const bolha = document.createElement('div');
  bolha.className = 'msg-audio-bolha';
  if (!isAluna) {
    bolha.dataset.identidade = ident;
    bolha.dataset.identidadeNome = nomeIdent;
  }
  bolha.innerHTML = `
    <button class="msg-audio-play-btn">
      <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    </button>
    <svg class="msg-audio-wave" viewBox="0 0 ${totalW} 28" xmlns="http://www.w3.org/2000/svg">${barsHtml}</svg>
    <span class="msg-audio-dur">${durFmt}</span>
  `;
  setupCtxMenu(bolha, msg);

  let audio = null;
  const playBtn = bolha.querySelector('.msg-audio-play-btn');
  const bars = bolha.querySelectorAll('.msg-audio-wave-bar');
  const durEl = bolha.querySelector('.msg-audio-dur');
  playBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!audio) {
      audio = new Audio(msg.url);
      audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        const pct = audio.currentTime / audio.duration;
        const idx = Math.floor(pct * bars.length);
        bars.forEach((b, i) => b.classList.toggle('ativa', i <= idx));
        const rem = Math.floor(audio.duration - audio.currentTime);
        durEl.textContent = fmtTempo(rem);
      });
      audio.addEventListener('ended', () => {
        bars.forEach(b => b.classList.remove('ativa'));
        playBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        durEl.textContent = durFmt;
      });
    }
    if (audio.paused) {
      audio.play();
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    } else {
      audio.pause();
      playBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    }
  });

  wrap.appendChild(bolha);

  const footer = document.createElement('div');
  footer.className = 'msg-footer';
  footer.innerHTML = `<span class="msg-hora">${horaFmt(msg.criado_em)}</span>`;
  if (isAluna) {
    const checks = document.createElement('span');
    let estado = 'enviada';
    if (msg.lida) estado = 'lida';
    else if (msg.entregue) estado = 'entregue';
    checks.className = `msg-checks ${estado}`;
    checks.dataset.msgId = msg.id;
    checks.innerHTML = checkSvg();
    footer.appendChild(checks);
  }
  wrap.appendChild(footer);

  setupSwipe(wrap, msg);

  return wrap;
}

function scrollChat() {
  const msgs = document.getElementById('chat-msgs');
  if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 50);
}

// ════════════════════════════════════════════════
// SWIPE PARA RESPONDER
// ════════════════════════════════════════════════
function setupSwipe(wrap, msg) {
  let startX = 0, startY = 0, currentX = 0;
  let arrastando = false;
  let direcaoBloqueada = null; // 'h' | 'v' | null
  const isAluna = msg.remetente === 'aluna';
  // Aluna mexe direita-pra-esquerda; Suellen esquerda-pra-direita
  const fator = isAluna ? -1 : 1;
  const triggerDist = 60;
  const maxDist = 90;

  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    arrastando = true;
    direcaoBloqueada = null;
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if (!arrastando || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!direcaoBloqueada) {
      if (Math.abs(dx) > Math.abs(dy) + 4) direcaoBloqueada = 'h';
      else if (Math.abs(dy) > 6) { direcaoBloqueada = 'v'; arrastando = false; return; }
    }
    if (direcaoBloqueada !== 'h') return;

    // Só permite na direção certa
    const dxAjustado = fator > 0 ? Math.max(0, dx) : Math.min(0, dx);
    currentX = Math.max(-maxDist, Math.min(maxDist, dxAjustado));
    wrap.style.transform = `translateX(${currentX}px)`;
    if (Math.abs(currentX) > triggerDist) wrap.classList.add('swipe-revealing');
    else wrap.classList.remove('swipe-revealing');
  }, { passive: true });

  wrap.addEventListener('touchend', () => {
    if (!arrastando) return;
    arrastando = false;
    const triggered = Math.abs(currentX) > triggerDist;
    wrap.style.transform = '';
    wrap.classList.remove('swipe-revealing');
    currentX = 0;
    if (triggered) {
      ctxMsgAtual = msg;
      acaoResponder();
    }
  });

  wrap.addEventListener('touchcancel', () => {
    arrastando = false;
    wrap.style.transform = '';
    wrap.classList.remove('swipe-revealing');
    currentX = 0;
  });
}

// ════════════════════════════════════════════════
// LONG-PRESS / CONTEXT MENU
// ════════════════════════════════════════════════
function setupCtxMenu(el, msg) {
  // Bloqueia o menu nativo do iOS
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  let pressTimer = null;
  let startX = 0, startY = 0;
  let cancelado = false;

  const abrirMenu = (x, y) => {
    if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
    ctxMsgAtual = msg;
    const menu = document.getElementById('msg-ctx-menu');
    if (!menu) return;
    menu.classList.add('visivel');
    const maxX = window.innerWidth - menu.offsetWidth - 8;
    const maxY = window.innerHeight - menu.offsetHeight - 8;
    menu.style.left = Math.min(Math.max(8, x), maxX) + 'px';
    menu.style.top = Math.min(Math.max(8, y), maxY) + 'px';
  };

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    cancelado = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (cancelado) return;
      abrirMenu(startX, startY);
    }, 450);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    const dx = Math.abs(e.touches[0].clientX - startX);
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dx > 8 || dy > 8) { cancelado = true; clearTimeout(pressTimer); }
  }, { passive: true });

  el.addEventListener('touchend', () => { cancelado = true; clearTimeout(pressTimer); });
  el.addEventListener('touchcancel', () => { cancelado = true; clearTimeout(pressTimer); });

  // Desktop: contextmenu (right-click)
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    abrirMenu(e.clientX, e.clientY);
  });
}

document.addEventListener('click', (e) => {
  // Não fecha se o clique foi num item do menu
  if (e.target.closest('.msg-ctx-menu')) return;
  document.getElementById('msg-ctx-menu')?.classList.remove('visivel');
});

function acaoResponder() {
  if (!ctxMsgAtual) return;
  replyMsgAtual = ctxMsgAtual;
  const autor = ctxMsgAtual.remetente === 'aluna'
    ? 'Você'
    : (ctxMsgAtual.identidade === 'equipe' ? 'Equipe Vida Mágica' : 'Suellen Seragi');
  const texto = ctxMsgAtual.conteudo
    || (ctxMsgAtual.tipo === 'imagem' ? '📷 Imagem' : ctxMsgAtual.tipo === 'audio' ? '🎤 Áudio' : '');
  const replyBar = document.getElementById('reply-bar');
  document.getElementById('reply-autor').textContent = autor;
  document.getElementById('reply-texto').textContent = texto;
  replyBar.classList.add('visivel');
  document.getElementById('chat-input')?.focus();
  document.getElementById('msg-ctx-menu')?.classList.remove('visivel');
}

document.getElementById('ctx-responder')?.addEventListener('click', acaoResponder);
document.getElementById('ctx-copiar')?.addEventListener('click', () => {
  if (ctxMsgAtual?.conteudo) {
    navigator.clipboard.writeText(ctxMsgAtual.conteudo).then(() => toast('Copiado'));
  }
  document.getElementById('msg-ctx-menu')?.classList.remove('visivel');
});

// ── REAÇÕES ──
async function reagirNaMsg(emoji) {
  if (!ctxMsgAtual || !emoji) return;
  const msgId = ctxMsgAtual.id;
  document.getElementById('msg-ctx-menu')?.classList.remove('visivel');
  try {
    await fetch(`${API}/api/chat/reacao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ mensagem_id: msgId, emoji }),
    });
    // O retorno via WebSocket atualiza a UI — não precisa mexer aqui.
  } catch (err) { console.error('[reagir]', err); }
}

document.querySelectorAll('#msg-ctx-emojis .msg-ctx-emoji[data-emoji]').forEach(btn => {
  btn.addEventListener('click', () => reagirNaMsg(btn.dataset.emoji));
});

// Botão "+" abre o picker nativo de emoji do teclado do celular.
// Usamos um input invisível com inputmode='text' — o teclado do iOS/Android tem
// botão pra trocar pra teclado de emoji (😀 ao lado da barra de espaço).
const pickerInput = document.getElementById('msg-ctx-emoji-picker');
document.getElementById('msg-ctx-emoji-mais')?.addEventListener('click', () => {
  if (!pickerInput) return;
  pickerInput.value = '';
  pickerInput.focus();
});
pickerInput?.addEventListener('input', () => {
  const v = pickerInput.value.trim();
  if (!v) return;
  // Pega o primeiro cluster grafêmico (1 emoji só)
  let primeiro = v;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const s of seg.segment(v)) { primeiro = s.segment; break; }
  } else {
    primeiro = Array.from(v)[0] || v;
  }
  pickerInput.value = '';
  pickerInput.blur();
  reagirNaMsg(primeiro);
});

// Toggle reação clicando direto no chip já existente sob a bolha
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.msg-reacao-chip');
  if (!chip) return;
  const wrap = chip.closest('.msg-wrap');
  if (!wrap) return;
  const msgId = parseInt(wrap.dataset.id, 10);
  const emoji = chip.dataset.emoji;
  if (!msgId || !emoji) return;
  // Aciona toggle
  fetch(`${API}/api/chat/reacao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ mensagem_id: msgId, emoji }),
  }).catch(err => console.error('[toggle reacao]', err));
});

document.getElementById('reply-fechar')?.addEventListener('click', () => {
  replyMsgAtual = null;
  document.getElementById('reply-bar')?.classList.remove('visivel');
});

// ── REFRESH DO CHAT (botão + pull-to-refresh) ──

let _refreshLock = false;

// Garante que o indicador de pull existe ACIMA do #chat-msgs como irmão (idempotente).
function getOuCriarPullIndicator() {
  let indic = document.getElementById('chat-pull-indicator');
  if (indic) return indic;
  const msgsEl = document.getElementById('chat-msgs');
  if (!msgsEl || !msgsEl.parentNode) return null;
  indic = document.createElement('div');
  indic.className = 'chat-pull-indicator';
  indic.id = 'chat-pull-indicator';
  indic.innerHTML = `
    <span class="chat-pull-indicator-circle">
      <svg viewBox="0 0 24 24">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
    </span>`;
  // Insere ACIMA da área de mensagens (não dentro)
  msgsEl.parentNode.insertBefore(indic, msgsEl);
  return indic;
}

// origem: 'botao' | 'pull' | 'push'
async function recarregarChatAtual(origem = 'botao') {
  if (_refreshLock) return;
  if (!chatConv) return;
  _refreshLock = true;

  const indic = getOuCriarPullIndicator();
  const btn = document.getElementById('btn-chat-refresh');
  const t0 = Date.now();
  const TEMPO_MIN = 700; // tempo mínimo do indicador visível (transição suave)

  if (indic) {
    indic.classList.remove('puxando', 'armado');
    indic.classList.add('atualizando');
  }
  if (origem === 'botao' && btn) btn.classList.add('atualizando');

  try {
    const r = await fetch(`${API}/api/chat/conversa?tipo=${chatConv.tipo}`, { headers: authHeader() });
    if (!r.ok) throw new Error();
    const dados = await r.json();
    chatConv = dados.conversa;
    mensagensAtuais = dados.mensagens || [];

    const msgsEl = document.getElementById('chat-msgs');
    if (msgsEl) {
      msgsEl.innerHTML = '';
      mensagensAtuais.forEach(msg => msgsEl.appendChild(renderMensagem(msg)));
      scrollChat();
    }
    atualizarBannerPlano(chatConv);
  } catch (err) {
    console.error('[recarregarChatAtual]', err);
  } finally {
    // Aguarda tempo mínimo pra animação ficar visível e suave
    const elapsed = Date.now() - t0;
    if (elapsed < TEMPO_MIN) await new Promise(r => setTimeout(r, TEMPO_MIN - elapsed));
    if (indic) indic.classList.remove('atualizando');
    if (btn) btn.classList.remove('atualizando');
    _refreshLock = false;
  }
}

// Listener delegado — funciona mesmo se o botão for re-renderizado depois
document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-chat-refresh')) {
    recarregarChatAtual('botao');
  }
});

// Pull-to-refresh — só na área de mensagens, sem afetar o resto da tela.
// O indicador é um botão circular dourado que aparece NO TOPO da #chat-msgs,
// gira conforme aluna puxa e completa giro quando "arma".
(function setupPullToRefresh() {
  const msgsEl = document.getElementById('chat-msgs');
  if (!msgsEl) return;

  // Indicador visual: círculo dourado com ícone de refresh dentro
  const indic = document.createElement('div');
  indic.className = 'chat-pull-indicator';
  indic.id = 'chat-pull-indicator';
  indic.innerHTML = `
    <span class="chat-pull-indicator-circle">
      <svg viewBox="0 0 24 24">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
    </span>`;
  msgsEl.appendChild(indic);
  const circle = indic.querySelector('.chat-pull-indicator-circle');

  let startY = 0;
  let pulling = false;
  let armed = false;
  const LIMITE_ARMAR = 70; // px puxados pra disparar

  msgsEl.addEventListener('touchstart', (e) => {
    if (msgsEl.scrollTop > 0) { pulling = false; return; }
    startY = e.touches[0].clientY;
    pulling = true;
    armed = false;
    indic.classList.remove('puxando', 'armado', 'atualizando');
    circle.style.transform = ''; // reset
  }, { passive: true });

  msgsEl.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const diff = e.touches[0].clientY - startY;
    if (diff <= 0) return;

    // Mostra indicador progressivamente conforme puxa
    indic.classList.add('puxando');

    // Rotação proporcional ao quanto puxou (até 360° em LIMITE_ARMAR)
    const ratio = Math.min(diff / LIMITE_ARMAR, 1);
    const rot = ratio * 360;
    const scale = 0.4 + (0.6 * ratio); // de 0.4 a 1.0

    if (diff < LIMITE_ARMAR) {
      circle.style.transform = `scale(${scale}) rotate(${rot}deg)`;
      if (armed) {
        armed = false;
        indic.classList.remove('armado');
      }
    } else {
      circle.style.transform = ''; // deixa CSS de .armado tomar conta
      if (!armed) {
        armed = true;
        indic.classList.add('armado');
      }
    }
  }, { passive: true });

  msgsEl.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (armed) {
      circle.style.transform = ''; // CSS de .atualizando assume
      indic.classList.remove('armado', 'puxando');
      indic.classList.add('atualizando');
      await recarregarChatAtual('pull');
      indic.classList.remove('atualizando');
    } else {
      // Não armou: recolhe sem atualizar
      indic.classList.remove('puxando');
      circle.style.transform = '';
    }
  });
})();

// ── WebSocket ──

// Dispara quando aluna está com chat aberto e ativo, marcando msgs do
// atendimento como lidas pra Suellen/suporte verem ✓✓ azul instantâneo.
async function marcarLidas(tipoChat) {
  try {
    await fetch(`${API}/api/chat/marcar-lidas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + VmSession.getAccess() },
      body: JSON.stringify({ tipo_chat: tipoChat || 'suellen' }),
    });
  } catch (_) { /* silencioso */ }
}

// Quando aluna volta o foco pra aba/app com chat aberto:
//   1. reconecta WS (caso tenha caído em background)
//   2. recarrega histórico do chat (pega tudo que aconteceu enquanto offline)
//   3. marca como lida
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  conectarChatWs();
  if (!chatConv) return;
  if (!document.querySelector('.nav-tab[data-view="chat"]')?.classList.contains('active')) return;
  recarregarChatAtual('push');
});

function conectarChatWs() {
  if (chatWs && chatWs.readyState <= 1) return;
  const token = VmSession.getAccess();
  if (!token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  chatWs = new WebSocket(`${proto}://${location.host}/ws/chat?token=${token}&modo=aluna`);
  chatWs.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      // ═══ EVENTO ATÔMICO: atendimento respondeu + marcou anteriores como lidas ═══
      // Processa as 2 coisas no mesmo tick de JS pra evitar dessincronia visual.
      if (data.evento === 'resposta_atendimento_e_lidas') {
        const convId = data.conversa_id;
        console.log('[CHECK-DEBUG] resposta_atendimento_e_lidas chegou', {
          chatConv_id: chatConv?.id,
          conv_id_evento: convId,
          lidas_ids: data.lidas_ids,
          batem: chatConv && convId === chatConv.id,
        });
        // 1º — pinta ✓✓ dourado nas mensagens antigas (que viraram lidas)
        if (chatConv && convId === chatConv.id && Array.isArray(data.lidas_ids)) {
          data.lidas_ids.forEach(id => {
            const msg = mensagensAtuais.find(m => m.id === id);
            const checkEl = document.querySelector(`.msg-checks[data-msg-id="${id}"]`);
            console.log('[CHECK-DEBUG] tentando marcar', { id, msg_achada: !!msg, checkEl_achado: !!checkEl });
            if (msg) { msg.lida = true; msg.entregue = true; }
            if (checkEl) {
              checkEl.classList.remove('enviada', 'entregue');
              checkEl.classList.add('lida');
            }
          });
        }
        // 2º — agora sim mostra a mensagem nova
        const msg = data.mensagem;
        if (msg) {
          if (chatConv && convId === chatConv.id) {
            mensagensAtuais.push(msg);
            document.getElementById('chat-msgs')?.appendChild(renderMensagem(msg));
            scrollChat();
            // Aluna está vendo o chat AGORA → marca lida instantâneo (✓✓ azul pra Suellen).
            if (document.querySelector('.nav-tab[data-view="chat"]').classList.contains('active')
                && document.visibilityState === 'visible') {
              marcarLidas(chatConv.tipo);
            }
          }
          carregarResumoChats();
          if (!document.querySelector('.nav-tab[data-view="chat"]').classList.contains('active')) {
            document.getElementById('nav-chat-badge').style.display = '';
          }
        }
        return;
      }

      // Compatibilidade (eventos antigos — caso ainda chegue algum)
      if (data.evento === 'nova_mensagem' && data.mensagem) {
        const msg = data.mensagem;
        const convId = data.conversa_id;
        if (chatConv && convId === chatConv.id) {
          mensagensAtuais.push(msg);
          document.getElementById('chat-msgs')?.appendChild(renderMensagem(msg));
          scrollChat();
          if (document.querySelector('.nav-tab[data-view="chat"]').classList.contains('active')
              && document.visibilityState === 'visible') {
            marcarLidas(chatConv.tipo);
          }
        }
        carregarResumoChats();
        if (!document.querySelector('.nav-tab[data-view="chat"]').classList.contains('active')) {
          document.getElementById('nav-chat-badge').style.display = '';
        }
      }
      if (data.evento === 'reacao_atualizada') {
        if (chatConv && data.conversa_id === chatConv.id) {
          const msg = mensagensAtuais.find(m => m.id === data.mensagem_id);
          if (msg) msg.reacoes = data.reacoes;
          // Re-renderiza só o bloco de reações da bolha
          const wrap = document.querySelector(`.msg-wrap[data-id="${data.mensagem_id}"]`);
          if (wrap) {
            const antigo = wrap.querySelector('.msg-reacoes');
            if (antigo) antigo.remove();
            const novo = renderReacoesEl(data.reacoes);
            if (novo) {
              const footer = wrap.querySelector('.msg-footer');
              if (footer) wrap.insertBefore(novo, footer); else wrap.appendChild(novo);
            }
          }
        }
      }

      if (data.evento === 'mensagens_lidas' && data.por === 'suellen') {
        if (chatConv && data.conversa_id === chatConv.id) {
          (data.ids || []).forEach(id => {
            const msg = mensagensAtuais.find(m => m.id === id);
            if (msg) { msg.lida = true; msg.entregue = true; }
            const checkEl = document.querySelector(`.msg-checks[data-msg-id="${id}"]`);
            if (checkEl) {
              checkEl.classList.remove('enviada', 'entregue');
              checkEl.classList.add('lida');
            }
          });
        }
      }
    } catch (err) { console.error('[WS]', err); }
  };
  chatWs.onclose = () => setTimeout(conectarChatWs, 4000);
}

// ── Input ──
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send-btn');
const audioBtn = document.getElementById('chat-audio-btn');

chatInput?.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  const tem = chatInput.value.trim().length > 0;
  sendBtn.style.display = tem ? 'flex' : 'none';
  audioBtn.style.display = tem ? 'none' : 'flex';
});
chatInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensagem(); }
});
sendBtn?.addEventListener('click', enviarMensagem);

async function enviarMensagem() {
  const texto = chatInput?.value.trim();
  if (!texto || !usuario || !canalAtivo) return;
  const replyId = replyMsgAtual?.id || null;
  const replyMsg = replyMsgAtual;

  const msgTemp = {
    id: 'tmp-'+Date.now(),
    remetente: 'aluna',
    tipo: 'texto',
    conteudo: texto,
    lida: false,
    reply_to_id: replyId,
    reply_to_conteudo: replyMsg?.conteudo,
    reply_to_remetente: replyMsg?.remetente,
    reply_to_identidade: replyMsg?.identidade,
    criado_em: new Date().toISOString(),
  };
  mensagensAtuais.push(msgTemp);
  document.getElementById('chat-msgs').appendChild(renderMensagem(msgTemp));

  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.style.display = 'none';
  audioBtn.style.display = 'flex';
  replyMsgAtual = null;
  document.getElementById('reply-bar')?.classList.remove('visivel');
  scrollChat();

  try {
    const r = await fetch(`${API}/api/chat/mensagem`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conteudo: texto,
        tipo: 'texto',
        reply_to_id: replyId,
        tipo_chat: canalAtivo,
      }),
    });
    if (r.ok) {
      const d = await r.json();
      if (d.mensagem) {
        const idx = mensagensAtuais.findIndex(m => m.id === msgTemp.id);
        if (idx >= 0) mensagensAtuais[idx] = { ...msgTemp, ...d.mensagem };
        // Atualiza o DOM: troca id temporário pelo real (importante pro check
        // virar lida quando atendimento responder — é por data-msg-id que acha)
        const wrapEl = document.querySelector(`.msg-wrap[data-id="${msgTemp.id}"]`);
        if (wrapEl) wrapEl.dataset.id = d.mensagem.id;
        const checkEl = document.querySelector(`.msg-checks[data-msg-id="${msgTemp.id}"]`);
        if (checkEl) {
          checkEl.dataset.msgId = d.mensagem.id;
          // Estado correto vindo do backend (entregue se atendimento online)
          checkEl.classList.remove('enviada','entregue','lida');
          if (d.mensagem.lida)         checkEl.classList.add('lida');
          else if (d.mensagem.entregue) checkEl.classList.add('entregue');
          else                          checkEl.classList.add('enviada');
        }
      }
      if (d.conversa) {
        chatConv = { ...chatConv, ...d.conversa };
        atualizarBannerPlano(chatConv);
      }
    }
  } catch {}
}

// Anexo
document.getElementById('chat-anexo-btn')?.addEventListener('click', () => document.getElementById('chat-file-input')?.click());
document.getElementById('chat-file-input')?.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file || !canalAtivo) return;
  e.target.value = '';
  const url = URL.createObjectURL(file);
  const msgTemp = {
    id: 'tmp-'+Date.now(),
    remetente: 'aluna',
    tipo: 'imagem',
    url,
    lida: false,
    criado_em: new Date().toISOString(),
  };
  mensagensAtuais.push(msgTemp);
  document.getElementById('chat-msgs').appendChild(renderMensagem(msgTemp));
  scrollChat();
  try {
    const form = new FormData();
    form.append('imagem', file);
    const up = await fetch(`${API}/api/upload/imagem`, {
      method: 'POST', headers: authHeader(), body: form,
    });
    if (!up.ok) throw new Error();
    const { url: urlReal } = await up.json();
    await fetch(`${API}/api/chat/mensagem`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type':'application/json' },
      body: JSON.stringify({ tipo: 'imagem', url: urlReal, tipo_chat: canalAtivo }),
    });
  } catch {
    toast('Erro ao enviar imagem', 'err');
  }
});

// ── ÁUDIO ────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let audioCtx = null;
let analyser = null;
let animFrame = null;
let audioTimer = null;
let audioSeg = 0;
let audioMimeType = '';
let permissaoMic = false;

function desenharOnda() {
  const canvas = document.getElementById('chat-rec-wave');
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth || 160;
  const W = canvas.width, H = canvas.height;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  const step = W / buf.length;
  buf.forEach((v, i) => {
    const y = (v / 128.0) * (H / 2);
    i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y);
  });
  ctx.strokeStyle = 'rgba(200,146,42,0.8)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  animFrame = requestAnimationFrame(desenharOnda);
}

async function iniciarGravacao() {
  if (!window.isSecureContext) { toast('Microfone exige HTTPS', 'err'); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast('Navegador sem suporte', 'err'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    permissaoMic = true;
    const candidatos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    audioMimeType = candidatos.find(t => MediaRecorder.isTypeSupported(t)) || '';
    mediaRecorder = audioMimeType ? new MediaRecorder(stream, { mimeType: audioMimeType }) : new MediaRecorder(stream);
    audioChunks = [];
    audioSeg = 0;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    audioCtx.createMediaStreamSource(stream).connect(analyser);

    document.getElementById('chat-input-row-normal').style.display = 'none';
    document.getElementById('chat-rec-row').style.display = 'flex';
    document.getElementById('chat-rec-timer').textContent = '0:00';
    desenharOnda();

    audioTimer = setInterval(() => {
      audioSeg++;
      document.getElementById('chat-rec-timer').textContent = fmtTempo(audioSeg);
      if (audioSeg >= 180) pararGravacao(true);
    }, 1000);

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = finalizarGravacao;
    mediaRecorder.start(200);
  } catch (err) {
    let msg = 'Erro no microfone';
    if (err.name === 'NotAllowedError') msg = 'Permissão negada. Habilite no navegador.';
    else if (err.name === 'NotFoundError') msg = 'Nenhum microfone encontrado.';
    else if (err.name === 'NotReadableError') msg = 'Microfone em uso por outro app.';
    toast(msg, 'err');
  }
}

function pararGravacao(enviar=true) {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder._enviar = enviar;
  mediaRecorder.stop();
  mediaRecorder.stream?.getTracks().forEach(t => t.stop());
}

async function finalizarGravacao() {
  clearInterval(audioTimer);
  cancelAnimationFrame(animFrame);
  try { audioCtx?.close(); } catch {}
  analyser = null; audioCtx = null;
  document.getElementById('chat-rec-row').style.display = 'none';
  document.getElementById('chat-input-row-normal').style.display = 'flex';
  if (!mediaRecorder._enviar || audioSeg < 1 || !canalAtivo) return;

  const blob = new Blob(audioChunks, { type: audioMimeType || 'audio/webm' });
  const dur = audioSeg;
  const urlLocal = URL.createObjectURL(blob);
  const msgTemp = {
    id: 'tmp-'+Date.now(),
    remetente: 'aluna',
    tipo: 'audio',
    url: urlLocal,
    duracao: dur,
    lida: false,
    criado_em: new Date().toISOString(),
    _alturas: gerarWaveform(28),
  };
  mensagensAtuais.push(msgTemp);
  document.getElementById('chat-msgs').appendChild(renderMensagem(msgTemp));
  scrollChat();
  try {
    const form = new FormData();
    form.append('audio', blob, `audio-${Date.now()}.webm`);
    const up = await fetch(`${API}/api/upload/audio`, {
      method: 'POST', headers: authHeader(), body: form,
    });
    if (!up.ok) throw new Error();
    const { url, duracao: durReal } = await up.json();
    await fetch(`${API}/api/chat/mensagem`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type':'application/json' },
      body: JSON.stringify({ tipo: 'audio', url, duracao: durReal || dur, tipo_chat: canalAtivo }),
    });
  } catch {
    toast('Erro ao enviar áudio', 'err');
  }
}

audioBtn?.addEventListener('click', () => {
  if (permissaoMic) iniciarGravacao();
  else abrirModal('modal-mic');
});
document.getElementById('modal-mic-ok')?.addEventListener('click', () => {
  fecharModal('modal-mic');
  setTimeout(iniciarGravacao, 150);
});
document.getElementById('chat-rec-cancel')?.addEventListener('click', () => pararGravacao(false));
document.getElementById('chat-rec-send')?.addEventListener('click', () => pararGravacao(true));

// ── Tela de escolha + abas ──
document.querySelectorAll('.chat-canal-card').forEach(btn => {
  btn.addEventListener('click', () => abrirCanal(btn.dataset.canal));
});
document.querySelectorAll('.chat-aba').forEach(btn => {
  btn.addEventListener('click', () => abrirCanal(btn.dataset.aba));
});
document.getElementById('btn-back-escolha')?.addEventListener('click', abrirTelaEscolhaChat);

// ════════════════════════════════════════════════
// VISUAL VIEWPORT — teclado fluido
// ════════════════════════════════════════════════
function setupVisualViewport() {
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const update = () => {
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kbd-offset', offset + 'px');
    if (offset > 80) {
      document.body.classList.add('teclado-aberto');
      // Garante que a última mensagem fica visível
      setTimeout(scrollChat, 200);
    } else {
      document.body.classList.remove('teclado-aberto');
    }
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}

// ── CONTEXTO DO APP ─────────────────────────────────────────
// Fonte única de dados pra todas as telas do app.
// Estrutura completa documentada em routes/app.js (GET /contexto).
let contextoApp = null;

async function carregarContexto() {
  try {
    const r = await fetch(`${API}/api/app/contexto`, { headers: authHeader() });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.ok) return null;
    contextoApp = d;
    return d;
  } catch (err) {
    console.warn('[contexto] erro:', err.message);
    return null;
  }
}

// ── HIDRATAÇÃO DA HOME COM CONTEXTO ─────────────────────────
function hidratarHome(ctx) {
  if (!ctx) return;

  // ── Saudação ──
  const elNome = document.getElementById('saudacao-nome');
  if (elNome) {
    elNome.textContent = `Olá, ${ctx.aluna.primeiro_nome}`;
  }

  // ── Badge sementes ──
  const badge = document.getElementById('badge-sementes');
  if (badge) badge.textContent = ctx.aluna.sementes || 0;

  // ── Trilha (substitui a trilha hardcoded) ──
  renderTrilhaJornada(ctx);

  // ── Banner de teste em andamento ──
  renderBannerTesteEmAndamento(ctx);

  // ── Aba Materiais ──
  renderMateriais(ctx);
}

// ── HIDRATAÇÃO DA ABA MATERIAIS ─────────────────────────────
function renderMateriais(ctx) {
  const wrap = document.getElementById('produtos-lista');
  if (!wrap) return;

  const blocos = [];

  // ── 1. Bloco de testes (concluídos + em andamento) ──
  if (ctx.teste_em_andamento) {
    const tea = ctx.teste_em_andamento;
    blocos.push(
      '<div class="material-card" style="background:linear-gradient(135deg,rgba(248,220,150,0.12),rgba(43,165,232,0.05));border:1px solid rgba(248,220,150,0.3);border-radius:12px;padding:1rem 1.1rem;margin-bottom:0.85rem;cursor:pointer" onclick="window.location.href=\'/teste\'">' +
        '<div style="font-size:0.7rem;color:var(--ouro-fundo,#C8922A);letter-spacing:0.06em;text-transform:uppercase;font-weight:700;margin-bottom:0.25rem">Em andamento</div>' +
        '<div style="font-family:var(--font-display,Montserrat);font-weight:700;font-size:0.95rem;color:var(--texto,#fff);margin-bottom:0.4rem">Continuar teste do Subconsciente</div>' +
        '<div style="font-size:0.78rem;color:var(--texto-suave)">Pergunta ' + tea.respondidas + ' de ' + tea.total + ' respondidas</div>' +
      '</div>'
    );
  }

  if (Array.isArray(ctx.todos_testes) && ctx.todos_testes.length > 0) {
    ctx.todos_testes.forEach(t => {
      const data = t.feito_em ? new Date(t.feito_em).toLocaleDateString('pt-BR') : '—';
      const isMaisRecente = ctx.teste_atual && t.id === ctx.teste_atual.id;
      const pago = isMaisRecente ? ctx.teste_atual.pago : false;
      const perfilNome = isMaisRecente ? (ctx.teste_atual.nome_exibicao || t.perfil_dominante) : (t.perfil_dominante || '—');
      const acaoHtml = pago
        ? '<a href="/resultado/' + t.id + '" target="_blank" style="display:inline-block;padding:0.5rem 0.9rem;background:linear-gradient(135deg,var(--ouro,#F8DC96),var(--ouro-fundo,#C8922A));color:#051929;border-radius:8px;font-family:var(--font-display,Montserrat);font-size:0.78rem;font-weight:700;text-decoration:none">Ver resultado →</a>'
        : '<div style="padding:0.5rem 0.9rem;background:rgba(245,240,232,0.08);border:1px solid rgba(245,240,232,0.15);color:var(--texto-suave);border-radius:8px;font-family:var(--font-display,Montserrat);font-size:0.78rem;font-weight:600;display:inline-block">🔒 Aguardando liberação</div>';
      blocos.push(
        '<div class="material-card" style="background:rgba(255,255,255,0.04);border:1px solid rgba(245,240,232,0.1);border-radius:12px;padding:1rem 1.1rem;margin-bottom:0.85rem">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem">' +
            '<div>' +
              '<div style="font-size:0.7rem;color:var(--ouro-fundo,#C8922A);letter-spacing:0.06em;text-transform:uppercase;font-weight:700;margin-bottom:0.2rem">Teste do Subconsciente</div>' +
              '<div style="font-family:var(--font-display,Montserrat);font-weight:700;font-size:0.95rem;color:var(--texto,#fff)">Energia da ' + escHtml(perfilNome) + '</div>' +
            '</div>' +
            '<div style="font-size:0.7rem;color:var(--texto-suave);text-align:right">' + data + '</div>' +
          '</div>' +
          acaoHtml +
        '</div>'
      );
    });
  }

  // ── 2. Bloco de produtos comprados ──
  if (Array.isArray(ctx.comprados) && ctx.comprados.length > 0) {
    // filtra teste-subconsciente porque ele já apareceu na seção de testes
    const compradosOutros = ctx.comprados.filter(c => c.produto_slug !== 'teste-subconsciente');
    if (compradosOutros.length > 0) {
      blocos.push(
        '<div style="font-size:0.72rem;color:var(--texto-suave);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin:1.5rem 0 0.65rem">Adquiridos</div>'
      );
      compradosOutros.forEach(c => {
        blocos.push(
          '<div class="material-card" style="background:rgba(255,255,255,0.04);border:1px solid rgba(245,240,232,0.1);border-radius:12px;padding:1rem 1.1rem;margin-bottom:0.65rem">' +
            '<div style="font-size:0.7rem;color:#2ED573;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;margin-bottom:0.2rem">✓ Liberado</div>' +
            '<div style="font-family:var(--font-display,Montserrat);font-weight:700;font-size:0.92rem;color:var(--texto,#fff)">' + escHtml(c.produto_nome || c.produto_slug) + '</div>' +
            (c.observacao ? '<div style="font-size:0.72rem;color:var(--texto-suave);margin-top:0.25rem">' + escHtml(c.observacao) + '</div>' : '') +
          '</div>'
        );
      });
    }
  }

  // Vazio total
  if (blocos.length === 0) {
    wrap.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon">📦</div>' +
        '<p class="empty-titulo">Nada por aqui ainda</p>' +
        '<p class="empty-sub">Quando começar sua jornada, seus testes e cursos aparecem aqui.</p>' +
      '</div>';
    return;
  }

  wrap.innerHTML = blocos.join('');
}

// ── BANNER "Continuar teste" no topo da Home ────────────────
function renderBannerTesteEmAndamento(ctx) {
  const existente = document.getElementById('banner-continuar-teste');
  if (existente) existente.remove();

  if (!ctx.teste_em_andamento) return;

  const banner = document.createElement('div');
  banner.id = 'banner-continuar-teste';
  banner.style.cssText =
    'background:linear-gradient(135deg,rgba(248,220,150,0.12),rgba(43,165,232,0.08));' +
    'border:1px solid rgba(248,220,150,0.3);border-radius:12px;' +
    'padding:0.85rem 1rem;margin:0 1rem 1rem;display:flex;justify-content:space-between;' +
    'align-items:center;gap:0.65rem;cursor:pointer';
  banner.innerHTML =
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:0.7rem;color:var(--ouro-fundo,#C8922A);letter-spacing:0.06em;text-transform:uppercase;font-weight:700;margin-bottom:0.2rem">Teste em andamento</div>' +
      '<div style="font-size:0.85rem;color:var(--texto,#fff);font-weight:600">Você parou na pergunta ' + ctx.teste_em_andamento.respondidas + ' de ' + ctx.teste_em_andamento.total + '</div>' +
    '</div>' +
    '<div style="font-size:1.4rem;color:var(--ouro-fundo,#C8922A)">▸</div>';
  banner.addEventListener('click', () => { window.location.href = '/teste'; });

  // Insere no topo do view-home, logo após a saudação
  const home = document.getElementById('view-home');
  const saudacao = home?.querySelector('.saudacao');
  if (saudacao && saudacao.nextSibling) {
    saudacao.parentNode.insertBefore(banner, saudacao.nextSibling);
  } else if (home) {
    home.insertBefore(banner, home.firstChild);
  }
}

// ── TRILHA DA JORNADA (substitui trilha hardcoded) ──────────
function renderTrilhaJornada(ctx) {
  const trilha = document.querySelector('.trilha');
  if (!trilha) return;

  // Caso 1: aluna não fez teste → propõe começar
  if (!ctx.teste_atual) {
    trilha.innerHTML =
      '<div class="trilha-header">' +
        '<span class="trilha-eyebrow">Sua jornada começa aqui</span>' +
        '<h2 class="trilha-titulo">Faça o Teste do Subconsciente</h2>' +
        '<p class="trilha-sub">Em 15 perguntas você descobre qual padrão mental trava sua prosperidade — e qual caminho é o seu.</p>' +
      '</div>' +
      '<ol class="trilha-lista">' +
        '<li class="trilha-item trilha-ativo">' +
          '<div class="trilha-num">1</div>' +
          '<div class="trilha-card">' +
            '<div class="trilha-eyebrow-card">Diagnóstico</div>' +
            '<h3 class="trilha-card-titulo">Teste do Subconsciente</h3>' +
            '<p class="trilha-card-desc">Descubra em 15 perguntas o padrão mental que bloqueia sua prosperidade.</p>' +
            '<div class="trilha-meta"><span>15 perguntas</span><span>~7 min</span></div>' +
            '<button class="trilha-btn" onclick="window.location.href=\'/teste\'">Começar →</button>' +
          '</div>' +
        '</li>' +
      '</ol>';
    return;
  }

  // Caso 2: aluna tem teste mas não tem jornada (não deveria acontecer)
  if (!ctx.jornada_atual) {
    trilha.innerHTML =
      '<div class="trilha-header">' +
        '<h2 class="trilha-titulo">Sua trilha</h2>' +
        '<p class="trilha-sub">Aguardando próximos passos.</p>' +
      '</div>';
    return;
  }

  // Caso 3: jornada ativa — renderiza barra + passos
  const j = ctx.jornada_atual;
  const cor = j.cor || '#C8922A';
  const passosHtml = j.passos.map((p, idx) => {
    const num = idx + 1;
    let classe = 'trilha-bloqueado';
    let btnHtml = '<button class="trilha-btn" disabled>🔒 Em breve</button>';
    if (p.comprado) {
      classe = '';
      btnHtml = '<button class="trilha-btn" disabled style="opacity:0.7">✓ Concluído</button>';
    } else if (p.eh_proximo) {
      classe = 'trilha-ativo';
      const link = p.produto_link_checkout || '#';
      btnHtml = '<a class="trilha-btn" href="' + link + '" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:inline-block">Quero esse passo →</a>';
    }
    return (
      '<li class="trilha-item ' + classe + '">' +
        '<div class="trilha-num">' + num + '</div>' +
        '<div class="trilha-card">' +
          '<div class="trilha-eyebrow-card">' + escHtml(p.titulo) + '</div>' +
          '<h3 class="trilha-card-titulo">' + escHtml(p.produto_nome) + '</h3>' +
          (p.descricao ? '<p class="trilha-card-desc">' + escHtml(p.descricao) + '</p>' : '') +
          btnHtml +
        '</div>' +
      '</li>'
    );
  }).join('');

  trilha.innerHTML =
    '<div class="trilha-header">' +
      // ── Barra de progresso da jornada ──
      '<div class="jornada-barra-wrap" style="margin-bottom:1rem">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:0.4rem">' +
          '<div>' +
            '<div style="font-size:0.7rem;color:' + cor + ';letter-spacing:0.08em;text-transform:uppercase;font-weight:800">Jornada ' + j.numero + '</div>' +
            '<div style="font-family:var(--font-display,Montserrat);font-size:1.1rem;color:var(--texto,#fff);font-weight:700;line-height:1.1">' + escHtml(j.nome_exibicao) + '</div>' +
            (j.subtitulo ? '<div style="font-size:0.78rem;color:var(--texto-suave);margin-top:0.15rem">' + escHtml(j.subtitulo) + '</div>' : '') +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-family:var(--font-display,Montserrat);font-weight:800;font-size:1.05rem;color:' + cor + '">' + j.progresso.passos_concluidos + '/' + j.progresso.passos_totais + '</div>' +
            '<div style="font-size:0.7rem;color:var(--texto-suave)">' + j.progresso.percentual + '%</div>' +
          '</div>' +
        '</div>' +
        '<div style="height:7px;background:rgba(245,240,232,0.08);border-radius:4px;overflow:hidden">' +
          '<div style="height:100%;background:linear-gradient(90deg,' + cor + ',' + cor + 'cc);width:' + j.progresso.percentual + '%;transition:width 0.6s ease"></div>' +
        '</div>' +
      '</div>' +
      '<h2 class="trilha-titulo" style="margin-top:0.5rem">Seu caminho</h2>' +
    '</div>' +
    '<ol class="trilha-lista">' + passosHtml + '</ol>';
}

// ── INIT ──
(async function init() {
  criarParticulas();
  criarSprites();
  atualizarBadgeAvisos();
  setupVisualViewport();

  usuario = await checarAuth();
  if (!usuario) return;

  hidratarUI(usuario);

  // Carrega o contexto unificado (aluna + teste + jornada + comprados)
  // e hidrata a Home com base nele.
  const ctx = await carregarContexto();
  if (ctx) hidratarHome(ctx);

  carregarFeed();
  carregarTesouro();
  conectarChatWs();
  carregarResumoChats();
  setInterval(carregarResumoChats, 30000);
})();
