/* ── VmSession ── */
window.VmSession=(function(){const K='vm_s',P='vm_lembrar';function salvar(d,l){const p=l!==undefined?l:getLembrar();localStorage.setItem(P,p?'1':'0');const s=p?localStorage:sessionStorage,o=p?sessionStorage:localStorage;o.removeItem(K);s.setItem(K,JSON.stringify(d));}function carregar(){try{const r=localStorage.getItem(K)||sessionStorage.getItem(K);return r?JSON.parse(r):null;}catch{return null;}}function destruir(){localStorage.removeItem(K);sessionStorage.removeItem(K);}function getAccess(){return carregar()?.access_token||null;}function getRefresh(){return carregar()?.refresh_token||null;}function getLembrar(){return localStorage.getItem(P)!=='0';}return{salvar,carregar,destruir,getAccess,getRefresh,getLembrar};})();

/* ============================================================
   VIDA MÁGICA — App v7
   ============================================================ */

const API = '';
let usuario  = null;
let chatWs   = null;
let chatConv = null;

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

// ── SPRITES ─────────────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════
// BOTTOM NAV
// ══════════════════════════════════════════════════════════
function irPara(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${viewId}`)?.classList.add('active');
  document.querySelector(`.nav-tab[data-view="${viewId}"]`)?.classList.add('active');
  if (viewId === 'chat' && !chatConv) iniciarChat();
  if (viewId === 'perfil') renderPerfil();
}
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => irPara(tab.dataset.view));
});
document.querySelector('.nav-tab[data-view="chat"]')?.addEventListener('click', () => {
  document.getElementById('nav-chat-badge').style.display = 'none';
});

// ══════════════════════════════════════════════════════════
// MODAIS
// ══════════════════════════════════════════════════════════
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
  VmSession.destruir(); window.location.replace('/auth?intencional');
});

// ══════════════════════════════════════════════════════════
// PLAYER DE VÍDEO
// ══════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════
// FEED
// ══════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════
// TESOURO DA SU
// ══════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════
// AVISOS
// ══════════════════════════════════════════════════════════
const AVISOS_KEY = 'vm_avisos_lidos';
const AVISOS = [
  {id:'av1',tag:'Tesouro da Su',titulo:'Seu presente chegou! ✨',desc:'Um novo tesouro está disponível para você hoje.',data:'Hoje'},
  {id:'av2',tag:'Comunidade',titulo:'Novo conteúdo disponível',desc:'A Suellen publicou um conteúdo exclusivo para membros.',data:'1 dia'},
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

// ══════════════════════════════════════════════════════════
// TESTES
// ══════════════════════════════════════════════════════════
async function carregarTestes() {
  const corpo = document.getElementById('testes-corpo'); if (!corpo) return;
  corpo.innerHTML = '<div class="loading-inline">Carregando...</div>';
  try {
    const r = await fetch(`${API}/api/auth/testes`, { headers:{ Authorization:`Bearer ${VmSession.getAccess()}` } });
    if (!r.ok) throw new Error();
    const testes = await r.json();
    if (!testes.length) { corpo.innerHTML='<div class="loading-inline">Nenhum teste realizado ainda.</div>'; return; }
    corpo.innerHTML = testes.map(t=>`<div class="teste-item"><div class="teste-perfil">${t.perfil_dominante}</div><div class="teste-pct">${t.percentual_prosperidade}<span>%</span></div><div class="teste-data">${new Date(t.feito_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</div></div>`).join('');
  } catch { corpo.innerHTML='<div class="loading-inline">Erro ao carregar.</div>'; }
}

// ══════════════════════════════════════════════════════════
// PERFIL
// ══════════════════════════════════════════════════════════
function renderPerfil() {
  if (!usuario) return;
  document.getElementById('perfil-nome').textContent     = usuario.nome || '—';
  document.getElementById('perfil-sementes').textContent = usuario.sementes || 0;
}

// ══════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════
function horaFmt(data) { return new Date(data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* Gera waveform estática aleatória para bolha de áudio */
function gerarWaveform(n=28) {
  const alturas = [];
  for (let i=0;i<n;i++) alturas.push(Math.random()*0.7+0.15);
  // Suaviza
  for (let i=1;i<n-1;i++) alturas[i]=(alturas[i-1]+alturas[i]+alturas[i+1])/3;
  return alturas;
}

function criarBolhaAudio(msg, alturas) {
  const isAluna = msg.remetente === 'aluna';
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${isAluna?'aluna':'suellen'}`;

  const duracaoFmt = msg.duracao ? `${Math.floor(msg.duracao/60)}:${String(msg.duracao%60).padStart(2,'0')}` : '0:00';

  // Gera barras SVG
  const barCount = alturas.length;
  const barW = 3, gap = 2, totalW = barCount*(barW+gap)-gap;
  const barsHtml = alturas.map((h,i) => {
    const bh = Math.max(4, Math.round(h*24));
    const y  = (28-bh)/2;
    return `<rect x="${i*(barW+gap)}" y="${y}" width="${barW}" height="${bh}" rx="1.5" class="msg-audio-wave-bar" data-idx="${i}"/>`;
  }).join('');

  wrap.innerHTML = `
    <div class="msg-audio-bolha">
      <button class="msg-audio-play-btn" data-url="${escHtml(msg.url||'')}">
        <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <svg class="msg-audio-wave" viewBox="0 0 ${totalW} 28" width="${totalW}" height="28" xmlns="http://www.w3.org/2000/svg">
        ${barsHtml}
      </svg>
      <span class="msg-audio-dur" id="audio-dur-${msg.id||Date.now()}">${duracaoFmt}</span>
    </div>
    <span class="msg-hora">${horaFmt(msg.criado_em)}</span>
  `;

  // Player de áudio
  let audio = null;
  let rafId = null;
  const playBtn = wrap.querySelector('.msg-audio-play-btn');
  const bars    = wrap.querySelectorAll('.msg-audio-wave-bar');
  const durEl   = wrap.querySelector('.msg-audio-dur');

  playBtn.addEventListener('click', () => {
    if (!audio) {
      audio = new Audio(msg.url);
      audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        const pct  = audio.currentTime / audio.duration;
        const idx  = Math.floor(pct * bars.length);
        bars.forEach((b,i) => b.classList.toggle('ativa', i <= idx));
        const rem  = Math.floor(audio.duration - audio.currentTime);
        durEl.textContent = `${Math.floor(rem/60)}:${String(rem%60).padStart(2,'0')}`;
      });
      audio.addEventListener('ended', () => {
        bars.forEach(b => b.classList.remove('ativa'));
        playBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        durEl.textContent = duracaoFmt;
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

  return wrap;
}

function renderMensagem(msg) {
  if (msg.tipo === 'audio') return criarBolhaAudio(msg, msg._alturas || gerarWaveform());

  const isAluna = msg.remetente === 'aluna';
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${isAluna?'aluna':'suellen'}`;

  let html = '';
  if (msg.tipo === 'imagem' && msg.url) {
    html = `<div class="msg-imagem"><img src="${escHtml(msg.url)}" loading="lazy"></div>`;
  } else {
    html = `<div class="msg-bolha">${escHtml(msg.conteudo||'')}</div>`;
  }

  wrap.innerHTML = `${html}<span class="msg-hora">${horaFmt(msg.criado_em)}</span>`;
  return wrap;
}

function scrollChat() {
  const msgs = document.getElementById('chat-msgs');
  if (msgs) setTimeout(()=>{ msgs.scrollTop = msgs.scrollHeight; }, 50);
}

function renderPlanoInfo(conv) {
  const info   = document.getElementById('chat-plano-info');
  const banner = document.getElementById('chat-prior-banner');
  const upg    = document.getElementById('chat-upgrade');
  const det    = document.getElementById('chat-prior-detalhe');
  if (conv.plano_chat === 'prioritario') {
    const restam = conv.interacoes_restantes??'—';
    const expira = conv.prioritario_expira_em ? new Date(conv.prioritario_expira_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
    if (info) { info.textContent=`⭐ Prioritário · ${restam} interações`; info.style.color='var(--ouro-fundo)'; }
    if (banner) banner.style.display='';
    if (upg)    upg.style.display='none';
    if (det)    det.textContent=`${restam} interações · expira às ${expira}`;
  } else {
    if (info) { info.textContent='💬 Chat Basic · resposta em breve'; info.style.color=''; }
    if (banner) banner.style.display='none';
    if (upg)    upg.style.display='';
  }
}

async function iniciarChat() {
  const loading   = document.getElementById('chat-loading');
  const msgsEl    = document.getElementById('chat-msgs');
  const inputWrap = document.getElementById('chat-input-wrap');

  loading.style.display = 'flex';
  msgsEl.style.display  = 'none';

  try {
    const r = await fetch(`${API}/api/chat/conversa`, { headers:{ Authorization:`Bearer ${VmSession.getAccess()}` } });
    if (!r.ok) throw new Error();
    const dados = await r.json();
    chatConv = dados.conversa;

    msgsEl.innerHTML = '';
    dados.mensagens.forEach(msg => msgsEl.appendChild(renderMensagem(msg)));

    loading.style.display   = 'none';
    msgsEl.style.display    = 'flex';
    inputWrap.style.display = '';
    renderPlanoInfo(chatConv);
    scrollChat();
    conectarChatWs();
  } catch {
    loading.innerHTML = `<p style="color:var(--texto-mute);font-size:0.82rem;text-align:center;padding:2rem">Erro ao carregar chat.</p>`;
  }
}

function conectarChatWs() {
  if (chatWs && chatWs.readyState <= 1) return;
  const proto = location.protocol==='https:'?'wss':'ws';
  const token = VmSession.getAccess();
  chatWs = new WebSocket(`${proto}://${location.host}/ws/chat?token=${token}&modo=aluna`);
  chatWs.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.evento==='nova_mensagem' && data.mensagem.remetente==='suellen') {
        document.getElementById('chat-msgs').appendChild(renderMensagem(data.mensagem));
        scrollChat();
        if (!document.querySelector('.nav-tab[data-view="chat"]').classList.contains('active')) {
          document.getElementById('nav-chat-badge').style.display='';
        }
      }
    } catch {}
  };
  chatWs.onclose = () => setTimeout(()=>{ if(document.getElementById('view-chat').classList.contains('active')) conectarChatWs(); }, 3000);
}

// Input
const chatInput = document.getElementById('chat-input');
const sendBtn   = document.getElementById('chat-send-btn');
const audioBtn  = document.getElementById('chat-audio-btn');

chatInput?.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight,120)+'px';
  const tem = chatInput.value.trim().length > 0;
  sendBtn.style.display  = tem ? 'flex' : 'none';
  audioBtn.style.display = tem ? 'none' : 'flex';
});
chatInput?.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();enviarMensagem();} });
sendBtn?.addEventListener('click', enviarMensagem);

async function enviarMensagem() {
  const texto = chatInput?.value.trim();
  if (!texto || !usuario) return;
  const msgTemp = { id:Date.now(), remetente:'aluna', tipo:'texto', conteudo:texto, criado_em:new Date().toISOString() };
  document.getElementById('chat-msgs').appendChild(renderMensagem(msgTemp));
  chatInput.value=''; chatInput.style.height='auto';
  sendBtn.style.display='none'; audioBtn.style.display='flex';
  scrollChat();
  try {
    const r = await fetch(`${API}/api/chat/mensagem`, { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${VmSession.getAccess()}`}, body:JSON.stringify({conteudo:texto,tipo:'texto'}) });
    if (r.ok) { const d=await r.json(); if(d.conversa) renderPlanoInfo({...chatConv,...d.conversa}); }
  } catch {}
}

// Anexo
document.getElementById('chat-anexo-btn')?.addEventListener('click', ()=>document.getElementById('chat-file-input')?.click());
document.getElementById('chat-file-input')?.addEventListener('change', e=>{
  const file=e.target.files?.[0]; if(!file) return;
  const url=URL.createObjectURL(file);
  document.getElementById('chat-msgs').appendChild(renderMensagem({id:Date.now(),remetente:'aluna',tipo:'imagem',url,criado_em:new Date().toISOString()}));
  scrollChat(); e.target.value='';
});

// Upgrade
document.getElementById('chat-upgrade-btn')?.addEventListener('click', ()=>alert('Em breve: Atendimento Prioritário por R$ 9,90'));

// ══════════════════════════════════════════════════════════
// ÁUDIO — gravação premium com waveform em tempo real
// ══════════════════════════════════════════════════════════
let mediaRecorder  = null;
let audioChunks    = [];
let audioCtx       = null;
let analyser       = null;
let animFrame      = null;
let audioTimer     = null;
let audioSeg       = 0;
let audioMimeType  = '';
let permissaoMic   = false; // já pediu permissão antes

function fmtTempo(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

/* Desenha waveform em tempo real no canvas */
function desenharOnda() {
  const canvas = document.getElementById('chat-rec-wave');
  if (!canvas || !analyser) return;
  const ctx   = canvas.getContext('2d');
  const W     = canvas.width, H = canvas.height;
  const buf   = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);
  ctx.clearRect(0,0,W,H);
  ctx.beginPath();
  const step = W / buf.length;
  buf.forEach((v,i)=>{
    const y = (v/128.0) * (H/2);
    i===0 ? ctx.moveTo(0,y) : ctx.lineTo(i*step,y);
  });
  ctx.strokeStyle = 'rgba(200,146,42,0.8)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  animFrame = requestAnimationFrame(desenharOnda);
}

/* Redimensiona canvas ao aparecer */
function ajustarCanvas() {
  const canvas = document.getElementById('chat-rec-wave');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth || 160;
}

async function iniciarGravacao() {
  try {
    const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    permissaoMic   = true;
    audioMimeType  = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
    mediaRecorder  = new MediaRecorder(stream, { mimeType: audioMimeType });
    audioChunks    = [];
    audioSeg       = 0;

    // Configura analyser para visualização
    audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    analyser  = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    const src = audioCtx.createMediaStreamSource(stream);
    src.connect(analyser);

    // Mostra barra de gravação
    document.getElementById('chat-input-row-normal').style.display = 'none';
    document.getElementById('chat-rec-row').style.display = 'flex';
    ajustarCanvas();
    desenharOnda();

    // Timer
    document.getElementById('chat-rec-timer').textContent = '0:00';
    audioTimer = setInterval(()=>{
      audioSeg++;
      document.getElementById('chat-rec-timer').textContent = fmtTempo(audioSeg);
      if (audioSeg >= 120) pararGravacao(true);
    }, 1000);

    mediaRecorder.ondataavailable = e => { if(e.data.size>0) audioChunks.push(e.data); };
    mediaRecorder.onstop = finalizarGravacao;
    mediaRecorder.start(200);

  } catch {
    alert('Não foi possível acessar o microfone.\nVerifique as permissões do navegador.');
  }
}

function pararGravacao(enviar=true) {
  if (!mediaRecorder || mediaRecorder.state==='inactive') return;
  mediaRecorder._enviar = enviar;
  mediaRecorder.stop();
  mediaRecorder.stream?.getTracks().forEach(t=>t.stop());
}

function cancelarGravacao() { pararGravacao(false); }

function finalizarGravacao() {
  // Limpa
  clearInterval(audioTimer);
  cancelAnimationFrame(animFrame);
  try { audioCtx?.close(); } catch {}
  analyser = null; audioCtx = null;

  // Restaura barra normal
  document.getElementById('chat-rec-row').style.display = 'none';
  document.getElementById('chat-input-row-normal').style.display = 'flex';

  if (!mediaRecorder._enviar || audioSeg < 1) return; // cancelado ou muito curto

  const blob = new Blob(audioChunks, { type: audioMimeType });
  const url  = URL.createObjectURL(blob);
  const alturas = gerarWaveform(); // waveform visual aleatória para a bolha

  const msgAudio = {
    id:        Date.now(),
    remetente: 'aluna',
    tipo:      'audio',
    url,
    duracao:   audioSeg,
    criado_em: new Date().toISOString(),
    _alturas:  alturas,
  };

  document.getElementById('chat-msgs').appendChild(criarBolhaAudio(msgAudio, alturas));
  scrollChat();

  // Aqui enviaria o blob via FormData quando tiver storage configurado
  // Por enquanto é só local
}

/* Botão microfone — abre pré-aviso se nunca pediu, ou inicia direto */
audioBtn?.addEventListener('click', ()=>{
  if (permissaoMic) {
    iniciarGravacao();
  } else {
    abrirModal('modal-mic');
  }
});

/* Confirmação do modal de pré-aviso */
document.getElementById('modal-mic-ok')?.addEventListener('click', ()=>{
  fecharModal('modal-mic');
  setTimeout(iniciarGravacao, 150); // pequeno delay para fechar o modal antes
});

/* Cancelar gravação */
document.getElementById('chat-rec-cancel')?.addEventListener('click', cancelarGravacao);

/* Enviar gravação */
document.getElementById('chat-rec-send')?.addEventListener('click', ()=>pararGravacao(true));

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
(async function init() {
  criarParticulas();
  criarSprites();
  atualizarBadgeAvisos();

  usuario = await checarAuth();
  if (!usuario) return;

  hidratarUI(usuario);
  carregarFeed();
  carregarTesouro();
})();
