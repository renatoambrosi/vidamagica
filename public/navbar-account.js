/* ============================================================
   VIDA MÁGICA — public/navbar-account.js
   Componente compartilhado: monta botão "Minha área" + avatar +
   dropdown de conta DENTRO do container `#navbar-actions` de cada
   página pública. Usado em index.html + 6 LPs.

   DEPENDÊNCIAS:
     - window.VmSession  (definido inline em cada HTML — mesma var
                          já usada antes pra auth da aluna)
     - Elemento com id="navbar-actions" no DOM

   COMPORTAMENTO:
     - Logada → "Minha área" (botão) + avatar (com dropdown 5 itens + Sair)
     - Deslogada → Entrar + Criar conta
     - Se sessão expirou, tenta renovar via refresh_token; se falhar, mostra Entrar/Criar

   ÍCONES: SVGs canônicos COPIADOS de public/app.html (.topo-btn e
   .bottom-nav). NÃO alterar paths sem alinhar com /app — esse é o
   padrão visual do projeto e mudança aqui despadroniza tudo.

   Pareado com /navbar-account.css (visual do componente).
   ============================================================ */

(function () {
  'use strict';

  // ⚠️ FLAG — bloco de conta na navbar das LPs (Entrar / Criar conta / avatar).
  // false (agora) = navbar-actions fica VAZIO (nada de "Entrar" nas LPs), pois o
  //   login/app ainda não foi liberado. true = volta o comportamento completo.
  const NAV_CONTA_ATIVA = false;

  function bootstrap() {
    if (!window.VmSession) return; // VmSession ainda não carregou — sai silencioso
    const actions = document.getElementById('navbar-actions');
    if (!actions) return; // página sem container — não é erro, só não há nada a fazer

    // Fase atual: sem botões de conta nas LPs.
    if (!NAV_CONTA_ATIVA) { actions.innerHTML = ''; return; }

    const API = '';

    function renderBotoes() {
      actions.innerHTML = `
        <a href="/auth?intencional" class="btn-login">Entrar</a>
        <a href="/auth?cadastro" class="btn-cadastro-nav">Criar conta</a>`;
    }

    function renderAvatar(usuario) {
      const iniciais = (usuario.nome || '?')
        .split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
      const fotoHtml = usuario.foto_url
        ? `<img src="${usuario.foto_url}" alt="${escAttr(usuario.nome)}" class="nav-avatar-img">`
        : `<span class="nav-avatar-iniciais">${escHtml(iniciais)}</span>`;

      actions.innerHTML = `
        <a href="/app" class="btn-minha-area" aria-label="Ir para minha área">
          <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Minha área
        </a>
        <div class="nav-avatar-wrap" id="nav-avatar-wrap">
          <button class="nav-avatar-btn" id="nav-avatar-btn" aria-label="Abrir menu da conta" aria-haspopup="true" aria-expanded="false">${fotoHtml}</button>
          <div class="nav-drop" id="nav-drop" role="menu">
            <div class="nav-drop-header">
              <div class="nav-drop-nome">${escHtml(usuario.nome || 'Minha conta')}</div>
              <div class="nav-drop-sub">${escHtml(usuario.email || usuario.telefone_formatado || '')}</div>
            </div>
            <a href="/app" class="nav-drop-item" role="menuitem">
              <svg class="nav-drop-icon" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              Minha área
            </a>
            <a href="/app/jornada" class="nav-drop-item" role="menuitem">
              <svg class="nav-drop-icon" viewBox="0 0 24 24"><path d="M12 2 L14.5 9 L22 9 L16 13.5 L18.5 21 L12 16.5 L5.5 21 L8 13.5 L2 9 L9.5 9 Z"/></svg>
              Minha Jornada
            </a>
            <a href="/app/chat" class="nav-drop-item" role="menuitem">
              <svg class="nav-drop-icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Fale com a Su
            </a>
            <a href="/app/loja" class="nav-drop-item" role="menuitem">
              <svg class="nav-drop-icon" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              Materiais
            </a>
            <a href="/app/perfil" class="nav-drop-item" role="menuitem">
              <svg class="nav-drop-icon" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Perfil
            </a>
            <div class="nav-drop-sep"></div>
            <button class="nav-drop-item danger" id="nav-drop-sair" role="menuitem">
              <svg class="nav-drop-icon" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sair
            </button>
          </div>
        </div>`;

      const btn = document.getElementById('nav-avatar-btn');
      const drop = document.getElementById('nav-drop');
      const wrap = document.getElementById('nav-avatar-wrap');
      const sair = document.getElementById('nav-drop-sair');

      btn?.addEventListener('click', function (e) {
        e.stopPropagation();
        const aberto = drop.classList.toggle('aberto');
        btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      });

      sair?.addEventListener('click', logout);

      // Fecha ao clicar fora
      document.addEventListener('click', function (e) {
        if (wrap && !wrap.contains(e.target) && drop?.classList.contains('aberto')) {
          drop.classList.remove('aberto');
          btn?.setAttribute('aria-expanded', 'false');
        }
      });

      // Fecha com ESC
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && drop?.classList.contains('aberto')) {
          drop.classList.remove('aberto');
          btn?.setAttribute('aria-expanded', 'false');
          btn?.focus();
        }
      });
    }

    async function logout() {
      try {
        await fetch(`${API}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: window.VmSession.getRefresh() }),
        });
      } catch (_) { /* silencioso — logout local roda mesmo se request falhar */ }
      window.VmSession.destruir();
      renderBotoes();
    }

    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escAttr(s) { return escHtml(s); }

    // ── Fluxo principal ──
    (async function () {
      const access = window.VmSession.getAccess();
      if (!access) { renderBotoes(); return; }

      try {
        const r = await fetch(`${API}/api/auth/me`, {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (r.ok) { renderAvatar(await r.json()); return; }
      } catch (_) { /* tenta renovar */ }

      const refresh = window.VmSession.getRefresh();
      if (refresh) {
        try {
          const r2 = await fetch(`${API}/api/auth/renovar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refresh }),
          });
          if (r2.ok) {
            const d = await r2.json();
            window.VmSession.salvar(d, window.VmSession.getLembrar());
            const r3 = await fetch(`${API}/api/auth/me`, {
              headers: { Authorization: `Bearer ${d.access_token}` },
            });
            if (r3.ok) { renderAvatar(await r3.json()); return; }
          }
        } catch (_) { /* cai pra deslogar */ }
      }

      window.VmSession.destruir();
      renderBotoes();
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
