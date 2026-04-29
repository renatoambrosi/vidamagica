/* ============================================================
   VIDA MÁGICA — App principal
   Navegação, modais, partículas, integração com /api/auth/me
   ============================================================ */

const API = ''; // mesmo domínio (server.js serve tudo junto)

// ───────────────────────────────────────────────────────────
// AUTH GUARD — redireciona se não logado
// ───────────────────────────────────────────────────────────

async function checarAuth() {
  const token = localStorage.getItem('vm_access');
  if (!token) {
    window.location.href = '/auth';
    return null;
  }

  try {
    const r = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (r.status === 401) {
      // Token expirado — tenta renovar
      const novoToken = await tentarRenovarToken();
      if (!novoToken) {
        localStorage.removeItem('vm_access');
        localStorage.removeItem('vm_refresh');
        window.location.href = '/auth';
        return null;
      }
      // refaz com token novo
      const r2 = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${novoToken}` },
      });
      if (!r2.ok) throw new Error('me falhou após renovar');
      return await r2.json();
    }

    if (!r.ok) throw new Error('Erro ao buscar perfil');
    return await r.json();
  } catch (err) {
    console.error('[Vida Mágica] erro auth:', err.message);
    // Em desenvolvimento, deixa passar com mock
    return null;
  }
}

async function tentarRenovarToken() {
  const refresh = localStorage.getItem('vm_refresh');
  if (!refresh) return null;
  try {
    const r = await fetch(`${API}/api/auth/renovar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    localStorage.setItem('vm_access', d.access_token);
    return d.access_token;
  } catch {
    return null;
  }
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
  const refresh = localStorage.getItem('vm_refresh') || sessionStorage.getItem('vm_refresh');
  try {
    await fetch(`${API}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
  } catch {}
  // Limpa todos os tokens e dados de sessão
  ['vm_access', 'vm_refresh', 'vm_usuario_lembrado', 'vm_identificador_salvo'].forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
  // Flag que impede auto-login ao chegar na tela de auth
  sessionStorage.setItem('vm_logout_intencional', '1');
  window.location.href = '/auth';
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
