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

  if (viewId === 'chat') {
    document.body.classList.remove('chat-aberto');
    document.body.classList.add('view-chat-ativa');
    abrirTelaEscolhaChat();
  } else {
    document.body.classList.remove('chat-aberto');
    document.body.classList.remove('view-chat-ativa');
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

document.getElementById('btn-avisos')?.addEventListener('click', () => { renderAvisos(); abrirModal('modal-avisos'); setTimeout(() => { AVISOS().forEach(a => marcarLido(a.id)); atualizarBadgeAvisos(); }, 2000); });
document.getElementById('btn-sementes')?.addEventListener('click', () => abrirModalSementes());

// Handler GLOBAL do ícone "i" do feed (sempre disponível, não depende do JS de renderFeedHome)
document.getElementById('feed-home-info')?.addEventListener('click', (ev) => {
  ev.stopPropagation();
  abrirModalInfoContextual('feed_video');
});

// Handler GLOBAL da barra de progresso no header (clique → modal jornada)
document.getElementById('topo-jornada')?.addEventListener('click', () => {
  const wrap = document.getElementById('topo-jornada');
  const j = wrap?.__jornada;
  if (j) {
    abrirModalJornada(j);
  } else {
    abrirModalJornada({
      numero: 1,
      nome: 'Conhecer e Despertar',
      progresso_percentual: 0,
      passos: [
        { ordem: 1, titulo: 'Conhecer', concluido: false },
        { ordem: 2, titulo: 'Despertar', concluido: false },
        { ordem: 3, titulo: 'Reprogramação', concluido: false },
      ],
    });
  }
});
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

let feedItens = [];
let feedItemDestaque = null;

async function carregarFeed() {
  try {
    const r = await fetch(`${API}/api/feed`);
    if (r.ok) feedItens = await r.json();
  } catch (e) {
    console.warn('[feed] erro:', e);
  }

  let videos = (feedItens || []).filter(i => i.tipo === 'video' && i.ativo);

  if (videos.length === 0) {
    videos = [{
      id: 'exemplo',
      tipo: 'video',
      titulo: 'Vida Mágica — A Jornada',
      subtitulo: '',
      corpo: '',
      url: 'https://www.youtube.com/embed/yzMQW1DW6eE',
      imagem_url: 'https://img.youtube.com/vi/yzMQW1DW6eE/maxresdefault.jpg',
      ativo: true,
      publicado_em: new Date().toISOString(),
    }];
  }

  const ordenados = [...videos].sort((a, b) => {
    const da = a.publicado_em ? new Date(a.publicado_em).getTime() : 0;
    const db = b.publicado_em ? new Date(b.publicado_em).getTime() : 0;
    return db - da;
  });
  feedItemDestaque = ordenados[0];
  renderFeedHome(feedItemDestaque);

  // "Ver mais vídeos" sempre visível — leva pra aba Materiais que sempre tem conteúdo
  const btnMais = document.getElementById('feed-home-ver-mais');
  if (btnMais) btnMais.style.display = '';
}

function renderFeedHome(item) {
  if (!item) return;
  const destaqueEl = document.getElementById('feed-home-destaque');
  const thumbEl    = document.getElementById('feed-home-thumb');
  const playEl     = document.getElementById('feed-home-play');
  const infoEl     = document.getElementById('feed-home-info');
  const cadeadoEl  = document.getElementById('feed-home-cadeado');
  const verMaisEl  = document.getElementById('feed-home-ver-mais');

  const thumb = item.imagem_url || thumbDeUrl(item.url);
  if (thumbEl) thumbEl.src = thumb || '';
  if (destaqueEl) destaqueEl.style.display = '';

  // Alterna play/cadeado de acordo com o Clube
  const temClube = !!(window.__vm_tem_clube);
  if (playEl)    playEl.style.display    = temClube ? '' : 'none';
  if (cadeadoEl) cadeadoEl.style.display = temClube ? 'none' : '';

  const acaoConteudo = () => {
    if (temClube) {
      try { abrirPlayer({ titulo: item.titulo, subtitulo: item.subtitulo, corpo: item.corpo, url: item.url }); }
      catch { window.open(item.url, '_blank', 'noopener'); }
    } else {
      try { window.app && window.app.abrirModalClube && window.app.abrirModalClube(); } catch {}
    }
  };

  if (playEl)    playEl.onclick    = acaoConteudo;
  if (cadeadoEl) cadeadoEl.onclick = acaoConteudo;
  if (thumbEl)   thumbEl.onclick   = acaoConteudo;

  if (infoEl) {
    infoEl.onclick = (ev) => {
      ev.stopPropagation();
      abrirModalInfoContextual('feed_video');
    };
  }

  if (verMaisEl) {
    verMaisEl.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try { irPara('produtos'); } catch (e) { console.warn('[feed] navegação:', e); }
    };
  }
}

// ── MODAL "i" contextual ─────────────────────────────────────
function abrirModalInfoContextual(secao) {
  const textos = {
    feed_video: {
      titulo: 'Vídeos exclusivos toda semana',
      texto: 'A Suellen grava vídeos especiais toda semana, com técnicas práticas que não estão em lugar nenhum — só pra quem é do Clube Vida Mágica.',
    },
    jornada: {
      titulo: 'Sua jornada completa',
      texto: 'Assinando o Clube Vida Mágica, você tem acesso às 3 jornadas — Conhecer e Despertar, Vida Mágica e Multiplicando a Vida Mágica — com acompanhamento personalizado a cada passo.',
    },
    tesouros: {
      titulo: 'Tesouros da Su',
      texto: 'Tesouros diários da Suellen — direcionamentos, insights e lembretes no momento certo. Cada tesouro que você abre te dá 1 semente.',
    },
  };
  const t = textos[secao] || { titulo: 'Vida Mágica', texto: '' };

  let ov = document.getElementById('vm-info-modal-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'vm-info-modal-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:1.25rem;opacity:0;transition:opacity 0.18s ease;pointer-events:none;';
    ov.innerHTML = `
      <div style="background:linear-gradient(180deg,rgba(20,15,5,0.96),rgba(13,8,0,0.98));border:1px solid rgba(200,146,42,0.35);border-radius:18px;width:100%;max-width:340px;padding:1.6rem 1.4rem 1.4rem;position:relative;box-shadow:0 18px 50px rgba(0,0,0,0.6);text-align:center;">
        <button id="vm-info-modal-fechar" style="position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;background:rgba(245,240,232,0.08);border:0;color:rgba(245,240,232,0.75);cursor:pointer;display:flex;align-items:center;justify-content:center;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div id="vm-info-modal-titulo" style="font-family:var(--font-display,Montserrat);font-size:1rem;font-weight:800;color:#F4D060;margin-bottom:0.75rem;line-height:1.3;"></div>
        <div id="vm-info-modal-texto" style="font-size:0.88rem;color:rgba(245,240,232,0.82);line-height:1.6;"></div>
      </div>`;
    document.body.appendChild(ov);
    const fechar = () => { ov.style.opacity='0'; ov.style.pointerEvents='none'; document.body.style.overflow=''; };
    ov.querySelector('#vm-info-modal-fechar').addEventListener('click', fechar);
    ov.addEventListener('click', e => { if (e.target===ov) fechar(); });
  }
  ov.querySelector('#vm-info-modal-titulo').textContent = t.titulo;
  ov.querySelector('#vm-info-modal-texto').textContent  = t.texto;
  ov.style.opacity='1'; ov.style.pointerEvents='auto';
  document.body.style.overflow='hidden';
}

// ── AVISOS ───────────────────────────────────────────────────
const AVISOS_KEY = 'vm_avisos_lidos';
const AVISOS_BASE = [
  { id:'av1', tag:'BOAS-VINDAS', titulo:'Bem-vinda ao app Vida Mágica!', desc:'Aqui você acompanha sua jornada, assiste os vídeos exclusivos e fala com a Suellen.', data:'Hoje' },
];
let AVISOS_DINAMICOS = [];
function AVISOS() { return [...AVISOS_DINAMICOS, ...AVISOS_BASE]; }

function getLidos() { try { return JSON.parse(localStorage.getItem(AVISOS_KEY)||'[]'); } catch { return []; } }
function marcarLido(id) { const l=getLidos(); if(!l.includes(id)){l.push(id);localStorage.setItem(AVISOS_KEY,JSON.stringify(l));} }
function atualizarBadgeAvisos() {
  const badge = document.getElementById('ponto-avisos');
  if (badge) AVISOS().some(a=>!getLidos().includes(a.id)) ? badge.classList.add('visivel') : badge.classList.remove('visivel');
}
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderAvisos() {
  const corpo = document.getElementById('avisos-corpo'); if (!corpo) return;
  const lidos = getLidos();
  corpo.innerHTML = AVISOS().map(a => {
    const acaoHtml = a.acao
      ? `<button class="aviso-acao" data-acao="${escHtml(a.acao.tipo)}" data-payload="${escHtml(a.acao.payload || '')}">${escHtml(a.acao.label)}</button>`
      : '';
    return `<div class="aviso-item${!lidos.includes(a.id)?' nao-lido':''}" data-id="${a.id}">
      <div class="aviso-dot"></div>
      <div class="aviso-corpo">
        <div class="aviso-tag">${a.tag}</div>
        <div class="aviso-titulo">${a.titulo}</div>
        <div class="aviso-desc">${a.desc}</div>
        ${acaoHtml}
        <div class="aviso-data">${a.data}</div>
      </div>
    </div>`;
  }).join('');
  corpo.querySelectorAll('.aviso-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('aviso-acao')) return;
      marcarLido(el.dataset.id);
      el.classList.remove('nao-lido');
      atualizarBadgeAvisos();
    });
  });
  corpo.querySelectorAll('.aviso-acao').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tipo = btn.dataset.acao;
      const payload = btn.dataset.payload;
      const modal = document.getElementById('modal-avisos');
      if (modal) modal.setAttribute('aria-hidden', 'true');
      if (tipo === 'ativar-trilha' && payload) {
        await ativarTrilhaComSplash(payload);
      } else if (tipo === 'celebrar-compra' && payload) {
        const ctxAtual = await carregarContexto();
        if (!ctxAtual) return;
        const alvo = (ctxAtual.atualizacoes_pendentes || []).find(a => a.id === payload);
        if (alvo) await dispararSplashAtualizacao(alvo, ctxAtual);
      }
    });
  });
}

function sincronizarAvisosComContexto(ctx) {
  AVISOS_DINAMICOS = [];
  if (!ctx) { atualizarBadgeAvisos(); return; }

  const pendentes = Array.isArray(ctx.atualizacoes_pendentes) ? ctx.atualizacoes_pendentes : [];
  pendentes.forEach(a => {
    if (a.tipo === 'teste') {
      AVISOS_DINAMICOS.push({
        id: `atualizar-trilha-${a.payload?.teste_id || a.id}`,
        tag: 'SUA JORNADA',
        titulo: 'Seu novo perfil está pronto!',
        desc: 'Sua trilha pode ser atualizada com base no seu teste mais recente.',
        data: 'Agora',
        acao: { tipo: 'ativar-trilha', payload: a.payload?.teste_id || '', label: 'Atualizar minha trilha →' },
      });
    } else if (a.tipo === 'compra') {
      AVISOS_DINAMICOS.push({
        id: a.id,
        tag: 'NOVA AQUISIÇÃO',
        titulo: 'Novo conteúdo disponível!',
        desc: a.payload?.titulo || 'Um novo produto foi adicionado à sua conta.',
        data: 'Agora',
        acao: { tipo: 'celebrar-compra', payload: a.id, label: 'Ver minha jornada →' },
      });
    }
  });
  atualizarBadgeAvisos();
}

// ── CONTEXTO DO APP ──────────────────────────────────────────
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

// ── HIDRATAÇÃO DA HOME ───────────────────────────────────────
function hidratarHome(ctx) {
  if (!ctx) return;
  const elNome = document.getElementById('saudacao-nome');
  if (elNome) elNome.textContent = `Olá, ${ctx.aluna.primeiro_nome}`;
  const badge = document.getElementById('badge-sementes');
  if (badge) badge.textContent = ctx.aluna.sementes || 0;
  window.__vm_tem_clube = !!ctx.tem_clube;
  renderHeaderJornada(ctx);
  renderTrilhaJornada(ctx);
  renderBannerTesteEmAndamento(ctx);
  renderBannerAtualizarTrilha(ctx);
  renderBannerAtualizarPorCompra(ctx);
  sincronizarAvisosComContexto(ctx);
  renderMateriais(ctx);
}

// ── BARRA DE PROGRESSO DA JORNADA NO HEADER ─────────────────
function renderHeaderJornada(ctx) {
  const wrap = document.getElementById('topo-jornada');
  const iconeAtualEl = document.getElementById('topo-jornada-icone-atual');
  const iconeProxEl  = document.getElementById('topo-jornada-icone-prox');
  const fillEl = document.getElementById('topo-jornada-fill');
  if (!wrap || !iconeAtualEl || !iconeProxEl || !fillEl) return;
  const j = ctx.jornada_vigente || ctx.jornada_atual;
  if (!j) { wrap.classList.add('is-vazio'); return; }
  wrap.classList.remove('is-vazio');
  const num = j.numero || 1;
  const pct = Math.max(0, Math.min(100, Math.round(j.progresso_percentual || j.progresso || 0)));
  iconeAtualEl.textContent = num;
  iconeProxEl.textContent = num < 3 ? (num + 1) : '★';
  requestAnimationFrame(() => { fillEl.style.width = pct + '%'; });
  wrap.__jornada = j;
}

// ── MODAL JORNADA ────────────────────────────────────────────
function abrirModalJornada(j) {
  let ov = document.getElementById('vm-jornada-modal-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'vm-jornada-modal-overlay';
    ov.className = 'vm-jornada-modal-overlay is-no-overlay';
    ov.innerHTML = '\
      <div class="vm-jornada-modal" role="dialog" aria-modal="true">\
        <button type="button" class="vm-jornada-modal-fechar" aria-label="Fechar">\
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\
        </button>\
        <div class="vm-jornada-modal-eyebrow" id="vm-jornada-eyebrow"></div>\
        <h2 class="vm-jornada-modal-titulo" id="vm-jornada-titulo"></h2>\
        <div class="vm-jornada-modal-pct-wrap">\
          <div class="vm-jornada-modal-pct-bar"><div class="vm-jornada-modal-pct-fill" id="vm-jornada-pct-fill" style="width:0%"></div></div>\
          <span class="vm-jornada-modal-pct-num" id="vm-jornada-pct-num">0%</span>\
        </div>\
        <div class="vm-jornada-modal-passos" id="vm-jornada-passos"></div>\
      </div>';
    document.body.appendChild(ov);
    const fechar = () => { ov.classList.remove('visible'); document.body.style.overflow = ''; };
    ov.querySelector('.vm-jornada-modal-fechar').addEventListener('click', fechar);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
  }
  const num = j.numero || 1;
  const pct = Math.max(0, Math.min(100, Math.round(j.progresso_percentual || j.progresso || 0)));
  ov.querySelector('#vm-jornada-eyebrow').textContent = `JORNADA ${num}`;
  ov.querySelector('#vm-jornada-titulo').textContent  = j.nome || `Jornada ${num}`;
  ov.querySelector('#vm-jornada-pct-num').textContent = pct + '%';
  requestAnimationFrame(() => { ov.querySelector('#vm-jornada-pct-fill').style.width = pct + '%'; });
  const passosEl = ov.querySelector('#vm-jornada-passos');
  const passos = Array.isArray(j.passos) ? j.passos : [];
  let idxAtual = passos.findIndex(p => !p.concluido);
  if (idxAtual === -1) idxAtual = -2;
  passosEl.innerHTML = passos.map((p, i) => {
    let cls = '', status = '';
    if (p.concluido) { cls = 'concluido'; status = '✓ Concluído'; }
    else if (i === idxAtual) { cls = 'atual'; status = 'Você está aqui'; }
    else { status = 'Próximos passos'; }
    return `<div class="vm-jornada-modal-passo ${cls}">
      <div class="vm-jornada-modal-passo-num">${p.concluido ? '✓' : (p.ordem || (i+1))}</div>
      <div class="vm-jornada-modal-passo-info">
        <div class="vm-jornada-modal-passo-titulo">${p.titulo || `Passo ${i+1}`}</div>
        <div class="vm-jornada-modal-passo-status">${status}</div>
      </div>
    </div>`;
  }).join('');
  ov.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

// ── MODAL SEMENTES ───────────────────────────────────────────
function abrirModalSementes() {
  const saldo = (typeof usuario !== 'undefined' && usuario && usuario.sementes) ? Number(usuario.sementes) : 0;
  let ov = document.getElementById('vm-sementes-modal-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'vm-sementes-modal-overlay';
    ov.className = 'vm-sementes-modal-overlay';
    ov.innerHTML = '\
      <div class="vm-sementes-modal" role="dialog" aria-modal="true">\
        <button type="button" class="vm-sementes-modal-fechar" aria-label="Fechar">\
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\
        </button>\
        <div class="vm-sementes-saldo" id="vm-sementes-saldo">0</div>\
        <div class="vm-sementes-label">🌱 Sementes</div>\
        <div class="vm-sementes-trocas" id="vm-sementes-trocas"></div>\
        <p class="vm-sementes-info">Você coleta 1 semente por dia ao abrir o Tesouro da Su.<br>Acumule e troque por testes e assinaturas.</p>\
      </div>';
    document.body.appendChild(ov);
    const fechar = () => { ov.classList.remove('visible'); document.body.style.overflow = ''; };
    ov.querySelector('.vm-sementes-modal-fechar').addEventListener('click', fechar);
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
  }
  ov.querySelector('#vm-sementes-saldo').textContent = saldo;
  const trocasEl = ov.querySelector('#vm-sementes-trocas');
  const trocas = [
    { custo: 50,  titulo: 'Teste do Subconsciente', sub: 'Faça um teste sem custo' },
    { custo: 100, titulo: 'Clube Vida Mágica',      sub: 'Um mês de assinatura' },
  ];
  trocasEl.innerHTML = trocas.map(t => {
    const ok = saldo >= t.custo;
    return `<div class="vm-sementes-troca ${ok ? '' : 'bloqueada'}">
      <div class="vm-sementes-troca-custo">🌱 ${t.custo}</div>
      <div class="vm-sementes-troca-info">
        <div class="vm-sementes-troca-titulo">${t.titulo}</div>
        <div class="vm-sementes-troca-sub">${t.sub}</div>
      </div>
    </div>`;
  }).join('');
  ov.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

// ── TRILHA DA JORNADA ────────────────────────────────────────
function renderTrilhaJornada(ctx) {
  const section = document.querySelector('.trilha');
  if (!section) return;
  if (!ctx || !ctx.jornada_atual) return;

  const j = ctx.jornada_atual;
  const temClube = !!ctx.tem_clube;
  const passos = Array.isArray(j.passos) ? j.passos : [];
  const cor = '#C8922A';

  const cadeadoClubeHtml = !temClube ? `
    <button class="trilha-cadeado-clube" onclick="window.app && window.app.abrirModalClube && window.app.abrirModalClube()">
      <span class="trilha-cadeado-icon">🔒</span>
      <div class="trilha-cadeado-texto">
        <strong>Clube Vida Mágica</strong>
        <span>Desbloqueie sua jornada completa</span>
      </div>
    </button>` : '';

  const analiseHtml = j.analise
    ? `<div class="trilha-analise">${escHtml(j.analise)}</div>`
    : '';

  const passosHtml = passos.map((p, i) => {
    const concluido = !!p.comprado;
    const bloqueado = !concluido && !temClube && i > 0;
    const cls = concluido ? 'trilha-ativo' : bloqueado ? 'trilha-bloqueado' : 'trilha-ativo';
    const btnLabel = concluido ? 'Acessar novamente' : bloqueado ? '🔒 Acesse com o Clube' : 'Começar →';
    const btnDisabled = bloqueado ? 'disabled' : '';
    const btnOnclick = !bloqueado && !concluido
      ? `onclick="irPara('produtos')"`
      : concluido && p.link
        ? `onclick="window.open('${p.link}','_blank','noopener')"`
        : '';
    return `<li class="trilha-item ${cls}">
      <div class="trilha-num">${concluido ? '✓' : (i+1)}</div>
      <div class="trilha-card">
        <div class="trilha-eyebrow-card">${escHtml(p.eyebrow || 'Passo ' + (i+1))}</div>
        <h3 class="trilha-card-titulo">${escHtml(p.titulo || '')}</h3>
        ${p.descricao ? `<p class="trilha-card-desc">${escHtml(p.descricao)}</p>` : ''}
        ${p.meta ? `<div class="trilha-meta"><span>${escHtml(p.meta)}</span></div>` : ''}
        <button class="trilha-btn" ${btnDisabled} ${btnOnclick}>${btnLabel}</button>
      </div>
    </li>`;
  }).join('');

  section.innerHTML = `
    <div class="trilha-header">
      <span class="trilha-eyebrow">Jornada ${j.numero || 1}</span>
      <h2 class="trilha-titulo">${escHtml(j.nome_exibicao || j.nome || 'Sua trilha')}</h2>
      <div style="height:7px;background:rgba(245,240,232,0.08);border-radius:4px;overflow:hidden;margin:0.5rem 0">
        <div style="height:100%;background:linear-gradient(90deg,${cor},${cor}cc);width:${j.progresso?.percentual||0}%;transition:width 0.6s ease"></div>
      </div>
      ${cadeadoClubeHtml}
    </div>
    ${analiseHtml}
    <ol class="trilha-lista">${passosHtml}</ol>`;
}

// ── BANNERS ──────────────────────────────────────────────────
function renderBannerTesteEmAndamento(ctx) {
  const existing = document.getElementById('banner-teste-andamento');
  if (existing) existing.remove();
  if (!ctx || !ctx.teste_em_andamento) return;
  const t = ctx.teste_em_andamento;
  const banner = document.createElement('div');
  banner.id = 'banner-teste-andamento';
  banner.style.cssText = 'margin:0.85rem 1.25rem;padding:0.9rem 1.1rem;background:linear-gradient(135deg,rgba(248,220,150,0.18),rgba(255,250,240,0.85));border:1px solid rgba(200,146,42,0.35);border-radius:12px;display:flex;gap:0.85rem;align-items:center;';
  banner.innerHTML = `
    <span style="font-size:1.3rem;flex-shrink:0">📊</span>
    <div style="flex:1;min-width:0">
      <div style="font-family:var(--font-display,Montserrat);font-size:0.82rem;font-weight:700;color:var(--texto)">Teste em andamento</div>
      <div style="font-size:0.75rem;color:var(--texto-suave);margin-top:2px">${t.progresso_percentual||0}% concluído</div>
    </div>
    <a href="/teste" style="padding:0.45rem 0.85rem;background:linear-gradient(135deg,var(--ouro-fundo),var(--ouro));color:white;border-radius:8px;font-family:var(--font-display,Montserrat);font-size:0.72rem;font-weight:800;text-decoration:none;white-space:nowrap">Continuar →</a>`;
  const trilha = document.querySelector('.trilha');
  if (trilha) trilha.before(banner);
}

function renderBannerAtualizarTrilha(ctx) {
  const existing = document.getElementById('banner-atualizar-trilha-wrap');
  if (existing) existing.remove();
  if (!ctx || !Array.isArray(ctx.atualizacoes_pendentes)) return;
  const teste = ctx.atualizacoes_pendentes.find(a => a.tipo === 'teste');
  if (!teste) return;
  const banner = document.createElement('div');
  banner.id = 'banner-atualizar-trilha-wrap';
  banner.className = 'banner-atualizar-trilha';
  banner.innerHTML = `
    <div class="banner-atualizar-icone">✨</div>
    <div class="banner-atualizar-textos">
      <div class="banner-atualizar-titulo">Seu novo perfil está pronto pra atualizar sua jornada</div>
      <button class="banner-atualizar-btn" onclick="ativarTrilhaComSplash('${escHtml(String(teste.payload?.teste_id||''))}')">Atualizar minha trilha →</button>
    </div>`;
  const trilha = document.querySelector('.trilha');
  if (trilha) trilha.before(banner);
}

function renderBannerAtualizarPorCompra(ctx) {
  const existing = document.getElementById('banner-compra-wrap');
  if (existing) existing.remove();
}

// ── SPLASH JORNADA ───────────────────────────────────────────
function rodarSplashJornada({ contexto, jornadaInfo }) {
  return new Promise(resolve => {
    let splash = document.getElementById('jornada-splash');
    if (!splash) {
      splash = document.createElement('div');
      splash.id = 'jornada-splash';
      splash.className = 'jornada-splash';
      splash.innerHTML = `
        <div class="jornada-splash-particulas">${Array.from({length:21},(_,i)=>`<div class="js-particula js-p${i%7}"></div>`).join('')}</div>
        <div class="jornada-splash-conteudo">
          <div class="jornada-splash-icone">✨</div>
          <h2 class="jornada-splash-titulo" id="js-titulo">Criando sua jornada<span class="reticencias"><span>.</span><span>.</span><span>.</span></span></h2>
          <p class="jornada-splash-sub" id="js-sub">Estamos preparando tudo pra você.</p>
          <div class="jornada-splash-progresso" id="js-progresso">
            <div class="jornada-splash-prog-info">
              <span class="jornada-splash-prog-nome" id="js-prog-nome"></span>
              <span class="jornada-splash-prog-passos" id="js-prog-passos"></span>
            </div>
            <div class="jornada-splash-prog-bar"><div class="jornada-splash-prog-fill" id="js-prog-fill"></div></div>
            <div class="jornada-splash-prog-pct"><span class="pct-num" id="js-prog-num">0</span><span class="pct-sym">%</span></div>
          </div>
          <button class="jornada-splash-botao" id="js-botao" onclick="this.closest('.jornada-splash').classList.remove('fase-botao')">Concluir →</button>
        </div>`;
      document.body.appendChild(splash);
    }

    const titulo = contexto === 'atualizando' ? 'Atualizando sua jornada' : 'Criando sua jornada';
    splash.querySelector('#js-titulo').innerHTML = `${titulo}<span class="reticencias"><span>.</span><span>.</span><span>.</span></span>`;
    splash.querySelector('#js-sub').textContent = 'Estamos preparando tudo pra você.';
    splash.classList.remove('fase-transicao','fase-progresso','fase-botao');

    requestAnimationFrame(() => { splash.classList.add('visivel'); });

    setTimeout(() => {
      splash.classList.add('fase-transicao');
      setTimeout(() => {
        splash.querySelector('#js-titulo').innerHTML = `${contexto === 'atualizando' ? 'Jornada atualizada' : 'Jornada criada'} com sucesso ✓`;
        splash.querySelector('#js-sub').textContent = '';
        splash.classList.remove('fase-transicao');
        if (jornadaInfo) {
          splash.querySelector('#js-prog-nome').textContent = jornadaInfo.nome || '';
          splash.querySelector('#js-prog-passos').textContent = `${jornadaInfo.passos_concluidos}/${jornadaInfo.passos_total} passos`;
          splash.classList.add('fase-progresso');
          setTimeout(() => {
            const fill = splash.querySelector('#js-prog-fill');
            const num  = splash.querySelector('#js-prog-num');
            if (fill) fill.style.width = (jornadaInfo.percentual || 0) + '%';
            let c = 0; const alvo = jornadaInfo.percentual || 0;
            const iv = setInterval(() => { c = Math.min(c+2, alvo); if(num) num.textContent=c; if(c>=alvo) clearInterval(iv); }, 20);
          }, 100);
          setTimeout(() => {
            splash.classList.add('fase-botao');
            const btn = splash.querySelector('#js-botao');
            if (btn) {
              btn.onclick = () => {
                splash.classList.remove('visivel');
                setTimeout(() => { splash.remove(); resolve(); }, 400);
              };
            }
          }, 1800);
        } else {
          setTimeout(() => {
            splash.classList.remove('visivel');
            setTimeout(() => { splash.remove(); resolve(); }, 400);
          }, 1200);
        }
      }, 300);
    }, 1800);
  });
}

async function ativarTrilhaComSplash(testeId) {
  if (!testeId) return;
  if (!confirm('Atualizar sua trilha de conhecimento agora?\nEssa escolha não pode ser desfeita.')) return;
  try {
    const r = await fetch(`${API}/api/teste/${testeId}/ativar-trilha`, { method:'POST', headers: authHeader() });
    if (!r.ok) { const d=await r.json().catch(()=>{}); toast(d?.error||'Erro ao ativar trilha','err'); return; }
  } catch { toast('Erro de conexão','err'); return; }
  const novoCtx = await carregarContexto();
  await consumirAtualizacoesDoTeste(novoCtx, testeId);
  const jornadaInfo = montarJornadaInfoSplash(novoCtx);
  await rodarSplashJornada({ contexto: 'atualizando', jornadaInfo });
  if (novoCtx) hidratarHome(novoCtx);
}

async function dispararSplashAtualizacao(atualizacao, ctxAtual) {
  const contexto = (atualizacao.payload && atualizacao.payload.contexto) || 'atualizando';
  const jornadaInfo = montarJornadaInfoSplash(ctxAtual);
  await rodarSplashJornada({ contexto, jornadaInfo });
  try {
    await fetch(`${API}/api/app/atualizacoes/${encodeURIComponent(atualizacao.id)}/consumir`, { method:'POST', headers: authHeader() });
  } catch {}
  const novoCtx = await carregarContexto();
  if (novoCtx) hidratarHome(novoCtx);
}

async function consumirAtualizacoesDoTeste(ctx, testeId) {
  if (!ctx || !Array.isArray(ctx.atualizacoes_pendentes)) return;
  const alvos = ctx.atualizacoes_pendentes.filter(a => a.tipo==='teste' && a.payload?.teste_id===testeId);
  for (const a of alvos) {
    try { await fetch(`${API}/api/app/atualizacoes/${encodeURIComponent(a.id)}/consumir`, { method:'POST', headers: authHeader() }); } catch {}
  }
}

function montarJornadaInfoSplash(ctx) {
  if (!ctx || !ctx.jornada_atual) return null;
  const j = ctx.jornada_atual;
  const total = (j.passos || []).length;
  const concluidos = (j.passos || []).filter(p => p.comprado).length;
  const percentual = total > 0 ? Math.round((concluidos / total) * 100) : 0;
  return { nome: j.nome_exibicao || ('Jornada ' + (j.numero || '')), passos_total: total, passos_concluidos: concluidos, percentual };
}

// ── MATERIAIS ────────────────────────────────────────────────
function renderMateriais(ctx) {
  const wrap = document.getElementById('produtos-lista');
  if (!wrap) return;
  try { _renderMateriaisInterno(ctx, wrap); }
  catch (e) {
    console.error('[renderMateriais]', e);
    const outros = Array.isArray(ctx.outros_produtos) ? ctx.outros_produtos : [];
    if (outros.length === 0) return;
    wrap.innerHTML = outros.filter(p => !p.comprado).slice(0,3).map(p => `
      <div class="mat-card" style="margin-bottom:0.65rem">
        <div class="mat-card-eyebrow">PARA DESCOBRIR</div>
        <div class="mat-card-titulo">${escHtml(p.nome)}</div>
        <div class="mat-card-desc">${escHtml(p.descricao||'')}</div>
      </div>`).join('');
  }
}

function _renderMateriaisInterno(ctx, wrap) {
  const secoesHtml = [];

  // Teste em andamento
  if (ctx.teste_em_andamento) {
    const t = ctx.teste_em_andamento;
    secoesHtml.push(`
      <div class="mat-secao">
        <div class="mat-secao-titulo">Em andamento</div>
        <div class="mat-card mat-card-andamento" onclick="location.href='/teste'">
          <div class="mat-card-eyebrow mat-card-eyebrow-andamento">TESTE DO SUBCONSCIENTE</div>
          <div class="mat-card-titulo">Continuar onde parei</div>
          <div class="mat-card-desc">${t.progresso_percentual||0}% concluído — toque para continuar</div>
          <div class="mat-card-acoes">
            <a href="/teste" class="mat-card-btn">Continuar →</a>
            <button class="mat-card-btn-secundario" onclick="event.stopPropagation();window.app.apagarTesteEmAndamento(event)">Descartar</button>
          </div>
        </div>
      </div>`);
  }

  // Clube
  if (!ctx.tem_clube) {
    secoesHtml.push(`
      <div class="mat-secao">
        <div class="mat-secao-titulo">Em destaque</div>
        <div class="mat-card mat-card-destaque">
          <div class="mat-card-destaque-topo">
            <div class="mat-card-destaque-textos">
              <div class="mat-card-eyebrow">CLUBE VIDA MÁGICA</div>
              <div class="mat-card-titulo-grande">Desbloqueie sua jornada</div>
              <div class="mat-card-desc">Vídeos exclusivos, encontros ao vivo, acompanhamento personalizado e muito mais.</div>
            </div>
          </div>
          <button class="mat-card-btn" onclick="window.app && window.app.abrirModalClube && window.app.abrirModalClube()">Quero o Clube →</button>
        </div>
      </div>`);
  }

  // Teste (adquirido ou disponível)
  const temTeste = ctx.comprados?.some(p => p.tipo === 'teste');
  secoesHtml.push(`
    <div class="mat-secao">
      <div class="mat-secao-titulo">Teste do Subconsciente</div>
      <div class="mat-card">
        <div class="mat-card-eyebrow">DIAGNÓSTICO</div>
        <div class="mat-card-titulo">Teste de Prosperidade</div>
        <div class="mat-card-desc">Descubra em 15 perguntas o padrão mental que bloqueia sua prosperidade.</div>
        ${temTeste
          ? `<a href="/teste" class="mat-card-btn">Fazer o teste →</a>`
          : `<a href="${LINK_ASSINAR}" target="_blank" rel="noopener" class="mat-card-btn">Adquirir →</a>`}
      </div>
    </div>`);

  // Outros produtos
  const outros = Array.isArray(ctx.outros_produtos) ? ctx.outros_produtos.filter(p => !p.comprado) : [];
  if (outros.length) {
    secoesHtml.push(`
      <div class="mat-secao">
        <div class="mat-secao-titulo">Para descobrir</div>
        ${outros.map(p => `
          <div class="mat-card" style="margin-bottom:0.65rem">
            <div class="mat-card-h">
              ${p.capa_url ? `<img class="mat-capa" src="${escHtml(p.capa_url)}" alt="">` : '<div class="mat-capa-placeholder"></div>'}
              <div class="mat-card-h-textos">
                <div class="mat-card-eyebrow">${escHtml(p.categoria||'PRODUTO')}</div>
                <div class="mat-card-titulo">${escHtml(p.nome)}</div>
                <div class="mat-card-desc">${escHtml(p.descricao||'')}</div>
                ${p.link ? `<a href="${escHtml(p.link)}" target="_blank" rel="noopener" class="mat-card-btn" style="margin-top:0.55rem">Ver mais →</a>` : ''}
              </div>
            </div>
          </div>`).join('')}
      </div>`);
  }

  wrap.innerHTML = secoesHtml.join('');
}

// ── TESOURO ──────────────────────────────────────────────────
async function carregarTesouro() {
  try {
    const r = await fetch(`${API}/api/app/tesouro`, { headers: authHeader() });
    if (!r.ok) return;
    const d = await r.json();
    const btn  = document.getElementById('tesouro-btn');
    const label = document.getElementById('tesouro-label');
    const sub   = document.getElementById('tesouro-sub');
    if (!d.disponivel) {
      if (label) label.textContent = 'Tesouro da Su';
      if (sub)   sub.textContent   = `Próximo em ${d.proximo_em_horas||24}h`;
      if (btn)   btn.classList.remove('tem-novidade');
    } else {
      if (label) label.textContent = 'Tesouro disponível!';
      if (sub)   sub.textContent   = 'Toque para resgatar';
      if (btn)   btn.classList.add('tem-novidade');
    }
    document.getElementById('tesouro-btn')?.addEventListener('click', () => abrirTesouro(d));
  } catch {}
}

async function abrirTesouro(d) {
  if (!d.disponivel) return;
  const conteudo = document.getElementById('modal-tesouro-conteudo');
  const btnRes   = document.getElementById('modal-tesouro-resgatar');
  if (conteudo) conteudo.innerHTML = `
    <div style="text-align:center;padding:1rem 0 0.5rem">
      <div style="font-size:2.5rem;margin-bottom:0.75rem">${d.emoji||'✨'}</div>
      <h3 style="font-family:var(--font-display,Montserrat);font-size:1.1rem;font-weight:800;color:var(--texto);margin-bottom:0.5rem">${escHtml(d.titulo||'Tesouro da Su')}</h3>
      <p style="font-size:0.88rem;color:var(--texto-suave);line-height:1.6">${escHtml(d.texto||'')}</p>
    </div>`;
  if (btnRes) {
    btnRes.disabled = false;
    btnRes.textContent = '🌱 Resgatar Tesouro (+1 semente)';
    btnRes.onclick = async () => {
      btnRes.disabled = true;
      try {
        const r = await fetch(`${API}/api/app/tesouro/resgatar`, { method:'POST', headers: authHeader() });
        if (r.ok) {
          const rd = await r.json();
          toast(`+1 semente! Total: ${rd.sementes||0} 🌱`);
          fecharModal('modal-tesouro');
          const btn = document.getElementById('tesouro-btn');
          if (btn) btn.classList.remove('tem-novidade');
          const badge = document.getElementById('badge-sementes');
          if (badge) badge.textContent = rd.sementes||0;
        } else { toast('Já resgatado hoje','err'); fecharModal('modal-tesouro'); }
      } catch { toast('Erro ao resgatar','err'); }
    };
  }
  abrirModal('modal-tesouro');
}

// ── PERFIL ───────────────────────────────────────────────────
function renderPerfil() {
  if (!usuario) return;
  const planoEl = document.getElementById('perfil-plano');
  if (planoEl) planoEl.textContent = window.__vm_tem_clube ? 'Clube Vida Mágica' : 'Comunidade Vida Mágica';
}

// ── TESTES ───────────────────────────────────────────────────
async function carregarTestes() {
  const corpo = document.getElementById('testes-corpo');
  if (!corpo) return;
  corpo.innerHTML = '<div class="loading-inline">Carregando...</div>';
  try {
    const r = await fetch(`${API}/api/teste/historico`, { headers: authHeader() });
    if (!r.ok) { corpo.innerHTML = '<div class="loading-inline">Erro ao carregar.</div>'; return; }
    const testes = await r.json();
    if (!testes.length) { corpo.innerHTML = '<div class="loading-inline">Nenhum teste ainda.</div>'; return; }
    corpo.innerHTML = testes.map(t => `
      <div class="teste-card">
        <div class="teste-card-header">
          <div class="teste-card-eyebrow">TESTE DO SUBCONSCIENTE</div>
          <div class="teste-card-data">${new Date(t.criado_em).toLocaleDateString('pt-BR')}</div>
        </div>
        <div class="teste-card-corpo">
          <div class="teste-card-perfil">
            <div class="teste-card-perfil-label">Seu perfil</div>
            <div class="teste-card-perfil-nome">${escHtml(t.perfil_nome||'—')}</div>
          </div>
          ${t.percentual!=null ? `<div class="teste-card-pct"><span class="teste-card-pct-num">${t.percentual}</span><span class="teste-card-pct-sym">%</span></div>` : ''}
        </div>
        ${t.resultado_url
          ? `<a href="${escHtml(t.resultado_url)}" target="_blank" rel="noopener" class="teste-card-btn">Ver resultado →</a>`
          : `<div class="teste-card-locked">Aguardando liberação</div>`}
      </div>`).join('');
  } catch { corpo.innerHTML = '<div class="loading-inline">Erro ao carregar.</div>'; }
}

// ── CHAT ─────────────────────────────────────────────────────
function abrirTelaEscolhaChat() {
  const escolha   = document.getElementById('chat-escolha-tela');
  const conversa  = document.getElementById('chat-conversa-tela');
  if (escolha)  { escolha.style.display = ''; }
  if (conversa) { conversa.style.display = 'none'; }
  document.body.classList.remove('chat-aberto');
}

async function abrirCanal(canal) {
  canalAtivo = canal;
  const escolha  = document.getElementById('chat-escolha-tela');
  const conversa = document.getElementById('chat-conversa-tela');
  if (escolha)  escolha.style.display  = 'none';
  if (conversa) { conversa.style.display = 'flex'; conversa.style.flexDirection = 'column'; }
  document.body.classList.add('chat-aberto');

  const nomes = { suellen: 'Suellen Seragi', suporte: 'Suporte Vida Mágica' };
  const avatares = { suellen: '/assets/avatar-suellen.jpg', suporte: '/assets/logo-equipe.png' };
  document.getElementById('chat-canal-header-nome').textContent = nomes[canal]||canal;
  const img = document.getElementById('chat-canal-header-img');
  if (img) img.src = avatares[canal]||'';

  document.querySelectorAll('.chat-aba').forEach(b => b.classList.toggle('ativa', b.dataset.aba===canal));

  await carregarChat(canal);
}

async function carregarChat(canal) {
  const loading  = document.getElementById('chat-loading');
  const msgsEl   = document.getElementById('chat-msgs');
  const inputWrap = document.getElementById('chat-input-wrap');
  if (loading)   { loading.style.display=''; }
  if (msgsEl)    { msgsEl.style.display='none'; }
  if (inputWrap) { inputWrap.style.display='none'; }

  try {
    const r = await fetch(`${API}/api/chat/${canal}`, { headers: authHeader() });
    if (!r.ok) { toast('Erro ao carregar chat','err'); return; }
    const d = await r.json();
    chatConv = d.conversa;
    mensagensAtuais = d.mensagens || [];
    atualizarBannerPlano(chatConv);
    if (loading)   loading.style.display='none';
    if (msgsEl)    { msgsEl.style.display=''; msgsEl.classList.toggle('cheio', mensagensAtuais.length>10); }
    if (inputWrap) inputWrap.style.display='';
    renderMensagens(mensagensAtuais);
    scrollChat();
  } catch { toast('Erro de conexão','err'); }
}

function atualizarBannerPlano(conv) {
  const banner = document.getElementById('plano-banner');
  const titulo = document.getElementById('plano-banner-titulo');
  const desc   = document.getElementById('plano-banner-desc');
  const acao   = document.getElementById('plano-banner-acao');
  if (!banner || !conv) return;
  const plano = conv.plano_chat || 'free';
  banner.className = `plano-banner tier-${plano}`;
  if (plano === 'prioritario') {
    if (titulo) titulo.textContent = 'PRIORITÁRIO';
    if (desc)   desc.textContent   = `${conv.interacoes_restantes??'?'} interações restantes`;
    if (acao)   acao.style.display = 'none';
  } else if (plano === 'basic_vm') {
    if (titulo) titulo.textContent = 'CLUBE VIDA MÁGICA';
    if (desc)   desc.textContent   = 'Resposta em até 5 dias úteis';
    if (acao)   acao.style.display = 'none';
  } else {
    if (titulo) titulo.textContent = 'PLANO FREE';
    if (desc)   desc.textContent   = 'Tempo de resposta indeterminado';
    if (acao)   { acao.style.display=''; acao.onclick=()=>{ window.app&&window.app.abrirModalClube&&window.app.abrirModalClube(); }; }
  }
}

function renderMensagens(msgs) {
  const el = document.getElementById('chat-msgs');
  if (!el) return;
  el.innerHTML = '';
  let ultimaData = '';
  msgs.forEach(m => {
    const d = new Date(m.criado_em);
    const dataStr = d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long'});
    if (dataStr !== ultimaData) {
      ultimaData = dataStr;
      const sep = document.createElement('div');
      sep.className = 'msg-data-sep';
      sep.textContent = dataStr;
      el.appendChild(sep);
    }
    el.appendChild(criarBolha(m));
  });
}

function criarBolha(m) {
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${m.remetente==='aluna'?'aluna':'suellen'}`;
  wrap.dataset.id = m.id;

  let replyHtml = '';
  if (m.reply_to_id && m.reply_to_conteudo) {
    const autor = m.reply_to_remetente==='aluna' ? 'Você' : 'Suellen';
    replyHtml = `<div class="msg-reply-preview"><span class="reply-autor">${autor}</span><span class="reply-texto">${escHtml(m.reply_to_conteudo.substring(0,80))}</span></div>`;
  }

  let bolhaHtml = '';
  if (m.tipo==='audio' && m.url) {
    const identAttr = m.identidade ? `data-identidade="${m.identidade}" data-identidade-nome="${m.identidade==='equipe'?'Equipe Vida Mágica':'Suellen Seragi'}"` : '';
    bolhaHtml = `<div class="msg-audio-bolha" ${identAttr}>
      <button class="msg-audio-play-btn" onclick="reproduzirAudio(this,'${escHtml(m.url)}')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <svg class="msg-audio-wave" viewBox="0 0 80 28" preserveAspectRatio="none">${Array.from({length:20},(_,i)=>`<rect class="msg-audio-wave-bar" x="${i*4}" y="${14-Math.random()*10}" width="2" height="${Math.random()*20+4}" rx="1"/>`).join('')}</svg>
      <span class="msg-audio-dur">0:${String(Math.floor((m.duracao_segundos||0)%60)).padStart(2,'0')}</span>
    </div>`;
  } else if (m.tipo==='imagem' && m.url) {
    bolhaHtml = `<div class="msg-imagem"><img src="${escHtml(m.url)}" alt="imagem" loading="lazy"></div>`;
  } else {
    const so = m.conteudo||'';
    const isEmoji = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F|\u200D){1,3}$/u.test(so.trim()) && so.trim().length<=8;
    const identAttr = m.remetente!=='aluna' && m.identidade
      ? `data-identidade="${m.identidade}" data-identidade-nome="${m.identidade==='equipe'?'Equipe Vida Mágica':'Suellen Seragi'}"`
      : '';
    const linkified = so.replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');
    const ctaMatch = so.match(/\[CTA:([^\]]+)\]\(([^)]+)\)/);
    const ctaHtml  = ctaMatch ? `<a href="${escHtml(ctaMatch[2])}" target="_blank" rel="noopener" class="msg-cta-btn">${escHtml(ctaMatch[1])}</a>` : '';
    const textoLimpo = so.replace(/\[CTA:[^\]]+\]\([^)]+\)/g,'').trim();
    const bolhaClasses = ['msg-bolha', isEmoji?'msg-bolha-emoji':'', isEmoji&&so.trim().length<=2?'msg-bolha-emoji-big':isEmoji&&so.trim().length<=4?'msg-bolha-emoji-med':isEmoji?'msg-bolha-emoji-sm':''].filter(Boolean).join(' ');
    bolhaHtml = `<div class="${bolhaClasses}" ${identAttr}>${replyHtml}${textoLimpo?linkified.replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>'):''}${ctaHtml}</div>`;
  }

  const hora = new Date(m.criado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  let checksHtml = '';
  if (m.remetente==='aluna') {
    const cls = m.lida?'lida':m.entregue?'entregue':'enviada';
    checksHtml = `<span class="msg-checks ${cls}" data-msg-id="${m.id}"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/><polyline points="20 6 9 17 4 12" transform="translate(4,0)"/></svg></span>`;
  }

  const reacoesHtml = renderReacoesEl(m.reacoes)?.outerHTML||'';

  wrap.innerHTML = `${bolhaHtml}<div class="msg-footer"><span class="msg-hora">${hora}</span>${checksHtml}</div>${reacoesHtml}`;
  wrap.addEventListener('click', () => abrirCtxMenu(m, wrap));
  return wrap;
}

function renderReacoesEl(reacoes) {
  if (!reacoes || !Object.keys(reacoes).length) return null;
  const div = document.createElement('div');
  div.className = 'msg-reacoes';
  div.innerHTML = Object.entries(reacoes).map(([emoji,uids])=>
    `<span class="msg-reacao-chip">${emoji}<span class="cnt">${uids.length}</span></span>`
  ).join('');
  return div;
}

function scrollChat() {
  const el = document.getElementById('chat-msgs');
  if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

// ── CONTEXT MENU CHAT ────────────────────────────────────────
function abrirCtxMenu(msg, wrapEl) {
  ctxMsgAtual = msg;
  const menu = document.getElementById('msg-ctx-menu');
  if (!menu) return;
  menu.classList.add('visivel');
  const rect = wrapEl.getBoundingClientRect();
  const mh = 120;
  const top = rect.top - mh > 10 ? rect.top - mh : rect.bottom + 4;
  menu.style.top  = top + 'px';
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth-200)) + 'px';
  setTimeout(() => document.addEventListener('click', fecharCtxMenuHandler, {once:true}), 10);
}
function fecharCtxMenuHandler() { document.getElementById('msg-ctx-menu')?.classList.remove('visivel'); }

document.getElementById('ctx-responder')?.addEventListener('click', () => {
  if (!ctxMsgAtual) return;
  replyMsgAtual = ctxMsgAtual;
  const bar = document.getElementById('reply-bar');
  const autorEl = document.getElementById('reply-autor');
  const textoEl = document.getElementById('reply-texto');
  if (bar)    bar.classList.add('visivel');
  if (autorEl) autorEl.textContent = ctxMsgAtual.remetente==='aluna' ? 'Você' : 'Suellen';
  if (textoEl) textoEl.textContent = (ctxMsgAtual.conteudo||'').substring(0,80);
  document.getElementById('chat-input')?.focus();
});
document.getElementById('ctx-copiar')?.addEventListener('click', () => {
  if (ctxMsgAtual?.conteudo) navigator.clipboard?.writeText(ctxMsgAtual.conteudo).then(()=>toast('Copiado!'));
});
document.getElementById('reply-fechar')?.addEventListener('click', () => {
  replyMsgAtual = null;
  document.getElementById('reply-bar')?.classList.remove('visivel');
});

document.querySelectorAll('.msg-ctx-emoji').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!ctxMsgAtual) return;
    const emoji = btn.dataset.emoji;
    if (!emoji) return;
    try {
      await fetch(`${API}/api/chat/${canalAtivo}/mensagem/${ctxMsgAtual.id}/reagir`, {
        method:'POST', headers:{...authHeader(),'Content-Type':'application/json'}, body:JSON.stringify({emoji})
      });
    } catch {}
  });
});

// ── INPUT DE CHAT ────────────────────────────────────────────
const inputEl  = document.getElementById('chat-input');
const sendBtn  = document.getElementById('chat-send-btn');
const audioBtn = document.getElementById('chat-audio-btn');

inputEl?.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  sendBtn.style.display = inputEl.value.trim() ? '' : 'none';
  audioBtn.style.display = inputEl.value.trim() ? 'none' : '';
});
inputEl?.addEventListener('keydown', e => {
  if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); enviarMensagem(); }
});
sendBtn?.addEventListener('click', enviarMensagem);

async function enviarMensagem() {
  const texto = inputEl?.value.trim();
  if (!texto || !chatConv) return;
  inputEl.value=''; inputEl.style.height='auto';
  sendBtn.style.display='none'; audioBtn.style.display='';

  const tempId = 'tmp_' + Date.now();
  const msgTemp = { id:tempId, remetente:'aluna', tipo:'texto', conteudo:texto, criado_em:new Date().toISOString(), reply_to_id:replyMsgAtual?.id||null, reply_to_conteudo:replyMsgAtual?.conteudo||null, reply_to_remetente:replyMsgAtual?.remetente||null };
  mensagensAtuais.push(msgTemp);
  const el = document.getElementById('chat-msgs');
  if (el) { el.classList.add('cheio'); el.appendChild(criarBolha(msgTemp)); scrollChat(); }

  if (replyMsgAtual) { replyMsgAtual=null; document.getElementById('reply-bar')?.classList.remove('visivel'); }

  try {
    const r = await fetch(`${API}/api/chat/${canalAtivo}/mensagem`, {
      method:'POST',
      headers:{...authHeader(),'Content-Type':'application/json'},
      body:JSON.stringify({conteudo:texto, tipo:'texto', reply_to_id:msgTemp.reply_to_id})
    });
    if (r.ok) {
      const d = await r.json();
      if (d.mensagem) {
        const idx = mensagensAtuais.findIndex(m=>m.id===tempId);
        if (idx>=0) mensagensAtuais[idx]={...msgTemp,...d.mensagem};
        const wrapEl = document.querySelector(`.msg-wrap[data-id="${tempId}"]`);
        if (wrapEl) wrapEl.dataset.id=d.mensagem.id;
        const checkEl = document.querySelector(`.msg-checks[data-msg-id="${tempId}"]`);
        if (checkEl) {
          checkEl.dataset.msgId=d.mensagem.id;
          checkEl.classList.remove('enviada','entregue','lida');
          checkEl.classList.add(d.mensagem.lida?'lida':d.mensagem.entregue?'entregue':'enviada');
        }
      }
      if (d.conversa) { chatConv={...chatConv,...d.conversa}; atualizarBannerPlano(chatConv); }
    }
  } catch { toast('Erro ao enviar','err'); }
}

// ── GRAVAÇÃO DE ÁUDIO ────────────────────────────────────────
let mr=null, chunks=[], audCtx=null, analyser=null, animFrame=null, recTimer=null, recSeg=0, recMime='';
let permissaoMic = false;

function desenharOnda() {
  const canvas = document.getElementById('chat-rec-wave');
  if (!canvas||!analyser) return;
  const ctx2d = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth||160;
  const H = canvas.height;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);
  ctx2d.clearRect(0,0,W,H);
  ctx2d.beginPath();
  const step = W/buf.length;
  buf.forEach((v,i) => { const y=(v/128.0)*(H/2); i===0?ctx2d.moveTo(i*step,y):ctx2d.lineTo(i*step,y); });
  ctx2d.strokeStyle='rgba(200,146,42,0.8)'; ctx2d.lineWidth=1.5; ctx2d.stroke();
  animFrame=requestAnimationFrame(desenharOnda);
}

async function iniciarGravacao() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    permissaoMic = true;
    chunks=[];
    const tipos=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
    recMime = tipos.find(t=>MediaRecorder.isTypeSupported(t))||'';
    mr = new MediaRecorder(stream, recMime?{mimeType:recMime}:{});
    mr.ondataavailable = e => { if(e.data.size>0) chunks.push(e.data); };
    mr.start(100);
    audCtx = new AudioContext();
    analyser = audCtx.createAnalyser();
    audCtx.createMediaStreamSource(stream).connect(analyser);
    animFrame=requestAnimationFrame(desenharOnda);
    recSeg=0;
    document.getElementById('chat-rec-timer').textContent='0:00';
    recTimer=setInterval(()=>{ recSeg++; document.getElementById('chat-rec-timer').textContent=`${Math.floor(recSeg/60)}:${String(recSeg%60).padStart(2,'0')}`; },1000);
    document.getElementById('chat-input-row-normal').style.display='none';
    document.getElementById('chat-rec-row').style.display='';
  } catch { toast('Microfone bloqueado','err'); }
}

async function pararGravacao(enviar) {
  if (recTimer) { clearInterval(recTimer); recTimer=null; }
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame=null; }
  if (audCtx) { try { audCtx.close(); } catch {} audCtx=null; analyser=null; }
  document.getElementById('chat-input-row-normal').style.display='';
  document.getElementById('chat-rec-row').style.display='none';
  if (!mr) return;
  mr.stream.getTracks().forEach(t=>t.stop());
  if (!enviar) { mr.stop(); mr=null; chunks=[]; return; }
  await new Promise(res=>{ mr.onstop=res; mr.stop(); });
  mr=null;
  const blob = new Blob(chunks,{type:recMime||'audio/webm'});
  chunks=[];
  if (blob.size<1000) { toast('Áudio muito curto','err'); return; }
  const fd = new FormData();
  fd.append('audio', blob, `audio.${recMime.includes('ogg')?'ogg':recMime.includes('mp4')?'mp4':'webm'}`);
  fd.append('duracao_segundos', String(recSeg));
  if (replyMsgAtual) fd.append('reply_to_id', replyMsgAtual.id);

  const tempId='tmp_'+Date.now();
  const msgTemp={id:tempId,remetente:'aluna',tipo:'audio',url:'',duracao_segundos:recSeg,criado_em:new Date().toISOString()};
  mensagensAtuais.push(msgTemp);
  const el=document.getElementById('chat-msgs');
  if(el){el.classList.add('cheio');el.appendChild(criarBolha(msgTemp));scrollChat();}
  if(replyMsgAtual){replyMsgAtual=null;document.getElementById('reply-bar')?.classList.remove('visivel');}

  try {
    const r=await fetch(`${API}/api/chat/${canalAtivo}/audio`,{method:'POST',headers:authHeader(),body:fd});
    if(r.ok){
      const d=await r.json();
      if(d.mensagem){
        const idx=mensagensAtuais.findIndex(m=>m.id===tempId);
        if(idx>=0)mensagensAtuais[idx]={...msgTemp,...d.mensagem};
        const wrapEl=document.querySelector(`.msg-wrap[data-id="${tempId}"]`);
        if(wrapEl)wrapEl.dataset.id=d.mensagem.id;
        const checkEl=document.querySelector(`.msg-checks[data-msg-id="${tempId}"]`);
        if(checkEl){checkEl.dataset.msgId=d.mensagem.id;checkEl.classList.remove('enviada','entregue','lida');checkEl.classList.add(d.mensagem.lida?'lida':d.mensagem.entregue?'entregue':'enviada');}
      }
      if(d.conversa){chatConv={...chatConv,...d.conversa};atualizarBannerPlano(chatConv);}
    }
  } catch { toast('Erro ao enviar áudio','err'); }
}

audioBtn?.addEventListener('click', () => { if(permissaoMic) iniciarGravacao(); else abrirModal('modal-mic'); });
document.getElementById('modal-mic-ok')?.addEventListener('click', () => { fecharModal('modal-mic'); setTimeout(iniciarGravacao,150); });
document.getElementById('chat-rec-cancel')?.addEventListener('click', () => pararGravacao(false));
document.getElementById('chat-rec-send')?.addEventListener('click', () => pararGravacao(true));

// ── ANEXO (imagem) ───────────────────────────────────────────
document.getElementById('chat-anexo-btn')?.addEventListener('click', () => document.getElementById('chat-file-input')?.click());
document.getElementById('chat-file-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value='';
  const fd=new FormData(); fd.append('file',file);
  try {
    const r=await fetch(`${API}/api/upload`,{method:'POST',headers:authHeader(),body:fd});
    if(!r.ok){toast('Erro no upload','err');return;}
    const d=await r.json();
    const r2=await fetch(`${API}/api/chat/${canalAtivo}/mensagem`,{method:'POST',headers:{...authHeader(),'Content-Type':'application/json'},body:JSON.stringify({tipo:'imagem',url:d.url,conteudo:''})});
    if(r2.ok){const d2=await r2.json();if(d2.mensagem){mensagensAtuais.push(d2.mensagem);const el=document.getElementById('chat-msgs');if(el){el.appendChild(criarBolha(d2.mensagem));scrollChat();}}}
  } catch { toast('Erro ao enviar imagem','err'); }
});

// ── Tela de escolha + abas ───────────────────────────────────
document.querySelectorAll('.chat-canal-card').forEach(btn => { btn.addEventListener('click', () => abrirCanal(btn.dataset.canal)); });
document.querySelectorAll('.chat-aba').forEach(btn => { btn.addEventListener('click', () => abrirCanal(btn.dataset.aba)); });
document.getElementById('btn-back-escolha')?.addEventListener('click', abrirTelaEscolhaChat);

// ── CHAT WEBSOCKET ───────────────────────────────────────────
function conectarChatWs() {
  const access = VmSession.getAccess();
  if (!access) return;
  const wsUrl = (location.protocol==='https:'?'wss':'ws') + '://' + location.host + `/api/chat/ws?token=${access}`;
  chatWs = new WebSocket(wsUrl);
  chatWs.onmessage = async (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.evento==='nova_mensagem' || data.evento==='resposta_suellen') {
        const msg = data.mensagem;
        if (!msg) return;
        if (canalAtivo && chatConv && data.conversa_id===chatConv.id) {
          mensagensAtuais.push(msg);
          const el=document.getElementById('chat-msgs');
          if(el){el.classList.add('cheio');el.appendChild(criarBolha(msg));scrollChat();}
        } else {
          // badge
          const badge=document.getElementById('nav-chat-badge');
          if(badge) badge.style.display='';
          const canais=['suellen','suporte'];
          canais.forEach(c=>{
            const b=document.getElementById(`canal-${c}-badge`);
            if(b&&data.canal===c){b.style.display='';b.textContent=Number(b.textContent||0)+1;}
          });
        }
      }
      if (data.evento==='mensagens_lidas' && data.por==='suellen') {
        (data.ids||[]).forEach(id=>{
          const msg=mensagensAtuais.find(m=>m.id===id);
          if(msg){msg.lida=true;msg.entregue=true;}
          const checkEl=document.querySelector(`.msg-checks[data-msg-id="${id}"]`);
          if(checkEl){checkEl.classList.remove('enviada','entregue');checkEl.classList.add('lida');}
        });
      }
      if (data.evento==='reacao_atualizada') {
        if(canalAtivo&&chatConv&&data.conversa_id===chatConv.id){
          const msg=mensagensAtuais.find(m=>m.id===data.mensagem_id);
          if(msg) msg.reacoes=data.reacoes;
          const wrap=document.querySelector(`.msg-wrap[data-id="${data.mensagem_id}"]`);
          if(wrap){
            const antigo=wrap.querySelector('.msg-reacoes');
            if(antigo) antigo.remove();
            const novo=renderReacoesEl(data.reacoes);
            if(novo){const footer=wrap.querySelector('.msg-footer');if(footer)wrap.insertBefore(novo,footer);else wrap.appendChild(novo);}
          }
        }
      }
    } catch(err){ console.error('[WS]',err); }
  };
  chatWs.onclose = () => setTimeout(conectarChatWs, 4000);
}

// ── RESUMO DE CHATS ──────────────────────────────────────────
async function carregarResumoChats() {
  try {
    const r=await fetch(`${API}/api/chat/resumo`,{headers:authHeader()});
    if(!r.ok) return;
    const d=await r.json();
    const canais=['suellen','suporte'];
    let totalNaoLidas=0;
    canais.forEach(c=>{
      const conv=d[c];
      const badge=document.getElementById(`canal-${c}-badge`);
      const preview=document.getElementById(`canal-${c}-preview`);
      const abaBadge=document.getElementById(`aba-${c}-badge`);
      if(conv){
        const nl=conv.nao_lidas_aluna||0;
        totalNaoLidas+=nl;
        if(badge){ badge.style.display=nl>0?'':'none'; badge.textContent=nl; }
        if(abaBadge){ abaBadge.style.display=nl>0?'':'none'; abaBadge.textContent=nl; }
        if(preview&&conv.ultima_preview) preview.textContent=conv.ultima_preview.substring(0,60);
      }
    });
    const navBadge=document.getElementById('nav-chat-badge');
    if(navBadge) navBadge.style.display=totalNaoLidas>0?'':'none';
  } catch {}
}

// ── REFRESH MANUAL ───────────────────────────────────────────
document.getElementById('btn-chat-refresh')?.addEventListener('click', async () => {
  const btn=document.getElementById('btn-chat-refresh');
  if(btn) btn.classList.add('atualizando');
  if(canalAtivo) await carregarChat(canalAtivo);
  if(btn) btn.classList.remove('atualizando');
});

// ── PULL-TO-REFRESH ──────────────────────────────────────────
(function setupPullRefresh() {
  const msgsEl=document.getElementById('chat-msgs');
  if(!msgsEl) return;
  let startY=0, pulling=false, armado=false;
  const indicator=document.createElement('div');
  indicator.className='chat-pull-indicator';
  indicator.innerHTML='<div class="chat-pull-indicator-circle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg></div>';
  msgsEl.before(indicator);
  msgsEl.addEventListener('touchstart',e=>{if(msgsEl.scrollTop===0){startY=e.touches[0].clientY;pulling=true;armado=false;}},{passive:true});
  msgsEl.addEventListener('touchmove',e=>{if(!pulling)return;const dy=e.touches[0].clientY-startY;if(dy>10){indicator.classList.add('puxando');if(dy>60&&!armado){armado=true;indicator.classList.replace('puxando','armado');}}},{passive:true});
  msgsEl.addEventListener('touchend',async()=>{if(!pulling)return;pulling=false;if(armado){indicator.classList.replace('armado','atualizando');if(canalAtivo)await carregarChat(canalAtivo);indicator.className='chat-pull-indicator';}else{indicator.className='chat-pull-indicator';}armado=false;});
})();

// ── REPRODUZIR ÁUDIO ─────────────────────────────────────────
let audioAtual=null;
function reproduzirAudio(btn, url) {
  if(audioAtual&&!audioAtual.paused){audioAtual.pause();audioAtual=null;btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>';return;}
  const audio=new Audio(url);
  audioAtual=audio;
  audio.play().catch(()=>{});
  btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  audio.onended=()=>{btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>';audioAtual=null;};
}

// ── VISUAL VIEWPORT ──────────────────────────────────────────
function setupVisualViewport() {
  if(!window.visualViewport) return;
  const vv=window.visualViewport;
  const update=()=>{
    const offset=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);
    document.documentElement.style.setProperty('--kbd-offset',offset+'px');
    if(offset>80){document.body.classList.add('teclado-aberto');setTimeout(scrollChat,200);}
    else{document.body.classList.remove('teclado-aberto');}
  };
  vv.addEventListener('resize',update);
  vv.addEventListener('scroll',update);
}

// ── window.app ───────────────────────────────────────────────
window.app = {
  apagarTesteEmAndamento(ev) {
    if(ev&&typeof ev.stopPropagation==='function') ev.stopPropagation();
    if(!confirm('Apagar suas respostas? Não pode desfazer.')) return;
    fetch(`${API}/api/teste/em-andamento`,{method:'DELETE',headers:authHeader()})
      .then(r=>{if(!r.ok)throw new Error();return r.json().catch(()=>({}));})
      .then(()=>{carregarContexto().then(c=>{if(c)hidratarHome(c);});})
      .catch(()=>{alert('Não consegui apagar agora. Tente de novo daqui a pouco.');});
  },
  async ativarTrilhaDoCard(testeId) {
    if(!testeId) return;
    await ativarTrilhaComSplash(testeId);
  },
  abrirModalClube() {
    let overlay=document.getElementById('vm-clube-modal-overlay');
    if(!overlay){
      overlay=document.createElement('div');
      overlay.id='vm-clube-modal-overlay';
      overlay.className='vm-clube-modal-overlay';
      overlay.innerHTML='\
        <div class="vm-clube-modal" role="dialog" aria-modal="true">\
          <button type="button" class="vm-clube-fechar" aria-label="Fechar">\
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\
          </button>\
          <div class="vm-clube-header">\
            <div class="vm-clube-eyebrow">CLUBE VIDA MÁGICA</div>\
            <h2 class="vm-clube-titulo">Desperte sua prosperidade</h2>\
            <p class="vm-clube-sub">Uma experiência guiada.</p>\
          </div>\
          <div class="vm-clube-beneficios">\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">✨</span><div><strong>Conteúdo exclusivo semanal</strong><span>1 vídeo novo por semana — técnicas práticas que não estão em lugar nenhum</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">🎥</span><div><strong>Encontro mensal ao vivo</strong><span>1 live por mês — troca direta com a Su e o Rê</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">💬</span><div><strong>Grupo de WhatsApp</strong><span>Comunidade ativa — pessoas reais vencendo problemas reais</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">💛</span><div><strong>Tesouros da Su</strong><span>Direcionamentos, insights e lembretes no momento certo</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">🌱</span><div><strong>Sementes de desconto</strong><span>Desconto exclusivo em todos os materiais Vida Mágica</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">🗺️</span><div><strong>Acompanhamento da jornada</strong><span>Animações de avanço, feed personalizado, notificações ativas</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">⚡</span><div><strong>Chat com resposta em até 5 dias</strong><span>Suporte direto comigo neste app</span></div></div>\
          </div>\
          <a href="https://www.vidamagica.com.br/assinar" target="_blank" rel="noopener" class="vm-clube-cta">Quero o Clube Vida Mágica</a>\
          <button type="button" class="vm-clube-depois">Agora não</button>\
        </div>';
      document.body.appendChild(overlay);
      const fechar=()=>{overlay.classList.remove('visible');document.body.style.overflow='';};
      overlay.querySelector('.vm-clube-fechar').addEventListener('click',fechar);
      overlay.querySelector('.vm-clube-depois').addEventListener('click',fechar);
      overlay.addEventListener('click',(e)=>{if(e.target===overlay)fechar();});
    }
    overlay.classList.add('visible');
    document.body.style.overflow='hidden';
  },
};

// ── INIT ─────────────────────────────────────────────────────
(async function init() {
  criarParticulas();
  criarSprites();
  atualizarBadgeAvisos();
  setupVisualViewport();

  usuario = await checarAuth();
  if (!usuario) return;

  hidratarUI(usuario);

  const ctx = await carregarContexto();
  if (ctx) hidratarHome(ctx);

  carregarFeed();
  carregarTesouro();
  conectarChatWs();
  carregarResumoChats();
  setInterval(carregarResumoChats, 30000);
})();
