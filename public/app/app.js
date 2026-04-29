/* ── VmSession ── */
window.VmSession=(function(){const K='vm_s',P='vm_lembrar',U='vm_u';function salvar(d,l){const p=l!==undefined?l:getLembrar();localStorage.setItem(P,p?'1':'0');const s=p?localStorage:sessionStorage,o=p?sessionStorage:localStorage;o.removeItem(K);s.setItem(K,JSON.stringify(d));if(d.usuario?.nome)localStorage.setItem(U,JSON.stringify({nome:d.usuario.nome,email:d.usuario.email||null,telefone_formatado:d.usuario.telefone_formatado||null,foto_url:d.usuario.foto_url||null}));}function carregar(){try{const r=localStorage.getItem(K)||sessionStorage.getItem(K);return r?JSON.parse(r):null;}catch{return null;}}function destruir(){localStorage.removeItem(K);sessionStorage.removeItem(K);}function getAccess(){return carregar()?.access_token||null;}function getRefresh(){return carregar()?.refresh_token||null;}function getLembrar(){return localStorage.getItem(P)!=='0';}function getUsuarioLembrado(){try{return JSON.parse(localStorage.getItem(U)||'null');}catch{return null;}}function limparUsuarioLembrado(){localStorage.removeItem(U);}return{salvar,carregar,destruir,getAccess,getRefresh,getLembrar,getUsuarioLembrado,limparUsuarioLembrado};})();

/* ============================================================
   VIDA MÁGICA — App principal
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
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function fecharTodosModais() {
  document.querySelectorAll('.modal').forEach(m => fecharModal(m));
}

// Botões do topo
document.getElementById('btn-arvore')?.addEventListener('click', () => {
  fecharTodosModais();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
document.getElementById('btn-produtos')?.addEventListener('click', () => abrirModal('modal-produtos'));

// Baú de sementes — abre modal-bau
document.getElementById('btn-bau')?.addEventListener('click', () => abrirModal('modal-bau'));

// Avisos — abre modal-avisos
document.getElementById('btn-avisos')?.addEventListener('click', () => {
  renderAvisos();
  abrirModal('modal-avisos');
  // Marca todos como lidos após 2s de visualização
  setTimeout(() => {
    AVISOS.forEach(a => marcarLido(a.id));
    atualizarBadge();
  }, 2000);
});

document.getElementById('btn-conta')?.addEventListener('click', () => abrirModal('modal-conta'));

// Tesouro do dash — abre modal-bau também
document.getElementById('tesouro-bau')?.addEventListener('click', () => abrirModal('modal-bau'));

// Fechar modais
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', e => fecharModal(e.target.closest('.modal')));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharTodosModais(); });

// Logout
document.getElementById('menu-logout')?.addEventListener('click', async () => {
  const refresh = VmSession.getRefresh();
  try { await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) }); } catch {}
  VmSession.destruir();
  window.location.replace('/auth?intencional');
});

// Trilha
document.querySelectorAll('.trilha-card-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    const step = e.target.closest('.trilha-item')?.dataset.step;
    console.log(`[Vida Mágica] trilha step ${step}`);
  });
});

// ── AVISOS & NOVIDADES ──────────────────────────────────────
// Array estático por enquanto — substituir por /api/avisos quando pronto

const AVISOS_KEY = 'vm_avisos_lidos';

const AVISOS = [
  {
    id: 'av_tesouro_01',
    tag: 'Tesouro da Su',
    titulo: 'Seu presente de hoje chegou! 🎁',
    desc: 'O Tesouro da Su está disponível. Abra agora e colete sua semente do dia.',
    data: 'Hoje',
  },
  {
    id: 'av_teste_01',
    tag: 'Ação necessária',
    titulo: 'Seu Teste de Prosperidade aguarda',
    desc: 'Você ainda não concluiu o Teste de Prosperidade. Ele é o primeiro passo da sua trilha.',
    data: 'Esta semana',
  },
  {
    id: 'av_video_01',
    tag: 'Novidade',
    titulo: 'Novo vídeo disponível no app',
    desc: 'A Suellen publicou uma aula exclusiva para membros do Clube Vida Mágica.',
    data: '2 dias atrás',
  },
];

function getLidos() {
  try { return JSON.parse(localStorage.getItem(AVISOS_KEY) || '[]'); } catch { return []; }
}

function marcarLido(id) {
  const lidos = getLidos();
  if (!lidos.includes(id)) { lidos.push(id); localStorage.setItem(AVISOS_KEY, JSON.stringify(lidos)); }
}

function atualizarBadge() {
  const lidos = getLidos();
  const naoLidos = AVISOS.filter(a => !lidos.includes(a.id)).length;
  const badge = document.getElementById('avisos-badge');
  if (!badge) return;
  if (naoLidos > 0) badge.classList.add('visivel');
  else badge.classList.remove('visivel');
}

function renderAvisos() {
  const lista = document.getElementById('avisos-lista');
  if (!lista) return;
  if (!AVISOS.length) {
    lista.innerHTML = `<div class="aviso-vazio"><div class="aviso-vazio-icon">🌱</div><p>Nenhum aviso por enquanto.<br>Volte amanhã para novidades.</p></div>`;
    return;
  }
  const lidos = getLidos();
  lista.innerHTML = `<ul class="aviso-lista">${AVISOS.map(a => {
    const naoLido = !lidos.includes(a.id);
    return `<li class="aviso-item${naoLido ? ' nao-lido' : ''}" data-id="${a.id}">
      <div class="aviso-dot"></div>
      <div class="aviso-corpo">
        <div class="aviso-tag">${a.tag}</div>
        <div class="aviso-titulo">${a.titulo}</div>
        <div class="aviso-desc">${a.desc}</div>
        <div class="aviso-data">${a.data}</div>
      </div>
    </li>`;
  }).join('')}</ul>`;

  lista.querySelectorAll('.aviso-item').forEach(el => {
    el.addEventListener('click', () => {
      marcarLido(el.dataset.id);
      el.classList.remove('nao-lido');
      atualizarBadge();
    });
  });
}

// ── PWA ─────────────────────────────────────────────────────

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e;
  const banner = document.getElementById('pwa-banner');
  if (banner) banner.hidden = false;
});
document.getElementById('pwa-instalar')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice;
  deferredPrompt = null; document.getElementById('pwa-banner').hidden = true;
});
document.getElementById('pwa-depois')?.addEventListener('click', () => {
  document.getElementById('pwa-banner').hidden = true;
});

// ── INIT ─────────────────────────────────────────────────────

(async function init() {
  criarParticulas();
  atualizarBadge();
  const usuario = await checarAuth();
  hidratarUI(usuario);
  console.log('[Vida Mágica] App inicializado');
})();
