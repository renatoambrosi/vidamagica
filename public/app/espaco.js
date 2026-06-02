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

  let devCarta = false;   // modo dev da Carta do Tempo (vem do /contexto: dev_carta)

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

  function aplicarTema(tema) {
    document.body.setAttribute('data-tema', tema);
    // Fora do Universo, zera o deslocamento do parallax (volta a imagem ao centro)
    if (tema !== 'universo') { const bg = el('espaco-bg'); if (bg) bg.style.transform = ''; }
  }

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
    talvezOferecerGiro(tema);
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
    el('menu-cartas')?.addEventListener('click', () => {
      fecharMenuAvatar();
      irPara('view-minhas-cartas');
      carregarMinhasCartas();
    });
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

  // ── NAVEGAÇÃO ENTRE VIEWS DO ESPAÇO ──────────────────────────
  // Mantemos uma única "view ativa" — troca por classe .ativa. O JS é leve
  // (sem router/HMR), e o estado mora só na DOM.
  function irPara(viewId) {
    document.querySelectorAll('.espaco-view').forEach(v => v.classList.remove('ativa'));
    const alvo = el(viewId);
    if (alvo) { alvo.classList.add('ativa'); document.querySelector('.espaco-corpo')?.scrollTo({ top: 0, behavior: 'instant' }); }
    fecharMenuTema(); fecharMenuAvatar();
  }

  function ligarCaminhos() {
    // Caminhos da entrada
    document.querySelectorAll('.espaco-caminho').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.caminho;
        if (c === 'carta')      return irPara('view-carta');
        if (c === 'manifestar') return toast('Quero manifestar — em breve ✨');
        if (c === 'meditar')    return toast('Quero meditar — em breve ✨');
      });
    });
    // Voltar (em qualquer view interna) — data-voltar="entrada"
    document.querySelectorAll('[data-voltar]').forEach(b => {
      b.addEventListener('click', () => irPara('view-' + b.dataset.voltar));
    });
    // Botão central "Ambiente" (timer + música + afirmações) — painel vem depois
    el('ferr-ambiente')?.addEventListener('click', () => toast('Ambiente (timer · música · afirmações) — em breve ✨'));
    // Início — volta ao topo da Meditação Guiada
    el('nav-inicio')?.addEventListener('click', () => {
      irPara('view-entrada');
    });
  }

  // ════════════════════════════════════════════════════════════
  // CARTA DO TEMPO — form (escrever) + lista + modal de abrir
  // ════════════════════════════════════════════════════════════
  let cartaDiasEscolhido = null;   // dias do preset (30/90/180/365) ou 'custom'

  function ligarFormCarta() {
    const ta = el('carta-conteudo');
    const cnt = el('carta-contador');
    const dataIn = el('carta-data');
    const resumo = el('carta-data-resumo');

    // Contador de caracteres
    ta?.addEventListener('input', () => { if (cnt) cnt.textContent = String(ta.value.trim().length); });

    // Presets de data
    document.querySelectorAll('.espaco-data-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.espaco-data-preset').forEach(b => b.classList.remove('selecionado'));
        btn.classList.add('selecionado');
        const v = btn.dataset.dias;
        cartaDiasEscolhido = v;
        if (v === 'custom') {
          dataIn?.classList.add('aberto');
          // Min: amanhã
          const min = new Date(Date.now() + 24 * 3600 * 1000);
          if (dataIn) dataIn.min = min.toISOString().slice(0, 10);
          if (resumo) resumo.textContent = 'Escolha a data exata abaixo.';
          setTimeout(() => dataIn?.focus(), 80);
        } else if (v === 'dev') {
          dataIn?.classList.remove('aberto');
          if (resumo) resumo.textContent = 'Modo teste: a carta abre em ~20 segundos.';
        } else {
          dataIn?.classList.remove('aberto');
          const dias = parseInt(v, 10);
          const d = new Date(Date.now() + dias * 24 * 3600 * 1000);
          if (resumo) resumo.textContent = `Sua carta abre em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.`;
        }
      });
    });
    dataIn?.addEventListener('change', () => {
      const v = dataIn.value;
      if (!v) return;
      const d = new Date(v + 'T12:00:00');
      if (resumo) resumo.textContent = `Sua carta abre em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.`;
    });

    // Botão "Testar envios agora" (modo dev) — dispara WhatsApp + email e mostra o resultado
    el('carta-testar-envio')?.addEventListener('click', async () => {
      const btn = el('carta-testar-envio');
      const txtOriginal = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Disparando teste...'; }
      try {
        const titulo = (el('carta-titulo')?.value || '').trim();   // usa o que VOCÊ digitou
        const r = await fetchAutenticado('/api/app/espaco/cartas/testar-envio', { method: 'POST', body: JSON.stringify({ titulo }) });
        if (!r) return;
        const d = await r.json().catch(() => ({}));
        if (!d?.ok) { toast(d?.erro || 'Não consegui testar agora.'); return; }
        const wa = d.whatsapp?.ok ? 'WhatsApp ✓' : `WhatsApp ✗ (${d.whatsapp?.motivo || 'falha'})`;
        const em = d.email?.ok ? 'E-mail ✓' : `E-mail ✗ (${d.email?.motivo || 'falha'})`;
        toast(`${wa} · ${em}`);
      } catch (err) {
        console.warn('[espaco] testar-envio:', err);
        toast('Não consegui testar agora.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = txtOriginal; }
      }
    });

    // Submit
    el('form-carta')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titulo = (el('carta-titulo')?.value || '').trim();
      const conteudo = (ta?.value || '').trim();
      if (conteudo.length < 10) { toast('Escreva pelo menos 10 caracteres.'); return; }
      if (!cartaDiasEscolhido) { toast('Escolha quando reler.'); return; }
      let abrirEm = null;
      if (cartaDiasEscolhido === 'custom') {
        if (!dataIn?.value) { toast('Escolha a data.'); return; }
        abrirEm = new Date(dataIn.value + 'T12:00:00');
      } else if (cartaDiasEscolhido === 'dev') {
        abrirEm = new Date(Date.now() + 20 * 1000);   // ~20s — modo teste
      } else {
        const dias = parseInt(cartaDiasEscolhido, 10);
        abrirEm = new Date(Date.now() + dias * 24 * 3600 * 1000);
      }
      // Em modo teste (dev) o mínimo cai pra alguns segundos; senão exige 1 dia.
      const minMs = cartaDiasEscolhido === 'dev' ? 10 * 1000 : 24 * 3600 * 1000;
      if (!(abrirEm.getTime() > Date.now() + minMs)) {
        toast(cartaDiasEscolhido === 'dev' ? 'Escolha uma data no futuro.' : 'A data precisa estar pelo menos 1 dia no futuro.'); return;
      }

      const btn = el('carta-lacrar');
      if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Lacrando...'; }
      try {
        const r = await fetchAutenticado('/api/app/espaco/cartas', {
          method: 'POST',
          body: JSON.stringify({ titulo, conteudo, abrir_em: abrirEm.toISOString() }),
        });
        if (!r) return;
        const d = await r.json().catch(() => ({}));
        if (!d?.ok) { toast(d?.erro || 'Não consegui lacrar a carta.'); return; }
        // Limpa o form
        if (ta) ta.value = ''; if (cnt) cnt.textContent = '0';
        const tit = el('carta-titulo'); if (tit) tit.value = '';
        document.querySelectorAll('.espaco-data-preset').forEach(b => b.classList.remove('selecionado'));
        dataIn?.classList.remove('aberto');
        if (dataIn) dataIn.value = '';
        if (resumo) resumo.textContent = 'Escolha quando a carta deve ser aberta.';
        cartaDiasEscolhido = null;
        toast('Carta lacrada ✨');
        setTimeout(() => { irPara('view-minhas-cartas'); carregarMinhasCartas(); }, 600);
      } catch (err) {
        console.warn('[espaco] lacrar carta:', err);
        toast('Não consegui lacrar agora. Tenta de novo.');
      } finally {
        if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Lacrar carta'; }
      }
    });
  }

  // ── LISTA "Minhas cartas do tempo" ───────────────────────────
  function fmtData(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }); }
    catch { return ''; }
  }
  function fmtRelativoFuturo(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'pronta pra abrir';
    if (ms < 60 * 1000) return 'abre em instantes';
    if (ms < 3600 * 1000) { const m = Math.round(ms / 60000); return `abre em ${m} min`; }
    if (ms < 24 * 3600 * 1000) return 'abre ainda hoje';
    const dias = Math.ceil(ms / (24 * 3600 * 1000));
    if (dias === 1) return 'abre amanhã';
    if (dias < 30)  return `abre em ${dias} dias`;
    const meses = Math.round(dias / 30);
    if (meses < 12) return `abre em ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    const anos = Math.round(dias / 365);
    return `abre em ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  }

  async function carregarMinhasCartas() {
    const wrap = el('cartas-lista');
    if (!wrap) return;
    wrap.innerHTML = '<div class="espaco-skeleton-carta"></div><div class="espaco-skeleton-carta"></div>';
    try {
      const r = await fetchAutenticado('/api/app/espaco/cartas');
      if (!r) return;
      const d = await r.json().catch(() => ({}));
      const cartas = (d?.cartas || []);
      if (cartas.length === 0) {
        wrap.innerHTML = `
          <div class="espaco-vazio">
            <strong>Ainda não tem nenhuma carta aqui.</strong>
            Você pode escrever a primeira pelo caminho “Carta do tempo”.
          </div>`;
        return;
      }
      wrap.innerHTML = cartas.map(c => {
        const trancada = !!c.trancada;
        const titulo = (c.titulo || 'Carta sem título').replace(/</g, '&lt;');
        const meta = trancada
          ? `Lacrada · ${fmtRelativoFuturo(c.abrir_em)}`
          : `Aberta · ${fmtData(c.abrir_em)}`;
        const tag = trancada ? 'Trancada' : 'Madura';
        const icone = trancada
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
        // Modo dev: ação pra amadurecer (destrancar + disparar aviso) na hora
        const devAcao = (trancada && devCarta)
          ? `<button type="button" class="espaco-carta-devacao" data-amadurecer="${c.id}">⚡ Amadurecer agora (teste)</button>`
          : '';
        return `
          <button type="button" class="espaco-carta-item ${trancada ? 'trancada' : 'madura'}" data-id="${c.id}" data-trancada="${trancada ? '1' : '0'}">
            <span class="espaco-carta-icone">${icone}</span>
            <span class="espaco-carta-info">
              <span class="espaco-carta-info-titulo">${titulo}</span>
              <span class="espaco-carta-info-meta">${meta}</span>
            </span>
            <span class="espaco-carta-item-tag">${tag}</span>
          </button>${devAcao}`;
      }).join('');

      // Ligar clique — só abre se madura
      wrap.querySelectorAll('.espaco-carta-item').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.trancada === '1') {
            const id = btn.dataset.id;
            const c = cartas.find(x => String(x.id) === String(id));
            toast(`Essa carta abre ${fmtRelativoFuturo(c.abrir_em)}.`);
            return;
          }
          const id = btn.dataset.id;
          const c = cartas.find(x => String(x.id) === String(id));
          if (c) abrirModalCarta(c);
        });
      });

      // Modo dev: "Amadurecer agora" — destranca + dispara aviso real + recarrega
      wrap.querySelectorAll('[data-amadurecer]').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const id = btn.dataset.amadurecer;
          btn.disabled = true; btn.textContent = 'Amadurecendo...';
          try {
            const r = await fetchAutenticado(`/api/app/espaco/cartas/${id}/amadurecer-teste`, { method: 'POST', body: '{}' });
            if (!r) return;
            const d = await r.json().catch(() => ({}));
            if (!d?.ok) { toast(d?.erro || 'Não consegui amadurecer agora.'); btn.disabled = false; btn.textContent = '⚡ Amadurecer agora (teste)'; return; }
            const wa = d.whatsapp?.ok ? 'WhatsApp ✓' : `WhatsApp ✗`;
            const em = d.email?.ok ? 'E-mail ✓' : `E-mail ✗`;
            toast(`Carta destrancada · ${wa} · ${em}`);
            carregarMinhasCartas();   // recarrega: a carta vira Madura, pronta pra abrir
          } catch (err) {
            console.warn('[espaco] amadurecer:', err);
            toast('Não consegui amadurecer agora.');
            btn.disabled = false; btn.textContent = '⚡ Amadurecer agora (teste)';
          }
        });
      });
    } catch (err) {
      console.warn('[espaco] cartas:', err);
      wrap.innerHTML = '<div class="espaco-vazio">Não consegui carregar agora. Tenta de novo daqui a pouco.</div>';
    }
  }

  // ── MODAL — abrir carta madura ───────────────────────────────
  function abrirModal(id) { el(id)?.classList.add('aberto'); el(id)?.setAttribute('aria-hidden', 'false'); }
  function fecharModal(id) { el(id)?.classList.remove('aberto'); el(id)?.setAttribute('aria-hidden', 'true'); }
  function abrirModalCarta(c) {
    const t = el('carta-aberta-titulo'); if (t) t.textContent = c.titulo || 'Sua Carta do Tempo';
    const d = el('carta-aberta-data');   if (d) d.textContent = `Lacrada e aberta em ${fmtData(c.abrir_em)}`;
    const co = el('carta-aberta-conteudo'); if (co) co.textContent = c.conteudo || '';
    // Botão "Compartilhar no WhatsApp" — monta o texto da carta + assinatura
    const share = el('carta-aberta-share');
    if (share) {
      share.onclick = () => {
        const linhas = [];
        if (c.titulo) linhas.push(`✨ ${c.titulo}`);
        else linhas.push('✨ Minha Carta do Tempo');
        linhas.push('');
        if (c.conteudo) linhas.push(c.conteudo);
        linhas.push('');
        linhas.push('Escrevi essa carta pra mim mesma no Espaço da Manifestação 💌');
        linhas.push('vidamagica.com.br');
        const url = 'https://wa.me/?text=' + encodeURIComponent(linhas.join('\n'));
        window.open(url, '_blank');
      };
    }
    abrirModal('modal-carta-aberta');
  }
  function ligarModais() {
    document.querySelectorAll('[data-fechar-modal]').forEach(el2 => {
      el2.addEventListener('click', () => fecharModal(el2.dataset.fecharModal));
    });
  }

  // ════════════════════════════════════════════════════════════
  // PARALLAX GIROSCÓPIO (tema Universo) — modal custom + DeviceOrientation
  // ════════════════════════════════════════════════════════════
  // Parallax DELICADO (estilo CDZ Awakening): deslocamento pequeno + interpolação
  // suave (lerp) num loop rAF contínuo — o sensor define o ALVO, o fundo desliza
  // devagar até ele (sem pular nem tremer com o ruído do giroscópio).
  let _giroOn = false, _giroLoop = null;
  let _giroAlvoX = 0, _giroAlvoY = 0, _giroX = 0, _giroY = 0;
  const GIRO_RANGE = 22;     // px de deslocamento da camada (folga é ~7% da tela) — sutil
  const GIRO_EASE = 0.06;    // suavização (lerp): quanto menor, mais delicado/lento
  function _giroEvt(e) {
    const gx = Math.max(-15, Math.min(15, e.gamma || 0));       // inclinação esq-dir
    const gy = Math.max(-15, Math.min(15, (e.beta || 0) - 45)); // frente-trás (em pé ~45°)
    _giroAlvoX = -(gx / 15) * GIRO_RANGE;   // alvo em px (move imagem ao contrário = profundidade)
    _giroAlvoY = -(gy / 15) * GIRO_RANGE;
  }
  function _giroTick() {
    _giroLoop = requestAnimationFrame(_giroTick);
    if (document.body.getAttribute('data-tema') !== 'universo') return;
    _giroX += (_giroAlvoX - _giroX) * GIRO_EASE;   // desliza suave até o alvo
    _giroY += (_giroAlvoY - _giroY) * GIRO_EASE;
    const bg = el('espaco-bg');
    if (bg) bg.style.transform = `translate3d(${_giroX.toFixed(2)}px, ${_giroY.toFixed(2)}px, 0)`;
  }
  function ligarGiro() {
    if (_giroOn) return; _giroOn = true;
    window.addEventListener('deviceorientation', _giroEvt);
    if (!_giroLoop) _giroLoop = requestAnimationFrame(_giroTick);
  }
  async function pedirGiro() {
    try {
      const D = window.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function') {   // iOS 13+
        const p = await D.requestPermission();
        if (p === 'granted') ligarGiro();
      } else if (D) { ligarGiro(); }                          // Android / sem prompt
    } catch (_) {}
  }
  function abrirGiroModal() { el('espaco-giro-modal')?.classList.add('aberto'); }
  function fecharGiroModal() { el('espaco-giro-modal')?.classList.remove('aberto'); }
  function talvezOferecerGiro(tema) {
    if (tema !== 'universo' || _giroOn) return;
    if (!window.DeviceOrientationEvent) return;               // sem sensor → ignora
    try { if (localStorage.getItem('vm_espaco_giro') === 'nao') return; } catch (_) {}
    setTimeout(abrirGiroModal, 700);
  }
  function ligarGiroBotoes() {
    el('espaco-giro-ativar')?.addEventListener('click', () => { fecharGiroModal(); pedirGiro(); });
    el('espaco-giro-depois')?.addEventListener('click', () => { fecharGiroModal(); try { localStorage.setItem('vm_espaco_giro', 'nao'); } catch (_) {} });
    el('espaco-giro-overlay')?.addEventListener('click', fecharGiroModal);
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
    talvezOferecerGiro(temaSalvo);
    // Sementes
    const sem = el('espaco-sementes-num');
    if (sem) sem.textContent = ctx.aluna?.sementes || 0;
    // Avatar (no menu de baixo) — foto se houver, senão inicial do nome.
    // Mira o container .espaco-bottom-avatar pra não apagar o label "Perfil".
    const avBox = el('espaco-bottom-avatar');
    if (avBox) {
      const ini = (ctx.aluna?.nome || '·').trim().charAt(0).toUpperCase() || '·';
      avBox.innerHTML = ctx.aluna?.foto_url
        ? `<img src="${ctx.aluna.foto_url}" alt="" />`
        : `<span id="espaco-avatar-inicial">${ini}</span>`;
    }
    // Saudação
    const tit = el('espaco-saudacao-titulo');
    const primeiro = (ctx.aluna?.nome || '').split(' ')[0];
    if (tit && primeiro) tit.textContent = `${primeiro}, o que você quer viver agora?`;
    // Data do dia na carta (só a data)
    const dl = el('carta-dateline');
    if (dl) dl.textContent = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    // Modo teste da Carta do Tempo — revela o preset "Em instantes (teste)",
    // o botão "Testar envios agora" e o "amadurecer agora" na lista de cartas.
    devCarta = !!ctx.dev_carta;
    if (devCarta) {
      const dp = el('carta-preset-dev'); if (dp) dp.style.display = '';
      const bt = el('carta-testar-envio'); if (bt) bt.style.display = '';
    }
  }

  async function init() {
    // Sem sessão → login
    if (!VmSession.getAccess()) { irLogin(); return; }

    ligarTemas();
    ligarAvatar();
    ligarCaminhos();
    ligarGiroBotoes();
    ligarFormCarta();
    ligarModais();
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

    // Deep-link do aviso de carta madura (WhatsApp/e-mail levam a ?ver=cartas):
    // abre direto "Minhas cartas do tempo" (fica sob a animação e aparece quando ela some).
    try {
      if (new URLSearchParams(location.search).get('ver') === 'cartas') {
        irPara('view-minhas-cartas');
        carregarMinhasCartas();
      }
    } catch {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
