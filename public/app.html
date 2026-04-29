/* ── VmSession ── */
window.VmSession=(function(){const K='vm_s',P='vm_lembrar',U='vm_u';function salvar(d,l){const p=l!==undefined?l:getLembrar();localStorage.setItem(P,p?'1':'0');const s=p?localStorage:sessionStorage,o=p?sessionStorage:localStorage;o.removeItem(K);s.setItem(K,JSON.stringify(d));if(d.usuario?.nome)localStorage.setItem(U,JSON.stringify({nome:d.usuario.nome,email:d.usuario.email||null,telefone_formatado:d.usuario.telefone_formatado||null,foto_url:d.usuario.foto_url||null}));}function carregar(){try{const r=localStorage.getItem(K)||sessionStorage.getItem(K);return r?JSON.parse(r):null;}catch{return null;}}function destruir(){localStorage.removeItem(K);sessionStorage.removeItem(K);}function getAccess(){return carregar()?.access_token||null;}function getRefresh(){return carregar()?.refresh_token||null;}function getLembrar(){return localStorage.getItem(P)!=='0';}function getUsuarioLembrado(){try{return JSON.parse(localStorage.getItem(U)||'null');}catch{return null;}}function limparUsuarioLembrado(){localStorage.removeItem(U);}return{salvar,carregar,destruir,getAccess,getRefresh,getLembrar,getUsuarioLembrado,limparUsuarioLembrado};})();

/* ============================================================
   VIDA MÁGICA — App principal  v3
   ============================================================ */

const API = '';

// ── AUTH GUARD ──────────────────────────────────────────────
async function checarAuth() {
  const access = VmSession.getAccess();
  if (!access) { window.location.replace('/auth?intencional'); return null; }
  try {
    const r = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${access}` } });
    if (r.ok) return await r.json();
    if (r.status === 401) {
      const refresh = VmSession.getRefresh();
      if (!refresh) { VmSession.destruir(); window.location.replace('/auth?intencional'); return null; }
      try {
        const r2 = await fetch(`${API}/api/auth/renovar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) });
        if (r2.ok) {
          const d = await r2.json();
          VmSession.salvar(d, VmSession.getLembrar());
          const r3 = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${d.access_token}` } });
          if (r3.ok) return await r3.json();
        }
      } catch {}
      VmSession.destruir(); window.location.replace('/auth?intencional'); return null;
    }
  } catch (err) { console.error('[Vida Mágica] erro auth:', err.message); }
  return null;
}

// ── HIDRATAR UI ─────────────────────────────────────────────
function hidratarUI(usuario) {
  if (!usuario) return;
  const nomeEl = document.getElementById('saudacao-nome');
  if (nomeEl) {
    const primeiro = (usuario.nome || '').split(' ')[0] || '';
    nomeEl.textContent = primeiro ? `Olá, ${primeiro}` : 'Sua jornada';
  }
  const sementesEl = document.getElementById('topo-sementes');
  if (sementesEl) sementesEl.textContent = usuario.sementes || 0;
}

// ── PARTÍCULAS ──────────────────────────────────────────────
function criarParticulas() {
  const c = document.getElementById('particulas');
  if (!c) return;
  const count = window.innerWidth < 640 ? 14 : 22;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particula';
    const t = Math.random() * 4 + 2;
    p.style.cssText = `width:${t}px;height:${t}px;left:${Math.random()*100}%;animation-duration:${Math.random()*16+12}s;animation-delay:${Math.random()*18}s;`;
    c.appendChild(p);
  }
}

// ── SPRITES ─────────────────────────────────────────────────
function criarSprites() {
  const SPRITES = [
    { top:'15%', left:'8%',   size:18, dur:4.2, delay:0   },
    { top:'22%', right:'6%',  size:14, dur:5.8, delay:1.4 },
    { top:'38%', left:'5%',   size:12, dur:6.1, delay:2.2 },
    { top:'55%', right:'4%',  size:16, dur:4.8, delay:0.8 },
    { top:'70%', left:'7%',   size:10, dur:7.2, delay:3.1 },
    { top:'82%', right:'9%',  size:20, dur:5.3, delay:1.9 },
    { top:'12%', left:'50%',  size:11, dur:6.6, delay:2.7 },
    { top:'90%', left:'35%',  size:13, dur:4.5, delay:0.5 },
  ];
  SPRITES.forEach(s => {
    const el = document.createElement('div');
    el.className = 'sprite';
    Object.assign(el.style, {
      top: s.top || 'auto', left: s.left || 'auto', right: s.right || 'auto',
      width: s.size+'px', height: s.size+'px',
      animationDuration: s.dur+'s', animationDelay: s.delay+'s',
    });
    el.innerHTML = `<svg viewBox="0 0 24 24" width="${s.size}" height="${s.size}" fill="none">
      <path d="M12 2L13.5 9L20 9L14.5 13.5L16.5 20L12 16L7.5 20L9.5 13.5L4 9L10.5 9Z"
        fill="rgba(232,201,122,0.7)" stroke="rgba(200,146,42,0.4)" stroke-width="0.5"/>
    </svg>`;
    document.body.appendChild(el);
  });
}

// ── MODAIS ──────────────────────────────────────────────────
function abrirModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function fecharModal(modal) {
  if (typeof modal === 'string') modal = document.getElementById(modal);
  if (!modal) return;
  if (modal.id === 'modal-player') pararPlayer();
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
function fecharTodosModais() {
  document.querySelectorAll('.modal').forEach(m => fecharModal(m));
}

document.getElementById('btn-arvore')?.addEventListener('click', () => { fecharTodosModais(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
document.getElementById('btn-produtos')?.addEventListener('click', () => abrirModal('modal-produtos'));
document.getElementById('btn-bau')?.addEventListener('click',     () => abrirModal('modal-bau'));
document.getElementById('btn-conta')?.addEventListener('click',   () => abrirModal('modal-conta'));
document.getElementById('btn-avisos')?.addEventListener('click', () => {
  renderAvisos();
  abrirModal('modal-avisos');
  setTimeout(() => { AVISOS.forEach(a => marcarLido(a.id)); atualizarBadge(); }, 2000);
});
document.getElementById('tesouro-bau')?.addEventListener('click', () => abrirModal('modal-bau'));
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', e => fecharModal(e.target.closest('.modal')));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { fecharTodosModais(); fecharIOSModal(); } });

document.getElementById('menu-logout')?.addEventListener('click', async () => {
  const refresh = VmSession.getRefresh();
  try { await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) }); } catch {}
  VmSession.destruir();
  window.location.replace('/auth?intencional');
});

// Botão instalar dentro da conta
document.getElementById('menu-instalar-app')?.addEventListener('click', () => {
  fecharModal('modal-conta');
  abrirInstalar();
});

// ── PWA — Android/Chrome ────────────────────────────────────
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  // Mostra banner nativo Android
  const b = document.getElementById('pwa-banner');
  if (b) b.hidden = false;
  // Mostra botão "Instalar App" na tela de Conta
  const mi = document.getElementById('menu-instalar-app');
  if (mi) mi.style.display = '';
});

document.getElementById('pwa-instalar')?.addEventListener('click', () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
  }
  document.getElementById('pwa-banner').hidden = true;
});

document.getElementById('pwa-depois')?.addEventListener('click', () => {
  document.getElementById('pwa-banner').hidden = true;
});

// ── PWA — iOS Safari: modal visual ─────────────────────────
const IOS_KEY = 'vm_ios_install_dismissed';

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}
function isStandalone() {
  return window.navigator.standalone === true ||
         window.matchMedia('(display-mode: standalone)').matches;
}

function abrirIOSModal() {
  const modal = document.getElementById('ios-install-modal');
  if (!modal) return;
  modal.classList.add('aberto');
  document.body.style.overflow = 'hidden';

  // Anima o destaque alternando entre os passos
  let step = 1;
  window._iosInterval = setInterval(() => {
    document.getElementById('ios-passo-1')?.classList.toggle('destaque', step === 1);
    document.getElementById('ios-passo-2')?.classList.toggle('destaque', step === 2);
    step = step === 1 ? 2 : 1;
  }, 2200);
}

function fecharIOSModal() {
  const modal = document.getElementById('ios-install-modal');
  if (!modal) return;
  modal.classList.remove('aberto');
  document.body.style.overflow = '';
  clearInterval(window._iosInterval);
  localStorage.setItem(IOS_KEY, '1');
}

document.getElementById('ios-fechar')?.addEventListener('click', fecharIOSModal);
document.getElementById('ios-overlay')?.addEventListener('click', fecharIOSModal);

function abrirInstalar() {
  if (deferredPrompt) {
    // Android com prompt disponível
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
  } else if (isIOS() && !isStandalone()) {
    abrirIOSModal();
  }
}

function verificarIOSInstall() {
  if (!isIOS() || isStandalone()) return;
  // Mostra botão na conta sempre
  const mi = document.getElementById('menu-instalar-app');
  if (mi) mi.style.display = '';
  // Mostra modal automaticamente na primeira vez (após 3s)
  if (!localStorage.getItem(IOS_KEY)) {
    setTimeout(abrirIOSModal, 3000);
  }
}

// ── FEED ────────────────────────────────────────────────────
async function carregarFeed() {
  try {
    const r = await fetch(`${API}/api/feed`);
    if (!r.ok) throw new Error('status ' + r.status);
    const itens = await r.json();
    renderCarrossel(itens.filter(i => i.destaque));
    renderLista(itens.filter(i => !i.destaque));
  } catch (err) {
    console.warn('[Feed] erro:', err.message);
    const wrap = document.getElementById('feed-carrossel-wrap');
    if (wrap) wrap.style.display = 'none';
  }
}

function thumbDeUrl(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/mqdefault.jpg`;
  return null;
}

function embedDeUrl(url) {
  if (!url) return '';
  const origin = encodeURIComponent(window.location.origin);
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0&enablejsapi=1&origin=${origin}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}?autoplay=1`;
  return url;
}

function iconeDoTipo(t) { return { video:'🎬', texto:'📝', imagem:'🖼️', link:'🔗' }[t]||'✦'; }

function renderCarrossel(itens) {
  const wrap = document.getElementById('feed-carrossel-wrap');
  const car  = document.getElementById('feed-carrossel');
  const dots = document.getElementById('feed-dots');
  if (!itens.length) { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap) wrap.style.display = '';
  car.innerHTML = itens.map(item => {
    const thumb = item.imagem_url || thumbDeUrl(item.url);
    const isVid = item.tipo === 'video';
    return `<div class="feed-card-destaque" tabindex="0"
      data-tipo="${item.tipo}" data-url="${item.url||''}"
      data-titulo="${encodeURIComponent(item.titulo)}"
      data-subtitulo="${encodeURIComponent(item.subtitulo||'')}"
      data-corpo="${encodeURIComponent(item.corpo||'')}">
      <div class="feed-thumb">
        ${thumb ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy">` : `<div class="feed-thumb-placeholder">${iconeDoTipo(item.tipo)}</div>`}
        ${isVid ? `<div class="feed-play-overlay"><div class="feed-play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>` : ''}
      </div>
      <div class="feed-card-body">
        ${item.subtitulo ? `<div class="feed-card-eyebrow">${item.subtitulo}</div>` : ''}
        <div class="feed-card-titulo">${item.titulo}</div>
        ${item.corpo ? `<div class="feed-card-corpo">${item.corpo}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  dots.innerHTML = itens.map((_,i) => `<div class="feed-dot${i===0?' ativo':''}" data-idx="${i}"></div>`).join('');
  car.addEventListener('scroll', () => {
    const idx = Math.round(car.scrollLeft / car.offsetWidth);
    dots.querySelectorAll('.feed-dot').forEach((d,i) => d.classList.toggle('ativo', i===idx));
  }, { passive: true });
  dots.querySelectorAll('.feed-dot').forEach(d => {
    d.addEventListener('click', () => {
      const card = car.children[parseInt(d.dataset.idx)];
      if (card) card.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'start' });
    });
  });
  car.querySelectorAll('.feed-card-destaque').forEach(c => {
    c.addEventListener('click', () => ativarItem(c));
    c.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') ativarItem(c); });
  });
}

function renderLista(itens) {
  const lista = document.getElementById('feed-lista');
  if (!lista || !itens.length) { if (lista) lista.innerHTML = ''; return; }
  lista.innerHTML = itens.map(item => {
    const thumb = item.imagem_url || thumbDeUrl(item.url);
    const isVid = item.tipo === 'video';
    return `<div class="feed-card-lista" tabindex="0"
      data-tipo="${item.tipo}" data-url="${item.url||''}"
      data-titulo="${encodeURIComponent(item.titulo)}"
      data-subtitulo="${encodeURIComponent(item.subtitulo||'')}"
      data-corpo="${encodeURIComponent(item.corpo||'')}">
      <div class="feed-lista-thumb">
        ${thumb ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy">` : `<div class="feed-lista-thumb-placeholder">${iconeDoTipo(item.tipo)}</div>`}
        ${isVid ? `<div class="feed-lista-play"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>` : ''}
      </div>
      <div class="feed-lista-info">
        ${item.subtitulo ? `<div class="feed-lista-eyebrow">${item.subtitulo}</div>` : ''}
        <div class="feed-lista-titulo">${item.titulo}</div>
        ${item.corpo ? `<div class="feed-lista-corpo">${item.corpo}</div>` : ''}
        <span class="feed-tipo-tag feed-tipo-${item.tipo}">${iconeDoTipo(item.tipo)} ${item.tipo}</span>
      </div>
    </div>`;
  }).join('');
  lista.querySelectorAll('.feed-card-lista').forEach(c => {
    c.addEventListener('click', () => ativarItem(c));
    c.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') ativarItem(c); });
  });
}

function ativarItem(card) {
  const tipo      = card.dataset.tipo;
  const url       = card.dataset.url;
  const titulo    = decodeURIComponent(card.dataset.titulo);
  const subtitulo = decodeURIComponent(card.dataset.subtitulo);
  const corpo     = decodeURIComponent(card.dataset.corpo);
  if (tipo === 'video' && url) abrirPlayer({ titulo, subtitulo, corpo, url });
  else if ((tipo === 'link' || tipo === 'imagem') && url) window.open(url, '_blank', 'noopener');
  else abrirPlayer({ titulo, subtitulo, corpo, url: null });
}

function abrirPlayer({ titulo, subtitulo, corpo, url }) {
  const iframe = document.getElementById('player-iframe');
  document.getElementById('player-titulo').textContent  = titulo    || '';
  document.getElementById('player-subtitulo').textContent = subtitulo || '';
  document.getElementById('player-corpo').textContent   = corpo     || '';
  const wrap = document.querySelector('.player-wrap');
  if (url && iframe) { iframe.src = embedDeUrl(url); if (wrap) wrap.style.display = ''; }
  else { if (iframe) iframe.src = ''; if (wrap) wrap.style.display = 'none'; }
  abrirModal('modal-player');
}
function pararPlayer() {
  const iframe = document.getElementById('player-iframe');
  if (iframe) iframe.src = '';
}

// ── AVISOS ──────────────────────────────────────────────────
const AVISOS_KEY = 'vm_avisos_lidos';
const AVISOS = [
  { id:'av_tesouro_01', tag:'Tesouro da Su',   titulo:'Seu presente de hoje chegou! 🎁',    desc:'O Tesouro da Su está disponível. Abra agora e colete sua semente do dia.', data:'Hoje' },
  { id:'av_teste_01',   tag:'Ação necessária', titulo:'Seu Teste de Prosperidade aguarda',   desc:'Você ainda não concluiu o Teste de Prosperidade. Ele é o primeiro passo da sua trilha.', data:'Esta semana' },
  { id:'av_video_01',   tag:'Novidade',        titulo:'Novo vídeo disponível no app',        desc:'A Suellen publicou uma aula exclusiva para membros do Clube Vida Mágica.', data:'2 dias atrás' },
];
function getLidos() { try { return JSON.parse(localStorage.getItem(AVISOS_KEY)||'[]'); } catch { return []; } }
function marcarLido(id) { const l=getLidos(); if(!l.includes(id)){l.push(id);localStorage.setItem(AVISOS_KEY,JSON.stringify(l));} }
function atualizarBadge() {
  const lidos = getLidos();
  const badge = document.getElementById('avisos-badge');
  if (badge) AVISOS.some(a => !lidos.includes(a.id)) ? badge.classList.add('visivel') : badge.classList.remove('visivel');
}
function renderAvisos() {
  const lista = document.getElementById('avisos-lista');
  if (!lista) return;
  const lidos = getLidos();
  lista.innerHTML = `<ul class="aviso-lista">${AVISOS.map(a=>`
    <li class="aviso-item${!lidos.includes(a.id)?' nao-lido':''}" data-id="${a.id}">
      <div class="aviso-dot"></div>
      <div class="aviso-corpo">
        <div class="aviso-tag">${a.tag}</div>
        <div class="aviso-titulo">${a.titulo}</div>
        <div class="aviso-desc">${a.desc}</div>
        <div class="aviso-data">${a.data}</div>
      </div>
    </li>`).join('')}</ul>`;
  lista.querySelectorAll('.aviso-item').forEach(el => {
    el.addEventListener('click', () => { marcarLido(el.dataset.id); el.classList.remove('nao-lido'); atualizarBadge(); });
  });
}

// ── INIT ────────────────────────────────────────────────────
(async function init() {
  criarParticulas();
  criarSprites();
  atualizarBadge();
  carregarFeed();
  verificarIOSInstall();
  const usuario = await checarAuth();
  hidratarUI(usuario);
  console.log('[Vida Mágica] App v3 iniciado');
})();
