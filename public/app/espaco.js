/* === VIDA MÁGICA — public/app/espaco.js ===
   Lógica do Espaço da Manifestação (página própria espaco.html).

   Inclui (autônomo, não depende do app.js):
   - VmSession (mesma chave de storage do /app — sessão compartilhada)
   - fetchAutenticado com renovação de token (mescla preservando refresh_token)
   - Animação de abertura (cérebro dourado) — PORTADA do Caderno, fiel
   - Sistema de 3 temas (preview → confirma com check → reverte se sair)
   - Dropup do avatar (cartas/manifestações/voltar) + navegação dos caminhos

   NOTA: o VmSession aqui é cópia do app.js (sessão compartilhada via mesma
   chave 'vm_s'). Unificar num sessao.js compartilhado é faxina futura.
   === */
(function () {
  'use strict';

  // ── SESSÃO (mesma chave do /app) ───────────────────────────
  const VmSession = (function () {
    const K = 'vm_s', P = 'vm_lembrar';
    function getLembrar() { return localStorage.getItem(P) !== '0'; }
    function salvar(d, l) {
      const p = l !== undefined ? l : getLembrar();
      localStorage.setItem(P, p ? '1' : '0');
      const s = p ? localStorage : sessionStorage, o = p ? sessionStorage : localStorage;
      o.removeItem(K); s.setItem(K, JSON.stringify(d));
    }
    function carregar() {
      try { const r = localStorage.getItem(K) || sessionStorage.getItem(K); return r ? JSON.parse(r) : null; }
      catch { return null; }
    }
    function destruir() { localStorage.removeItem(K); sessionStorage.removeItem(K); }
    function getAccess() { return carregar()?.access_token || null; }
    function getRefresh() { return carregar()?.refresh_token || null; }
    return { salvar, carregar, destruir, getAccess, getRefresh, getLembrar };
  })();

  function irLogin() { window.location.replace('/auth?intencional'); }

  // Wrapper de fetch autenticado — renova token em 401 (mesclando, preservando
  // o refresh_token; mesmo fix aplicado no app.js).
  async function fetchAutenticado(url, opts = {}) {
    const access = VmSession.getAccess();
    if (!access) { irLogin(); return null; }
    const fazer = (token) => {
      const headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
      if (typeof opts.body === 'string' && !headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      return fetch(url, Object.assign({}, opts, { headers }));
    };
    try {
      let r = await fazer(access);
      if (r.status !== 401) return r;
      const refresh = VmSession.getRefresh();
      if (!refresh) { VmSession.destruir(); irLogin(); return null; }
      const rRen = await fetch('/api/auth/renovar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!rRen.ok) { VmSession.destruir(); irLogin(); return null; }
      const novo = await rRen.json();
      VmSession.salvar({ ...(VmSession.carregar() || {}), ...novo }, VmSession.getLembrar());
      return await fazer(novo.access_token);
    } catch (e) { console.warn('[espaco] fetch erro:', e); return null; }
  }

  // ── HELPERS ────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  let _toastTimer = null;
  function toast(msg) {
    const t = el('espaco-toast');
    if (!t) return;
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2600);
  }

  // ════════════════════════════════════════════════════════════
  // ANIMAÇÃO DE ABERTURA — portada do Caderno (FIEL). Cérebro dourado,
  // 5 frases empilhando, 6,25s. Aprovada pelo Renato — não mexer no design.
  // ════════════════════════════════════════════════════════════
  const LOADING_STEP_MS = 1250;
  const LOADING_STEPS = 5;
  const LOADING_DURACAO_MS = LOADING_STEPS * LOADING_STEP_MS; // 6250ms
  const LOADING_RITUAL_ATIVO = true;
  let _loadingTimers = [];

  function criarSparklesLoading() {
    const wrap = el('espaco-loading-sparkles');
    if (!wrap || wrap.dataset.gerado === '1') return;
    wrap.dataset.gerado = '1';
    let html = '';
    for (let i = 0; i < 22; i++) {
      const left = Math.random() * 100;
      const size = 2 + Math.random() * 5;
      const delay = -Math.random() * 10;
      const dur = 4 + Math.random() * 6;
      html += `<span class="espaco-sparkle" style="--sp-left:${left}%;--sp-size:${size}px;--sp-delay:${delay}s;--sp-dur:${dur}s"></span>`;
    }
    wrap.innerHTML = html;
  }

  function getLoadingCount() {
    try { return parseInt(localStorage.getItem('vm_espaco_loading_vezes') || '0', 10) || 0; } catch { return 0; }
  }
  function incLoadingCount() {
    try { const n = getLoadingCount() + 1; localStorage.setItem('vm_espaco_loading_vezes', String(n)); return n; } catch { return 1; }
  }

  function dispararLoadingRitual() {
    const overlay = el('espaco-loading');
    if (!overlay) return;
    criarSparklesLoading();
    _loadingTimers.forEach(t => clearTimeout(t));
    _loadingTimers = [];
    overlay.classList.remove('ativo', 'saindo');
    void overlay.offsetWidth;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('ativo');

    const vezes = incLoadingCount();
    const btnPular = el('espaco-loading-pular');
    if (btnPular) {
      if (vezes >= 2) { btnPular.style.display = ''; btnPular.style.animation = 'none'; void btnPular.offsetWidth; btnPular.style.animation = ''; }
      else { btnPular.style.display = 'none'; }
    }

    const fraseArea = el('espaco-loading-frase-area');
    if (fraseArea) fraseArea.innerHTML = '';
    const FRASES = [
      { texto: 'Acessando o subconsciente…', cor: null },
      { texto: 'Acessando sonhos…', cor: null },
      { texto: 'Indo a lugares profundos…', cor: null },
      { texto: 'Conectado', cor: 'verde' },
      { texto: 'Pronto para manifestar ✨', cor: 'dourado' },
    ];
    const tocarFrase = (i) => {
      if (!fraseArea) return;
      const item = FRASES[i] || FRASES[0];
      const p = document.createElement('p');
      p.className = 'espaco-loading-frase entrando';
      p.textContent = item.texto;
      if (item.cor === 'verde') p.classList.add('final-verde');
      else if (item.cor === 'dourado') p.classList.add('final-dourado');
      fraseArea.prepend(p);
      requestAnimationFrame(() => { requestAnimationFrame(() => p.classList.remove('entrando')); });
    };
    for (let i = 0; i < LOADING_STEPS; i++) {
      _loadingTimers.push(setTimeout(() => tocarFrase(i), i * LOADING_STEP_MS));
    }
    _loadingTimers.push(setTimeout(() => {
      const b = el('espaco-loading-pular');
      if (b) b.style.display = 'none';
      overlay.classList.add('saindo');
      _loadingTimers.push(setTimeout(() => {
        overlay.classList.remove('ativo', 'saindo');
        overlay.setAttribute('aria-hidden', 'true');
      }, 500));
    }, LOADING_DURACAO_MS));
  }

  function pularLoading() {
    const overlay = el('espaco-loading');
    if (!overlay) return;
    _loadingTimers.forEach(t => clearTimeout(t));
    _loadingTimers = [];
    const btn = el('espaco-loading-pular');
    if (btn) btn.style.display = 'none';
    overlay.classList.add('saindo');
    setTimeout(() => { overlay.classList.remove('ativo', 'saindo'); overlay.setAttribute('aria-hidden', 'true'); }, 400);
    criarParticulas();
  }

  function criarParticulas() {
    const wrap = el('espaco-particulas');
    if (!wrap || wrap.dataset.gerado === '1') return;
    wrap.dataset.gerado = '1';
    const ehClube = !!window._espacoCtx?.tem_clube;
    const total = ehClube ? 26 : 18;   // reduzido — performance no iOS
    let html = '';
    for (let i = 0; i < total; i++) {
      const left = Math.random() * 100;
      const size = 2 + Math.random() * 4;
      const delay = -Math.random() * 18;
      const dur = 14 + Math.random() * 10;
      const opacity = 0.35 + Math.random() * 0.45;
      html += `<span class="espaco-particula" style="--p-left:${left}%;--p-size:${size}px;--p-delay:${delay}s;--p-dur:${dur}s;--p-op:${opacity}"></span>`;
    }
    wrap.innerHTML = html;
  }

  // ════════════════════════════════════════════════════════════
  // TEMAS — preview ao tocar, confirma no check, reverte se fechar.
  // ════════════════════════════════════════════════════════════
  let temaSalvo = 'vida_magica';   // o confirmado (no banco)
  let temaPreview = null;          // o em pré-visualização

  function aplicarTema(tema) { document.body.setAttribute('data-tema', tema); }

  function marcarItens() {
    document.querySelectorAll('.espaco-tema-item').forEach(it => {
      it.classList.toggle('ativo', it.dataset.tema === temaSalvo);
      it.classList.toggle('previewing', temaPreview && it.dataset.tema === temaPreview && temaPreview !== temaSalvo);
    });
  }

  function abrirMenuTema() {
    el('espaco-tema-menu')?.classList.add('aberto');
    temaPreview = null;
    marcarItens();
  }
  function fecharMenuTema() {
    el('espaco-tema-menu')?.classList.remove('aberto');
    // Reverte preview não confirmado
    if (temaPreview && temaPreview !== temaSalvo) { aplicarTema(temaSalvo); temaPreview = null; marcarItens(); }
  }

  async function confirmarTema(tema) {
    temaSalvo = tema; temaPreview = null;
    aplicarTema(tema); marcarItens();
    el('espaco-tema-menu')?.classList.remove('aberto');
    try {
      await fetchAutenticado('/api/app/espaco/tema', { method: 'PUT', body: JSON.stringify({ tema }) });
    } catch (_) {}
  }

  function ligarTemas() {
    el('espaco-tema-bolinha')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = el('espaco-tema-menu');
      if (menu?.classList.contains('aberto')) fecharMenuTema(); else { fecharMenuAvatar(); abrirMenuTema(); }
    });
    document.querySelectorAll('.espaco-tema-item').forEach(item => {
      const tema = item.dataset.tema;
      // Toque no item (fora do check) = preview imediato
      item.addEventListener('click', (e) => {
        if (e.target.closest('.espaco-tema-check')) return; // o check tem handler próprio
        temaPreview = tema; aplicarTema(tema); marcarItens();
      });
      // Toque no check = confirma
      item.querySelector('.espaco-tema-check')?.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmarTema(tema);
      });
    });
  }

  // ════════════════════════════════════════════════════════════
  // AVATAR DROPUP + NAVEGAÇÃO
  // ════════════════════════════════════════════════════════════
  function abrirMenuAvatar() { el('espaco-avatar-menu')?.classList.add('aberto'); }
  function fecharMenuAvatar() { el('espaco-avatar-menu')?.classList.remove('aberto'); }

  function ligarAvatar() {
    el('espaco-avatar')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = el('espaco-avatar-menu');
      if (menu?.classList.contains('aberto')) fecharMenuAvatar(); else { fecharMenuTema(); abrirMenuAvatar(); }
    });
    el('menu-cartas')?.addEventListener('click', () => { fecharMenuAvatar(); toast('Minhas cartas do tempo — em breve ✨'); });
    el('menu-manifestacoes')?.addEventListener('click', () => { fecharMenuAvatar(); toast('Minhas manifestações — em breve ✨'); });
    el('menu-voltar')?.addEventListener('click', () => { window.location.href = '/app'; });

    // Fecha menus ao tocar FORA deles (e fora dos botões que os abrem).
    // Sem este guard, o clique num item do menu borbulhava pro document e
    // fechava o menu na hora — o preview de tema "não obedecia".
    document.addEventListener('click', (e) => {
      if (e.target.closest('#espaco-tema-menu') || e.target.closest('#espaco-tema-bolinha')
        || e.target.closest('#espaco-avatar-menu') || e.target.closest('#espaco-avatar')) return;
      fecharMenuTema();
      fecharMenuAvatar();
    });
  }

  function ligarCaminhos() {
    document.querySelectorAll('.espaco-caminho').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.caminho;
        const nomes = { meditar: 'Meditação guiada', carta: 'Carta do tempo', manifestar: 'Manifestar' };
        toast(`${nomes[c] || 'Em breve'} — em breve ✨`);
      });
    });
    // Ferramentas (timer / música / afirmação) — painel Ambiente vem depois
    el('ferr-timer')?.addEventListener('click', () => toast('Timer — em breve ✨'));
    el('ferr-musica')?.addEventListener('click', () => toast('Música — em breve ✨'));
    el('ferr-afirmacao')?.addEventListener('click', () => toast('Afirmações — em breve ✨'));
  }

  // ════════════════════════════════════════════════════════════
  // CONTEXTO + INIT
  // ════════════════════════════════════════════════════════════
  function hidratar(ctx) {
    window._espacoCtx = ctx;
    if (!ctx) return;
    // Tema salvo
    temaSalvo = ctx.tema || 'vida_magica';
    aplicarTema(temaSalvo);
    marcarItens();
    // Sementes
    const sem = el('espaco-sementes-num');
    if (sem) sem.textContent = ctx.aluna?.sementes || 0;
    // Avatar — foto se houver, senão inicial do nome
    const av = el('espaco-avatar');
    if (av) {
      if (ctx.aluna?.foto_url) {
        const img = document.createElement('img');
        img.src = ctx.aluna.foto_url; img.alt = '';
        av.innerHTML = ''; av.appendChild(img);
      } else {
        av.innerHTML = `<span id="espaco-avatar-inicial">${(ctx.aluna?.nome || '·').trim().charAt(0).toUpperCase() || '·'}</span>`;
      }
    }
    // Saudação
    const tit = el('espaco-saudacao-titulo');
    const primeiro = (ctx.aluna?.nome || '').split(' ')[0];
    if (tit && primeiro) tit.textContent = `${primeiro}, o que você quer viver agora?`;
  }

  async function init() {
    // Sem sessão → login
    if (!VmSession.getAccess()) { irLogin(); return; }

    ligarTemas();
    ligarAvatar();
    ligarCaminhos();
    el('espaco-loading-pular')?.addEventListener('click', pularLoading);

    // Dispara a animação de abertura imediatamente
    if (LOADING_RITUAL_ATIVO) {
      dispararLoadingRitual();
      setTimeout(criarParticulas, LOADING_DURACAO_MS + 600);
    } else {
      criarParticulas();
    }

    // Carrega contexto (tema/sementes/nome)
    try {
      const r = await fetchAutenticado('/api/app/espaco/contexto');
      if (r) { const d = await r.json(); if (d?.ok) hidratar(d); }
    } catch (e) { console.warn('[espaco] contexto:', e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
