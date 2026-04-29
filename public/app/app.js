/* ── VmSession ── */
window.VmSession=(function(){const K='vm_s',P='vm_lembrar',U='vm_u';function salvar(d,l){const p=l!==undefined?l:getLembrar();localStorage.setItem(P,p?'1':'0');const s=p?localStorage:sessionStorage,o=p?sessionStorage:localStorage;o.removeItem(K);s.setItem(K,JSON.stringify(d));if(d.usuario?.nome)localStorage.setItem(U,JSON.stringify({nome:d.usuario.nome,email:d.usuario.email||null,telefone_formatado:d.usuario.telefone_formatado||null,foto_url:d.usuario.foto_url||null}));}function carregar(){try{const r=localStorage.getItem(K)||sessionStorage.getItem(K);return r?JSON.parse(r):null;}catch{return null;}}function destruir(){localStorage.removeItem(K);sessionStorage.removeItem(K);}function getAccess(){return carregar()?.access_token||null;}function getRefresh(){return carregar()?.refresh_token||null;}function getLembrar(){return localStorage.getItem(P)!=='0';}function getUsuarioLembrado(){try{return JSON.parse(localStorage.getItem(U)||'null');}catch{return null;}}function limparUsuarioLembrado(){localStorage.removeItem(U);}return{salvar,carregar,destruir,getAccess,getRefresh,getLembrar,getUsuarioLembrado,limparUsuarioLembrado};})();

/* ============================================================
   VIDA MÁGICA — App principal
   Navegação, modais, partículas, integração com /api/auth/me
   ============================================================ */

const API = ''; // mesmo domínio (server.js serve tudo junto)

// ───────────────────────────────────────────────────────────
// AUTH GUARD — redireciona se não logado
// ───────────────────────────────────────────────────────────

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
        const r2 = await fetch(`${API}/api/auth/renovar`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (r2.ok) {
          const d = await r2.json();
          VmSession.salvar(d, VmSession.getLembrar());
          const r3 = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${d.access_token}` } });
          if (r3.ok) return await r3.json();
        }
      } catch {}
      VmSession.destruir();
      window.location.replace('/auth?intencional');
      return null;
    }
  } catch (err) {
    console.error('[Vida Mágica] erro auth:', err.message);
  }
  return null;
}

// ───────────────────────────────────────────────────────────
// HIDRATAR UI COM DADOS DO USUÁRIO
// ───────────────────────────────────────────────────────────

function hidratarUI(usuario) {
  if (!usuario) return;

  // Saudação
  const nomeEl = document.getElementById('saudacao-nome');
  if (nomeEl) {
    const primeiroNome = (usuario.nome || '').split(' ')[0] || 'Sua jornada';
    nomeEl.textContent = primeiroNome ? `Olá, ${primeiroNome}` : 'Sua jornada';
  }

  // Sementes
  const sementesEl = document.getElementById('topo-sementes');
  if (sementesEl) {
    sementesEl.textContent = usuario.sementes || 0;
  }
}

// ───────────────────────────────────────────────────────────
// PARTÍCULAS DOURADAS (luzinhas mágicas no ar)
// ───────────────────────────────────────────────────────────

function criarParticulas() {
  const c = document.getElementById('particulas');
  if (!c) return;
  const count = window.innerWidth < 640 ? 14 : 22;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particula';
    const tamanho = Math.random() * 4 + 2;
    p.style.cssText = `
      width: ${tamanho}px;
      height: ${tamanho}px;
      left: ${Math.random() * 100}%;
      animation-duration: ${Math.random() * 16 + 12}s;
      animation-delay: ${Math.random() * 18}s;
    `;
    c.appendChild(p);
  }
}

// ───────────────────────────────────────────────────────────
// MODAIS
// ───────────────────────────────────────────────────────────

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

// Listeners dos botões do topo
document.getElementById('btn-conta')?.addEventListener('click', () => abrirModal('modal-conta'));
document.getElementById('btn-produtos')?.addEventListener('click', () => abrirModal('modal-produtos'));
document.getElementById('btn-bau')?.addEventListener('click', () => abrirModal('modal-bau'));
document.getElementById('btn-arvore')?.addEventListener('click', () => {
  fecharTodosModais();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Botões de fechar dos modais
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', e => {
    fecharModal(e.target.closest('.modal'));
  });
});

// Fecha modal com ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') fecharTodosModais();
});

// Logout
document.getElementById('menu-logout')?.addEventListener('click', async () => {
  const refresh = VmSession.getRefresh();
  try {
    await fetch(`${API}/api/auth/logout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
  } catch {}
  VmSession.destruir();
  // ?intencional impede auto-login na tela de auth
  window.location.replace('/auth?intencional');
});

// ───────────────────────────────────────────────────────────
// TESOURO DA SU (mock — abre modal por enquanto)
// ───────────────────────────────────────────────────────────

document.getElementById('tesouro-bau')?.addEventListener('click', () => {
  abrirModal('modal-bau');
});

// ───────────────────────────────────────────────────────────
// TRILHA — botões das atividades (mock)
// ───────────────────────────────────────────────────────────

document.querySelectorAll('.trilha-card-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    const item = e.target.closest('.trilha-item');
    const step = item?.dataset.step;
    console.log(`[Vida Mágica] clique trilha step ${step}`);
    // TODO: navegar para a atividade correspondente
  });
});

// ───────────────────────────────────────────────────────────
// PWA — esqueleto do banner de instalação
// ───────────────────────────────────────────────────────────

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('pwa-banner');
  if (banner) banner.hidden = false;
});

document.getElementById('pwa-instalar')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('pwa-banner').hidden = true;
});

document.getElementById('pwa-depois')?.addEventListener('click', () => {
  document.getElementById('pwa-banner').hidden = true;
});

// ───────────────────────────────────────────────────────────
// INIT
// ───────────────────────────────────────────────────────────

(async function init() {
  criarParticulas();

  const usuario = await checarAuth();
  hidratarUI(usuario);

  console.log('[Vida Mágica] App inicializado');
})();
