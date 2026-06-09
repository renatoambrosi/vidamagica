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
  let alunaFoto = null;   // foto da aluna (vem do /contexto) — usada como "selo" da carta

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
    // Medieval: liga/desliga os 2 Lotties do fundo (pesados — só nesse tema)
    ligarFxMedieval(tema);
  }

  // ── FX MEDIEVAL — Lotties no fundo, só no tema medieval ──────────
  // Carrega e toca quando entra no medieval; destrói ao sair (Lottie consome
  // CPU; não pode rodar nos outros temas). JSON em cache pra não re-baixar.
  // Cada slot aponta pra um JSON + a pasta das imagens (os .lottie do Renato
  // são image-based: o JSON referencia webp externos → usamos assetsPath).
  // Slot 2 entra quando ele subir o 2º arquivo.
  const FX_MEDIEVAL_SLOTS = [
    { mount: 'fx-medieval-1', json: '/assets/medieval-fx-1/animation.json', assets: '/assets/medieval-fx-1/images/' },
    // Slot 2 reusa a MESMA arte (rota/tempo diferentes no CSS) até o Renato
    // subir um 2º Lottie próprio — aí é só trocar json/assets aqui.
    { mount: 'fx-medieval-2', json: '/assets/medieval-fx-1/animation.json', assets: '/assets/medieval-fx-1/images/' },
  ];
  let _fxMedievalAnims = [];
  const _fxMedievalCache = {};
  function destruirFxMedieval() {
    _fxMedievalAnims.forEach(a => { try { a.destroy(); } catch (e) {} });
    _fxMedievalAnims = [];
    FX_MEDIEVAL_SLOTS.forEach(s => { const m = el(s.mount); if (m) m.innerHTML = ''; });
  }
  function ligarFxMedieval(tema) {
    if (tema !== 'medieval') { if (_fxMedievalAnims.length) destruirFxMedieval(); return; }
    if (_fxMedievalAnims.length) return;            // já está ativo
    if (typeof lottie === 'undefined') return;      // lib ainda não carregou
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    FX_MEDIEVAL_SLOTS.forEach(slot => {
      const mount = el(slot.mount);
      if (!mount) return;
      const criar = (data) => {
        if (document.body.getAttribute('data-tema') !== 'medieval') return;  // saiu enquanto baixava
        try {
          _fxMedievalAnims.push(lottie.loadAnimation({
            container: mount, renderer: 'canvas', loop: true, autoplay: true,
            // clona o JSON: duas instâncias não podem compartilhar o mesmo objeto
            animationData: JSON.parse(JSON.stringify(data)), assetsPath: slot.assets,
            rendererSettings: {
              preserveAspectRatio: 'xMidYMid meet', clearCanvas: true,
              dpr: Math.min(2, window.devicePixelRatio || 1),
            },
          }));
        } catch (e) {}
      };
      if (_fxMedievalCache[slot.json]) criar(_fxMedievalCache[slot.json]);
      else fetch(slot.json).then(r => r.ok ? r.json() : Promise.reject()).then(j => { _fxMedievalCache[slot.json] = j; criar(j); }).catch(() => {});
    });
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
    // Botão central "Ambiente" → abre o painel (ligado em ligarAmbiente()).
    // Início — volta ao topo da Meditação Guiada
    el('nav-inicio')?.addEventListener('click', () => {
      irPara('view-entrada');
    });
    // Atalho "Correio temporal" (no topo da view de escrever) → Minhas cartas
    el('ir-correio')?.addEventListener('click', () => {
      irPara('view-minhas-cartas');
      carregarMinhasCartas();
    });
  }

  // ════════════════════════════════════════════════════════════
  // CARTA DO TEMPO — form (escrever) + lista + modal de abrir
  // ════════════════════════════════════════════════════════════
  let cartaDiasEscolhido = null;   // dias do preset (30/90/180/365) ou 'custom'

  // Temas de sugestão (afirmações de exemplo que aparecem no corpo da carta).
  const CARTA_SUGESTOES = [
    { tema: 'Identidade e Conexão Espiritual', linhas: [
      'Eu sou a imagem e semelhança do Criador, meu potencial é ilimitado e eu nasci para triunfar.',
      'Eu estou em perfeito alinhamento divino com O Mestre e vivo debaixo da graça que me fortalece todos os dias.',
      'O Grande Livro diz que tudo posso naquele que me fortalece, por isso eu afasto toda mente fraca e tomo posse da minha verdadeira identidade.',
      'Eu vivo o hoje presente conscientemente, sabendo que o amor de Deus por mim é inabalável e perfeito.',
    ] },
    { tema: 'Prosperidade e Finanças', linhas: [
      'A riqueza e a abundância divina são a vontade de Deus para a minha vida; eu nasci para fluir na prosperidade.',
      'Eu ativo hoje as 3 leis da riqueza: mantenho minha Imagem Fixa, minha Fé Firme e minha Gratidão Plena.',
      'O dinheiro é energia de riqueza e ele vem até mim de forma mágica, limpa e abundante.',
      'Eu rompo com todo pensamento pequeno e com a escassez; minha mente expandida enxerga inúmeras possibilidades de crescimento.',
    ] },
    { tema: 'Saúde e Mentalidade', linhas: [
      'Eu domino a minha mente e comando os meus pensamentos para que eles gerem vida, saúde e energia de vitória.',
      'O meu corpo é o templo do Espírito Santo, cheio de vitalidade, força e saúde perfeita.',
      'Eu liberto o meu passado, ressignifico todas as travas e escolho o slogan da minha nova realidade: pense novo, viva o novo!',
      'Quando eu agradeço, coisas boas acontecem. Eu blindo a minha mente contra a negatividade e a reclamação.',
    ] },
    { tema: 'Relacionamentos e Autoestima', linhas: [
      'Eu me amo, me respeito e não aceito menos do que a harmonia do amor, respeito e valorização nas minhas relações.',
      'O meu lar é um ambiente de paz, harmonia e alinhamento com o propósito divino.',
      'Eu não reclamo do que eu permito; por isso, estabeleço limites saudáveis com amor, sabedoria e firmeza, ainda que o outro não goste no começo.',
      'Eu atraio conexões que me elevam, que estão na mesma frequência de prosperidade e que expandem minha visão.',
    ] },
    { tema: 'Carreira, Sucesso e Propósito', linhas: [
      'O meu trabalho é um canal de bênção e eu sou extremamente guiada a tomar as melhores e mais lucrativas decisões.',
      'Eu sou uma profissional realizada e realizadora, de mente expandida, e as portas das inúmeras possibilidades se abrem para mim agora e todos os dias.',
      'Eu não aceito uma vida morna ou travada; eu fui chamada para fazer a diferença e governar a minha própria história.',
      'Pense grande, seja grande! Eu aceito o sucesso, a promoção e a liderança que me pertencem por direito divino. Eu me permito prosperar e crescer sempre.',
    ] },
  ];

  function ligarFormCarta() {
    const ta = el('carta-conteudo');
    const cnt = el('carta-contador');
    const dataIn = el('carta-data');
    const resumo = el('carta-data-resumo');

    // Contador de caracteres
    ta?.addEventListener('input', () => { if (cnt) cnt.textContent = String(ta.value.trim().length); });

    // "Continuar" → rola a tela até o fim (revela o lacre)
    el('carta-continuar')?.addEventListener('click', () => {
      const corpo = document.querySelector('.espaco-corpo');
      if (corpo) corpo.scrollTo({ top: corpo.scrollHeight, behavior: 'smooth' });
      else el('carta-lacrar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

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

    // ── SUGESTÕES — as setas ciclam temas; o exemplo aparece COMPLETO (read-only)
    // e rolável (não some ao scrollar). "Limpar" volta pra vazio; tocar no exemplo
    // abre o diálogo custom (editar a sugestão OU limpar e escrever do zero). ──
    let sugIdx = -1;            // -1 = "Sugestões" (vazio); 0..N = tema
    let exemploAtivo = false;   // true quando o corpo mostra exemplo (read-only)
    const sugLabel = el('sug-label');
    const sugLimparBtn = el('sug-limpar');
    const dicaEl = el('carta-corpo-dica');
    const hintEl = el('carta-corpo-hint');

    // Cresce o textarea pra caber todo o conteúdo (sem rolagem interna; a página rola)
    function autoGrow() {
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
    function toggleHint(modoExemplo) {
      if (dicaEl) dicaEl.style.display = modoExemplo ? 'none' : '';
      if (hintEl) hintEl.style.display = modoExemplo ? '' : 'none';
    }
    function mostrarSugestao() {
      const s = CARTA_SUGESTOES[sugIdx];
      if (sugLabel) sugLabel.textContent = s.tema;
      if (!ta) return;
      ta.value = s.linhas.join('\n\n');
      ta.readOnly = true;                 // read-only: tocar não digita; o diálogo decide
      ta.classList.add('carta-corpo-exemplo');
      exemploAtivo = true;
      toggleHint(true);
      if (sugLimparBtn) sugLimparBtn.style.display = '';
      autoGrow();
    }
    // Sai do modo exemplo. manterTexto=true (editar) mantém o texto; false (limpar) zera.
    function sairExemplo(manterTexto, focar) {
      if (!ta) return;
      ta.readOnly = false;
      if (!manterTexto) ta.value = '';
      ta.classList.remove('carta-corpo-exemplo');
      exemploAtivo = false;
      sugIdx = -1;
      if (sugLabel) sugLabel.textContent = 'Sugestões';
      if (sugLimparBtn) sugLimparBtn.style.display = 'none';
      toggleHint(false);
      if (cnt) cnt.textContent = String((ta.value || '').trim().length);
      autoGrow();
      if (focar) ta.focus();
    }

    el('sug-next')?.addEventListener('click', () => {
      sugIdx = (sugIdx < 0) ? 0 : (sugIdx + 1) % CARTA_SUGESTOES.length;
      mostrarSugestao();
    });
    el('sug-prev')?.addEventListener('click', () => {
      sugIdx = (sugIdx <= 0) ? CARTA_SUGESTOES.length - 1 : sugIdx - 1;
      mostrarSugestao();
    });
    // "Limpar" da barra → volta pra "Sugestões" vazio (sem abrir o teclado)
    sugLimparBtn?.addEventListener('click', () => sairExemplo(false, false));

    // Tocar no exemplo → diálogo custom. 'click' só dispara em TOQUE (não em
    // rolagem) → rolar a tela pra ler NÃO abre o diálogo.
    ta?.addEventListener('click', () => { if (exemploAtivo) abrirModal('modal-sugestao'); });
    el('sug-acao-editar')?.addEventListener('click', () => { fecharModal('modal-sugestao'); sairExemplo(true, true); });
    el('sug-acao-limpar')?.addEventListener('click', () => { fecharModal('modal-sugestao'); sairExemplo(false, true); });

    // Textarea cresce conforme a aluna digita (a página rola, sem scroll interno)
    ta?.addEventListener('input', autoGrow);

    // ── VÍDEO "como usar" (modal translúcido por cima da carta) ──
    const VIDEO_ID = 'UCK4EA_MVTA';
    const vmodal = el('carta-video-modal');
    const vframe = el('carta-video-frame');
    function abrirVideo() {
      if (!vmodal || !vframe) return;
      // SEM autoplay: no iOS o autoplay é bloqueado e o player fica PRETO. Sem
      // ele, o YouTube mostra a capa + play de forma confiável; a aluna toca e
      // roda com som (gesto do usuário). playsinline = toca embutido, não em fullscreen.
      vframe.innerHTML = '<iframe src="https://www.youtube.com/embed/' + VIDEO_ID + '?rel=0&modestbranding=1&playsinline=1" title="Como usar a Carta do Tempo" allow="encrypted-media; fullscreen" allowfullscreen></iframe>';
      vmodal.classList.add('aberto'); vmodal.setAttribute('aria-hidden', 'false');
    }
    function fecharVideo() {
      if (!vmodal || !vframe) return;
      vmodal.classList.remove('aberto'); vmodal.setAttribute('aria-hidden', 'true');
      vframe.innerHTML = '';   // remove o iframe = para o vídeo
    }
    el('carta-video-btn')?.addEventListener('click', abrirVideo);
    document.querySelectorAll('[data-fechar-video]').forEach(x => x.addEventListener('click', fecharVideo));

    // ── SALVAR a carta — "Lacrar e enviar" (modo='enviar') OU "Só salvar" (modo='salvar') ──
    async function salvarCarta(modo) {
      if (exemploAtivo) { toast('Toque na carta e escreva a sua antes de salvar.'); ta?.focus(); return; }
      const titulo = (el('carta-titulo')?.value || '').trim();
      const conteudo = (ta?.value || '').trim();
      if (conteudo.length < 10) { toast('Escreva pelo menos 10 caracteres.'); return; }

      const corpoReq = {
        titulo, conteudo, modo,
        carta_de: el('carta-de')?.value || null,
        carta_para: el('carta-para')?.value || null,
      };

      if (modo === 'enviar') {
        if (!cartaDiasEscolhido) { toast('Escolha quando reler.'); return; }
        let abrirEm = null;
        if (cartaDiasEscolhido === 'custom') {
          if (!dataIn?.value) { toast('Escolha a data.'); return; }
          abrirEm = new Date(dataIn.value + 'T12:00:00');
        } else if (cartaDiasEscolhido === 'dev') {
          abrirEm = new Date(Date.now() + 20 * 1000);
        } else {
          const dias = parseInt(cartaDiasEscolhido, 10);
          abrirEm = new Date(Date.now() + dias * 24 * 3600 * 1000);
        }
        const minMs = cartaDiasEscolhido === 'dev' ? 10 * 1000 : 24 * 3600 * 1000;
        if (!(abrirEm.getTime() > Date.now() + minMs)) {
          toast(cartaDiasEscolhido === 'dev' ? 'Escolha uma data no futuro.' : 'A data precisa estar pelo menos 1 dia no futuro.'); return;
        }
        corpoReq.abrir_em = abrirEm.toISOString();
      }

      const btnPrim = el('carta-lacrar'), btnSalv = el('carta-salvar');
      const primSpan = btnPrim?.querySelector('span');
      if (btnPrim) btnPrim.disabled = true;
      if (btnSalv) btnSalv.disabled = true;
      if (modo === 'salvar') { if (btnSalv) btnSalv.textContent = 'Salvando...'; }
      else { if (primSpan) primSpan.textContent = 'Lacrando...'; }
      try {
        const r = await fetchAutenticado('/api/app/espaco/cartas', { method: 'POST', body: JSON.stringify(corpoReq) });
        if (!r) return;
        const d = await r.json().catch(() => ({}));
        if (!d?.ok) { toast(d?.erro || 'Não consegui salvar a carta.'); return; }
        // Limpa o form (reseta também read-only/altura/estado de sugestão)
        if (ta) { ta.value = ''; ta.classList.remove('carta-corpo-exemplo'); ta.readOnly = false; ta.style.height = ''; }
        exemploAtivo = false;
        if (sugLabel) sugLabel.textContent = 'Sugestões';
        if (sugLimparBtn) sugLimparBtn.style.display = 'none';
        toggleHint(false);
        if (cnt) cnt.textContent = '0';
        const tit = el('carta-titulo'); if (tit) tit.value = '';
        document.querySelectorAll('.espaco-data-preset').forEach(b => b.classList.remove('selecionado'));
        dataIn?.classList.remove('aberto'); if (dataIn) dataIn.value = '';
        if (resumo) resumo.textContent = 'Escolha quando a carta deve ser aberta.';
        cartaDiasEscolhido = null; sugIdx = -1; if (sugLabel) sugLabel.textContent = 'Sugestões';
        if (modo === 'salvar') {
          irPara('view-minhas-cartas'); carregarMinhasCartas(); toast('Carta salva ✨');
        } else {
          tocarCerimoniaLacre(() => { irPara('view-minhas-cartas'); carregarMinhasCartas(); toast('Carta lacrada ✨'); });
        }
      } catch (err) {
        console.warn('[espaco] salvar carta:', err);
        toast('Não consegui salvar agora. Tenta de novo.');
      } finally {
        if (btnPrim) { btnPrim.disabled = false; if (primSpan) primSpan.textContent = 'Lacrar e enviar'; }
        if (btnSalv) { btnSalv.disabled = false; btnSalv.textContent = 'Só salvar (sem enviar)'; }
      }
    }
    el('form-carta')?.addEventListener('submit', (e) => { e.preventDefault(); salvarCarta('enviar'); });
    el('carta-salvar')?.addEventListener('click', () => salvarCarta('salvar'));
  }

  // ── ANIMAÇÕES DA CARTA (portais, SVG) ────────────────────────
  // Recolorem pelo tema via var(--acento)/var(--acento-2) + classes .p-* em CSS.
  function svgPortalShapes() {
    return '<ellipse class="p-glow" rx="23" ry="31"/>' +
      '<ellipse class="p-mouth" rx="18" ry="26"/>' +
      '<ellipse class="p-rim" rx="18" ry="26"/>' +
      '<ellipse class="p-swirl" rx="12.5" ry="19"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="7s" repeatCount="indefinite"/></ellipse>' +
      '<ellipse class="p-deep" rx="6.5" ry="11"/>';
  }
  // Momento 2 — voo entre portais (loop)
  function svgVoo() {
    var P = function (x, y, r) { return '<g transform="translate(' + x + ',' + y + ') rotate(' + r + ')">' + svgPortalShapes() + '</g>'; };
    return '<svg viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet">' +
      '<path class="arco" d="M58,104 Q160,40 262,104"/>' + P(58, 104, -18) + P(262, 104, 18) +
      '<g class="spark" opacity=".7"><path d="M120,46 l1.6,3.4 3.4,1.6 -3.4,1.6 -1.6,3.4 -1.6,-3.4 -3.4,-1.6 3.4,-1.6z"><animate attributeName="opacity" values="0.2;0.9;0.2" dur="2s" repeatCount="indefinite"/></path></g>' +
      '<circle class="spark" cx="160" cy="40" r="2"><animate attributeName="opacity" values="0.2;0.8;0.2" dur="1.8s" repeatCount="indefinite"/></circle>' +
      '<g><animateMotion dur="3.4s" repeatCount="indefinite" rotate="auto" calcMode="spline" keyTimes="0;1" keyPoints="0;1" keySplines="0.45 0 0.55 1" path="M58,104 Q160,40 262,104"/>' +
      '<g><animateTransform attributeName="transform" type="scale" values="0.2;1;1;0.2" keyTimes="0;0.24;0.76;1" dur="3.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.3 0 0.4 1;0 0 1 1;0.6 0 0.7 1"/>' +
      '<rect x="-15" y="-10" width="30" height="20" rx="2.5" fill="var(--ac)"/>' +
      '<path d="M-15,-10 L0,2 L15,-10 Z" fill="var(--ac2)"/>' +
      '<path d="M-15,-9 L0,3 L15,-9" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1.6" stroke-linejoin="round"/>' +
      '</g></g></svg>';
  }
  // Momento 1 — lacrar (ciclo 4s): brilho explode → portal cresce → envelope fecha/lacra → voa pro portal
  function svgLacre() {
    // Envelope maior, mais alto e centrado; aba arredondada com pontas encaixadas
    // no corpo (evita "vazar ponta"); voa pro portal no fim.
    return '<svg viewBox="108 2 104 128" preserveAspectRatio="xMidYMid meet">' +
      '<g transform="translate(160,40)">' +
      '<circle fill="#fff" r="0" opacity="0"><animate attributeName="r" values="0;0;32;32" keyTimes="0;0.24;0.31;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;0.15 0.7 0.4 1;0 0 1 1"/><animate attributeName="opacity" values="0;0;0.5;0;0" keyTimes="0;0.24;0.275;0.33;1" dur="4s" repeatCount="indefinite"/></circle>' +
      '<circle fill="#fff" r="0" opacity="0"><animate attributeName="r" values="0;0;19;19" keyTimes="0;0.24;0.30;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;0.2 0.8 0.4 1;0 0 1 1"/><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.24;0.27;0.34;1" dur="4s" repeatCount="indefinite"/></circle>' +
      '<g><animateTransform attributeName="transform" type="scale" values="0;0;1.12;1;1;0;0" keyTimes="0;0.27;0.38;0.42;0.66;0.76;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;0.2 0.9 0.4 1;0.5 0 0.8 1;0 0 1 1;0.5 0 0.8 1;0 0 1 1"/>' + svgPortalShapes() + '</g>' +
      '</g>' +
      '<g><animateMotion dur="4s" repeatCount="indefinite" rotate="0" keyPoints="0;0;1;1" keyTimes="0;0.4;0.62;1" calcMode="spline" keySplines="0 0 1 1;0.5 0 0.6 1;0 0 1 1" path="M160,92 Q152,62 160,40"/>' +
      '<g><animateTransform attributeName="transform" type="scale" values="1;1;0.12;0.12" keyTimes="0;0.4;0.62;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;0.5 0 0.7 1;0 0 1 1"/>' +
      '<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.58;0.66;0.94;1" dur="4s" repeatCount="indefinite"/>' +
      '<rect x="-24" y="-16" width="48" height="32" rx="4" fill="var(--ac)"/>' +
      '<path fill="var(--ac2)" stroke="var(--ac)" stroke-width="0.6" stroke-linejoin="round"><animate attributeName="d" values="M-20,-15 L-2,-30 Q0,-32 2,-30 L20,-15 Z; M-20,-15 L-2,-30 Q0,-32 2,-30 L20,-15 Z; M-20,-15 L-2,5 Q0,7 2,5 L20,-15 Z; M-20,-15 L-2,5 Q0,7 2,5 L20,-15 Z" keyTimes="0;0.1;0.25;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;0.4 0 0.3 1;0 0 1 1"/></path>' +
      '<circle class="wax" cx="0" cy="5" r="0"><animate attributeName="r" values="0;0;6;6" keyTimes="0;0.28;0.36;1" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;0.2 1.5 0.5 1;0 0 1 1"/></circle>' +
      '</g></g>' +
      '<g class="spark">' +
      '<circle cx="160" cy="40" r="2.4"><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.64;0.7;0.82;1" dur="4s" repeatCount="indefinite"/><animate attributeName="cy" values="40;40;22;22" keyTimes="0;0.64;0.82;1" dur="4s" repeatCount="indefinite"/></circle>' +
      '<circle cx="141" cy="42" r="1.9"><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.64;0.72;0.84;1" dur="4s" repeatCount="indefinite"/><animate attributeName="cy" values="42;42;26;26" keyTimes="0;0.64;0.84;1" dur="4s" repeatCount="indefinite"/></circle>' +
      '<circle cx="179" cy="42" r="1.9"><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.64;0.72;0.84;1" dur="4s" repeatCount="indefinite"/><animate attributeName="cy" values="42;42;26;26" keyTimes="0;0.64;0.84;1" dur="4s" repeatCount="indefinite"/></circle>' +
      '</g></svg>';
  }
  // Mini-animações dentro dos cards = as MESMAS fases, em versão compacta.
  // "A caminho" — voo entre portais, pequeno (mesma animação da fase 2).
  function svgVooMini() {
    var P = function (x, y, r) { return '<g transform="translate(' + x + ',' + y + ') scale(0.46) rotate(' + r + ')">' + svgPortalShapes() + '</g>'; };
    return '<svg viewBox="0 0 96 66" preserveAspectRatio="xMidYMid meet">' +
      '<path class="arco" d="M18,44 Q48,14 78,44"/>' + P(18, 44, -18) + P(78, 44, 18) +
      '<circle class="spark" cx="48" cy="12" r="1.5"><animate attributeName="opacity" values="0.2;0.9;0.2" dur="1.8s" repeatCount="indefinite"/></circle>' +
      '<g><animateMotion dur="3s" repeatCount="indefinite" rotate="auto" calcMode="spline" keyTimes="0;1" keyPoints="0;1" keySplines="0.45 0 0.55 1" path="M18,44 Q48,14 78,44"/>' +
      '<g><animateTransform attributeName="transform" type="scale" values="0.15;0.5;0.5;0.15" keyTimes="0;0.24;0.76;1" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.3 0 0.4 1;0 0 1 1;0.6 0 0.7 1"/>' +
      '<rect x="-15" y="-10" width="30" height="20" rx="2.5" fill="var(--ac)"/>' +
      '<path d="M-15,-10 L0,2 L15,-10 Z" fill="var(--ac2)"/>' +
      '</g></g></svg>';
  }
  // "Chegou" (não lida) — envelope LACRADO que acabou de chegar, com halo pulsando
  // (pronta pra abrir). Selo de cera no centro. Brilha = "tem novidade".
  function svgChegouMini() {
    return '<svg viewBox="0 0 84 66" preserveAspectRatio="xMidYMid meet">' +
      '<g transform="translate(42,36)"><g class="mini-pulse">' +
      '<ellipse rx="27" ry="21" fill="var(--ac)" opacity="0.20"/>' +
      '<rect x="-19" y="-13" width="38" height="26" rx="3" fill="var(--ac)"/>' +
      '<path d="M-19,-13 L0,3 L19,-13" fill="none" stroke="var(--ac2)" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="0" cy="-1" r="3.6" fill="var(--ac2)"/>' +
      '</g></g>' +
      '<path class="spark" d="M66,15 l1.4,3 3,1.4 -3,1.4 -1.4,3 -1.4,-3 -3,-1.4 3,-1.4z"><animate attributeName="opacity" values="0.2;0.95;0.2" dur="1.8s" repeatCount="indefinite"/></path>' +
      '</svg>';
  }
  // "Lida" — envelope ABERTO com a carta pra fora (já foi lida). Calmo, sem brilho.
  function svgLidaMini() {
    return '<svg viewBox="0 0 84 66" preserveAspectRatio="xMidYMid meet">' +
      '<g transform="translate(42,38)">' +
      '<rect x="-16" y="-13" width="32" height="18" rx="1.5" fill="#fff8ec"/>' +
      '<rect x="-19" y="-2" width="38" height="16" rx="2.5" fill="var(--ac)"/>' +
      '<path d="M-19,-2 L0,-15 L19,-2 Z" fill="var(--ac2)"/>' +
      '</g></svg>';
  }

  // Toca a cerimônia de lacrar (uma vez) e chama cb ao final
  function tocarCerimoniaLacre(cb) {
    var ov = el('carta-cerimonia'), palco = el('carta-cerimonia-palco');
    if (!ov || !palco) { if (cb) cb(); return; }
    palco.innerHTML = svgLacre();            // injeta fresco → SMIL toca do início
    ov.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => ov.classList.add('ativo'));
    setTimeout(() => {                         // ~3,2s: cerimônia completa → fecha + segue
      ov.classList.remove('ativo');
      ov.setAttribute('aria-hidden', 'true');
      setTimeout(() => { palco.innerHTML = ''; }, 450);
      if (cb) cb();
    }, 3200);
  }
  // ── ABERTURA MÁGICA DA CARTA (Lottie carta.json recolorido por tema) ──
  function _hx(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function _toHex(r) { return '#' + r.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join(''); }
  function _mix(a, b, t) { a = _hx(a); b = _hx(b); return _toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  function _rgb01ToHex(c) { return '#' + c.slice(0, 3).map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); }
  function _hexToRgb01(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; }
  // Substitui as cores douradas do carta.json pelos tons do acento do tema (mantém papel/neutros)
  function tintLottie(data, map) {
    var m = {}; for (var k in map) m[k.toLowerCase()] = _hexToRgb01(map[k]);
    (function w(o) {
      if (Array.isArray(o)) { o.forEach(w); return; }
      if (o && typeof o === 'object') {
        if ((o.ty === 'fl' || o.ty === 'st') && o.c && Array.isArray(o.c.k) && typeof o.c.k[0] === 'number') {
          var h = _rgb01ToHex(o.c.k).toLowerCase();
          if (m[h]) { o.c.k[0] = m[h][0]; o.c.k[1] = m[h][1]; o.c.k[2] = m[h][2]; }
        }
        for (var kk in o) w(o[kk]);
      }
    })(data);
    return data;
  }
  function mapaCartaTema() {
    var ac = (getComputedStyle(document.body).getPropertyValue('--acento') || '').trim() || '#C8922A';
    return { '#ffbd00': _mix(ac, '#ffffff', 0.42), '#faad03': ac, '#b5872b': _mix(ac, '#000000', 0.30) };
  }
  // Camada de sparkles (estrelas + pontos subindo) ao redor da carta abrindo — cor do tema
  function svgSparklesAbertura() {
    var STAR = 'M0,-4 L1.1,-1.1 L4,0 L1.1,1.1 L0,4 L-1.1,1.1 L-4,0 L-1.1,-1.1 Z';
    var P = [[20,34,0.75,1.9,1],[80,40,0.9,2.3,1],[50,20,1.05,2.6,1],[30,64,0.6,2.1,0],
             [72,66,0.7,1.7,1],[14,80,0.55,2.4,0],[88,76,0.7,2.0,1],[46,92,0.6,2.2,0],
             [62,48,0.5,1.6,0],[36,44,0.6,2.5,0],[8,52,0.6,2.0,1],[92,56,0.55,1.8,0]];
    var s = '<svg viewBox="0 0 100 110" preserveAspectRatio="xMidYMid meet">';
    P.forEach(function (p, i) {
      var beg = (i * 0.16).toFixed(2);
      if (p[4]) s += '<path class="spark" transform="translate(' + p[0] + ',' + p[1] + ') scale(' + p[2] + ')" d="' + STAR + '" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="' + p[3] + 's" repeatCount="indefinite" begin="' + beg + 's"/></path>';
      else s += '<circle class="spark" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (p[2] * 1.7).toFixed(2) + '" opacity="0"><animate attributeName="opacity" values="0;0.9;0" dur="' + p[3] + 's" repeatCount="indefinite" begin="' + beg + 's"/><animate attributeName="cy" values="' + p[1] + ';' + (p[1] - 7) + '" dur="' + p[3] + 's" repeatCount="indefinite" begin="' + beg + 's"/></circle>';
    });
    return s + '</svg>';
  }

  var _cartaJsonCache = null;
  // Toca a carta abrindo (uma vez); ao terminar chama cb (mostrar a leitura).
  function playAberturaCarta(cb) {
    var ov = el('carta-abertura'), palco = el('carta-abertura-palco');
    if (!ov || !palco || typeof lottie === 'undefined') { if (cb) cb(); return; }  // fallback: abre direto
    function rodar(json) {
      var data = tintLottie(JSON.parse(JSON.stringify(json)), mapaCartaTema());
      palco.innerHTML = '';
      var sparks = el('carta-abertura-sparks');
      if (sparks) sparks.innerHTML = svgSparklesAbertura();
      ov.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => ov.classList.add('ativo'));
      var anim = lottie.loadAnimation({ container: palco, renderer: 'svg', loop: false, autoplay: true, animationData: data });
      var done = false;
      var fechar = function () {
        if (done) return; done = true;
        ov.classList.remove('ativo'); ov.setAttribute('aria-hidden', 'true');
        setTimeout(function () { try { anim.destroy(); } catch (e) {} palco.innerHTML = ''; if (sparks) sparks.innerHTML = ''; }, 420);
        if (cb) cb();
      };
      anim.addEventListener('complete', fechar);
      setTimeout(fechar, 4200);   // segurança, caso o evento não dispare
    }
    if (_cartaJsonCache) { rodar(_cartaJsonCache); return; }
    fetch('/assets/carta.json').then(r => r.json()).then(function (j) { _cartaJsonCache = j; rodar(j); }).catch(function () { if (cb) cb(); });
  }

  // Modal "carta viajando" (ao tocar numa carta trancada)
  function abrirModalViagem(c) {
    var palco = el('carta-viagem-palco');
    if (palco) palco.innerHTML = svgVoo();
    var t = el('carta-viagem-titulo'); if (t) t.textContent = c.titulo || 'Sua Carta do Tempo';
    var q = el('carta-viagem-quando'); if (q) q.textContent = 'Ela ainda está a caminho — atravessando o tempo até você. Chega em ' + fmtData(c.abrir_em) + '.';
    abrirModal('modal-carta-viagem');
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
      // Divisor entre grupos (linha fina + rótulo à esquerda). A lista já vem
      // agrupada do backend (prontas → a caminho → lidas).
      const ROTULO_GRUPO = { chegou: 'Prontas pra abrir', trancada: 'A caminho', lida: 'Já lidas' };
      let grupoAnterior = null;
      wrap.innerHTML = cartas.map(c => {
        const trancada = !!c.trancada;
        const lida = !trancada && !!c.aberta_em;
        const estado = trancada ? 'trancada' : (lida ? 'lida' : 'chegou');
        let sep = '';
        if (estado !== grupoAnterior) {
          sep = `<div class="espaco-cartas-sep"><span>${ROTULO_GRUPO[estado] || ''}</span></div>`;
          grupoAnterior = estado;
        }
        const titulo = (c.titulo || 'Carta sem título').replace(/</g, '&lt;');
        const meta = trancada
          ? `Lacrada · ${fmtRelativoFuturo(c.abrir_em)}`
          : (lida ? `Lida · ${fmtData(c.aberta_em)}` : `Chegou · ${fmtData(c.abrir_em)}`);
        const tag = trancada ? 'A caminho' : (lida ? 'Lida' : 'Chegou');
        const icone = trancada ? svgVooMini() : (lida ? svgLidaMini() : svgChegouMini());
        // Modo dev: faz a carta "chegar" agora (destranca + dispara aviso)
        const devAcao = (trancada && devCarta)
          ? `<button type="button" class="espaco-carta-devacao" data-amadurecer="${c.id}">⚡ Fazer chegar agora (teste)</button>`
          : '';
        const rotuloExcluir = trancada ? 'Cancelar' : 'Excluir';
        return sep + `
          <div class="espaco-carta-row${trancada ? ' cancelar' : ''}" data-id="${c.id}">
            <button type="button" class="espaco-carta-excluir" data-excluir="${c.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              <span>${rotuloExcluir}</span>
            </button>
            <button type="button" class="espaco-carta-item ${estado}" data-id="${c.id}" data-trancada="${trancada ? '1' : '0'}">
              <span class="espaco-carta-icone carta-anim">${icone}</span>
              <span class="espaco-carta-info">
                <span class="espaco-carta-info-titulo">${titulo}</span>
                <span class="espaco-carta-info-meta">${meta}</span>
              </span>
              <span class="espaco-carta-item-tag">${tag}</span>
            </button>
          </div>${devAcao}`;
      }).join('');

      // Por linha: swipe horizontal revela "Excluir"/"Cancelar"; tap abre a carta
      wrap.querySelectorAll('.espaco-carta-row').forEach(row => {
        const item = row.querySelector('.espaco-carta-item');
        const acao = row.querySelector('.espaco-carta-excluir');
        const id = row.dataset.id;
        const c = cartas.find(x => String(x.id) === String(id));
        let startX = 0, startY = 0, base = 0, curX = 0, dragging = false, locked = null, moved = false;
        const apply = (x) => { curX = x; item.style.transform = x ? `translateX(${x}px)` : ''; };
        const fechar = () => { apply(0); row.classList.remove('aberto', 'arrastando'); };
        item.addEventListener('touchstart', (e) => {
          const t = e.touches[0]; startX = t.clientX; startY = t.clientY; base = curX;
          dragging = true; locked = null; moved = false; item.style.transition = 'none';
        }, { passive: true });
        item.addEventListener('touchmove', (e) => {
          if (!dragging) return; const t = e.touches[0];
          const mx = t.clientX - startX, my = t.clientY - startY;
          if (locked === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) locked = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
          if (locked !== 'h') return;
          moved = true; row.classList.add('arrastando');
          const w = acao.offsetWidth;
          apply(Math.max(-w, Math.min(0, base + mx)));
        }, { passive: true });
        item.addEventListener('touchend', () => {
          if (!dragging) return; dragging = false; item.style.transition = '';
          const w = acao.offsetWidth;
          if (curX < -w * 0.4) { apply(-w); row.classList.add('aberto'); row.classList.remove('arrastando'); }
          else fechar();
        }, { passive: true });
        // Tap: se arrastou, ignora; se aberto, fecha; senão abre a carta
        item.addEventListener('click', () => {
          if (moved) { moved = false; return; }
          if (row.classList.contains('aberto')) { fechar(); return; }
          if (!c) return;
          if (item.dataset.trancada === '1') { abrirModalViagem(c); return; }
          if (!c.aberta_em) {
            c.aberta_em = new Date().toISOString();
            playAberturaCarta(() => abrirModalCarta(c));   // abertura mágica → leitura
            fetchAutenticado(`/api/app/espaco/cartas/${id}/lida`, { method: 'POST', body: '{}' })
              .then(() => carregarMinhasCartas()).catch(() => {});
          } else {
            abrirModalCarta(c);
          }
        });
        // Botão revelado: excluir / cancelar envio
        acao.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ehTrancada = item.dataset.trancada === '1';
          const ok = await confirmarAcao({
            mensagem: ehTrancada
              ? 'Essa carta ainda está a caminho do seu futuro. Se você cancelar a viagem dela, ela não chega — e não tem como recuperar.'
              : 'Você quer mesmo tirar essa carta do seu acervo? Ela se vai pra sempre, sem volta.',
            okLabel: ehTrancada ? 'Cancelar a viagem' : 'Apagar carta',
            cancelLabel: ehTrancada ? 'Deixar viajar' : 'Manter no acervo',
            perigo: true,
          });
          if (!ok) return;
          try {
            const rr = await fetchAutenticado(`/api/app/espaco/cartas/${id}`, { method: 'DELETE' });
            if (!rr) return;
            const dd = await rr.json().catch(() => ({}));
            if (!dd?.ok) { toast(dd?.erro || 'Não consegui excluir.'); return; }
            row.style.transition = 'opacity .25s ease, transform .25s ease';
            row.style.opacity = '0'; row.style.transform = 'translateX(-100%)';
            setTimeout(() => carregarMinhasCartas(), 260);
          } catch (err) { toast('Não consegui excluir agora.'); }
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

  // ── CARD DE COMPARTILHAR (viral) — imagem 1080×1920 com o fundo do tema,
  // a logo Vida Mágica e "Correio Temporal / Vida Mágica". Gera e abre o share nativo.
  function _carregarImg(src) {
    return new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => res(img); img.onerror = rej; img.src = src;
    });
  }
  function _cover(ctx, img, W, H) {
    const ir = img.width / img.height, cr = W / H; let dw, dh, dx, dy;
    if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
    else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  function _fill(ctx, W, H, c1, c2) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function _wrap(ctx, text, maxW) {
    const out = [];
    String(text || '').split('\n').forEach(para => {
      if (!para) { out.push(''); return; }
      const words = para.split(' '); let line = '';
      words.forEach(w => {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
      });
      if (line) out.push(line);
    });
    return out;
  }
  async function _garantirFontes() {
    if (!document.fonts || !document.fonts.load) return;
    try { await Promise.all([document.fonts.load('700 100px Lora'), document.fonts.load('600 52px Montserrat')]); } catch (e) {}
  }
  // Card de compartilhar = a CARTA (papel com avatar/título/data/texto, como ela é,
  // SEM o X e SEM o botão) por cima do fundo do tema + marca "Correio Temporal".
  async function gerarCardCompartilhar(c, comAvatar) {
    c = c || {}; if (comAvatar === undefined) comAvatar = true;
    const W = 1080, H = 1920;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle(document.body);
    const tema = document.body.getAttribute('data-tema') || 'vida_magica';
    const acento = (cs.getPropertyValue('--acento') || '#C8922A').trim();
    const acento2 = (cs.getPropertyValue('--acento-2') || '#E8C97A').trim();
    const cTexto = (cs.getPropertyValue('--carta-texto') || '#3D2E1A').trim();
    const cSalut = (cs.getPropertyValue('--carta-salut') || '#4A3414').trim();
    const cSuave = (cs.getPropertyValue('--carta-suave') || '#A07B3E').trim();
    const paperMap = { vida_magica: ['#FCF6E7', '#F4E8CF'], medieval: ['#F2E4C2', '#E4CF9F'], universo: ['#F4F3FB', '#E5E7F5'], magico: ['#FBF4FB', '#ECE4F8'] };
    const paper = paperMap[tema] || paperMap.vida_magica;

    // 1) Fundo do tema + scrim
    const bgMap = { magico: '/assets/bgespaco/magico.webp', universo: '/assets/bgespaco/universo.webp', medieval: '/assets/bgespaco/medieval.webp' };
    if (bgMap[tema]) { try { _cover(ctx, await _carregarImg(bgMap[tema]), W, H); } catch (e) { _fill(ctx, W, H, '#FBF6EA', '#E8DCC0'); } }
    else _fill(ctx, W, H, '#FBF6EA', '#E8DCC0');
    const sc = ctx.createLinearGradient(0, 0, 0, H);
    sc.addColorStop(0, 'rgba(8,6,3,0.28)'); sc.addColorStop(0.5, 'rgba(8,6,3,0.36)'); sc.addColorStop(1, 'rgba(8,6,3,0.66)');
    ctx.fillStyle = sc; ctx.fillRect(0, 0, W, H);

    // Carrega selo + avatar antes (preciso saber se o avatar entra pra medir a altura)
    let seloImg = null; try { seloImg = await _carregarImg('/assets/selo-carta.webp'); } catch (e) {}
    let avImg = null; if (comAvatar && alunaFoto) { try { avImg = await _carregarImg(alunaFoto); } catch (e) {} }
    await _garantirFontes();

    // Layout do PAPEL — altura dinâmica (cresce/encolhe com o texto) e centralizado
    const px = 80, pw = W - 160, pad = 56, cw = pw - pad * 2;
    const avatarBloco = avImg ? (156 + 26) : 0;           // diâmetro + respiro
    const yCorreioRel = pad + avatarBloco + 50;           // "Correio Temporal" (cabeçalho)
    const yEscritaRel = yCorreioRel + 50;                 // "Escrita por mim em: …"
    const yRecebidaRel = yEscritaRel + 42;                // "Recebida em: …"
    const yTituloRel = yRecebidaRel + 72;                 // título da carta
    const yContentTopRel = yTituloRel + 42;               // topo do corpo
    const bandTop = 210, bandBottom = 1730, bandH = bandBottom - bandTop;
    const maxContentH = bandH - (yContentTopRel + pad);
    let fs = 42, lh, lines;
    for (; fs >= 26; fs -= 2) { ctx.font = '400 ' + fs + 'px Lora, Georgia, serif'; lines = _wrap(ctx, c.conteudo || '', cw); lh = Math.round(fs * 1.62); if (lines.length * lh <= maxContentH) break; }
    if (lines.length * lh > maxContentH) { const mx = Math.max(1, Math.floor(maxContentH / lh)); lines = lines.slice(0, mx); lines[lines.length - 1] = (lines[lines.length - 1] || '').replace(/.$/, '…'); }
    const contentH = lines.length * lh;
    const cardH = yContentTopRel + contentH + pad;
    const cardTop = Math.round(Math.max(bandTop, Math.min(bandTop + (bandH - cardH) / 2, bandBottom - cardH)));

    // Papel
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.42)'; ctx.shadowBlur = 46; ctx.shadowOffsetY = 18;
    const pg = ctx.createLinearGradient(0, cardTop, 0, cardTop + cardH); pg.addColorStop(0, paper[0]); pg.addColorStop(1, paper[1]);
    _roundRect(ctx, px, cardTop, pw, cardH, 38); ctx.fillStyle = pg; ctx.fill(); ctx.restore();

    // Avatar (foto da aluna)
    if (avImg) {
      const r = 78, ax = W / 2, ay = cardTop + pad + r;
      ctx.save(); ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      const s = Math.max((2 * r) / avImg.width, (2 * r) / avImg.height), dw = avImg.width * s, dh = avImg.height * s;
      ctx.drawImage(avImg, ax - dw / 2, ay - dh / 2, dw, dh); ctx.restore();
      ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.lineWidth = 6; ctx.strokeStyle = acento2; ctx.stroke();
    }
    ctx.textAlign = 'center';
    // Cabeçalho "Correio Temporal" + datas
    ctx.fillStyle = cSalut; ctx.font = '700 52px Lora, Georgia, serif';
    ctx.fillText('Correio Temporal', W / 2, cardTop + yCorreioRel);
    ctx.fillStyle = cSuave; ctx.font = 'italic 400 32px Lora, Georgia, serif';
    if (c.criado_em) ctx.fillText('Escrita por mim em: ' + fmtData(c.criado_em), W / 2, cardTop + yEscritaRel);
    if (c.abrir_em) ctx.fillText('Recebida em: ' + fmtData(c.abrir_em), W / 2, cardTop + yRecebidaRel);
    // Título da carta
    let tit = c.titulo || 'Sua Carta do Tempo';
    ctx.fillStyle = cSalut; ctx.font = '700 46px Lora, Georgia, serif';
    while (tit.length > 4 && ctx.measureText(tit).width > cw) tit = tit.slice(0, -2);
    if (tit !== (c.titulo || 'Sua Carta do Tempo')) tit = tit.replace(/.$/, '…');
    ctx.fillText(tit, W / 2, cardTop + yTituloRel);
    // Corpo
    ctx.textAlign = 'left'; ctx.fillStyle = cTexto; ctx.font = '400 ' + fs + 'px Lora, Georgia, serif';
    let y = cardTop + yContentTopRel + fs;
    lines.forEach(ln => { ctx.fillText(ln, px + pad, y); y += lh; });
    // Selo (selo-carta.webp): topo TANGENTE à margem superior do card + leve folga da direita.
    if (seloImg) { const seloDir = 36, bw = 168, bh = bw * (seloImg.height / seloImg.width); ctx.drawImage(seloImg, px + pw - bw - seloDir, cardTop, bw, bh); }

    // toBlob — se o avatar tiver tornado o canvas "tainted" (CORS), refaz sem avatar
    try {
      return await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('null')), 'image/png', 0.95));
    } catch (e) {
      if (comAvatar) return gerarCardCompartilhar(c, false);
      throw e;
    }
  }

  // ── MODAL — abrir carta madura ───────────────────────────────
  function abrirModal(id) { el(id)?.classList.add('aberto'); el(id)?.setAttribute('aria-hidden', 'false'); }
  function fecharModal(id) { el(id)?.classList.remove('aberto'); el(id)?.setAttribute('aria-hidden', 'true'); }

  // Confirmação própria da marca (NUNCA usar confirm()/alert() do sistema)
  function confirmarAcao(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const modal = el('modal-confirmar'), msg = el('confirmar-msg');
      const okb = el('confirmar-ok'), cancelb = el('confirmar-cancelar');
      const overlay = modal ? modal.querySelector('.espaco-modal-overlay') : null;
      if (!modal || !okb || !cancelb) { resolve(false); return; }
      if (msg) msg.textContent = opts.mensagem || 'Tem certeza?';
      okb.textContent = opts.okLabel || 'Confirmar';
      cancelb.textContent = opts.cancelLabel || 'Voltar';
      okb.classList.toggle('perigo', !!opts.perigo);
      let done = false;
      const finish = (v) => {
        if (done) return; done = true;
        okb.removeEventListener('click', onOk);
        cancelb.removeEventListener('click', onCancel);
        if (overlay) overlay.removeEventListener('click', onCancel);
        fecharModal('modal-confirmar');
        resolve(v);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      okb.addEventListener('click', onOk);
      cancelb.addEventListener('click', onCancel);
      if (overlay) overlay.addEventListener('click', onCancel);
      abrirModal('modal-confirmar');
    });
  }
  function abrirModalCarta(c) {
    // Selo = foto da aluna (ela escreveu pra si mesma); sem foto, cai no envelope
    const selo = el('carta-aberta-selo');
    if (selo) selo.innerHTML = alunaFoto
      ? `<img src="${alunaFoto}" alt="">`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
    const t = el('carta-aberta-titulo'); if (t) t.textContent = c.titulo || 'Sua Carta do Tempo';
    const d = el('carta-aberta-data');   if (d) d.textContent = `Escrita em ${fmtData(c.criado_em || c.abrir_em)}`;
    const co = el('carta-aberta-conteudo'); if (co) co.textContent = c.conteudo || '';
    // Botão "Compartilhar" — gera o card da marca e abre o share nativo
    // (WhatsApp, Status, Instagram Stories/Feed — a pessoa escolhe onde postar).
    const share = el('carta-aberta-share');
    if (share) {
      share.onclick = async () => {
        if (share.classList.contains('carregando')) return;
        share.classList.add('carregando');
        const texto = 'Deixei uma carta pro meu futuro no Correio Temporal ✨ — Vida Mágica\nvidamagica.com.br';
        try {
          const blob = await gerarCardCompartilhar(c);
          const file = new File([blob], 'correio-temporal-vida-magica.png', { type: 'image/png' });
          if (blob && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text: texto });
          } else if (blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'correio-temporal-vida-magica.png'; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            toast('Card salvo — compartilhe nos stories ✨');
          } else { throw new Error('sem card'); }
        } catch (e) {
          if (!e || e.name !== 'AbortError') {   // AbortError = usuário fechou o share
            window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
          }
        } finally { share.classList.remove('carregando'); }
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
  // ════════════════════════════════════════════════════════════
  // AMBIENTE + PLAYER DE AFIRMAÇÕES
  // Ambiente = bottom sheet (afirmações · timer · música). Afirmações:
  // a aluna escolhe até 7 frases (na ordem), define ritmo/narração/repetir
  // e roda um player de tela cheia com a imagem do tema. Seleção efêmera.
  // ════════════════════════════════════════════════════════════
  function escAfirm(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  let _afirmTodas = [];        // catálogo carregado (flat, ordenado por categoria)
  let _afirmSel = [];          // selecionadas, NA ORDEM (máx 7)
  let _afirmCarregou = false;
  // gapMs = INTERVALO (espaço) que a aluna define entre uma afirmação e a próxima.
  // Com narração: a contagem do intervalo só começa DEPOIS do áudio terminar
  // (áudio a áudio, duração real — nunca estimativa/média).
  const _afirmCfg = { gapMs: 4000, narracao: true, repetir: false };

  // ── Ambiente (bottom sheet) ──
  function abrirAmbiente() {
    const a = el('espaco-ambiente'); if (!a) return;
    a.classList.add('aberto'); a.setAttribute('aria-hidden', 'false');
  }
  function fecharAmbiente() {
    const a = el('espaco-ambiente'); if (!a) return;
    a.classList.remove('aberto'); a.setAttribute('aria-hidden', 'true');
  }

  // ── Afirmações: setup ──
  async function abrirAfirmSetup() {
    const ov = el('espaco-afirm-setup'); if (!ov) return;
    ov.classList.add('aberto'); ov.setAttribute('aria-hidden', 'false');
    if (!_afirmCarregou) { _afirmCarregou = true; await carregarAfirmacoes(); }
  }
  function fecharAfirmSetup() {
    const ov = el('espaco-afirm-setup'); if (!ov) return;
    ov.classList.remove('aberto'); ov.setAttribute('aria-hidden', 'true');
  }
  async function carregarAfirmacoes() {
    const cont = el('afirm-lista');
    try {
      const r = await fetchAutenticado('/api/app/espaco/afirmacoes');
      if (!r) return;
      const d = await r.json();
      if (d?.ok) { _afirmTodas = d.afirmacoes || []; renderAfirmLista(); }
      else if (cont) cont.innerHTML = '<div class="espaco-afirm-load">Não consegui carregar agora.</div>';
    } catch (e) {
      console.warn('[espaco] afirmacoes:', e);
      if (cont) cont.innerHTML = '<div class="espaco-afirm-load">Não consegui carregar agora.</div>';
    }
  }
  function renderAfirmLista() {
    const cont = el('afirm-lista'); if (!cont) return;
    if (!_afirmTodas.length) { cont.innerHTML = '<div class="espaco-afirm-load">Nenhuma afirmação disponível ainda.</div>'; return; }
    let html = ''; let catAtual;
    _afirmTodas.forEach(a => {
      if (a.categoria !== catAtual) { catAtual = a.categoria; html += `<div class="espaco-afirm-grupo">${escAfirm(catAtual)}</div>`; }
      const idx = _afirmSel.findIndex(s => s.id === a.id);
      const sel = idx >= 0;
      html += `<button type="button" class="espaco-afirm-frase${sel ? ' sel' : ''}" data-aid="${a.id}">
        <span class="espaco-afirm-num">${sel ? (idx + 1) : ''}</span>
        <span class="espaco-afirm-txt">${escAfirm(a.texto)}</span>
      </button>`;
    });
    cont.innerHTML = html;
    _atualizarContador();
  }
  function _refreshSelUI() {
    document.querySelectorAll('#afirm-lista .espaco-afirm-frase').forEach(btn => {
      const id = Number(btn.dataset.aid);
      const idx = _afirmSel.findIndex(s => s.id === id);
      const sel = idx >= 0;
      btn.classList.toggle('sel', sel);
      const num = btn.querySelector('.espaco-afirm-num');
      if (num) num.textContent = sel ? (idx + 1) : '';
    });
    _atualizarContador();
  }
  function _atualizarContador() {
    const c = el('afirm-contador'); if (c) c.textContent = `${_afirmSel.length}/7`;
    const ini = el('afirm-iniciar'); if (ini) ini.disabled = _afirmSel.length === 0;
  }
  function toggleAfirmSel(id) {
    const i = _afirmSel.findIndex(s => s.id === id);
    if (i >= 0) { _afirmSel.splice(i, 1); }
    else {
      if (_afirmSel.length >= 7) { toast('Você já escolheu 7 — toque numa pra tirar e trocar.'); return; }
      const a = _afirmTodas.find(x => x.id === id); if (a) _afirmSel.push(a);
    }
    _refreshSelUI();
  }

  // ── Afirmações: player tela cheia ──
  let _pLista = [], _pIdx = 0, _pPlaying = false, _pFase = 'gap';  // _pFase: 'audio' | 'gap'
  let _pTimer = null, _pFadeTimer = null, _pAudio = null, _visHandler = null;

  const SVG_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  const SVG_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  function _setToggleIcon(playing) {
    const b = el('afirm-player-toggle');
    if (b) { b.innerHTML = playing ? SVG_PAUSE : SVG_PLAY; b.setAttribute('aria-label', playing ? 'Pausar' : 'Continuar'); }
  }

  function iniciarPlayer() {
    if (!_afirmSel.length) return;
    _pLista = _afirmSel.slice();
    _pIdx = 0; _pPlaying = true;
    _pAudio = el('afirm-player-audio');
    const pl = el('espaco-afirm-player');
    pl.classList.add('aberto'); pl.setAttribute('aria-hidden', 'false');
    _setToggleIcon(true);
    _ligarVisibilidade();
    _mostrarFrase(0);
  }
  function _mostrarFrase(i) {
    _pIdx = i;
    const fr = el('afirm-player-frase'); const it = _pLista[i]; if (!fr || !it) return;
    const pos = el('afirm-player-pos'); if (pos) pos.textContent = `${i + 1} / ${_pLista.length}`;
    fr.classList.remove('visivel');
    clearTimeout(_pFadeTimer); clearTimeout(_pTimer);
    _pFadeTimer = setTimeout(() => {
      fr.textContent = it.texto;
      requestAnimationFrame(() => requestAnimationFrame(() => fr.classList.add('visivel')));
      _tocarOuEsperar(it);
    }, 320);
  }
  // Decide o que controla o avanço desta frase:
  // - narração ON + tem MP3 → espera o ÁUDIO TERMINAR (duração real), depois o intervalo;
  // - senão (sem narração ou frase sem áudio) → o intervalo é o tempo da frase na tela.
  function _tocarOuEsperar(it) {
    const usarAudio = _afirmCfg.narracao && it && it.audio_url && _pAudio;
    if (usarAudio) {
      _pFase = 'audio';
      try {
        _pAudio.onended = _aposAudio;
        _pAudio.onerror = _aposAudio;   // se o MP3 falhar, não trava — segue
        _pAudio.src = it.audio_url;
        _pAudio.currentTime = 0;
        const pp = _pAudio.play();
        if (pp && pp.catch) pp.catch(() => _aposAudio());
      } catch { _aposAudio(); }
    } else {
      if (_pAudio) _pAudio.pause();
      _pFase = 'gap';
      _pTimer = setTimeout(_playerProximo, _afirmCfg.gapMs);
    }
  }
  // Áudio terminou (de verdade) → conta o INTERVALO escolhido e só então avança.
  function _aposAudio() {
    if (_pAudio) { _pAudio.onended = null; _pAudio.onerror = null; }
    if (!_pPlaying) return;
    _pFase = 'gap';
    clearTimeout(_pTimer);
    _pTimer = setTimeout(_playerProximo, _afirmCfg.gapMs);
  }
  function _playerProximo() {
    if (!_pPlaying) return;
    let n = _pIdx + 1;
    if (n >= _pLista.length) {
      if (_afirmCfg.repetir) n = 0;
      else return _finalizarPlayer();
    }
    _mostrarFrase(n);
  }
  function playerPausar() {
    _pPlaying = false;
    clearTimeout(_pTimer); clearTimeout(_pFadeTimer);
    if (_pAudio && _pFase === 'audio') _pAudio.pause();
    _setToggleIcon(false);
  }
  function playerRetomar() {
    _pPlaying = true; _setToggleIcon(true);
    if (_pFase === 'audio' && _pAudio) {
      // retoma o áudio de onde parou; ao terminar, _aposAudio conta o intervalo
      try { const pp = _pAudio.play(); if (pp && pp.catch) pp.catch(() => _aposAudio()); } catch { _aposAudio(); }
    } else {
      clearTimeout(_pTimer);
      _pTimer = setTimeout(_playerProximo, _afirmCfg.gapMs);
    }
  }
  function playerToggle() { _pPlaying ? playerPausar() : playerRetomar(); }
  function _finalizarPlayer() { fecharPlayer(); toast('Sessão concluída ✨'); }
  function fecharPlayer() {
    _pPlaying = false;
    clearTimeout(_pTimer); clearTimeout(_pFadeTimer);
    if (_pAudio) { _pAudio.pause(); _pAudio.onended = null; _pAudio.onerror = null; }
    _desligarVisibilidade();
    const pl = el('espaco-afirm-player');
    if (pl) { pl.classList.remove('aberto'); pl.setAttribute('aria-hidden', 'true'); }
    el('afirm-player-frase')?.classList.remove('visivel');
  }
  // Monetização: não-Clube só ouve com a tela aberta (pausa ao esconder).
  function _ligarVisibilidade() {
    _desligarVisibilidade();
    if (window._espacoCtx?.tem_clube) return; // Clube pode background
    _visHandler = () => { if (document.hidden && _pPlaying) playerPausar(); };
    document.addEventListener('visibilitychange', _visHandler);
  }
  function _desligarVisibilidade() {
    if (_visHandler) { document.removeEventListener('visibilitychange', _visHandler); _visHandler = null; }
  }

  // ── Timer (estilo Apple) — global; roda independente da folha aberta.
  // Conta por TIMESTAMP-alvo (não decrementa contador) → sobrevive ao
  // throttle de background do iOS: ao voltar, recalcula o tempo certo.
  let _tmRunning = false, _tmFimTs = 0, _tmRestanteMs = 0, _tmTick = null;
  let _audioCtx = null;

  function _fmtTimer(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60), ss = s % 60;
    return `${m}:${String(ss).padStart(2, '0')}`;
  }
  function _tmRestante() { return _tmRunning ? Math.max(0, _tmFimTs - Date.now()) : _tmRestanteMs; }
  function _tmRender() {
    const txt = _fmtTimer(_tmRestante());
    const disp = el('timer-display'); if (disp) disp.textContent = txt;
    const tg = el('timer-toggle');
    if (tg) { tg.innerHTML = _tmRunning ? SVG_PAUSE : SVG_PLAY; tg.setAttribute('aria-label', _tmRunning ? 'Pausar' : 'Iniciar'); }
    const chip = el('espaco-timer-chip');
    if (chip) {
      const ativo = _tmRunning || _tmRestanteMs > 0;
      chip.style.display = ativo ? '' : 'none';
      chip.classList.toggle('rodando', _tmRunning);
      const ct = el('timer-chip-txt'); if (ct) ct.textContent = txt;
    }
  }
  function abrirTimer() {
    const t = el('espaco-timer'); if (!t) return;
    t.classList.add('aberto'); t.setAttribute('aria-hidden', 'false');
    _tmRender();
  }
  function fecharTimer() {
    const t = el('espaco-timer'); if (!t) return;
    t.classList.remove('aberto'); t.setAttribute('aria-hidden', 'true');
  }
  function _tmSetPreset(ms) {
    _tmRestanteMs = ms;
    if (_tmRunning) _tmFimTs = Date.now() + ms;
    _tmRender();
  }
  function _tmAdd(ms) {
    if (_tmRunning) _tmFimTs += ms;
    else _tmRestanteMs = Math.max(0, _tmRestanteMs + ms);
    _tmRender();
  }
  function _tmPlayPause() {
    if (_tmRunning) {
      _tmRestanteMs = _tmRestante();
      _tmRunning = false;
      clearInterval(_tmTick); _tmTick = null;
    } else {
      if (_tmRestanteMs <= 0) { toast('Escolha um tempo primeiro.'); return; }
      _desbloquearAudio();   // gesto do usuário libera o som de término
      _tmFimTs = Date.now() + _tmRestanteMs;
      _tmRunning = true;
      clearInterval(_tmTick);
      _tmTick = setInterval(_tmTickFn, 250);
    }
    _tmRender();
  }
  function _tmTickFn() {
    if (_tmRestante() <= 0) { _tmCompletar(); return; }
    _tmRender();
  }
  function _tmCompletar() {
    clearInterval(_tmTick); _tmTick = null;
    _tmRunning = false; _tmRestanteMs = 0;
    document.querySelectorAll('#timer-presets button').forEach(b => b.classList.remove('sel'));
    _tmRender();
    _tmTocarSino();
    toast('Tempo concluído ✨');
  }
  function _tmReset() {
    clearInterval(_tmTick); _tmTick = null;
    _tmRunning = false; _tmRestanteMs = 0;
    document.querySelectorAll('#timer-presets button').forEach(b => b.classList.remove('sel'));
    _tmRender();
  }
  // Som suave de término — Web Audio (sem arquivo). Desbloqueado no 1º play.
  function _desbloquearAudio() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
    } catch {}
  }
  function _tmTocarSino() {
    try {
      if (!_audioCtx) _desbloquearAudio();
      const ctx = _audioCtx; if (!ctx) return;
      const now = ctx.currentTime;
      [880, 1174.7, 1318.5].forEach((f, k) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t0 = now + k * 0.16;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0); o.stop(t0 + 1.7);
      });
    } catch {}
  }

  // ── Wiring do Ambiente/Afirmações ──
  function ligarAmbiente() {
    el('ferr-ambiente')?.addEventListener('click', abrirAmbiente);
    document.querySelectorAll('[data-fechar-ambiente]').forEach(o => o.addEventListener('click', fecharAmbiente));
    el('ferr-afirmacoes')?.addEventListener('click', () => { fecharAmbiente(); abrirAfirmSetup(); });
    el('ferr-timer')?.addEventListener('click', () => { fecharAmbiente(); abrirTimer(); });
    el('ferr-musica')?.addEventListener('click', () => toast('Música — em breve ✨'));
    // Timer: chip do header reabre a folha; controles
    el('espaco-timer-chip')?.addEventListener('click', abrirTimer);
    document.querySelectorAll('[data-fechar-timer]').forEach(o => o.addEventListener('click', fecharTimer));
    el('timer-presets')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-min]'); if (!b) return;
      el('timer-presets').querySelectorAll('button').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      _tmSetPreset(Number(b.dataset.min) * 60000);
    });
    el('timer-add')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-add]'); if (!b) return;
      _tmAdd(Number(b.dataset.add) * 60000);
    });
    el('timer-reset')?.addEventListener('click', _tmReset);
    el('timer-toggle')?.addEventListener('click', _tmPlayPause);
    el('afirm-setup-x')?.addEventListener('click', fecharAfirmSetup);
    el('afirm-lista')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.espaco-afirm-frase'); if (!btn) return;
      toggleAfirmSel(Number(btn.dataset.aid));
    });
    el('afirm-cadencia')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-cad]'); if (!b) return;
      el('afirm-cadencia').querySelectorAll('button').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); _afirmCfg.gapMs = Number(b.dataset.cad);
    });
    const ligarToggle = (id, key) => {
      el(id)?.addEventListener('click', () => {
        _afirmCfg[key] = !_afirmCfg[key];
        el(id).classList.toggle('sel', _afirmCfg[key]);
        el(id).setAttribute('aria-checked', _afirmCfg[key] ? 'true' : 'false');
      });
    };
    ligarToggle('afirm-narracao', 'narracao');
    ligarToggle('afirm-repetir', 'repetir');
    el('afirm-iniciar')?.addEventListener('click', iniciarPlayer);
    el('afirm-player-x')?.addEventListener('click', fecharPlayer);
    el('afirm-player-toggle')?.addEventListener('click', playerToggle);
  }

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
    alunaFoto = ctx.aluna?.foto_url || null;   // pra usar como selo na carta aberta

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
    ligarAmbiente();
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
