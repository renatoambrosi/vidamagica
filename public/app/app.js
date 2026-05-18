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
      if (!refresh) { try{limparCooldownPopupClube();}catch{} VmSession.destruir(); window.location.replace('/auth?intencional'); return null; }
      const r2 = await fetch(`${API}/api/auth/renovar`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ refresh_token: refresh }) });
      if (r2.ok) {
        const d = await r2.json();
        VmSession.salvar(d, VmSession.getLembrar());
        const r3 = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${d.access_token}` } });
        if (r3.ok) return await r3.json();
      }
      try{limparCooldownPopupClube();}catch{} VmSession.destruir(); window.location.replace('/auth?intencional'); return null;
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
// Os "brilhos que sobem na tela" — marca registrada do app, mesmo padrão
// do index.html e admin.html (.particle com keyframe float lá; aqui .particula
// com keyframe flutua, equivalente).
//
// PADRÃO BASE (todo mundo): 22 partículas douradas saturadas, médias, com
// glow dourado. Cria a vibe mágica do app desde o cadastro.
//
// PADRÃO PLUS (assinante Vida Mágica): +24 partículas adicionais ainda
// maiores e com glow mais intenso, fazendo o efeito de "chuva de ouro".
// O CSS também aumenta brilho/saturação das base. Aparecem quando
// body.clube-ativo é adicionado.
function criarParticulas() {
  const c = document.getElementById('particulas');
  if (!c) return;

  // 22 partículas BASE — pra todos. Douradas saturadas, 4-10px, com glow.
  for (let i = 0; i < 22; i++) {
    const p = document.createElement('div');
    p.className = 'particula';
    const t = Math.random() * 6 + 4;  // 4-10px
    const dourado = 'rgba(244,208,96,0.95)';
    const douradoFade = 'rgba(244,208,96,0)';
    p.style.cssText = `width:${t}px;height:${t}px;left:${Math.random()*100}%;background:radial-gradient(circle,${dourado} 0%,${douradoFade} 70%);box-shadow:0 0 ${t*2}px rgba(244,208,96,0.6),0 0 ${t*4}px rgba(244,208,96,0.25);animation-duration:${Math.random()*18+12}s;animation-delay:${Math.random()*20}s;`;
    c.appendChild(p);
  }

  // 24 partículas PLUS — SÓ pro assinante (controlado por body.clube-ativo).
  // Maiores (6-14px) e com glow muito mais amplo. Algumas em ouro claro
  // pra dar variação luminosa elegante.
  for (let i = 0; i < 24; i++) {
    const p = document.createElement('div');
    p.className = 'particula particula-plus';
    const t = Math.random() * 8 + 6;  // 6-14px (bem maiores)
    // 2 tons de ouro pra dar profundidade:
    // - ouro brilhante (F4D060) → cor principal da marca
    // - champagne (F8DC96) → ouro pálido, mais luminoso
    const ehChampagne = Math.random() > 0.5;
    const cor = ehChampagne ? 'rgba(248,220,150,1)' : 'rgba(244,208,96,1)';
    const corFade = ehChampagne ? 'rgba(248,220,150,0)' : 'rgba(244,208,96,0)';
    const glowCor = ehChampagne ? 'rgba(248,220,150,0.75)' : 'rgba(244,208,96,0.75)';
    p.style.cssText = `width:${t}px;height:${t}px;left:${Math.random()*100}%;background:radial-gradient(circle,${cor} 0%,${corFade} 70%);box-shadow:0 0 ${t*3}px ${glowCor},0 0 ${t*6}px rgba(244,208,96,0.35);animation-duration:${Math.random()*14+10}s;animation-delay:${Math.random()*16}s;`;
    c.appendChild(p);
  }
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

  // Persiste a view atual em sessionStorage. Se a aluna der pull-to-refresh
  // (ou recarregar de qualquer outro jeito), o init() vai restaurar essa
  // view em vez de cair sempre na Home. Exceção: chat → cai pra antessala,
  // que é o comportamento mais natural após reload (não recarrega conversa).
  try {
    const viewSalvar = (viewId === 'chat') ? 'fale-com-a-su' : viewId;
    sessionStorage.setItem('vm_view_atual', viewSalvar);
  } catch {}

  // body.chat-aberto ativa as regras especiais SÓ na conversa real do chat.
  // A "antessala" (#view-fale-com-a-su) é uma view normal e NÃO ativa essa
  // classe — comporta-se exatamente como Home/Materiais/Perfil.
  if (viewId === 'chat') {
    document.body.classList.add('chat-aberto');
    // Na conversa, mantém o botão "Fale com a Su" da bottom-nav destacado
    // (ele que disparou a entrada nesse fluxo).
    document.querySelector('.nav-tab[data-view="fale-com-a-su"]')?.classList.add('active');
  } else {
    document.body.classList.remove('chat-aberto');
    document.getElementById('chat-input')?.blur();
  }

  // Liga a class `antessala-ativa` no body só quando está nessa view.
  // Usada no CSS pra anular paddings do .views e travar scroll, fazendo
  // a min-height: 100vh da .chat-escolha centralizar EM 100vh real.
  document.body.classList.toggle('antessala-ativa', viewId === 'fale-com-a-su');

  if (viewId === 'fale-com-a-su') {
    canalAtivo = null;
    carregarResumoChats();
  }

  if (viewId === 'perfil') renderPerfil();
  if (viewId === 'bau') renderBau();
  if (viewId === 'meus-relatos') renderMeusRelatos();
  if (viewId === 'videos') {
    // Renderiza a grade Netflix passando o contexto atual (pra saber se é assinante)
    renderViewVideos(window._ctxAtual || null);
  }
}
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => irPara(tab.dataset.view));
});
document.querySelector('.nav-tab[data-view="fale-com-a-su"]')?.addEventListener('click', () => {
  document.getElementById('nav-chat-badge').style.display = 'none';
});

// Botão "voltar" da view-videos → volta pra Home
document.getElementById('videos-voltar')?.addEventListener('click', () => irPara('home'));

// Botão "Quero assinar" do modal exclusivo → abre o modal de Clube Vida Mágica
document.getElementById('modal-exclusivo-assinar')?.addEventListener('click', () => {
  fecharModal('modal-exclusivo');
  // Pequeno delay pro fechamento ficar suave antes do próximo modal
  setTimeout(() => { window.app?.abrirModalClube?.(); }, 200);
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
document.getElementById('btn-sementes')?.addEventListener('click', () => irPara('perfil'));
document.getElementById('menu-testes')?.addEventListener('click',  () => { carregarTestes(); abrirModal('modal-testes'); });
document.getElementById('menu-logout')?.addEventListener('click',  async () => {
  const refresh = VmSession.getRefresh();
  try { await fetch(`${API}/api/auth/logout`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({refresh_token:refresh}) }); } catch {}
  try { limparCooldownPopupClube(); } catch {}
  VmSession.destruir();
  window.location.replace('/');
});

// ── PLAYER ───────────────────────────────────────────────────
// Embed usado pelo modal-player (aberto via "Assista mais vídeos").
// Sem `enablejsapi&origin` pra não disparar erro 153 do YouTube.
function embedDeUrl(url) {
  if (!url) return '';
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&fs=1`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}?autoplay=1&title=0&byline=0&portrait=0&badge=0&autopause=0`;
  return url;
}
function thumbDeUrl(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/mqdefault.jpg`;
  return null;
}

// Cache de thumbs do Vimeo (oEmbed retorna por fetch — evita refazer toda vez)
const _vimeoThumbCache = {};
// Busca a thumbnail do Vimeo via API oficial oEmbed.
// Retorna null se a URL não é Vimeo, se o fetch falhar, ou se o vídeo
// não está acessível (privado/erro).
async function thumbVimeoDeUrl(url) {
  if (!url) return null;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (!vm) return null;
  const id = vm[1];
  if (_vimeoThumbCache[id] !== undefined) return _vimeoThumbCache[id];
  try {
    const r = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${id}`);
    if (!r.ok) { _vimeoThumbCache[id] = null; return null; }
    const data = await r.json();
    // thumbnail_url_with_play é versão com play overlay; preferimos sem,
    // porque o nosso overlay desenha o botão por cima.
    const thumb = data.thumbnail_url || null;
    _vimeoThumbCache[id] = thumb;
    return thumb;
  } catch {
    _vimeoThumbCache[id] = null;
    return null;
  }
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

// Cache local dos itens do feed (evita refazer fetch quando troca pra view-videos)
let _feedItensCache = null;
async function obterFeedItens() {
  if (_feedItensCache) return _feedItensCache;
  try {
    const r = await fetch(`${API}/api/feed`);
    if (!r.ok) return [];
    _feedItensCache = await r.json();
    return _feedItensCache;
  } catch { return []; }
}
function invalidarFeedCache() { _feedItensCache = null; }

// Embed do YouTube com proteção máxima possível (esconde controles de
// compartilhar/abrir no YouTube, sugestões, anotações). Vídeo deve ser
// configurado como "não listado" no painel do YouTube pra blindar de busca.
//
// Importante: NÃO usamos `enablejsapi=1&origin=...` porque o YouTube valida
// o domínio do origin e qualquer divergência (subdomínio, https vs http,
// proxy) dispara erros tipo 150/153. Também usamos `youtube.com` direto
// (não `youtube-nocookie.com`), porque o nocookie é mais restritivo e
// alguns vídeos não tocam nele.
function embedProtegidoDeUrl(url) {
  if (!url) return '';
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) {
    // autoplay=1       → toca automaticamente quando o iframe aparece
    // rel=0            → não sugere vídeos de outros canais ao terminar
    // modestbranding=1 → esconde logo do YouTube no canto
    // iv_load_policy=3 → desliga anotações antigas
    // playsinline=1    → não força tela cheia no iPhone
    // fs=1             → mantém botão fullscreen (pra TV/casting)
    return `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&fs=1`;
  }
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) {
    // Vimeo embed limpo: esconde título, byline e foto do autor.
    return `https://player.vimeo.com/video/${vm[1]}?autoplay=1&title=0&byline=0&portrait=0&badge=0&autopause=0`;
  }
  return url;
}

// ── PLAYER DO TOPO (vídeo ou imagem) ─────────────────────────
// Renderiza o item destaque do feed dentro de #player-topo.
// Não-assinante → cadeado dourado. Click abre modal-exclusivo.
// Assinante     → botão de play. Click carrega iframe com proteção.
async function carregarPlayerTopo(ctx) {
  const el = document.getElementById('player-topo');
  if (!el) return;

  const itens = await obterFeedItens();
  const destaque = itens.find(i => i.destaque && i.ativo);
  if (!destaque) { el.innerHTML = ''; return; }

  const ehAssinante = !!ctx?.tem_clube;
  const isVideo  = destaque.tipo === 'video';
  const isImagem = destaque.tipo === 'imagem';
  // Prioridade: imagem cadastrada manualmente no admin > thumb auto (YT/Vimeo)
  let thumb = destaque.imagem_url || thumbDeUrl(destaque.url) || '';
  // Vimeo: thumb vem por fetch oEmbed (assíncrono). Se a admin não cadastrou
  // imagem_url manualmente, buscamos automaticamente.
  if (!thumb && destaque.url && /vimeo\.com\/\d+/.test(destaque.url)) {
    thumb = (await thumbVimeoDeUrl(destaque.url)) || '';
  }

  // Imagem pura: sem play/cadeado, só a imagem (sem overlay).
  if (isImagem) {
    el.innerHTML = thumb
      ? `<img class="player-topo-thumb" src="${thumb}" alt="${escHtml(destaque.titulo||'')}" loading="lazy">`
      : '';
    return;
  }

  // Vídeo: mostra thumb + botão central (play se assinante, cadeado se não)
  const btnConteudo = ehAssinante
    ? `<div class="player-topo-btn player-topo-btn-play" aria-label="Assistir">
         <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
       </div>`
    : `<div class="player-topo-btn player-topo-btn-cadeado" aria-label="Conteúdo exclusivo">
         <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
       </div>`;

  el.innerHTML = `
    ${thumb ? `<img class="player-topo-thumb" src="${thumb}" alt="${escHtml(destaque.titulo||'')}" loading="lazy">` : ''}
    <button type="button" class="player-topo-overlay" aria-label="${ehAssinante?'Assistir vídeo':'Conteúdo exclusivo'}">
      ${btnConteudo}
    </button>
  `;

  const overlay = el.querySelector('.player-topo-overlay');
  overlay?.addEventListener('click', () => {
    if (!ehAssinante) { abrirModal('modal-exclusivo'); return; }
    if (!destaque.url) return;
    // Carrega iframe inline e esconde o overlay.
    // Os divs ".player-topo-bloqueio-*" cobrem os cantos onde o YouTube
    // mostra "Compartilhar" (inferior esquerdo) e "Assistir no YouTube"
    // (inferior direito). Como o iframe é cross-origin, não dá pra esconder
    // esses botões via CSS interno — cobrimos por cima e capturamos o
    // clique antes de chegar no iframe.
    const iframeWrap = document.createElement('div');
    iframeWrap.className = 'player-topo-iframe-wrap';
    iframeWrap.innerHTML = `
      <iframe src="${embedProtegidoDeUrl(destaque.url)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
      <div class="player-topo-bloqueio-tl" aria-hidden="true"></div>
      <div class="player-topo-bloqueio-tr" aria-hidden="true"></div>
      <div class="player-topo-bloqueio-bl" aria-hidden="true"></div>
      <div class="player-topo-bloqueio-br" aria-hidden="true"></div>
    `;
    el.appendChild(iframeWrap);
    el.classList.add('tocando');
    // Bloqueia clique direito (long-press no mobile) sobre o player todo —
    // dificulta a aluna copiar o link do vídeo via menu de contexto.
    el.addEventListener('contextmenu', e => e.preventDefault());
  });
}

// ── BOTOEIRA (faixa abaixo do player) ────────────────────────
function renderBotoeira() {
  const el = document.getElementById('botoeira');
  if (!el) return;
  el.innerHTML = `
    <button type="button" class="botoeira-btn-videos" id="botoeira-ir-videos">
      <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Assista mais vídeos
    </button>
    <button type="button" class="botoeira-btn-info" id="botoeira-info" aria-label="Mais informações">i</button>
  `;
  document.getElementById('botoeira-ir-videos')?.addEventListener('click', () => irPara('videos'));
  document.getElementById('botoeira-info')?.addEventListener('click', () => abrirModal('modal-info-videos'));
}

// ── GÊNERO PELO NOME ────────────────────────────────────────
// Heurística leve pra decidir 'do' / 'da' / 'do(a)' antes do nome da aluna.
// Não há campo de gênero no perfil — inferimos pelo primeiro nome. Universo
// real é >99% feminino (alunas), mas mantemos a cortesia 'do(a)' em ambíguos
// e a possibilidade de 'do' em casos masculinos (admin, dependente, etc).
//
// Regras (todas case-insensitive sobre o primeiro nome sem acentos):
// 1. Termina em 'a' → 'da'           (Maria, Ana, Patrícia, Tainá, Naomi-NÃO)
// 2. Termina em 'en'/'lyn'/'lin' → 'da' (Suellen, Ellen, Karen, Carolin)
// 3. Termina em 'ce'/'ês'/'eth' → 'da' (Alice, Inês, Beth)
// 4. Termina em 'o','or','os','on','son','us','im' → 'do' (Renato, Heitor, Joaquim)
// 5. Lista explícita de ambíguos → 'do(a)' (Alex, Sam, Lee, Cris)
// 6. Default → 'do(a)'
function generoArtigoPorNome(nome) {
  if (!nome || typeof nome !== 'string') return 'do(a)';
  const n = nome.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // remove acentos
  if (!n) return 'do(a)';

  const ambiguos = new Set(['alex', 'sam', 'lee', 'cris', 'andrea']);
  if (ambiguos.has(n)) return 'do(a)';

  if (/(en|lyn|lin)$/.test(n)) return 'da';            // Suellen, Ellen, Karen, Carolin
  if (/(ce|es|eth)$/.test(n))  return 'da';            // Alice, Inês (sem acento → ines), Beth
  if (n.endsWith('a'))         return 'da';            // Maria, Ana, Patrícia
  if (/(son|im|us|os|on|or)$/.test(n)) return 'do';    // Anderson, Joaquim, Carlos, Heitor
  if (/[o]$/.test(n))          return 'do';            // Renato, Paulo

  return 'do(a)';
}

// ── SAUDAÇÃO + BARRA DE JORNADA (view-jornada) ──────────────
// Renderiza dentro de view-jornada:
//   - view-sub (#jornada-saudacao-sub) → "Jornada do/da/do(a) NOME"
//   - barra com número, nome, subtítulo, passos e %
// O bloco saudacao-jornada antes ficava no view-home — moveu junto com a
// trilha. A Home agora não tem mais saudação própria (era acoplada à barra).
function renderSaudacaoJornada(ctx) {
  const primeiroNome = ctx?.aluna?.primeiro_nome || '';
  const nomeJornadaVigente = ctx?.jornada_vigente?.nome || '';

  // Atualiza a view-sub "Jornada de NOME — NOME_DA_JORNADA" no topo do view-jornada
  const subEl = document.getElementById('jornada-saudacao-sub');
  if (subEl) {
    if (primeiroNome && nomeJornadaVigente) {
      subEl.textContent = `Jornada de ${primeiroNome} — ${nomeJornadaVigente}`;
    } else if (primeiroNome) {
      subEl.textContent = `Jornada de ${primeiroNome}`;
    } else {
      subEl.textContent = 'Sua jornada';
    }
  }

  const el = document.getElementById('saudacao-jornada');
  if (!el) return;

  // Pega a jornada (prefere vigente, cai pra atual). Pode ser null.
  const vigente = ctx?.jornada_vigente;
  let nomeJornada = '', numeroJornada = '', subtitulo = '', concluidos = 0, totais = 0, percentual = 0;
  if (vigente) {
    nomeJornada = vigente.nome || '';
    numeroJornada = vigente.numero ? `Jornada ${vigente.numero}` : '';
    concluidos = (vigente.passos || []).filter(p => p.concluido).length;
    totais = (vigente.passos || []).length;
    percentual = Math.round(vigente.progresso_percentual || 0);
  } else if (ctx?.jornada_atual) {
    const j = ctx.jornada_atual;
    nomeJornada = j.nome_exibicao || '';
    numeroJornada = j.numero ? `Jornada ${j.numero}` : '';
    subtitulo = j.subtitulo || '';
    concluidos = j.progresso?.passos_concluidos || 0;
    totais = j.progresso?.passos_totais || 0;
    percentual = j.progresso?.percentual || 0;
  }

  const barraHtml = (totais > 0) ? `
    <div class="saudacao-jornada-barra">
      <div class="saudacao-jornada-barra-topo">
        <div>
          ${numeroJornada ? `<div class="saudacao-jornada-numero">${escHtml(numeroJornada)}</div>` : ''}
          <div class="saudacao-jornada-nome">${escHtml(nomeJornada)}</div>
          ${subtitulo ? `<div class="saudacao-jornada-sub">${escHtml(subtitulo)}</div>` : ''}
        </div>
        <div class="saudacao-jornada-passos">
          <div class="saudacao-jornada-passos-num">${concluidos}/${totais}</div>
          <div class="saudacao-jornada-passos-pct">${percentual}%</div>
        </div>
      </div>
      <div class="saudacao-jornada-bar-track">
        <div class="saudacao-jornada-bar-fill" style="width:${percentual}%"></div>
      </div>
    </div>
  ` : '';

  el.innerHTML = barraHtml;
}

// ── POP-UP CONVITE CLUBE VIDA MÁGICA ─────────────────────────
// Flutua logo abaixo do header, sobre o player do topo, convidando a aluna
// a assinar. Só pra NÃO-assinante (ctx.tem_clube === false). Tem botão
// fechar (X) — quando fecha, fica oculto por 12h (cookie em localStorage).
const POPUP_CLUBE_KEY = 'vm_popup_clube_fechado_em';
const POPUP_CLUBE_HORAS_OCULTO = 12;
function popupClubeEstaOculto() {
  try {
    const ts = parseInt(localStorage.getItem(POPUP_CLUBE_KEY) || '0', 10);
    if (!ts) return false;
    const horas = (Date.now() - ts) / (1000 * 60 * 60);
    return horas < POPUP_CLUBE_HORAS_OCULTO;
  } catch { return false; }
}
function fecharPopupClube() {
  try { localStorage.setItem(POPUP_CLUBE_KEY, String(Date.now())); } catch {}
  const el = document.getElementById('popup-clube');
  if (el) el.remove();
}
// Limpa o cooldown — chamado em todo logout pra próxima aluna ver o pop-up.
function limparCooldownPopupClube() {
  try { localStorage.removeItem(POPUP_CLUBE_KEY); } catch {}
}
function renderPopupClube(ctx) {
  // Remove se já existir (re-render seguro)
  const antigo = document.getElementById('popup-clube');
  if (antigo) antigo.remove();
  // Só pra não-assinante. E respeita o "fechei, não me mostra de novo agora".
  if (ctx?.tem_clube) return;
  if (popupClubeEstaOculto()) return;

  const el = document.createElement('div');
  el.id = 'popup-clube';
  el.className = 'popup-clube';
  el.innerHTML = `
    <button type="button" class="popup-clube-fechar" aria-label="Fechar">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="popup-clube-icone" aria-hidden="true">
      <img src="/assets/favicon.png" alt="" onerror="this.style.display='none'">
    </div>
    <div class="popup-clube-textos">
      <div class="popup-clube-titulo">Clube Vida Mágica</div>
      <div class="popup-clube-sub">Conteúdo exclusivo toda semana e acompanhamento da sua jornada.</div>
    </div>
    <button type="button" class="popup-clube-btn">Assinar</button>
  `;
  document.body.appendChild(el);
  el.querySelector('.popup-clube-fechar').addEventListener('click', fecharPopupClube);
  el.querySelector('.popup-clube-btn').addEventListener('click', () => {
    window.app?.abrirModalClube?.();
  });
}

// ── VIEW VÍDEOS (grade Netflix) ──────────────────────────────
async function renderViewVideos(ctx) {
  const grid = document.getElementById('videos-grid');
  if (!grid) return;

  const itens = await obterFeedItens();
  const videos = itens.filter(i => i.tipo === 'video' && i.ativo);

  if (!videos.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">🎬</div>
        <p class="empty-titulo">Nada por aqui ainda</p>
        <p class="empty-sub">Em breve novos vídeos exclusivos.</p>
      </div>`;
    return;
  }

  const ehAssinante = !!ctx?.tem_clube;

  // Busca thumbs em paralelo. YouTube/Imagem manual: síncrono.
  // Vimeo: via fetch oEmbed (cacheado, então só pesa na primeira vez).
  const thumbs = await Promise.all(videos.map(async (v) => {
    if (v.imagem_url) return v.imagem_url;
    const t = thumbDeUrl(v.url);
    if (t) return t;
    if (v.url && /vimeo\.com\/\d+/.test(v.url)) return (await thumbVimeoDeUrl(v.url)) || '';
    return '';
  }));

  grid.innerHTML = videos.map((v, idx) => {
    const thumb = thumbs[idx];
    const btnClasse = ehAssinante ? 'video-card-btn-play' : 'video-card-btn-cadeado';
    const btnSvg = ehAssinante
      ? '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
      : '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
    return `
      <div class="video-card" data-id="${v.id}" data-url="${escAttr(v.url||'')}" data-titulo="${escAttr(v.titulo||'')}" data-subtitulo="${escAttr(v.subtitulo||'')}" data-corpo="${escAttr(v.corpo||'')}">
        ${thumb
          ? `<img class="video-card-thumb" src="${thumb}" alt="${escHtml(v.titulo||'')}" loading="lazy">`
          : `<div class="video-card-thumb"></div>`}
        <div class="video-card-overlay">
          <div class="video-card-btn ${btnClasse}">${btnSvg}</div>
        </div>
        <div class="video-card-info">
          <div class="video-card-titulo">${escHtml(v.titulo||'')}</div>
          ${v.subtitulo ? `<div class="video-card-sub">${escHtml(v.subtitulo)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.video-card').forEach(card => {
    card.addEventListener('click', () => {
      if (!ehAssinante) { abrirModal('modal-exclusivo'); return; }
      abrirPlayer({
        titulo: card.dataset.titulo,
        subtitulo: card.dataset.subtitulo,
        corpo: card.dataset.corpo,
        url: card.dataset.url,
      });
    });
  });
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
    document.getElementById('tesouro-sub').textContent='Seu presente de hoje está aqui ✦';
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
      <p style="font-size:0.82rem;color:var(--texto-suave);line-height:1.5;margin-bottom:0.75rem;font-style:italic">"Quando agradece, coisas boas acontecem. Quando acredita, coisas boas realiza."</p>
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
  document.getElementById('tesouro-sub').textContent = 'Ouro resgatado. Volte amanhã ✦';
  tesouroAtual = null;
  btn.disabled = false; btn.textContent = '🌱 Resgatar Tesouro';
});

// ── AVISOS ───────────────────────────────────────────────────
const AVISOS_KEY = 'vm_avisos_lidos';
const AVISOS_BASE = [
  {id:'av1',tag:'Tesouro da Su',titulo:'Seu ouro do dia chegou ✦',desc:'A Su deixou algo pra você hoje. Não deixa passar.',data:'Hoje'},
  {id:'av2',tag:'Comunidade',titulo:'Conteúdo exclusivo disponível',desc:'Tem ouro novo esperando por você. Só pra quem está dentro.',data:'1 dia'},
];
// Avisos dinâmicos (vindos do contexto da aluna). São injetados antes dos
// avisos base porque costumam ser mais urgentes/personalizados.
let AVISOS_DINAMICOS = [];
function AVISOS() { return [...AVISOS_DINAMICOS, ...AVISOS_BASE]; }

function getLidos() { try { return JSON.parse(localStorage.getItem(AVISOS_KEY)||'[]'); } catch { return []; } }
function marcarLido(id) { const l=getLidos(); if(!l.includes(id)){l.push(id);localStorage.setItem(AVISOS_KEY,JSON.stringify(l));} }
function atualizarBadgeAvisos() {
  const badge = document.getElementById('ponto-avisos');
  if (badge) AVISOS().some(a=>!getLidos().includes(a.id)) ? badge.classList.add('visivel') : badge.classList.remove('visivel');
}
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
  // Click no item: marca lido
  corpo.querySelectorAll('.aviso-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Não marca lido se clicou no botão de ação (deixa o handler dele agir)
      if (e.target.classList.contains('aviso-acao')) return;
      marcarLido(el.dataset.id);
      el.classList.remove('nao-lido');
      atualizarBadgeAvisos();
    });
  });
  // Click no botão de ação
  corpo.querySelectorAll('.aviso-acao').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tipo = btn.dataset.acao;
      const payload = btn.dataset.payload;
      // Fecha modal de avisos antes da splash
      const modal = document.getElementById('modal-avisos');
      if (modal) modal.setAttribute('aria-hidden', 'true');

      if (tipo === 'ativar-trilha' && payload) {
        await ativarTrilhaComSplash(payload);
      } else if (tipo === 'celebrar-compra' && payload) {
        // Encontra a atualização correspondente no contexto e dispara
        const ctxAtual = await carregarContexto();
        if (!ctxAtual) return;
        const alvo = (ctxAtual.atualizacoes_pendentes || []).find(a => a.id === payload);
        if (alvo) await dispararSplashAtualizacao(alvo, ctxAtual);
      }
    });
  });
}

// Atualiza avisos dinâmicos com base no contexto da aluna.
// Chamado no hidratarHome após /api/app/contexto.
function sincronizarAvisosComContexto(ctx) {
  AVISOS_DINAMICOS = [];
  if (ctx && ctx.teste_aguardando_ativacao) {
    AVISOS_DINAMICOS.push({
      id: 'av-trilha-' + ctx.teste_aguardando_ativacao.id,
      tag: 'Sua jornada',
      titulo: 'Atualização disponível',
      desc: 'Seu novo perfil está pronto pra atualizar sua jornada.',
      data: 'Agora',
      acao: { tipo: 'ativar-trilha', payload: ctx.teste_aguardando_ativacao.id, label: 'Quero atualizar →' },
    });
  }
  // Avisos de compras pendentes (produto adquirido — webhook futuro)
  if (ctx && Array.isArray(ctx.atualizacoes_pendentes)) {
    ctx.atualizacoes_pendentes.filter(a => a.tipo === 'compra').forEach(a => {
      const produtoNome = (a.payload && a.payload.produto_nome) || 'Produto adquirido';
      AVISOS_DINAMICOS.push({
        id: 'av-compra-' + a.id,
        tag: 'Sua jornada',
        titulo: 'Sua jornada avançou! ✦',
        desc: `${produtoNome} foi liberado e atualizou sua trilha.`,
        data: 'Agora',
        acao: { tipo: 'celebrar-compra', payload: a.id, label: 'Ver minha trilha →' },
      });
    });
  }
  atualizarBadgeAvisos();
}

// ── TESTES ───────────────────────────────────────────────────
// Mapa de slug do perfil para nome de exibição (igual backend usa)
const PERFIS_LABELS_FRONT = {
  medo: 'Medo',
  desordem: 'Desordem',
  validacao: 'Validação',
  sobrevivencia: 'Sobrevivência',
  prosperidade_nv1: 'Prosperidade Nível 1',
  prosperidade_nv2: 'Prosperidade Nível 2',
  prosperidade_nv3: 'Prosperidade Nível 3',
};
// Artigo correto pra cada perfil — "Energia DO Medo", "Energia DA Desordem"
const PERFIS_ARTIGO = {
  medo: 'do',
  desordem: 'da',
  validacao: 'da',
  sobrevivencia: 'da',
  prosperidade_nv1: 'da',
  prosperidade_nv2: 'da',
  prosperidade_nv3: 'da',
};
function nomePerfil(slug) {
  if (!slug) return '—';
  return PERFIS_LABELS_FRONT[slug] || (String(slug).charAt(0).toUpperCase() + String(slug).slice(1));
}
function artigoPerfil(slug) {
  return PERFIS_ARTIGO[slug] || 'da';
}

async function carregarTestes() {
  const corpo = document.getElementById('testes-corpo'); if (!corpo) return;
  corpo.innerHTML = '<div class="loading-inline">Carregando...</div>';
  try {
    const r = await fetch(`${API}/api/auth/testes`, { headers: authHeader() });
    if (!r.ok) throw new Error();
    const testes = await r.json();
    if (!testes.length) {
      corpo.innerHTML = '<div class="loading-inline">Nenhum teste do subconsciente realizado ainda.</div>';
      return;
    }
    corpo.innerHTML = testes.map(t => {
      const dataTxt = t.feito_em
        ? new Date(t.feito_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
        : 'em andamento';
      const perfilLabel = nomePerfil(t.perfil_dominante);
      const perfilArt = artigoPerfil(t.perfil_dominante);
      const pct = (t.percentual_prosperidade != null) ? t.percentual_prosperidade : null;

      // Botão "Ver resultado": só aparece se está pago E tem feito_em
      const acaoHtml = (t.pago && t.feito_em)
        ? `<a href="/resultado/${t.id}" target="_blank" class="teste-card-btn">Ver resultado →</a>`
        : `<div class="teste-card-locked">🔒 Aguardando liberação</div>`;

      return `
        <div class="teste-card">
          <div class="teste-card-header">
            <div class="teste-card-eyebrow">Teste do Subconsciente</div>
            <div class="teste-card-data">${dataTxt}</div>
          </div>
          <div class="teste-card-corpo">
            <div class="teste-card-perfil">
              <div class="teste-card-perfil-label">Energia ${perfilArt}</div>
              <div class="teste-card-perfil-nome">${escHtml(perfilLabel)}</div>
            </div>
            ${pct != null ? `<div class="teste-card-pct"><span class="teste-card-pct-num">${pct}</span><span class="teste-card-pct-sym">%</span></div>` : ''}
          </div>
          ${acaoHtml}
        </div>
      `;
    }).join('');
  } catch {
    corpo.innerHTML = '<div class="loading-inline">Erro ao carregar.</div>';
  }
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
// Versão pra usar dentro de atributos HTML (escapa aspas duplas e simples também).
function escAttr(s) { return escHtml(s).replace(/"/g,'&#34;').replace(/'/g,'&#39;'); }

// Formata "10/05/2026 às 14h01" a partir de ISO date
function formatarDataHora(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const dt = d.toLocaleDateString('pt-BR');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${dt} às ${hh}h${mm}`;
  } catch { return '—'; }
}
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

// ── Voltar pra antessala (view "Fale com a Su") ──
// A antessala é uma view independente do chat. Navegar pra ela é o
// equivalente a "voltar da conversa". O irPara('fale-com-a-su') já
// reseta canalAtivo e recarrega o resumo via lógica do próprio irPara.
function abrirTelaEscolhaChat() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  irPara('fale-com-a-su');
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
  // Navega pra view do chat (antes a aluna estava na antessala
  // #view-fale-com-a-su). irPara('chat') ativa o body.chat-aberto
  // que aplica todas as regras especiais do chat (header escondido, etc).
  irPara('chat');
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
  const icone = document.getElementById('plano-banner-icone');
  const titulo = document.getElementById('plano-banner-titulo');
  const desc = document.getElementById('plano-banner-desc');
  const btn = document.getElementById('plano-banner-acao');
  if (!banner || !titulo || !desc || !btn) return;

  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  banner.classList.remove('tier-free', 'tier-basic_vm', 'tier-prioritario', 'alerta');
  const tier = conv.tier || 'free';

  // Padrão visual igual ao painel de atendimento da Suellen.
  // Caixa compacta com ícone + 2 linhas de texto. O botão (regra que já existe)
  // só aparece nos tiers Free e Basic VM, pra a aluna ter porta de venda.
  if (tier === 'prioritario') {
    banner.classList.add('tier-prioritario');
    if (icone) icone.textContent = '⏱️';
    titulo.textContent = 'Prioritário · até 24h';
    btn.style.display = 'none';
    atualizarDescPrioritario(conv);
    timerInterval = setInterval(() => atualizarDescPrioritario(conv), 30000);
  } else if (tier === 'basic_vm') {
    banner.classList.add('tier-basic_vm');
    if (icone) icone.textContent = '💛';
    titulo.textContent = 'Básico Vida Mágica';
    desc.textContent = 'Resposta em até 5 dias';
    btn.style.display = '';
    btn.textContent = 'Ativar prioritário';
    btn.onclick = acaoAtivarPrioritario;
  } else {
    banner.classList.add('tier-free');
    if (icone) icone.textContent = '·';
    titulo.textContent = 'Free';
    desc.textContent = 'Resposta em tempo indeterminado';
    btn.style.display = '';
    btn.textContent = 'Assinar Vida Mágica';
    btn.onclick = acaoAssinarVM;
  }
}

// Descrição do banner prioritário no formato "X interações · expira DD/MM, HH:MM"
// Igual ao padrão usado no painel de atendimento.
function atualizarDescPrioritario(conv) {
  const desc = document.getElementById('plano-banner-desc');
  const banner = document.getElementById('plano-banner');
  if (!desc) return;
  const interacoes = `${conv.interacoes_restantes ?? 0} interações`;

  if (!conv.prioritario_expira_em) {
    desc.textContent = interacoes;
    return;
  }
  const expira = new Date(conv.prioritario_expira_em);
  const restMs = expira.getTime() - Date.now();
  if (restMs <= 0) {
    desc.textContent = `${interacoes} · expirado`;
    banner.classList.add('alerta');
    return;
  }
  const expiraFmt = expira.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  desc.textContent = `${interacoes} · expira ${expiraFmt}`;
  // Marca alerta quando falta menos de 1 hora
  const totalMin = Math.floor(restMs / 60000);
  if (totalMin < 60) banner.classList.add('alerta');
  else banner.classList.remove('alerta');
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
  if (!document.getElementById('view-chat')?.classList.contains('active')) return;
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
            if (document.getElementById('view-chat')?.classList.contains('active')
                && document.visibilityState === 'visible') {
              marcarLidas(chatConv.tipo);
            }
          }
          carregarResumoChats();
          if (!document.getElementById('view-chat')?.classList.contains('active')) {
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
          if (document.getElementById('view-chat')?.classList.contains('active')
              && document.visibilityState === 'visible') {
            marcarLidas(chatConv.tipo);
          }
        }
        carregarResumoChats();
        if (!document.getElementById('view-chat')?.classList.contains('active')) {
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

    const r = await fetch(`${API}/api/chat/mensagem`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type':'application/json' },
      body: JSON.stringify({ tipo: 'imagem', url: urlReal, tipo_chat: canalAtivo }),
    });

    // Atualiza msgTemp com resposta real (msm padrão do texto/áudio)
    if (r.ok) {
      const d = await r.json();
      if (d.mensagem) {
        const idx = mensagensAtuais.findIndex(m => m.id === msgTemp.id);
        if (idx >= 0) mensagensAtuais[idx] = { ...msgTemp, ...d.mensagem };
        const wrapEl = document.querySelector(`.msg-wrap[data-id="${msgTemp.id}"]`);
        if (wrapEl) wrapEl.dataset.id = d.mensagem.id;
        const checkEl = document.querySelector(`.msg-checks[data-msg-id="${msgTemp.id}"]`);
        if (checkEl) {
          checkEl.dataset.msgId = d.mensagem.id;
          checkEl.classList.remove('enviada','entregue','lida');
          if (d.mensagem.lida)          checkEl.classList.add('lida');
          else if (d.mensagem.entregue) checkEl.classList.add('entregue');
          else                          checkEl.classList.add('enviada');
        }
      }
      if (d.conversa) {
        chatConv = { ...chatConv, ...d.conversa };
        atualizarBannerPlano(chatConv);
      }
    }
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

    const r = await fetch(`${API}/api/chat/mensagem`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type':'application/json' },
      body: JSON.stringify({ tipo: 'audio', url, duracao: durReal || dur, tipo_chat: canalAtivo }),
    });

    // ── Atualiza msgTemp com a resposta do backend ──
    // Sem isso, o áudio fica eternamente como ✓ (enviada) e os eventos
    // posteriores (entregue, lida) não acham a bolha porque o id é tmp-*.
    if (r.ok) {
      const d = await r.json();
      if (d.mensagem) {
        const idx = mensagensAtuais.findIndex(m => m.id === msgTemp.id);
        if (idx >= 0) mensagensAtuais[idx] = { ...msgTemp, ...d.mensagem };
        // Troca id temporário pelo real no DOM
        const wrapEl = document.querySelector(`.msg-wrap[data-id="${msgTemp.id}"]`);
        if (wrapEl) wrapEl.dataset.id = d.mensagem.id;
        const checkEl = document.querySelector(`.msg-checks[data-msg-id="${msgTemp.id}"]`);
        if (checkEl) {
          checkEl.dataset.msgId = d.mensagem.id;
          checkEl.classList.remove('enviada','entregue','lida');
          if (d.mensagem.lida)          checkEl.classList.add('lida');
          else if (d.mensagem.entregue) checkEl.classList.add('entregue');
          else                          checkEl.classList.add('enviada');
        }
      }
      if (d.conversa) {
        chatConv = { ...chatConv, ...d.conversa };
        atualizarBannerPlano(chatConv);
      }
    }
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

  // Guarda o contexto atual num escopo global pra outras views consultarem
  // (ex: view-videos precisa saber se é assinante quando a aluna troca de aba)
  window._ctxAtual = ctx;

  // ── Marca o body como "clube-ativo" quando a aluna tem Vida Mágica.
  //    O CSS usa essa classe pra revelar as 14 partículas-plus
  //    (.particula-plus) que ficam escondidas por padrão. As 18 partículas
  //    base continuam aparecendo pra todos. Resultado: assinante vê 32
  //    brilhos subindo na tela (mais intenso). Vale pra TODAS as views
  //    porque a classe está no <body>. Não toca no #view-chat — partículas
  //    têm z-index 0, ficam atrás das views (z-index 10), chat segue intacto.
  document.body.classList.toggle('clube-ativo', !!ctx.tem_clube);

  // ── Player do topo (vídeo/imagem destaque) ──
  carregarPlayerTopo(ctx);

  // ── Relatos da Comunidade (feed horizontal abaixo do Tesouro) ──
  carregarRelatosComunidade(ctx);

  // ── Pop-up convite Clube (só pra não-assinante; flutua abaixo do header) ──
  renderPopupClube(ctx);

  // ── Botoeira (faixa abaixo do player com "Assista mais vídeos" + "i") ──
  renderBotoeira();

  // ── Saudação + barra de progresso da jornada ──
  renderSaudacaoJornada(ctx);

  // ── Badge sementes ──
  const badge = document.getElementById('badge-sementes');
  if (badge) badge.textContent = ctx.aluna.sementes || 0;

  // ── Trilha (substitui a trilha hardcoded) ──
  renderTrilhaJornada(ctx);

  // ── Banner de teste em andamento ──
  renderBannerTesteEmAndamento(ctx);

  // ── Banner de atualização de trilha disponível (re-teste sem ativação) ──
  renderBannerAtualizarTrilha(ctx);

  // ── Banner de atualização pendente por COMPRA (slot futuro pra Kiwify) ──
  renderBannerAtualizarPorCompra(ctx);

  // ── Sincroniza avisos dinâmicos (badge do sino + aviso na lista) ──
  sincronizarAvisosComContexto(ctx);

  // ── Aba Materiais ──
  renderMateriais(ctx);
}

// ── BANNER "Seu novo perfil está pronto pra atualizar sua jornada" ──
// Aparece quando aluna refez teste, viu o resultado, mas escolheu "Não" no
// popup (ou ainda não decidiu). Também aparece em Avisos.
function renderBannerAtualizarTrilha(ctx) {
  const wrap = document.getElementById('view-jornada');
  if (!wrap) return;
  // Remove banner antigo (se existir) — re-render seguro
  const antigo = document.getElementById('banner-atualizar-trilha');
  if (antigo) antigo.remove();

  if (!ctx.teste_aguardando_ativacao) return;

  const banner = document.createElement('div');
  banner.id = 'banner-atualizar-trilha';
  banner.className = 'banner-atualizar-trilha';
  banner.innerHTML = `
    <div class="banner-atualizar-icone">✦</div>
    <div class="banner-atualizar-textos">
      <div class="banner-atualizar-titulo">Você é outra pessoa agora. Sua jornada precisa refletir isso. ✦</div>
      <button class="banner-atualizar-btn" data-teste-id="${ctx.teste_aguardando_ativacao.id}">
        Atualizar minha jornada →
      </button>
    </div>
  `;
  // Posiciona ANTES da trilha (logo abaixo do tesouro).
  const trilha = wrap.querySelector('.trilha');
  if (trilha) {
    trilha.parentNode.insertBefore(banner, trilha);
  } else {
    wrap.appendChild(banner);
  }

  banner.querySelector('.banner-atualizar-btn').addEventListener('click', async (e) => {
    const testeId = e.currentTarget.dataset.testeId;
    await ativarTrilhaComSplash(testeId);
  });
}

// ── BANNER "Sua jornada avançou!" (compra de produto) ──
// Aparece quando há atualização pendente do tipo 'compra'. Pega a primeira
// e mostra o banner. Click dispara splash de celebração direto (sem precisar
// de confirmação — o avanço já é fato, não escolha).
function renderBannerAtualizarPorCompra(ctx) {
  const wrap = document.getElementById('view-jornada');
  if (!wrap) return;
  const antigo = document.getElementById('banner-atualizar-compra');
  if (antigo) antigo.remove();

  const compras = (ctx.atualizacoes_pendentes || []).filter(a => a.tipo === 'compra');
  if (compras.length === 0) return;

  const a = compras[0];
  const produtoNome = (a.payload && a.payload.produto_nome) || 'Novo produto';

  const banner = document.createElement('div');
  banner.id = 'banner-atualizar-compra';
  banner.className = 'banner-atualizar-trilha';
  banner.innerHTML = `
    <div class="banner-atualizar-icone">✦</div>
    <div class="banner-atualizar-textos">
      <div class="banner-atualizar-titulo">Pensou, falou, viveu — e avançou. ✦</div>
      <button class="banner-atualizar-btn" data-atualizacao-id="${a.id}">
        Ver minha trilha →
      </button>
    </div>
  `;
  // Posiciona ANTES da trilha (logo abaixo do tesouro).
  const trilha = wrap.querySelector('.trilha');
  if (trilha) {
    trilha.parentNode.insertBefore(banner, trilha);
  } else {
    wrap.appendChild(banner);
  }

  banner.querySelector('.banner-atualizar-btn').addEventListener('click', async () => {
    await dispararSplashAtualizacao(a, ctx);
  });
}

// ──────────────────────────────────────────────────────────
// SPLASH DE CELEBRAÇÃO DA JORNADA — 4 FASES
// ──────────────────────────────────────────────────────────
// Fase 1 (0-2s)   : "Criando/Atualizando sua jornada..." com 3 pontinhos
// Fase 2 (2-3s)   : Fade out → fade in "Jornada criada/atualizada com sucesso"
// Fase 3 (3-4.5s) : Barra de progresso real anima 0 → percentual atual
// Fase 4 (4.5s+)  : Botão "Concluir →" aparece. Click fecha splash.
//
// Parâmetros:
// - contexto: 'criando' (1º teste) | 'atualizando' (re-teste / compra)
// - jornadaInfo: { nome, passos_total, passos_concluidos, percentual }
// - aoConcluir: callback chamado quando aluna clica em "Concluir →"

function criarSplashJornada({ contexto = 'atualizando', jornadaInfo = null, primeiroNome = '', aoConcluir = null } = {}) {
  const ehCriando = contexto === 'criando';
  const nomeMostrar = (primeiroNome || '').trim();
  const tituloFase1 = ehCriando
    ? 'A vida é mágica!'
    : 'Você avançou ✦';
  const subFase1 = ehCriando
    ? (nomeMostrar
        ? `Jornada personalizada de ${nomeMostrar} está sendo criada.`
        : 'Sua jornada personalizada está sendo criada.')
    : 'Cada passo que você dá, a mente expande. Veja onde você está agora.';

  const splash = document.createElement('div');
  splash.className = 'jornada-splash';
  splash.innerHTML = `
    <div class="jornada-splash-particulas">
      ${Array.from({ length: 28 }, (_, i) => `<span class="js-particula js-p${i % 7}"></span>`).join('')}
    </div>
    <div class="jornada-splash-conteudo">
      <div class="jornada-splash-icone">✦</div>
      <h2 class="jornada-splash-titulo">${tituloFase1}<span class="reticencias"><span>.</span><span>.</span><span>.</span></span></h2>
      <p class="jornada-splash-sub">${subFase1}</p>
      <div class="jornada-splash-progresso">
        <div class="jornada-splash-prog-info">
          <span class="jornada-splash-prog-nome" data-prog-nome>—</span>
          <span class="jornada-splash-prog-passos" data-prog-passos>—</span>
        </div>
        <div class="jornada-splash-prog-bar">
          <div class="jornada-splash-prog-fill" data-prog-fill></div>
        </div>
        <div class="jornada-splash-prog-pct">
          <span class="pct-num" data-prog-pct>0</span><span class="pct-sym">%</span>
        </div>
      </div>
      <button class="jornada-splash-botao" data-btn-concluir>${ehCriando ? 'Acessar minha jornada' : 'Concluir →'}</button>
    </div>
  `;

  splash.querySelector('[data-btn-concluir]').addEventListener('click', () => {
    splash.classList.remove('visivel');
    setTimeout(() => {
      splash.remove();
      if (aoConcluir) aoConcluir();
    }, 400);
  });

  return splash;
}

// Orquestra as fases da splash. Retorna Promise que resolve quando aluna
// clica em "Concluir" (ou splash é fechada por outro motivo).
function rodarSplashJornada({ contexto = 'atualizando', jornadaInfo = null, primeiroNome = '' } = {}) {
  return new Promise(resolve => {
    const splash = criarSplashJornada({ contexto, jornadaInfo, primeiroNome, aoConcluir: resolve });
    document.body.appendChild(splash);
    requestAnimationFrame(() => splash.classList.add('visivel'));

    const tituloFase2 = contexto === 'criando'
      ? 'Sua jornada começou ✦'
      : 'Sua jornada avançou ✦';

    // FASE 2 (em 2s): fade do título → trocar texto → fade in
    setTimeout(() => {
      splash.classList.add('fase-transicao');
      setTimeout(() => {
        const titEl = splash.querySelector('.jornada-splash-titulo');
        const subEl = splash.querySelector('.jornada-splash-sub');
        if (titEl) titEl.innerHTML = tituloFase2;
        if (subEl) subEl.textContent = 'Sua trilha está pronta';
        splash.classList.remove('fase-transicao');
      }, 400);
    }, 2000);

    // FASE 3 (em 3s): mostra barra de progresso e anima
    setTimeout(() => {
      if (jornadaInfo) {
        const nomeEl = splash.querySelector('[data-prog-nome]');
        const passosEl = splash.querySelector('[data-prog-passos]');
        if (nomeEl && jornadaInfo.nome) nomeEl.textContent = jornadaInfo.nome;
        if (passosEl && jornadaInfo.passos_total) {
          passosEl.textContent = `${jornadaInfo.passos_concluidos} de ${jornadaInfo.passos_total}`;
        }
      }
      splash.classList.add('fase-progresso');

      setTimeout(() => {
        const fillEl = splash.querySelector('[data-prog-fill]');
        const pctEl = splash.querySelector('[data-prog-pct]');
        const pctAlvo = (jornadaInfo && typeof jornadaInfo.percentual === 'number') ? jornadaInfo.percentual : 0;
        if (fillEl) fillEl.style.width = pctAlvo + '%';
        if (pctEl) animarNumero(pctEl, 0, pctAlvo, 1200);
      }, 200);
    }, 3000);

    // FASE 4 (em 4.5s): mostra botão "Concluir"
    setTimeout(() => {
      splash.classList.add('fase-botao');
    }, 4500);
  });
}

// Animação simples de contagem de número (easeOutCubic)
function animarNumero(el, de, ate, duracao) {
  const inicio = performance.now();
  function tick(agora) {
    const t = Math.min(1, (agora - inicio) / duracao);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(de + (ate - de) * ease);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Função: ativa a trilha de um teste + roda splash + recarrega Home
async function ativarTrilhaComSplash(testeId) {
  try {
    await fetch(`${API}/api/teste/ativar-trilha/${encodeURIComponent(testeId)}`, {
      method: 'POST',
      headers: authHeader(),
    });
  } catch (e) {
    console.warn('[ativarTrilha] erro:', e);
  }

  // Recarrega contexto pra pegar a nova jornada antes da splash
  const novoCtx = await carregarContexto();

  // Marca a atualização pendente desse teste como consumida
  await consumirAtualizacoesDoTeste(novoCtx, testeId);

  // Monta info da jornada pra splash
  const jornadaInfo = montarJornadaInfoSplash(novoCtx);

  // Roda splash (volta quando aluna clica Concluir)
  const primeiroNomeSplash = novoCtx?.aluna?.primeiro_nome || '';
  await rodarSplashJornada({ contexto: 'atualizando', jornadaInfo, primeiroNome: primeiroNomeSplash });

  // Atualiza UI com novo contexto
  if (novoCtx) hidratarHome(novoCtx);
}

// Função: dispara splash de celebração (uso geral — banner Home, aviso, compra)
async function dispararSplashAtualizacao(atualizacao, ctxAtual) {
  const contexto = (atualizacao.payload && atualizacao.payload.contexto) || 'atualizando';
  const jornadaInfo = montarJornadaInfoSplash(ctxAtual);
  const primeiroNomeSplash = ctxAtual?.aluna?.primeiro_nome || '';

  await rodarSplashJornada({ contexto, jornadaInfo, primeiroNome: primeiroNomeSplash });

  // Marca consumida
  try {
    await fetch(`${API}/api/app/atualizacoes/${encodeURIComponent(atualizacao.id)}/consumir`, {
      method: 'POST',
      headers: authHeader(),
    });
  } catch (e) {
    console.warn('[atualizacoes/consumir] erro:', e);
  }

  // Recarrega contexto
  const novoCtx = await carregarContexto();
  if (novoCtx) hidratarHome(novoCtx);
}

// Marca todas as atualizações pendentes que se referem a um teste específico
async function consumirAtualizacoesDoTeste(ctx, testeId) {
  if (!ctx || !Array.isArray(ctx.atualizacoes_pendentes)) return;
  const alvos = ctx.atualizacoes_pendentes.filter(a =>
    a.tipo === 'teste' && a.payload && a.payload.teste_id === testeId
  );
  for (const a of alvos) {
    try {
      await fetch(`${API}/api/app/atualizacoes/${encodeURIComponent(a.id)}/consumir`, {
        method: 'POST',
        headers: authHeader(),
      });
    } catch {}
  }
}

// Extrai info da jornada do contexto pra alimentar a barra da splash
function montarJornadaInfoSplash(ctx) {
  if (!ctx || !ctx.jornada_atual) return null;
  const j = ctx.jornada_atual;
  const total = (j.passos || []).length;
  const concluidos = (j.passos || []).filter(p => p.comprado).length;
  const percentual = total > 0 ? Math.round((concluidos / total) * 100) : 0;
  return {
    nome: j.nome_exibicao || ('Jornada ' + (j.numero || '')),
    passos_total: total,
    passos_concluidos: concluidos,
    percentual,
  };
}

// ── HIDRATAÇÃO DA ABA MATERIAIS ─────────────────────────────
function renderMateriais(ctx) {
  const wrap = document.getElementById('produtos-lista');
  if (!wrap) return;

  const blocos = [];
  const SLUG_TESTE = 'teste_subconsciente';
  const SLUG_CLUBE = 'clube_vida_magica';
  // Slugs de produtos de RECOMPRA / RECORRÊNCIA — sempre visíveis no bloco
  // "Em destaque" no topo, mesmo se a aluna já comprou. São os únicos do
  // catálogo que fazem sentido aparecer assim.
  const SLUGS_RECOMPRA = new Set([SLUG_TESTE, SLUG_CLUBE]);

  // Mapa rápido pra achar dados de qualquer produto pelo slug
  const todosProdutosBySlug = {};
  (ctx.outros_produtos || []).forEach(p => { todosProdutosBySlug[p.slug] = p; });

  // ── 1. EM DESTAQUE — Teste do Subconsciente + Clube Vida Mágica ──
  // Sempre visíveis no topo, comprados ou não. Produtos de recompra/recorrência.
  const destaqueCards = [];

  // Card do TESTE DO SUBCONSCIENTE
  {
    const prodTeste = todosProdutosBySlug[SLUG_TESTE] || {};
    const capa = prodTeste.imagem_url
      ? `<img src="${escHtml(prodTeste.imagem_url)}" alt="" class="mat-capa-destaque" onerror="this.style.display='none'">`
      : '<div class="mat-capa-destaque mat-capa-placeholder"></div>';
    const linkTeste = prodTeste.link_checkout_padrao || '';
    const jaTemTeste = ctx.teste_atual || (ctx.todos_testes && ctx.todos_testes.length);
    const cta = jaTemTeste
      ? `<a href="/teste" class="mat-card-btn">Refazer e ver evolução →</a>`
      : (linkTeste
          ? `<a href="${escHtml(linkTeste)}" target="_blank" rel="noopener" class="mat-card-btn">Quero fazer →</a>`
          : `<a href="/teste" class="mat-card-btn">Fazer agora →</a>`);
    destaqueCards.push(
      `<div class="mat-card mat-card-destaque">
        <div class="mat-card-destaque-topo">
          ${capa}
          <div class="mat-card-destaque-textos">
            <div class="mat-card-eyebrow">Teste do Subconsciente</div>
            <div class="mat-card-titulo">Descubra o padrão dominante que rege sua mente.</div>
          </div>
        </div>
        <div class="mat-card-desc">Um instrumento de autodiagnóstico que pode ser refeito sempre que sentir necessidade — sua energia muda com o tempo.</div>
        ${cta}
      </div>`
    );
  }

  // Card do CLUBE VIDA MÁGICA
  {
    const prodClube = todosProdutosBySlug[SLUG_CLUBE] || {};
    const capa = prodClube.imagem_url
      ? `<img src="${escHtml(prodClube.imagem_url)}" alt="" class="mat-capa-destaque" onerror="this.style.display='none'">`
      : '<div class="mat-capa-destaque mat-capa-placeholder"></div>';
    const slugsComprados = new Set((ctx.comprados || []).map(c => c.produto_slug));
    const jaAssinou = slugsComprados.has(SLUG_CLUBE);
    const linkClube = prodClube.link_checkout_padrao || '';
    const cta = jaAssinou
      ? `<div class="mat-card-locked">✓ Você já é membro</div>`
      : (linkClube
          ? `<a href="${escHtml(linkClube)}" target="_blank" rel="noopener" class="mat-card-btn">Quero entrar →</a>`
          : '');
    destaqueCards.push(
      `<div class="mat-card mat-card-destaque">
        <div class="mat-card-destaque-topo">
          ${capa}
          <div class="mat-card-destaque-textos">
            <div class="mat-card-eyebrow">Comunidade</div>
            <div class="mat-card-titulo">${escHtml(prodClube.nome || 'Clube Vida Mágica')}</div>
          </div>
        </div>
        <div class="mat-card-desc">Encontros mensais ao vivo, comunidade ativa e suporte direto pra sustentar a transformação no convívio diário.</div>
        ${cta}
      </div>`
    );
  }

  blocos.push('<div class="mat-secao"><div class="mat-secao-titulo">Em destaque</div>' + destaqueCards.join('') + '</div>');

  // ── 2. SEUS TESTES — subseções "Em andamento" e "Concluídos" ──
  // Em andamento: linha de teste_respostas existe sem teste finalizado.
  //   → Card destacado em dourado/atenção. Botões "Continuar" e "Apagar".
  // Concluídos: testes finalizados (pagos OU aguardando pagamento).
  //   → Cards normais com badge verde "✓ Concluído". Mais recente em cima.
  //   → Se for o teste mais recente E ainda não ativou trilha, mostra
  //     também botão "Atualizar Trilha" em dourado.
  // Card "+ Fazer novo" sempre por último.

  // Lista de testes feitos, ordenada do mais recente pro mais antigo
  const testesFeitosRaw = Array.isArray(ctx.todos_testes) ? ctx.todos_testes : [];
  const testesFeitos = [...testesFeitosRaw].sort((a, b) => {
    const da = a.feito_em ? new Date(a.feito_em).getTime() : 0;
    const db = b.feito_em ? new Date(b.feito_em).getTime() : 0;
    return db - da;
  });

  const temAndamento = !!ctx.teste_em_andamento;

  if (testesFeitos.length > 0 || temAndamento) {
    // Carrossel/lista (toggle só aparece se tiver concluídos pra mostrar)
    const modoSalvo = (() => { try { return localStorage.getItem('vm_testes_modo') || 'carrossel'; } catch { return 'carrossel'; } })();
    const toggleHtml = testesFeitos.length > 1
      ? `<div class="mat-secao-toggle">
          <button class="mat-toggle-btn ${modoSalvo === 'carrossel' ? 'ativo' : ''}" data-modo="carrossel" aria-label="Visualização em carrossel">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="6" height="12" rx="1"/><rect x="11" y="6" width="6" height="12" rx="1"/><rect x="19" y="6" width="2" height="12" rx="1" opacity="0.5"/></svg>
          </button>
          <button class="mat-toggle-btn ${modoSalvo === 'lista' ? 'ativo' : ''}" data-modo="lista" aria-label="Visualização em lista">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>`
      : '';

    // ID do teste aguardando ativação (se houver) — pra destacar
    const idAguardando = ctx.teste_aguardando_ativacao ? ctx.teste_aguardando_ativacao.id : null;
    // Pra "Atualizar Trilha" só no MAIS RECENTE: o primeiro teste pago da lista
    // que esteja aguardando ativação (que é justamente o idAguardando).
    // Se idAguardando não bater com o primeiro teste pago, ninguém recebe o botão.

    const partes = [];
    partes.push('<div class="mat-secao"><div class="mat-secao-titulo-row"><div class="mat-secao-titulo">Seus testes</div>' + toggleHtml + '</div>');

    // ── Subseção: Em andamento ──
    if (temAndamento) {
      const tea = ctx.teste_em_andamento;
      const dataTxt = tea.iniciado_em
        ? formatarDataHora(tea.iniciado_em)
        : '—';
      partes.push(
        `<div class="testes-subsecao testes-subsecao-andamento">
          <div class="testes-subsecao-titulo testes-subsecao-titulo-andamento">
            <span class="testes-subsecao-icone">⚠</span> Em andamento
          </div>
          <div class="teste-mini-card teste-mini-em-andamento">
            <div class="teste-mini-eyebrow">Teste do Subconsciente</div>
            <div class="teste-mini-data">Iniciado em ${dataTxt}</div>
            <div class="teste-mini-andamento-info">Pergunta ${tea.respondidas || 0} de ${tea.total || 15} respondidas</div>
            <div class="teste-mini-acoes-row">
              <button class="teste-mini-btn teste-mini-btn-continuar" onclick="window.location.href='/teste?from=app'">Continuar →</button>
              <button class="teste-mini-btn teste-mini-btn-apagar" onclick="window.app.apagarTesteEmAndamento(event)">Apagar</button>
            </div>
          </div>
        </div>`
      );
    }

    // ── Subseção: Concluídos ──
    if (testesFeitos.length > 0) {
      const testesCards = testesFeitos.map((t, idx) => {
        const dataTxt = t.feito_em ? formatarDataHora(t.feito_em) : '—';
        const pago = !!t.pago;
        const status = pago ? 'pago' : 'bloqueado';
        const ehAguardando = !!idAguardando && t.id === idAguardando;
        const classeExtra = ehAguardando ? ' teste-mini-aguardando-ativacao' : '';
        const onclick = pago
          ? `onclick="window.open('/resultado/${t.id}', '_blank')"`
          : `onclick="alert('Aguardando liberação do resultado.')"`;

        // Linha de ações: "Ver resultado" sempre + "Atualizar Trilha" se aguardando
        const acoesRow = pago
          ? `<div class="teste-mini-acoes-row">
              <span class="teste-mini-link teste-mini-link-resultado">Ver resultado →</span>
              ${ehAguardando ? '<button class="teste-mini-link teste-mini-link-atualizar" onclick="event.stopPropagation();window.app.ativarTrilhaDoCard(\'' + t.id + '\')">Atualizar Trilha</button>' : ''}
            </div>`
          : '<div class="teste-mini-status teste-mini-bloqueado">🔒 Liberação pendente</div>';

        return `<div class="teste-mini-card teste-mini-${status}${classeExtra}" ${onclick}>
          <div class="teste-mini-badge-concluido">✓ Concluído</div>
          <div class="teste-mini-eyebrow">Teste do Subconsciente</div>
          <div class="teste-mini-data">${dataTxt}</div>
          ${acoesRow}
        </div>`;
      }).join('');

      // Card final "+ Fazer novo" — sempre como último item
      const fazerNovoCard = `<div class="teste-mini-card teste-mini-novo" onclick="window.location.href='/teste?from=app'">
        <div class="teste-mini-novo-icone">+</div>
        <div class="teste-mini-novo-label">Fazer novo</div>
      </div>`;

      partes.push(
        `<div class="testes-subsecao testes-subsecao-concluidos">
          <div class="testes-subsecao-titulo testes-subsecao-titulo-concluidos">
            <span class="testes-subsecao-icone">✓</span> Concluídos
          </div>
          <div class="testes-wrapper testes-modo-${modoSalvo}" id="testes-wrapper">
            ${testesCards}
            ${fazerNovoCard}
          </div>
        </div>`
      );
    } else if (temAndamento) {
      // Tem só teste em andamento, sem concluídos — mostra "Fazer novo" sozinho
      partes.push(
        `<div class="testes-subsecao testes-subsecao-concluidos">
          <div class="testes-wrapper testes-modo-lista">
            <div class="teste-mini-card teste-mini-novo" onclick="window.location.href='/teste?from=app'">
              <div class="teste-mini-novo-icone">+</div>
              <div class="teste-mini-novo-label">Fazer novo</div>
            </div>
          </div>
        </div>`
      );
    }

    partes.push('</div>');
    blocos.push(partes.join(''));
  }

  // ── 3. ADQUIRIDOS — produtos comprados, exceto recompra (já em destaque) ──
  const compradosOutros = Array.isArray(ctx.comprados)
    ? ctx.comprados.filter(c => !SLUGS_RECOMPRA.has(c.produto_slug))
    : [];

  if (compradosOutros.length > 0) {
    const cards = compradosOutros.map(c => {
      const capa = c.produto_imagem
        ? `<img src="${escHtml(c.produto_imagem)}" alt="" class="mat-capa" onerror="this.style.display='none'">`
        : '<div class="mat-capa-placeholder"></div>';
      return `<div class="mat-card mat-card-h">
        ${capa}
        <div class="mat-card-h-textos">
          <div class="mat-card-eyebrow">Adquirido</div>
          <div class="mat-card-titulo">${escHtml(c.produto_nome || c.produto_slug)}</div>
          ${c.observacao ? `<div class="mat-card-desc">${escHtml(c.observacao)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    blocos.push('<div class="mat-secao"><div class="mat-secao-titulo">Adquiridos</div>' + cards + '</div>');
  }

  // ── 4. CONTINUE SUA JORNADA — passos da jornada não comprados ──
  const slugsComprados = new Set((ctx.comprados || []).map(c => c.produto_slug));
  if (ctx.teste_atual) slugsComprados.add(SLUG_TESTE);

  const passosNaoComprados = (ctx.jornada_atual && Array.isArray(ctx.jornada_atual.passos))
    ? ctx.jornada_atual.passos.filter(p => !slugsComprados.has(p.produto_slug) && !SLUGS_RECOMPRA.has(p.produto_slug))
    : [];

  if (passosNaoComprados.length > 0) {
    const cards = passosNaoComprados.map(p => {
      const capa = p.produto_imagem
        ? `<img src="${escHtml(p.produto_imagem)}" alt="" class="mat-capa" onerror="this.style.display='none'">`
        : '<div class="mat-capa-placeholder"></div>';
      const link = p.link_checkout_padrao || '';
      // Texto do botão muda conforme o perfil dominante (M11).
      const textosBotaoProximo = {
        medo:          'Quero vencer esse padrão →',
        desordem:      'Quero clareza e direção →',
        validacao:     'Quero me libertar dessa busca →',
        sobrevivencia: 'Quero soltar esse peso →',
        prosperidade:  'Quero expandir ainda mais →',
      };
      const perfilDom = (ctx?.teste_atual?.perfil_dominante || '').toLowerCase();
      const textoBotao = textosBotaoProximo[perfilDom] || 'Quero esse passo →';
      const btnHtml = link
        ? `<a href="${escHtml(link)}" target="_blank" rel="noopener" class="mat-card-btn">${textoBotao}</a>`
        : '';
      return `<div class="mat-card mat-card-h">
        ${capa}
        <div class="mat-card-h-textos">
          <div class="mat-card-eyebrow">${escHtml(p.titulo)}</div>
          <div class="mat-card-titulo">${escHtml(p.produto_nome)}</div>
          ${p.descricao ? `<div class="mat-card-desc">${escHtml(p.descricao)}</div>` : ''}
          ${btnHtml}
        </div>
      </div>`;
    }).join('');
    blocos.push('<div class="mat-secao"><div class="mat-secao-titulo">Continue sua jornada</div>' + cards + '</div>');
  }

  // ── 5. PARA DESCOBRIR — outros do catálogo (sem recompra, sem jornada) ──
  const slugsJornada = new Set(
    (ctx.jornada_atual && Array.isArray(ctx.jornada_atual.passos))
      ? ctx.jornada_atual.passos.map(p => p.produto_slug)
      : []
  );
  const SLUGS_LEGADOS_INVISIVEIS = new Set([
    'teste_prosperidade',  // teste antigo, substituído pelo Teste do Subconsciente
  ]);
  const outros = Array.isArray(ctx.outros_produtos) ? ctx.outros_produtos : [];
  const outrosFiltrados = outros.filter(p =>
    !slugsComprados.has(p.slug)
    && !slugsJornada.has(p.slug)
    && !SLUGS_RECOMPRA.has(p.slug)               // recompra está em "Em destaque"
    && !SLUGS_LEGADOS_INVISIVEIS.has(p.slug)
    && !!p.link_checkout_padrao
  );

  if (outrosFiltrados.length > 0) {
    const cards = outrosFiltrados.map(p => {
      const capa = p.imagem_url
        ? `<img src="${escHtml(p.imagem_url)}" alt="" class="mat-capa" onerror="this.style.display='none'">`
        : '<div class="mat-capa-placeholder"></div>';
      return `<div class="mat-card mat-card-h">
        ${capa}
        <div class="mat-card-h-textos">
          <div class="mat-card-titulo">${escHtml(p.nome)}</div>
          <a href="${escHtml(p.link_checkout_padrao)}" target="_blank" rel="noopener" class="mat-card-btn-secundario">Conhecer →</a>
        </div>
      </div>`;
    }).join('');
    blocos.push('<div class="mat-secao"><div class="mat-secao-titulo">Para descobrir</div>' + cards + '</div>');
  }

  wrap.innerHTML = blocos.join('');

  // Liga o toggle de visualização (carrossel/lista)
  wrap.querySelectorAll('.mat-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modo = btn.dataset.modo;
      try { localStorage.setItem('vm_testes_modo', modo); } catch {}
      const wrapTestes = document.getElementById('testes-wrapper');
      if (wrapTestes) {
        wrapTestes.classList.remove('testes-modo-carrossel', 'testes-modo-lista');
        wrapTestes.classList.add(`testes-modo-${modo}`);
      }
      wrap.querySelectorAll('.mat-toggle-btn').forEach(b => b.classList.remove('ativo'));
      btn.classList.add('ativo');
    });
  });
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

  // Insere no topo do view-jornada, antes da barra de saudação/progresso.
  // (O banner é sobre continuar o teste, que é o 1º passo da trilha — vive
  // junto com a jornada.)
  const wrap = document.getElementById('view-jornada');
  const barra = wrap?.querySelector('#saudacao-jornada');
  if (barra) {
    barra.parentNode.insertBefore(banner, barra);
  } else if (wrap) {
    wrap.insertBefore(banner, wrap.firstChild);
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
  if (!ctx.jornada_atual && !ctx.jornada_vigente) {
    trilha.innerHTML =
      '<div class="trilha-header">' +
        '<h2 class="trilha-titulo">Sua trilha</h2>' +
        '<p class="trilha-sub">Aguardando próximos passos.</p>' +
      '</div>';
    return;
  }

  // Caso 3: jornada ativa — renderiza barra + passos
  // Preferimos jornada_vigente (novo, via core/jornadas.js). Se ainda não
  // estiver presente no payload, caímos pra jornada_atual (antigo) e
  // mapeamos os campos pra ter compatibilidade.
  const vigente = ctx.jornada_vigente;
  const j = vigente
    ? {
        numero: vigente.numero,
        nome_exibicao: vigente.nome,
        subtitulo: '',
        cor: '#C8922A',
        passos: (vigente.passos || []).map(p => ({
          titulo: p.titulo,
          // No formato vigente, "produtos" é array (P2 da Vida Mágica tem 2 produtos).
          // Pra trilha da Home/Materiais, usamos o primeiro produto como representante visual.
          produto_slug: (p.produtos && p.produtos[0]) || null,
          produto_nome: p.subtitulo || p.titulo,
          produto_imagem: '',
          descricao: '',
          comprado: !!p.concluido,
          eh_proximo: !!p.eh_proximo,
          link_checkout_padrao: '',
          // Lista completa de produtos do passo (pra Materiais mostrar todos)
          produtos_do_passo: p.produtos || [],
          peso: p.peso || 0,
        })),
        progresso: {
          passos_concluidos: (vigente.passos || []).filter(p => p.concluido).length,
          passos_totais: (vigente.passos || []).length,
          percentual: Math.round(vigente.progresso_percentual || 0),
        },
        analise: vigente.analise || null,
      }
    : ctx.jornada_atual;
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
      const link = p.link_checkout_padrao || '#';
      // Texto do botão muda conforme o perfil dominante da aluna no teste atual.
      const textosBotaoProximo = {
        medo:          'Quero vencer esse padrão →',
        desordem:      'Quero clareza e direção →',
        validacao:     'Quero me libertar dessa busca →',
        sobrevivencia: 'Quero soltar esse peso →',
        prosperidade:  'Quero expandir ainda mais →',
      };
      const perfilDom = (ctx?.teste_atual?.perfil_dominante || '').toLowerCase();
      const textoBotao = textosBotaoProximo[perfilDom] || 'Quero esse passo →';
      btnHtml = '<a class="trilha-btn" href="' + link + '" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:inline-block">' + textoBotao + '</a>';
    }
    // Capa do produto (60x60) à esquerda; se não tiver imagem, deixa o slot vazio
    const capa = p.produto_imagem
      ? '<img class="trilha-capa" src="' + escHtml(p.produto_imagem) + '" alt="" onerror="this.style.display=\'none\'">'
      : '';
    return (
      '<li class="trilha-item ' + classe + '">' +
        '<div class="trilha-num">' + num + '</div>' +
        '<div class="trilha-card">' +
          '<div class="trilha-card-topo">' +
            capa +
            '<div class="trilha-card-textos">' +
              '<div class="trilha-eyebrow-card">' + escHtml(p.titulo) + '</div>' +
              '<h3 class="trilha-card-titulo">' + escHtml(p.produto_nome) + '</h3>' +
            '</div>' +
          '</div>' +
          (p.descricao ? '<p class="trilha-card-desc">' + escHtml(p.descricao) + '</p>' : '') +
          btnHtml +
        '</div>' +
      '</li>'
    );
  }).join('');

  // Análise automatizada (texto da jornada — ex: trava forte mesmo com Prosperidade)
  const analiseHtml = j.analise
    ? '<div class="trilha-analise">' + escHtml(j.analise) + '</div>'
    : '';

  // A barra de progresso e o nome da jornada ficam na seção
  // "Saudação + Jornada" (#saudacao-jornada), renderizada por
  // renderSaudacaoJornada(). O convite pro Clube foi pra um pop-up
  // flutuante (renderPopupClube). Aqui só análise + lista de passos.
  trilha.innerHTML =
    '<div class="trilha-header">' +
      analiseHtml +
      '<h2 class="trilha-titulo" style="margin-top:0.5rem">Seu caminho</h2>' +
    '</div>' +
    '<ol class="trilha-lista">' + passosHtml + '</ol>';
}

// ── window.app: API exposta pra cliques inline em HTML gerado dinamicamente ──
// (botões dentro de cards de Materiais que precisam chamar funções deste módulo)
window.app = {
  // Apaga teste em andamento (DELETE em teste_respostas)
  apagarTesteEmAndamento(ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    if (!confirm('Apagar suas respostas? Não pode desfazer.')) return;
    fetch(`${API}/api/teste/em-andamento`, {
      method: 'DELETE',
      headers: authHeader(),
    })
      .then(r => {
        if (!r.ok) throw new Error('Falha ao apagar');
        return r.json().catch(() => ({}));
      })
      .then(() => {
        // Recarrega contexto e re-renderiza Materiais
        carregarContexto().then(c => { if (c) hidratarHome(c); });
      })
      .catch(err => {
        alert('Não consegui apagar agora. Tente de novo daqui a pouco.');
        console.error('apagarTesteEmAndamento:', err);
      });
  },

  // Ativa trilha (re-teste): roda o popup → splash → recarrega
  async ativarTrilhaDoCard(testeId) {
    if (!testeId) return;
    if (!confirm('Atualizar sua trilha de conhecimento agora?\nEssa escolha não pode ser desfeita.')) return;
    try {
      await ativarTrilhaComSplash(testeId);
    } catch (e) {
      console.error('ativarTrilhaDoCard:', e);
    }
  },

  // Abre o modal de assinatura do Clube Vida Mágica
  // Criado dinamicamente na primeira chamada (não precisa estar no HTML)
  abrirModalClube() {
    let overlay = document.getElementById('vm-clube-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'vm-clube-modal-overlay';
      overlay.className = 'vm-clube-modal-overlay';
      overlay.innerHTML = '\
        <div class="vm-clube-modal" role="dialog" aria-modal="true">\
          <button type="button" class="vm-clube-fechar" aria-label="Fechar">\
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\
          </button>\
          <div class="vm-clube-header">\
            <div class="vm-clube-eyebrow">CLUBE</div>\
            <h2 class="vm-clube-titulo">Vida Mágica</h2>\
            <p class="vm-clube-sub">Mais do que um conteúdo. Uma experiência guiada.</p>\
          </div>\
          <div class="vm-clube-beneficios">\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">✨</span><div><strong>Conteúdo exclusivo semanal</strong><span>1 vídeo novo por semana — técnicas práticas que não estão em lugar nenhum</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">🎥</span><div><strong>Encontro mensal ao vivo</strong><span>1 live por mês — troca direta com a Su e o Rê</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">💬</span><div><strong>Grupo de WhatsApp</strong><span>Comunidade ativa — pessoas reais vencendo problemas reais</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">💛</span><div><strong>Tesouros da Su</strong><span>Direcionamentos, insights e lembretes no momento certo</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">🌱</span><div><strong>Sementes de desconto</strong><span>Desconto real e exclusivo em todos os materiais Vida Mágica.</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">🗺️</span><div><strong>Acompanhamento da jornada</strong><span>Sua jornada ganha vida. Você vê onde está e pra onde vai.</span></div></div>\
            <div class="vm-clube-beneficio"><span class="vm-clube-icone">⚡</span><div><strong>Chat com resposta em até 5 dias</strong><span>Resposta no chat em até 5 dias. Você não está sozinha nessa.</span></div></div>\
          </div>\
          <a href="https://www.vidamagica.com.br/assinar" target="_blank" rel="noopener" class="vm-clube-cta">Quero o Clube Vida Mágica</a>\
          <button type="button" class="vm-clube-depois">Mais tarde</button>\
        </div>';
      document.body.appendChild(overlay);

      const fechar = () => {
        overlay.classList.remove('visible');
        document.body.style.overflow = '';
      };
      overlay.querySelector('.vm-clube-fechar').addEventListener('click', fechar);
      overlay.querySelector('.vm-clube-depois').addEventListener('click', fechar);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
    }
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
  },
};

// ── INIT ──
(async function init() {
  // Restaura a view SALVA antes de qualquer outra coisa, pra evitar o
  // "piscar" da Home (que é a .active default no HTML) antes do JS
  // chegar no fim do init. Síncrono — aplica antes do primeiro paint.
  try {
    const viewSalva = sessionStorage.getItem('vm_view_atual');
    const viewsValidas = ['home', 'jornada', 'produtos', 'fale-com-a-su', 'videos', 'perfil'];
    if (viewSalva && viewSalva !== 'home' && viewsValidas.includes(viewSalva)) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`view-${viewSalva}`)?.classList.add('active');
      document.querySelector(`.nav-tab[data-view="${viewSalva}"]`)?.classList.add('active');
      if (viewSalva === 'fale-com-a-su') {
        document.body.classList.add('antessala-ativa');
      }
    }
  } catch {}

  criarParticulas();
  atualizarBadgeAvisos();
  setupVisualViewport();

  usuario = await checarAuth();
  if (!usuario) return;

  hidratarUI(usuario);

  // Carrega o contexto unificado (aluna + teste + jornada + comprados)
  // e hidrata a Home com base nele.
  const ctx = await carregarContexto();
  if (ctx) hidratarHome(ctx);

  carregarTesouro();
  conectarChatWs();
  carregarResumoChats();
  setInterval(carregarResumoChats, 30000);

  // Se restaurou a antessala lá em cima, atualiza o resumo dos canais
  // (que normalmente é chamado por irPara('fale-com-a-su')).
  if (document.body.classList.contains('antessala-ativa')) {
    carregarResumoChats();
  }
  // Se restaurou o Perfil, renderiza ele (irPara('perfil') faria isso).
  if (document.getElementById('view-perfil')?.classList.contains('active')) {
    renderPerfil();
  }
})();

// ════════════════════════════════════════════════════════════════════
// MODAL POSTAR RELATO (Sub-fase 2.1)
// ════════════════════════════════════════════════════════════════════
window.abrirModalPostarRelato = function(){
  const m = document.getElementById('modal-postar-relato');
  if (!m) return;
  document.getElementById('postar-relato-texto').value = '';
  document.getElementById('postar-relato-feedback').className = 'modal-postar-feedback';
  document.getElementById('postar-relato-feedback').textContent = '';
  document.getElementById('postar-relato-enviar').disabled = false;
  atualizarCounterRelato();
  m.classList.add('aberto');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('postar-relato-texto')?.focus(), 100);
};

window.fecharModalPostarRelato = function(){
  document.getElementById('modal-postar-relato')?.classList.remove('aberto');
  document.body.style.overflow = '';
};

window.atualizarCounterRelato = function(){
  const ta = document.getElementById('postar-relato-texto');
  const c  = document.getElementById('postar-relato-counter');
  if (!ta || !c) return;
  const n = ta.value.length;
  c.textContent = `${n} / 2000 caracteres`;
  c.style.color = (n > 0 && n < 20)
    ? 'var(--ouro-fundo)'
    : (n > 1900 ? '#a83838' : 'var(--texto-mute)');
};

window.postarRelato = async function(){
  const texto = (document.getElementById('postar-relato-texto').value || '').trim();
  const feedback = document.getElementById('postar-relato-feedback');
  const btn = document.getElementById('postar-relato-enviar');
  feedback.className = 'modal-postar-feedback';
  feedback.textContent = '';

  if (texto.length < 20) {
    feedback.className = 'modal-postar-feedback tipo-erro';
    feedback.textContent = 'Escreva pelo menos 20 caracteres pra contar sua história.';
    return;
  }
  btn.disabled = true;
  try {
    const r = await fetchAutenticado(`${API}/api/app/relato`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
    });
    if (!r) return; // fetchAutenticado já tratou expiração de sessão
    const data = await r.json();
    if (!r.ok) {
      feedback.className = 'modal-postar-feedback tipo-erro';
      feedback.textContent = data.erro || 'Não consegui enviar agora.';
      btn.disabled = false;
      return;
    }
    feedback.className = 'modal-postar-feedback tipo-ok';
    feedback.textContent = '✓ Recebemos seu relato! Em breve a equipe vai aprovar e ele aparece na comunidade.';
    setTimeout(() => fecharModalPostarRelato(), 2200);
  } catch {
    feedback.className = 'modal-postar-feedback tipo-erro';
    feedback.textContent = 'Falha na conexão. Tenta de novo daqui a pouco.';
    btn.disabled = false;
  }
};

// ════════════════════════════════════════════════════════════════════
// BAÚ DE RELATOS (Sub-fase 2.2)
// 4 abas: quero | ja_vivo | parabens | nao_e_pra_mim
// ════════════════════════════════════════════════════════════════════
let bauDados = null;
let bauAbaAtual = 'quero';

async function renderBau(){
  const lista = document.getElementById('bau-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="bau-empty">Carregando seu Baú…</div>';
  try {
    const r = await fetchAutenticado(`${API}/api/app/bau`);
    if (!r) return;
    const data = await r.json();
    if (!data.ok) throw new Error(data.erro || 'erro');
    bauDados = data.abas || { quero: [], ja_vivo: [], nao_e_pra_mim: [], parabens: [] };
    // Atualiza contadores nas abas
    ['quero','ja_vivo','parabens','nao_e_pra_mim'].forEach(t => {
      const el = document.getElementById(`bau-count-${t}`);
      if (el) el.textContent = String((bauDados[t] || []).length);
    });
    renderAbaBau(bauAbaAtual);
  } catch {
    lista.innerHTML = '<div class="bau-empty">Não consegui carregar seu Baú agora.</div>';
  }
}

window.trocarAbaBau = function(aba, btn){
  bauAbaAtual = aba;
  document.querySelectorAll('#bau-abas .bau-aba').forEach(b => b.classList.remove('ativa'));
  btn?.classList.add('ativa');
  renderAbaBau(aba);
};

function renderAbaBau(aba){
  const lista = document.getElementById('bau-lista');
  if (!lista || !bauDados) return;
  const itens = bauDados[aba] || [];
  if (!itens.length){
    const msgs = {
      quero:           { ic:'✨', txt:'Quando você marcar "Quero isso na minha vida" em algum relato, ele aparece aqui.' },
      ja_vivo:         { ic:'💛', txt:'Marque "Já vivo isso" pra celebrar — e essas histórias ficam guardadas aqui.' },
      nao_e_pra_mim:   { ic:'🌿', txt:'O que não é seu caminho fica respeitosamente guardado aqui.' },
      parabens:        { ic:'🙏', txt:'Quando você honrar a transformação de outras alunas, fica registrado aqui.' },
    };
    const m = msgs[aba];
    lista.innerHTML = `<div class="bau-empty"><div class="bau-empty-icone">${m.ic}</div>${m.txt}</div>`;
    return;
  }
  lista.innerHTML = itens.map(d => `
    <div class="bau-relato-card ${d.autora_era_assinante_clube ? 'relato-clube' : ''}"
         onclick="abrirRelatoDoBau(${d.id})">
      <div class="relato-card-autor">${escHtml(d.nome || '—')}</div>
      ${(d.profissao || d.idade) ? `<div class="relato-card-meta">${escHtml([d.profissao, d.idade ? d.idade + ' anos' : null].filter(Boolean).join(' • '))}</div>` : ''}
      <p class="relato-card-texto">${escHtml(d.texto || '')}</p>
      ${d.tema_nome ? `<span class="relato-card-tema">${escHtml(d.tema_nome)}</span>` : ''}
    </div>
  `).join('');
}

window.abrirRelatoDoBau = function(id){
  if (!bauDados) return;
  const todos = Object.values(bauDados).flat();
  const rel = todos.find(d => d.id === id);
  if (rel && window.VmRelatos) window.VmRelatos.abrirModal(rel);
};

// ════════════════════════════════════════════════════════════════════
// MEUS RELATOS (Sub-fase 2.1 — lista do que a aluna mandou + status)
// ════════════════════════════════════════════════════════════════════
async function renderMeusRelatos(){
  const lista = document.getElementById('meus-relatos-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="bau-empty">Carregando…</div>';
  try {
    const r = await fetchAutenticado(`${API}/api/app/meus-relatos`);
    if (!r) return;
    const data = await r.json();
    if (!data.ok) throw new Error(data.erro || 'erro');
    const relatos = data.relatos || [];
    if (!relatos.length){
      lista.innerHTML = `
        <div class="bau-empty">
          <div class="bau-empty-icone">📝</div>
          Você ainda não compartilhou nenhum relato.<br>
          <button type="button" class="modal-postar-btn-enviar" style="margin-top:1rem;max-width:240px" onclick="abrirModalPostarRelato()">+ Compartilhar agora</button>
        </div>`;
      return;
    }
    lista.innerHTML = relatos.map(d => {
      const status = d.status_moderacao || 'pendente';
      const corStatus = status === 'aprovado' ? '#4a7a3f' : (status === 'rejeitado' ? '#a83838' : 'var(--ouro-fundo)');
      const bgStatus = status === 'aprovado' ? 'rgba(139,200,122,0.15)' : (status === 'rejeitado' ? 'rgba(200,80,77,0.12)' : 'rgba(200,146,42,0.12)');
      const labelStatus = status === 'aprovado' ? '✓ Aprovado' : (status === 'rejeitado' ? '✗ Não publicado' : '⏳ Em análise');
      return `
        <div class="bau-relato-card" style="cursor:default">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.6rem;margin-bottom:0.4rem">
            <span style="font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:999px;background:${bgStatus};color:${corStatus}">${labelStatus}</span>
            ${d.tema_nome ? `<span class="relato-card-tema" style="margin:0">${escHtml(d.tema_nome)}</span>` : ''}
          </div>
          <p class="relato-card-texto" style="-webkit-line-clamp:6">${escHtml(d.texto || '')}</p>
        </div>
      `;
    }).join('');
  } catch {
    lista.innerHTML = '<div class="bau-empty">Não consegui carregar agora.</div>';
  }
}

// ════════════════════════════════════════════════════════════════════
// RELATOS DA COMUNIDADE — Sub-fase 2.0 + algoritmo completo da 2.5
// Feed horizontal abaixo do Tesouros da Su.
// Estratégia: tenta GET /api/app/relatos-feed (algoritmo inteligente,
// usa config do admin + anti-repetição). Se falhar, cai pro client-side
// simples como fallback.
// Click no card abre o modal universal (relatos-card.js → VmRelatos.abrirModal).
// ════════════════════════════════════════════════════════════════════
async function carregarRelatosComunidade(ctx) {
  const track = document.getElementById('relatos-comunidade-track');
  if (!track) return;

  let ordenados = [];
  // 1ª tentativa: feed inteligente do servidor (Fase 2.5)
  try {
    const r = await fetchAutenticado(`${API}/api/app/relatos-feed?limit=12`);
    if (r && r.ok) {
      const data = await r.json();
      if (data.ok && Array.isArray(data.relatos)) ordenados = data.relatos;
    }
  } catch { /* cai no fallback */ }

  // Fallback client-side (algoritmo simples) — usado se endpoint falhar
  if (!ordenados.length) {
    try {
      const r2 = await fetch('/api/depoimentos', { headers: { 'Accept': 'application/json' } });
      if (!r2.ok) throw new Error('HTTP ' + r2.status);
      const relatos = await r2.json();
      if (!Array.isArray(relatos) || !relatos.length) {
        track.innerHTML = '<div class="relatos-comunidade-loading">Nenhum relato disponível ainda.</div>';
        return;
      }
      const slugsJornada = new Set(
        (ctx?.jornada_atual?.passos || []).map(p => p.produto_slug).filter(Boolean)
      );
      const agora = Date.now();
      const _48h = 48 * 60 * 60 * 1000;
      ordenados = relatos
        .map(rel => {
          const idadeMs = rel.criado_em ? (agora - new Date(rel.criado_em).getTime()) : Infinity;
          const ehNovo = idadeMs <= _48h;
          const ehJornada = rel.produto_slug && slugsJornada.has(rel.produto_slug);
          const peso = Math.random() * (ehNovo ? 5 : 1) * (ehJornada ? 3 : 1);
          return { rel, peso };
        })
        .sort((a, b) => b.peso - a.peso)
        .slice(0, 12)
        .map(x => x.rel);
    } catch (err) {
      console.error('❌ Erro ao carregar relatos da comunidade:', err);
      track.innerHTML = '<div class="relatos-comunidade-loading">Não consegui carregar os relatos agora.</div>';
      return;
    }
  }

  // Daqui pra baixo é o render comum, vindo do feed inteligente OU do fallback
  try {

    // 1º card = botão "+ Compartilhar meu relato" (estilo story). Sempre primeiro.
    const cardCompartilhar = `
      <div class="relato-card relato-card-postar" onclick="abrirModalPostarRelato()" role="button" tabindex="0">
        <div class="relato-postar-icone">＋</div>
        <div class="relato-postar-titulo">Compartilhar<br>meu relato</div>
        <div class="relato-postar-sub">Conte sua transformação</div>
      </div>
    `;

    const cardsRelatos = ordenados.map((d, i) => {
      const metaPartes = [];
      if (d.profissao) metaPartes.push(escHtml(d.profissao));
      if (d.idade) metaPartes.push(escHtml(d.idade + ' anos'));
      const meta = metaPartes.join(' • ');
      const ehClube = !!d.autora_era_assinante_clube;
      return `
        <div class="relato-card ${ehClube ? 'relato-clube' : ''}" data-relato-idx="${i}">
          <div class="relato-card-autor">${escHtml(d.nome || '—')}</div>
          ${meta ? `<div class="relato-card-meta">${meta}</div>` : ''}
          <p class="relato-card-texto">${escHtml(d.texto || '')}</p>
          ${d.tema_nome ? `<span class="relato-card-tema">${escHtml(d.tema_nome)}</span>` : ''}
        </div>
      `;
    }).join('');

    track.innerHTML = cardCompartilhar + cardsRelatos;

    // Ativa click → modal universal (reusa toda a UX do relatos-card.js)
    // Exclui o card "+ Compartilhar" da marcação de índice (ele tem onclick próprio).
    if (window.VmRelatos) {
      window.VmRelatos.iniciar({
        depoimentos: ordenados,
        container: '#relatos-comunidade-track',
        cardSelector: '.relato-card:not(.relato-card-postar)',
      });
    }
  } catch (err) {
    console.error('❌ Erro ao carregar relatos da comunidade:', err);
    track.innerHTML = '<div class="relatos-comunidade-loading">Não consegui carregar os relatos agora.</div>';
  }
}
