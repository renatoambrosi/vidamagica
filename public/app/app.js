/* ── VmSession ── */
window.VmSession=(function(){const K='vm_s',P='vm_lembrar',U='vm_u';function salvar(d,l){const p=l!==undefined?l:getLembrar();localStorage.setItem(P,p?'1':'0');const s=p?localStorage:sessionStorage,o=p?sessionStorage:localStorage;o.removeItem(K);s.setItem(K,JSON.stringify(d));if(d.usuario?.nome)localStorage.setItem(U,JSON.stringify({nome:d.usuario.nome,email:d.usuario.email||null,telefone_formatado:d.usuario.telefone_formatado||null,foto_url:d.usuario.foto_url||null}));}function carregar(){try{const r=localStorage.getItem(K)||sessionStorage.getItem(K);return r?JSON.parse(r):null;}catch{return null;}}function destruir(){localStorage.removeItem(K);sessionStorage.removeItem(K);}function getAccess(){return carregar()?.access_token||null;}function getRefresh(){return carregar()?.refresh_token||null;}function getLembrar(){return localStorage.getItem(P)!=='0';}function getUsuarioLembrado(){try{return JSON.parse(localStorage.getItem(U)||'null');}catch{return null;}}function limparUsuarioLembrado(){localStorage.removeItem(U);}return{salvar,carregar,destruir,getAccess,getRefresh,getLembrar,getUsuarioLembrado,limparUsuarioLembrado};})();

/* ============================================================
   VIDA MÁGICA — App principal  v2
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

// ── SPRITES (estrelinhas decorativas, igual à home) ─────────
function criarSprites() {
  // Posições e tamanhos variados, animação assincrona
  const SPRITES = [
    { top: '15%', left: '8%',  size: 18, dur: 4.2, delay: 0 },
    { top: '22%', right: '6%', size: 14, dur: 5.8, delay: 1.4 },
    { top: '38%', left: '5%',  size: 12, dur: 6.1, delay: 2.2 },
    { top: '55%', right: '4%', size: 16, dur: 4.8, delay: 0.8 },
    { top: '70%', left: '7%',  size: 10, dur: 7.2, delay: 3.1 },
    { top: '82%', right: '9%', size: 20, dur: 5.3, delay: 1.9 },
    { top: '12%', left: '50%', size: 11, dur: 6.6, delay: 2.7 },
    { top: '90%', left: '35%', size: 13, dur: 4.5, delay: 0.5 },
  ];

  SPRITES.forEach(s => {
    const el = document.createElement('div');
    el.className = 'sprite';
    Object.assign(el.style, {
      top:    s.top || 'auto',
      left:   s.left || 'auto',
      right:  s.right || 'auto',
      width:  s.size + 'px',
      height: s.size + 'px',
      animationDuration: s.dur + 's',
      animationDelay: s.delay + 's',
    });
    // Estrela SVG dourada
    el.innerHTML = `<svg viewBox="0 0 24 24" width="${s.size}" height="${s.size}" fill="none">
      <path d="M12 2 L13.5 9 L20 9 L14.5 13.5 L16.5 20 L12 16 L7.5 20 L9.5 13.5 L4 9 L10.5 9 Z"
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharTodosModais(); });

document.getElementById('menu-logout')?.addEventListener('click', async () => {
  const refresh = VmSession.getRefresh();
  try { await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) }); } catch {}
  VmSession.destruir();
  window.location.replace('/auth?intencional');
});

// ── FEED ────────────────────────────────────────────────────
async function carregarFeed() {
  try {
    const r = await fetch(`${API}/api/feed`);
    if (!r.ok) throw new Error('status ' + r.status);
    const itens = await r.json();
    const destaques = itens.filter(i => i.destaque);
    const lista     = itens.filter(i => !i.destaque);
    renderCarrossel(destaques);
    renderLista(lista);
  } catch (err) {
    console.warn('[Feed] erro ao carregar:', err.message);
    const wrap = document.getElementById('feed-carrossel-wrap');
    if (wrap) wrap.style.display = 'none';
  }
}

/* ── Thumbnail ── */
function thumbDeUrl(url) {
  if (!url) return null;
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`;
  return null;
}

/* ── Embed URL — YouTube privacy-enhanced + origin para evitar erro 153 ── */
function embedDeUrl(url) {
  if (!url) return '';
  const origin = encodeURIComponent(window.location.origin);
  // YouTube — usa youtube-nocookie.com (privacy-enhanced) + enablejsapi + origin
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?autoplay=1&rel=0&enablejsapi=1&origin=${origin}`;
  }
  // Vimeo
  const vmMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vmMatch) return `https://player.vimeo.com/video/${vmMatch[1]}?autoplay=1`;
  return url;
}

function iconeDoTipo(tipo) {
  return { video: '🎬', texto: '📝', imagem: '🖼️', link: '🔗' }[tipo] || '✦';
}

/* ── Carrossel ── */
function renderCarrossel(itens) {
  const wrap      = document.getElementById('feed-carrossel-wrap');
  const carrossel = document.getElementById('feed-carrossel');
  const dots      = document.getElementById('feed-dots');
  if (!itens.length) { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap) wrap.style.display = '';

  carrossel.innerHTML = itens.map((item) => {
    const thumb  = item.imagem_url || thumbDeUrl(item.url);
    const ehVideo = item.tipo === 'video';
    return `
    <div class="feed-card-destaque" tabindex="0"
         data-id="${item.id}" data-tipo="${item.tipo}" data-url="${item.url||''}"
         data-titulo="${encodeURIComponent(item.titulo)}"
         data-subtitulo="${encodeURIComponent(item.subtitulo||'')}"
         data-corpo="${encodeURIComponent(item.corpo||'')}">
      <div class="feed-thumb">
        ${thumb
          ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy">`
          : `<div class="feed-thumb-placeholder">${iconeDoTipo(item.tipo)}</div>`}
        ${ehVideo ? `<div class="feed-play-overlay"><div class="feed-play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>` : ''}
      </div>
      <div class="feed-card-body">
        ${item.subtitulo ? `<div class="feed-card-eyebrow">${item.subtitulo}</div>` : ''}
        <div class="feed-card-titulo">${item.titulo}</div>
        ${item.corpo ? `<div class="feed-card-corpo">${item.corpo}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // Dots
  dots.innerHTML = itens.map((_, i) =>
    `<div class="feed-dot${i===0?' ativo':''}" data-idx="${i}"></div>`).join('');

  carrossel.addEventListener('scroll', () => {
    const idx = Math.round(carrossel.scrollLeft / carrossel.offsetWidth);
    dots.querySelectorAll('.feed-dot').forEach((d, i) => d.classList.toggle('ativo', i===idx));
  }, { passive: true });

  // Clique nos dots
  dots.querySelectorAll('.feed-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.dataset.idx);
      const card = carrossel.children[idx];
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    });
  });

  carrossel.querySelectorAll('.feed-card-destaque').forEach(card => {
    card.addEventListener('click', () => ativarItem(card));
    card.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') ativarItem(card); });
  });
}

/* ── Lista ── */
function renderLista(itens) {
  const lista = document.getElementById('feed-lista');
  if (!lista) return;
  if (!itens.length) { lista.innerHTML = ''; return; }
  lista.innerHTML = itens.map(item => {
    const thumb   = item.imagem_url || thumbDeUrl(item.url);
    const ehVideo = item.tipo === 'video';
    return `
    <div class="feed-card-lista" tabindex="0"
         data-id="${item.id}" data-tipo="${item.tipo}" data-url="${item.url||''}"
         data-titulo="${encodeURIComponent(item.titulo)}"
         data-subtitulo="${encodeURIComponent(item.subtitulo||'')}"
         data-corpo="${encodeURIComponent(item.corpo||'')}">
      <div class="feed-lista-thumb">
        ${thumb
          ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy">`
          : `<div class="feed-lista-thumb-placeholder">${iconeDoTipo(item.tipo)}</div>`}
        ${ehVideo ? `<div class="feed-lista-play"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>` : ''}
      </div>
      <div class="feed-lista-info">
        ${item.subtitulo ? `<div class="feed-lista-eyebrow">${item.subtitulo}</div>` : ''}
        <div class="feed-lista-titulo">${item.titulo}</div>
        ${item.corpo ? `<div class="feed-lista-corpo">${item.corpo}</div>` : ''}
        <span class="feed-tipo-tag feed-tipo-${item.tipo}">${iconeDoTipo(item.tipo)} ${item.tipo}</span>
      </div>
    </div>`;
  }).join('');

  lista.querySelectorAll('.feed-card-lista').forEach(card => {
    card.addEventListener('click', () => ativarItem(card));
    card.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') ativarItem(card); });
  });
}

/* ── Ativar item ── */
function ativarItem(card) {
  const tipo      = card.dataset.tipo;
  const url       = card.dataset.url;
  const titulo    = decodeURIComponent(card.dataset.titulo);
  const subtitulo = decodeURIComponent(card.dataset.subtitulo);
  const corpo     = decodeURIComponent(card.dataset.corpo);

  if (tipo === 'video' && url) {
    abrirPlayer({ titulo, subtitulo, corpo, url });
  } else if (tipo === 'link' && url) {
    window.open(url, '_blank', 'noopener');
  } else if (tipo === 'imagem' && url) {
    window.open(url, '_blank', 'noopener');
  } else {
    abrirPlayer({ titulo, subtitulo, corpo, url: null });
  }
}

/* ── Player ── */
function abrirPlayer({ titulo, subtitulo, corpo, url }) {
  const iframe   = document.getElementById('player-iframe');
  const tituloEl = document.getElementById('player-titulo');
  const subEl    = document.getElementById('player-subtitulo');
  const corpoEl  = document.getElementById('player-corpo');
  const wrap     = document.querySelector('.player-wrap');

  if (tituloEl)  tituloEl.textContent  = titulo    || '';
  if (subEl)     subEl.textContent     = subtitulo || '';
  if (corpoEl)   corpoEl.textContent   = corpo     || '';

  if (url && iframe) {
    iframe.src = embedDeUrl(url);
    if (wrap) wrap.style.display = '';
  } else {
    if (iframe) iframe.src = '';
    if (wrap)   wrap.style.display = 'none';
  }

  abrirModal('modal-player');
}

function pararPlayer() {
  const iframe = document.getElementById('player-iframe');
  if (iframe) iframe.src = '';
}

// ── AVISOS ──────────────────────────────────────────────────
const AVISOS_KEY = 'vm_avisos_lidos';
const AVISOS = [
  { id: 'av_tesouro_01', tag: 'Tesouro da Su', titulo: 'Seu presente de hoje chegou! 🎁', desc: 'O Tesouro da Su está disponível. Abra agora e colete sua semente do dia.', data: 'Hoje' },
  { id: 'av_teste_01',   tag: 'Ação necessária', titulo: 'Seu Teste de Prosperidade aguarda', desc: 'Você ainda não concluiu o Teste de Prosperidade. Ele é o primeiro passo da sua trilha.', data: 'Esta semana' },
  { id: 'av_video_01',   tag: 'Novidade', titulo: 'Novo vídeo disponível no app', desc: 'A Suellen publicou uma aula exclusiva para membros do Clube Vida Mágica.', data: '2 dias atrás' },
];
function getLidos() { try { return JSON.parse(localStorage.getItem(AVISOS_KEY)||'[]'); } catch { return []; } }
function marcarLido(id) { const l=getLidos(); if(!l.includes(id)){l.push(id);localStorage.setItem(AVISOS_KEY,JSON.stringify(l));} }
function atualizarBadge() {
  const lidos = getLidos();
  const badge = document.getElementById('avisos-badge');
  if (!badge) return;
  AVISOS.some(a => !lidos.includes(a.id)) ? badge.classList.add('visivel') : badge.classList.remove('visivel');
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

// ── PWA ─────────────────────────────────────────────────────
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const b = document.getElementById('pwa-banner');
  if (b) b.hidden = false;
});

document.getElementById('pwa-instalar')?.addEventListener('click', async () => {
  if (!deferredPrompt) {
    // Fallback: abre instruções nativas no iOS (Safari não suporta beforeinstallprompt)
    alert('Para instalar: toque no botão Compartilhar (□↑) e depois em "Adicionar à Tela de Início".');
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log('[PWA] outcome:', outcome);
  deferredPrompt = null;
  document.getElementById('pwa-banner').hidden = true;
});

document.getElementById('pwa-depois')?.addEventListener('click', () => {
  document.getElementById('pwa-banner').hidden = true;
});

// Detecta iOS (que não dispara beforeinstallprompt) e mostra o banner de forma diferente
function verificarIOSInstall() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true;
  if (isIOS && !isStandalone) {
    const b = document.getElementById('pwa-banner');
    if (b) {
      b.querySelector('span').textContent = 'Instalar no iPhone?';
      b.hidden = false;
    }
  }
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
  console.log('[Vida Mágica] App v2 inicializado');
})();
