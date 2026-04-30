/* ── VmSession ── */
window.VmSession=(function(){const K='vm_s',P='vm_lembrar',U='vm_u';function salvar(d,l){const p=l!==undefined?l:getLembrar();localStorage.setItem(P,p?'1':'0');const s=p?localStorage:sessionStorage,o=p?sessionStorage:localStorage;o.removeItem(K);s.setItem(K,JSON.stringify(d));if(d.usuario?.nome)localStorage.setItem(U,JSON.stringify({nome:d.usuario.nome,email:d.usuario.email||null,telefone_formatado:d.usuario.telefone_formatado||null,foto_url:d.usuario.foto_url||null}));}function carregar(){try{const r=localStorage.getItem(K)||sessionStorage.getItem(K);return r?JSON.parse(r):null;}catch{return null;}}function destruir(){localStorage.removeItem(K);sessionStorage.removeItem(K);}function getAccess(){return carregar()?.access_token||null;}function getRefresh(){return carregar()?.refresh_token||null;}function getLembrar(){return localStorage.getItem(P)!=='0';}return{salvar,carregar,destruir,getAccess,getRefresh,getLembrar};})();

/* ============================================================
   VIDA MÁGICA — App v4
   ============================================================ */

const API = '';
let usuario = null;
let chatWs  = null;
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

// ── HIDRATAR ────────────────────────────────────────────────
function hidratarUI(u) {
  if (!u) return;
  usuario = u;
  const nome = (u.nome||'').split(' ')[0] || 'Você';
  document.getElementById('saudacao-nome').textContent = `Olá, ${nome}`;
  document.getElementById('badge-sementes').textContent = u.sementes || 0;
  document.getElementById('perfil-nome').textContent = u.nome || '—';
  document.getElementById('perfil-sementes').textContent = u.sementes || 0;
  if (u.foto_url) {
    const av = document.getElementById('perfil-avatar');
    av.innerHTML = `<img src="${u.foto_url}" alt="${u.nome}">`;
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

// ══════════════════════════════════════════════════════════
// BOTTOM NAV
// ══════════════════════════════════════════════════════════
const views = { home: null, produtos: null, chat: null, perfil: null };

function irPara(viewId) {
  // Desativa todos
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  // Ativa o alvo
  document.getElementById(`view-${viewId}`)?.classList.add('active');
  document.querySelector(`.nav-tab[data-view="${viewId}"]`)?.classList.add('active');
  // Ações ao entrar em cada view
  if (viewId === 'chat' && !chatConv) iniciarChat();
  if (viewId === 'perfil') renderPerfil();
}

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => irPara(tab.dataset.view));
});

// ══════════════════════════════════════════════════════════
// MODAIS
// ══════════════════════════════════════════════════════════
function abrirModal(id) {
  document.getElementById(id)?.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function fecharModal(id) {
  const m = typeof id === 'string' ? document.getElementById(id) : id;
  if (!m) return;
  if (m.id === 'modal-player') pararPlayer();
  m.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', e => fecharModal(e.target.closest('.modal')));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal[aria-hidden="false"]').forEach(m => fecharModal(m)); });

// Avisos
document.getElementById('btn-avisos')?.addEventListener('click', () => {
  renderAvisos(); abrirModal('modal-avisos');
  setTimeout(() => { AVISOS.forEach(a => marcarLido(a.id)); atualizarBadgeAvisos(); }, 2000);
});
// Sementes
document.getElementById('btn-sementes')?.addEventListener('click', () => irPara('perfil'));
// Testes
document.getElementById('menu-testes')?.addEventListener('click', () => { carregarTestes(); abrirModal('modal-testes'); });
// Logout
document.getElementById('menu-logout')?.addEventListener('click', async () => {
  const refresh = VmSession.getRefresh();
  try { await fetch(`${API}/api/auth/logout`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ refresh_token: refresh }) }); } catch {}
  VmSession.destruir(); window.location.replace('/auth?intencional');
});

// ══════════════════════════════════════════════════════════
// PLAYER
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
  document.getElementById('player-titulo').textContent = titulo || '';
  document.getElementById('player-sub').textContent = subtitulo || '';
  document.getElementById('player-corpo').textContent = corpo || '';
  const wrap = document.querySelector('.player-wrap');
  const iframe = document.getElementById('player-iframe');
  if (url) { iframe.src = embedDeUrl(url); if (wrap) wrap.style.display = ''; }
  else { iframe.src = ''; if (wrap) wrap.style.display = 'none'; }
  abrirModal('modal-player');
}
function pararPlayer() {
  const iframe = document.getElementById('player-iframe');
  if (iframe) iframe.src = '';
}

// ══════════════════════════════════════════════════════════
// FEED
// ══════════════════════════════════════════════════════════
function icone(tipo) { return { video:'🎬', texto:'📝', imagem:'🖼️', link:'🔗' }[tipo]||'✦'; }

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
  const wrap = document.getElementById('feed-carrossel-wrap');
  const car  = document.getElementById('feed-carrossel');
  const dots = document.getElementById('feed-dots');
  if (!itens.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  car.innerHTML = itens.map(item => {
    const thumb = item.imagem_url || thumbDeUrl(item.url);
    const isVid = item.tipo === 'video';
    return `<div class="feed-card-destaque" tabindex="0"
      data-tipo="${item.tipo}" data-url="${item.url||''}"
      data-titulo="${encodeURIComponent(item.titulo)}"
      data-subtitulo="${encodeURIComponent(item.subtitulo||'')}"
      data-corpo="${encodeURIComponent(item.corpo||'')}">
      <div class="feed-thumb">
        ${thumb ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy">` : `<div class="feed-thumb-placeholder">${icone(item.tipo)}</div>`}
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
    d.addEventListener('click', () => { const c = car.children[parseInt(d.dataset.idx)]; if(c) c.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'}); });
  });
  car.querySelectorAll('.feed-card-destaque').forEach(c => c.addEventListener('click', () => ativarItem(c)));
}

function renderLista(itens) {
  const lista = document.getElementById('feed-lista');
  if (!lista) return;
  lista.innerHTML = itens.map(item => {
    const thumb = item.imagem_url || thumbDeUrl(item.url);
    const isVid = item.tipo === 'video';
    return `<div class="feed-card-lista" tabindex="0"
      data-tipo="${item.tipo}" data-url="${item.url||''}"
      data-titulo="${encodeURIComponent(item.titulo)}"
      data-subtitulo="${encodeURIComponent(item.subtitulo||'')}"
      data-corpo="${encodeURIComponent(item.corpo||'')}">
      <div class="feed-lista-thumb">
        ${thumb ? `<img src="${thumb}" alt="${item.titulo}" loading="lazy">` : `<div class="feed-lista-thumb-placeholder">${icone(item.tipo)}</div>`}
        ${isVid ? `<div class="feed-lista-play"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>` : ''}
      </div>
      <div class="feed-lista-info">
        ${item.subtitulo ? `<div class="feed-lista-eyebrow">${item.subtitulo}</div>` : ''}
        <div class="feed-lista-titulo">${item.titulo}</div>
        ${item.corpo ? `<div class="feed-lista-corpo">${item.corpo}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  lista.querySelectorAll('.feed-card-lista').forEach(c => c.addEventListener('click', () => ativarItem(c)));
}

function ativarItem(card) {
  const tipo = card.dataset.tipo, url = card.dataset.url;
  const titulo = decodeURIComponent(card.dataset.titulo);
  const subtitulo = decodeURIComponent(card.dataset.subtitulo);
  const corpo = decodeURIComponent(card.dataset.corpo);
  if (tipo === 'video' && url) abrirPlayer({ titulo, subtitulo, corpo, url });
  else if ((tipo === 'link' || tipo === 'imagem') && url) window.open(url, '_blank', 'noopener');
  else abrirPlayer({ titulo, subtitulo, corpo, url: null });
}

// ══════════════════════════════════════════════════════════
// TESOURO DA SU
// ══════════════════════════════════════════════════════════
const TESOURO_KEY = 'vm_tesouro_resgatado';

function tesouroJaResgatado(id) {
  try { return JSON.parse(localStorage.getItem(TESOURO_KEY)||'[]').includes(id); } catch { return false; }
}
function marcarTesouroResgatado(id) {
  try { const l = JSON.parse(localStorage.getItem(TESOURO_KEY)||'[]'); if(!l.includes(id)){l.push(id);localStorage.setItem(TESOURO_KEY,JSON.stringify(l));} } catch {}
}

let tesouroAtual = null;

async function carregarTesouro() {
  // Busca item mais recente do feed marcado como tesouro
  // Por ora usa o primeiro item do feed com tipo != link
  try {
    const r = await fetch(`${API}/api/feed`);
    if (!r.ok) return;
    const itens = await r.json();
    const item = itens.find(i => i.ativo && !tesouroJaResgatado(String(i.id)));
    if (!item) {
      // Tudo resgatado
      const btn = document.getElementById('tesouro-btn');
      btn.classList.remove('tem-novidade');
      document.getElementById('tesouro-label').textContent = 'Tesouro da Su';
      document.getElementById('tesouro-sub').textContent = 'Nenhum tesouro hoje ainda';
      return;
    }
    tesouroAtual = item;
    const btn = document.getElementById('tesouro-btn');
    btn.classList.add('tem-novidade');
    document.getElementById('tesouro-sub').textContent = 'Novo! Toque para resgatar ✨';
  } catch {}
}

document.getElementById('tesouro-btn')?.addEventListener('click', () => {
  if (!tesouroAtual) return;
  // Monta conteúdo do modal
  const conteudo = document.getElementById('modal-tesouro-conteudo');
  conteudo.innerHTML = `
    <div class="feed-card-eyebrow" style="margin-bottom:0.4rem">${tesouroAtual.subtitulo || 'Tesouro do Dia'}</div>
    <div class="feed-card-titulo" style="font-size:1.1rem;margin-bottom:0.6rem">${tesouroAtual.titulo}</div>
    ${tesouroAtual.corpo ? `<p style="font-size:0.86rem;color:var(--txt2);line-height:1.6;margin-bottom:1rem">${tesouroAtual.corpo}</p>` : ''}
    ${tesouroAtual.url && tesouroAtual.tipo === 'video' ? `
      <div class="player-ratio" style="margin-bottom:1rem;border-radius:12px;overflow:hidden">
        <iframe src="${embedDeUrl(tesouroAtual.url)}" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%"></iframe>
      </div>` : ''}
    <div style="font-size:0.75rem;color:var(--ouro-fundo);font-family:var(--font-display);font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.25rem">Recompensa</div>
    <div style="font-size:1.4rem;font-family:var(--font-display);font-weight:900;color:var(--ouro-claro)">+1 🌱 Semente</div>
  `;
  abrirModal('modal-tesouro');
});

document.getElementById('modal-tesouro-resgatar')?.addEventListener('click', async () => {
  if (!tesouroAtual || !usuario) return;
  const btn = document.getElementById('modal-tesouro-resgatar');
  btn.disabled = true;
  btn.textContent = 'Resgatando...';
  try {
    // Soma semente via API — endpoint a criar; por ora local
    marcarTesouroResgatado(String(tesouroAtual.id));
    usuario.sementes = (usuario.sementes || 0) + 1;
    document.getElementById('badge-sementes').textContent = usuario.sementes;
    document.getElementById('perfil-sementes').textContent = usuario.sementes;
    fecharModal('modal-tesouro');
    document.getElementById('tesouro-btn').classList.remove('tem-novidade');
    document.getElementById('tesouro-sub').textContent = 'Resgatado hoje! Volte amanhã 🌱';
    tesouroAtual = null;
  } catch {
    btn.disabled = false;
    btn.textContent = '🌱 Resgatar Tesouro';
  }
});

// ══════════════════════════════════════════════════════════
// AVISOS
// ══════════════════════════════════════════════════════════
const AVISOS_KEY = 'vm_avisos_lidos';
const AVISOS = [
  { id:'av1', tag:'Tesouro da Su', titulo:'Seu presente chegou! ✨', desc:'Um novo tesouro está disponível para você hoje.', data:'Hoje' },
  { id:'av2', tag:'Comunidade', titulo:'Novo conteúdo disponível', desc:'A Suellen publicou um conteúdo exclusivo para membros.', data:'1 dia' },
];
function getLidos() { try { return JSON.parse(localStorage.getItem(AVISOS_KEY)||'[]'); } catch { return []; } }
function marcarLido(id) { const l=getLidos(); if(!l.includes(id)){l.push(id);localStorage.setItem(AVISOS_KEY,JSON.stringify(l));} }
function atualizarBadgeAvisos() {
  const lidos = getLidos();
  const ponto = document.getElementById('ponto-avisos');
  if (ponto) AVISOS.some(a => !lidos.includes(a.id)) ? ponto.classList.add('visivel') : ponto.classList.remove('visivel');
}
function renderAvisos() {
  const corpo = document.getElementById('avisos-corpo');
  if (!corpo) return;
  const lidos = getLidos();
  corpo.innerHTML = AVISOS.map(a => `
    <div class="aviso-item${!lidos.includes(a.id)?' nao-lido':''}" data-id="${a.id}">
      <div class="aviso-dot"></div>
      <div class="aviso-corpo">
        <div class="aviso-tag">${a.tag}</div>
        <div class="aviso-titulo">${a.titulo}</div>
        <div class="aviso-desc">${a.desc}</div>
        <div class="aviso-data">${a.data}</div>
      </div>
    </div>`).join('');
  corpo.querySelectorAll('.aviso-item').forEach(el => {
    el.addEventListener('click', () => { marcarLido(el.dataset.id); el.classList.remove('nao-lido'); atualizarBadgeAvisos(); });
  });
}

// ══════════════════════════════════════════════════════════
// TESTES DE PROSPERIDADE
// ══════════════════════════════════════════════════════════
async function carregarTestes() {
  const corpo = document.getElementById('testes-corpo');
  if (!corpo) return;
  corpo.innerHTML = '<div class="loading-inline">Carregando...</div>';
  try {
    const r = await fetch(`${API}/api/auth/testes`, { headers: { Authorization: `Bearer ${VmSession.getAccess()}` } });
    if (!r.ok) throw new Error();
    const testes = await r.json();
    if (!testes.length) { corpo.innerHTML = '<div class="loading-inline">Nenhum teste realizado ainda.</div>'; return; }
    corpo.innerHTML = testes.map(t => `
      <div class="teste-item">
        <div class="teste-perfil">${t.perfil_dominante}</div>
        <div class="teste-pct">${t.percentual_prosperidade}<span>%</span></div>
        <div class="teste-data">${new Date(t.feito_em).toLocaleDateString('pt-BR', {day:'2-digit',month:'long',year:'numeric'})}</div>
      </div>`).join('');
  } catch {
    corpo.innerHTML = '<div class="loading-inline">Erro ao carregar testes.</div>';
  }
}

// ══════════════════════════════════════════════════════════
// PERFIL
// ══════════════════════════════════════════════════════════
function renderPerfil() {
  if (!usuario) return;
  document.getElementById('perfil-nome').textContent = usuario.nome || '—';
  document.getElementById('perfil-sementes').textContent = usuario.sementes || 0;
}

// ══════════════════════════════════════════════════════════
// CHAT — WebSocket + REST
// ══════════════════════════════════════════════════════════

function horaFormatada(data) {
  return new Date(data).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}

function renderMensagem(msg) {
  const isAluna = msg.remetente === 'aluna';
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${isAluna ? 'aluna' : 'suellen'}`;
  wrap.dataset.id = msg.id;

  let conteudoHtml = '';
  if (msg.tipo === 'imagem' && msg.url) {
    conteudoHtml = `<div class="msg-imagem"><img src="${msg.url}" alt="Imagem" loading="lazy"></div>`;
  } else if (msg.tipo === 'audio' && msg.url) {
    conteudoHtml = `<div class="msg-bolha msg-audio">
      <div class="msg-audio-play">🎤</div>
      <audio controls src="${msg.url}" style="max-width:180px"></audio>
    </div>`;
  } else {
    conteudoHtml = `<div class="msg-bolha">${escHtml(msg.conteudo||'')}</div>`;
  }

  wrap.innerHTML = `
    ${conteudoHtml}
    <span class="msg-hora">${horaFormatada(msg.criado_em)}${msg.remetente==='aluna'?'':''}</span>
  `;
  return wrap;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function scrollChat() {
  const msgs = document.getElementById('chat-msgs');
  if (msgs) setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 50);
}

function renderPlanoInfo(conv) {
  const info = document.getElementById('chat-plano-info');
  const banner = document.getElementById('chat-prior-banner');
  const upgrade = document.getElementById('chat-upgrade');
  const detalhe = document.getElementById('chat-prior-detalhe');

  if (conv.plano_chat === 'prioritario') {
    const restam = conv.interacoes_restantes ?? '—';
    const expira = conv.prioritario_expira_em ? new Date(conv.prioritario_expira_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
    info.textContent = `⭐ Prioritário · ${restam} interações restantes`;
    info.style.color = 'var(--ouro-claro)';
    banner.style.display = '';
    upgrade.style.display = 'none';
    detalhe.textContent = `${restam} interações · expira às ${expira}`;
  } else {
    info.textContent = '💬 Chat Basic · resposta em breve';
    info.style.color = '';
    banner.style.display = 'none';
    upgrade.style.display = '';
  }
}

async function iniciarChat() {
  const loading   = document.getElementById('chat-loading');
  const msgsEl    = document.getElementById('chat-msgs');
  const inputWrap = document.getElementById('chat-input-wrap');

  loading.style.display = 'flex';
  msgsEl.style.display  = 'none';

  try {
    const r = await fetch(`${API}/api/chat/conversa`, {
      headers: { Authorization: `Bearer ${VmSession.getAccess()}` }
    });
    if (!r.ok) throw new Error('Não autorizado');
    const dados = await r.json();
    chatConv = dados.conversa;

    // Renderiza histórico
    msgsEl.innerHTML = '';
    dados.mensagens.forEach(msg => msgsEl.appendChild(renderMensagem(msg)));

    loading.style.display  = 'none';
    msgsEl.style.display   = 'flex';
    inputWrap.style.display = '';
    renderPlanoInfo(chatConv);
    scrollChat();

    // Conecta WebSocket
    conectarChatWs();
  } catch (err) {
    loading.innerHTML = `<p style="color:var(--txt3);font-size:0.82rem">Erro ao carregar chat.</p>`;
  }
}

function conectarChatWs() {
  if (chatWs && chatWs.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = VmSession.getAccess();
  chatWs = new WebSocket(`${proto}://${location.host}/ws/chat?token=${token}&modo=aluna`);

  chatWs.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.evento === 'nova_mensagem' && data.mensagem.remetente === 'suellen') {
        const msgsEl = document.getElementById('chat-msgs');
        msgsEl.appendChild(renderMensagem(data.mensagem));
        scrollChat();
        // Badge se não estiver na aba
        if (!document.querySelector('.nav-tab[data-view="chat"]').classList.contains('active')) {
          document.getElementById('nav-chat-badge').style.display = '';
        }
      }
    } catch {}
  };

  chatWs.onclose = () => {
    // Reconecta após 3s se a aba de chat ainda estiver ativa
    setTimeout(() => {
      if (document.getElementById('view-chat').classList.contains('active')) conectarChatWs();
    }, 3000);
  };
}

// Limpa badge ao entrar no chat
document.querySelector('.nav-tab[data-view="chat"]')?.addEventListener('click', () => {
  document.getElementById('nav-chat-badge').style.display = 'none';
});

// Input — auto-resize + mostrar botão enviar
const chatInput = document.getElementById('chat-input');
const sendBtn   = document.getElementById('chat-send-btn');
const audioBtn  = document.getElementById('chat-audio-btn');

chatInput?.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  const temTexto = chatInput.value.trim().length > 0;
  sendBtn.style.display  = temTexto ? 'flex' : 'none';
  audioBtn.style.display = temTexto ? 'none' : 'flex';
});

chatInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensagem(); }
});

sendBtn?.addEventListener('click', enviarMensagem);

async function enviarMensagem() {
  const texto = chatInput?.value.trim();
  if (!texto || !usuario) return;

  // Otimista: adiciona na tela imediatamente
  const msgTemp = {
    id: Date.now(), remetente: 'aluna', tipo: 'texto',
    conteudo: texto, criado_em: new Date().toISOString()
  };
  const msgsEl = document.getElementById('chat-msgs');
  msgsEl.appendChild(renderMensagem(msgTemp));
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.style.display  = 'none';
  audioBtn.style.display = 'flex';
  scrollChat();

  try {
    const r = await fetch(`${API}/api/chat/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Authorization: `Bearer ${VmSession.getAccess()}` },
      body: JSON.stringify({ conteudo: texto, tipo: 'texto' }),
    });
    if (r.ok) {
      const dados = await r.json();
      // Atualiza plano info se mudou
      if (dados.conversa) renderPlanoInfo({ ...chatConv, ...dados.conversa });
    }
  } catch {}
}

// Anexo (imagem)
document.getElementById('chat-anexo-btn')?.addEventListener('click', () => {
  document.getElementById('chat-file-input')?.click();
});
document.getElementById('chat-file-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  // Por ora mostra preview local — upload real requer storage
  const url = URL.createObjectURL(file);
  const msgTemp = { id: Date.now(), remetente: 'aluna', tipo: 'imagem', url, criado_em: new Date().toISOString() };
  document.getElementById('chat-msgs').appendChild(renderMensagem(msgTemp));
  scrollChat();
  e.target.value = '';
});

// Upgrade prioritário
document.getElementById('chat-upgrade-btn')?.addEventListener('click', () => {
  // Redireciona para checkout — implementar gateway depois
  alert('Em breve: Atendimento Prioritário por R$ 9,90 — 30 interações · 24h');
});

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
(async function init() {
  criarParticulas();
  atualizarBadgeAvisos();

  usuario = await checarAuth();
  if (!usuario) return;

  hidratarUI(usuario);
  carregarFeed();
  carregarTesouro();
})();

// ── Gravação de áudio com MediaRecorder ──
let mediaRecorder = null;
let audioChunks   = [];
let audioTimer    = null;
let audioSeg      = 0;

function formatarTempo(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2,'0')}`;
}

document.getElementById('chat-audio-btn')?.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];
    audioSeg = 0;

    const audioBtn       = document.getElementById('chat-audio-btn');
    const sendBtn        = document.getElementById('chat-send-btn');
    const inputContainer = document.querySelector('.chat-input-container');

    // Guarda o input original
    const originalHTML = inputContainer.innerHTML;

    // Mostra preview de gravação
    inputContainer.innerHTML = `
      <div class="chat-audio-preview">
        <div class="chat-audio-preview-dot"></div>
        <span style="flex:1;font-size:0.82rem;color:var(--texto-mute)">Gravando áudio...</span>
        <span class="chat-audio-preview-timer" id="audio-timer">0:00</span>
      </div>`;

    audioBtn.classList.add('gravando');
    sendBtn.style.display = 'flex';

    audioTimer = setInterval(() => {
      audioSeg++;
      const el = document.getElementById('audio-timer');
      if (el) el.textContent = formatarTempo(audioSeg);
      if (audioSeg >= 120) mediaRecorder.stop();
    }, 1000);

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = () => {
      clearInterval(audioTimer);
      stream.getTracks().forEach(t => t.stop());
      audioBtn.classList.remove('gravando');
      inputContainer.innerHTML = originalHTML;
      sendBtn.style.display = 'none';
      audioBtn.style.display = 'flex';

      if (audioSeg < 1) return;

      const blob = new Blob(audioChunks, { type: mimeType });
      const url  = URL.createObjectURL(blob);
      const msgTemp = {
        id: Date.now(), remetente: 'aluna', tipo: 'audio',
        url, criado_em: new Date().toISOString()
      };
      document.getElementById('chat-msgs').appendChild(renderMensagem(msgTemp));
      scrollChat();
    };

    mediaRecorder.start(200);

  } catch {
    alert('Não foi possível acessar o microfone. Verifique as permissões.');
  }
});
