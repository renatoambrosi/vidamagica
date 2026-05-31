/* === VIDA MÁGICA — public/app/caderno.js ===
   Lógica do Caderno da Mentalização e da view Conquistas.

   Carregado como script separado depois de app.js. Usa as globais:
   - fetchAutenticado(url, opts)  pra chamadas autenticadas
   - irPara(viewId)               pra navegar entre views
   - toast(msg, tipo)             pra mensagens curtas
   - abrirModal / fecharModal     pra os modais
   - window._ctxAtual             pro contexto carregado da Home

   Funções globais expostas (chamadas via onclick no app.html):
   - trocarAbaCaderno(aba, btn)
   - trocarFonteAudio(fonte, btn)
   - trocarStatusVision(status, btn)
   - filtrarAfirmacoes(filtro, btn)

   Funções de render chamadas pelo irPara:
   - renderCaderno()
   - renderConquistas()
   === */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     LOADING RITUAL DO CADERNO — sempre dispara
     ═══════════════════════════════════════════════════════════
     Toda vez que a aluna entra no Caderno (não só na 1ª visita),
     roda um loading narrativo de ~3s simulando "acesso ao
     subconsciente": fumaça branca tomando a tela + orb dourado
     pulsando + mensagens sequenciais ("Acessando o subconsciente
     → Acessando sonhos → Indo a lugares profundos → Sonhos
     carregados com sucesso ✨"). É proposital — a feature é
     ritualística, a entrada faz parte da experiência.

     Pra desabilitar temporariamente (debug, teste rápido),
     trocar `LOADING_RITUAL_ATIVO` pra false.
     ═══════════════════════════════════════════════════════════ */
  const LOADING_RITUAL_ATIVO = true;
  const LOADING_DURACAO_MS = 5000;       // total do loading
  const LOADING_STEPS = 4;               // 4 mensagens
  const LOADING_STEP_MS = LOADING_DURACAO_MS / LOADING_STEPS; // 1250ms cada — leitura confortável

  // ── ESTADO LOCAL ─────────────────────────────────────────
  const estado = {
    abaAtiva: 'escrever',
    promptDoDia: null,
    audios: { catalogo: [], url_propria: null, ultimo_audio_id: null },
    visionStatus: 'ativo',
    afirmacoesFiltro: 'todas',
  };

  function el(id) { return document.getElementById(id); }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtData(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return ''; }
  }
  function diasAtePropriaDataISO(iso) {
    if (!iso) return 0;
    const alvo = new Date(iso).getTime();
    const agora = Date.now();
    return Math.max(0, Math.ceil((alvo - agora) / 86400000));
  }

  // ════════════════════════════════════════════════════════
  // CARDS DE ATALHO (Home)
  // Mostra badges de streak (Caderno) e prêmios novos (Conquistas).
  // Chamado depois do contexto ser carregado.
  // ════════════════════════════════════════════════════════
  window.renderAtalhosCaderno = function (ctx) {
    if (!ctx) return;
    // Badge no card Caderno: streak rápida (🔥 N)
    try {
      const r = ctx.gamificacao?.rapida_atual || 0;
      const badge = el('atalho-caderno-badge');
      if (badge) {
        if (r > 0) {
          badge.textContent = '🔥 ' + r;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
      const sub = el('atalho-caderno-sub');
      if (sub) {
        if (ctx.caderno?.escreveu_hoje) sub.textContent = 'Escreveu hoje ✨';
        else if (ctx.caderno?.prompt_do_dia?.texto) sub.textContent = 'Prompt do dia esperando';
        else sub.textContent = 'Escreva o que você quer materializar';
      }
    } catch (_) {}

    // Badge no card Conquistas: prêmios novos
    try {
      const premiosN = (ctx.gamificacao_premios_novos || []).length;
      const badge = el('atalho-conquistas-badge');
      if (badge) {
        if (premiosN > 0) {
          badge.textContent = '✦ ' + premiosN;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
      const sub = el('atalho-conquistas-sub');
      if (sub) {
        const ciclo = ctx.gamificacao?.ciclo_30_logins || 0;
        if (ciclo > 0) sub.textContent = `Mês: ${ciclo}/30 · 🔥 ${ctx.gamificacao?.rapida_atual || 0}`;
        else sub.textContent = 'Ofensivas, missões e prêmios';
      }
    } catch (_) {}
  };

  // ════════════════════════════════════════════════════════
  // CADERNO — render principal e abas
  // ════════════════════════════════════════════════════════
  window.renderCaderno = async function () {
    estado.abaAtiva = estado.abaAtiva || 'escrever';
    // Sincroniza estado ativo em pills antigas E no bottom-nav imersivo
    document.querySelectorAll('.caderno-aba, .caderno-tab').forEach(a => {
      a.classList.toggle('ativa', a.dataset.aba === estado.abaAtiva);
    });
    document.querySelectorAll('.caderno-painel').forEach(p => {
      p.classList.toggle('ativo', p.id === `caderno-painel-${estado.abaAtiva}`);
    });
    // Badge de sementes no topo do Caderno (espelha o do /app)
    const badge = el('caderno-badge-sementes');
    if (badge && window._ctxAtual?.aluna) {
      badge.textContent = window._ctxAtual.aluna.sementes || 0;
    }
    // LOADING RITUAL — toda visita. Cérebro central + sparkles brancos
    // subindo + 4 frases empilhando estilo log. As partículas douradas do
    // Caderno NÃO disparam durante o loading (ficavam acumulando com os
    // sparkles e travando o iOS). Elas entram só DEPOIS do overlay sumir.
    if (LOADING_RITUAL_ATIVO) {
      dispararLoadingRitual();
      // Atraso = duração do loading + fade out (500ms) + um respiro
      setTimeout(() => criarParticulasCaderno(), LOADING_DURACAO_MS + 600);
    } else {
      criarParticulasCaderno();
    }
    // Carrega conteúdo da aba ativa
    await carregarAbaCaderno(estado.abaAtiva);
    // Indicador de cápsula madura (banner no topo da aba Escrever)
    aplicarBannerCapsula(window._ctxAtual?.caderno?.capsula_madura_pendente);
    // Botões iniciais
    ligarBotoesCaderno();
    // Mostra o botão Salvar flutuante quando entrar pela aba Escrever
    const salvar = el('caderno-btn-salvar');
    if (salvar) salvar.style.display = (estado.abaAtiva === 'escrever') ? '' : 'none';
    // Total de escritas no link "Ver minhas escritas"
    const count = el('caderno-historico-count');
    if (count && window._ctxAtual?.caderno) {
      count.textContent = window._ctxAtual.caderno.total_escritas || 0;
    }
    // Auto-focus no textarea da aba Escrever — só DEPOIS do loading sumir.
    // Loading dura LOADING_DURACAO_MS + ~300ms de fade out. Aí o teclado
    // sobe sem competir com a animação. iOS exige interação prévia pra
    // .focus() funcionar — o tap no card de atalho conta como gesto.
    if (estado.abaAtiva === 'escrever') {
      const atraso = LOADING_RITUAL_ATIVO ? (LOADING_DURACAO_MS + 250) : 100;
      setTimeout(() => {
        const t = el('caderno-escrita-input');
        if (t && document.activeElement !== t) {
          try { t.focus({ preventScroll: true }); } catch { try { t.focus(); } catch {} }
        }
      }, atraso);
    }
  };

  // ────────────────────────────────────────────────────────────
  // ENTRADA RITUAL — splash + saudação + partículas + glow brand
  // Total da experiência: ~2.2s, mas não trava a aluna — splash usa
  // pointer-events: none, ela pode tocar/scrollar normalmente por baixo.
  // ────────────────────────────────────────────────────────────
  // Timers ativos do loading — limpos antes de re-disparar pra evitar
  // que um ciclo anterior interrompa o novo (acontece quando a aluna
  // reabre o Caderno antes do loading anterior terminar).
  let _loadingTimers = [];

  // Cria uma grande quantidade de sparkles brancos subindo na tela
  // para o fundo do loading, como pedido.
  function criarSparklesLoading() {
    const wrap = el('caderno-loading-sparkles');
    if (!wrap || wrap.dataset.gerado === '1') return;
    wrap.dataset.gerado = '1';
    const total = 22; // reduzido de 35 — menos compositor layers no iOS
    let html = '';
    for (let i = 0; i < total; i++) {
      const left = Math.random() * 100;
      const size = 2 + Math.random() * 5; 
      const delay = -Math.random() * 10;
      const dur = 4 + Math.random() * 6;
      html += `<span class="caderno-sparkle" style="--sp-left:${left}%;--sp-size:${size}px;--sp-delay:${delay}s;--sp-dur:${dur}s"></span>`;
    }
    wrap.innerHTML = html;
  }

  function dispararLoadingRitual() {
    const overlay = el('caderno-loading');
    if (!overlay) return;

    criarSparklesLoading();

    // Reset total — limpa timers e classes anteriores
    _loadingTimers.forEach(t => clearTimeout(t));
    _loadingTimers = [];
    overlay.classList.remove('ativo', 'saindo');
    const frase = el('caderno-loading-frase');
    if (frase) {
      frase.textContent = '';
      frase.classList.remove('ativa', 'final');
    }
    // Force reflow pra CSS animation reiniciar do zero
    void overlay.offsetWidth;

    // Mostra o overlay
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('ativo');

    // 4 FRASES — swap de texto na MESMA tag <p>. Elimina o bug iOS Safari
    // de elementos absolutos empilhados.
    //
    // Cada frase TOCA uma animação CSS auto-contida (entra → fica → sai)
    // em LOADING_STEP_MS (1200ms). Pra disparar de novo na próxima frase,
    // remove a classe, força reflow, troca texto, adiciona a classe.
    // SEM rAF, SEM timeouts encadeados, SEM swap de classes — só toca.
    const fraseArea = el('caderno-loading-frase-area');
    if (fraseArea) fraseArea.innerHTML = ''; // Limpa frases do loading anterior

    const FRASES = [
      { texto: 'Acessando o subconsciente…',         final: false },
      { texto: 'Acessando sonhos…',                  final: false },
      { texto: 'Indo a lugares profundos…',          final: false },
      { texto: 'Conectado - Pronto para manifestar ✨', final: true  },
    ];

    const tocarFrase = (i) => {
      if (!fraseArea) return;
      const item = FRASES[i] || FRASES[0];

      const p = document.createElement('p');
      // .entrando = estado inicial (vem de cima, maior, desfocada)
      p.className = 'caderno-loading-frase entrando';
      p.textContent = item.texto;
      if (item.final) p.classList.add('final');

      // PREPEND → nova frase entra no TOPO. As anteriores viram
      // :nth-child(2,3,4) e deslizam pra baixo suave (transition).
      fraseArea.prepend(p);

      // Remove .entrando no próximo frame → transiciona pro destaque.
      // rAF duplo garante que o browser pinte o estado .entrando antes.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => p.classList.remove('entrando'));
      });
    };

    // Agenda cada frase no seu slot (0, 1200ms, 2400ms, 3600ms)
    for (let i = 0; i < LOADING_STEPS; i++) {
      _loadingTimers.push(setTimeout(() => tocarFrase(i), i * LOADING_STEP_MS));
    }

    // Brand do topo pulsa quando chega a mensagem final
    _loadingTimers.push(setTimeout(() => {
      el('caderno-topo')?.classList.add('reveal-brand');
      _loadingTimers.push(setTimeout(() => el('caderno-topo')?.classList.remove('reveal-brand'), 1400));
    }, (LOADING_STEPS - 1) * LOADING_STEP_MS));

    // Fade out do overlay no fim do ciclo (depois da última frase ler)
    _loadingTimers.push(setTimeout(() => {
      overlay.classList.add('saindo');
      _loadingTimers.push(setTimeout(() => {
        overlay.classList.remove('ativo', 'saindo');
        overlay.setAttribute('aria-hidden', 'true');
      }, 500));
    }, LOADING_DURACAO_MS));
  }

  function criarParticulasCaderno() {
    const wrap = el('caderno-particulas');
    if (!wrap || wrap.dataset.gerado === '1') return;
    wrap.dataset.gerado = '1';
    // 36 partículas — mais densas que as 22 da Home pra comunicar
    // "outro espaço". Aluna do Clube ganha 18 extras (chuva de ouro
    // do Caderno, espelha a do app).
    const ehClube = !!window._ctxAtual?.tem_clube;
    const total = ehClube ? 54 : 36;
    let html = '';
    for (let i = 0; i < total; i++) {
      const left = Math.random() * 100;
      const size = 2 + Math.random() * 4;
      const delay = -Math.random() * 18;
      const dur = 14 + Math.random() * 10;
      const opacity = 0.35 + Math.random() * 0.45;
      const plus = i >= 36 ? ' caderno-particula-plus' : '';
      html += `<span class="caderno-particula${plus}" style="--p-left:${left}%;--p-size:${size}px;--p-delay:${delay}s;--p-dur:${dur}s;--p-op:${opacity}"></span>`;
    }
    wrap.innerHTML = html;
  }

  window.trocarAbaCaderno = function (aba, btnEl) {
    estado.abaAtiva = aba;
    // Sincroniza estado ATIVO no bottom-nav imersivo (.caderno-tab) E
    // nas pills antigas (.caderno-aba) se ainda existirem.
    document.querySelectorAll('.caderno-tab, .caderno-aba').forEach(a => a.classList.remove('ativa'));
    if (btnEl) btnEl.classList.add('ativa');
    // Garante que o tab certo do bottom-nav fique ativo mesmo se a
    // chamada veio de outro lugar (atalho, deep link futuro, etc.)
    document.querySelector(`.caderno-tab[data-aba="${aba}"]`)?.classList.add('ativa');
    document.querySelectorAll('.caderno-painel').forEach(p => p.classList.remove('ativo'));
    el(`caderno-painel-${aba}`)?.classList.add('ativo');
    // Botão Salvar flutuante: visível APENAS na aba Escrever
    const salvar = el('caderno-btn-salvar');
    if (salvar) salvar.style.display = (aba === 'escrever') ? '' : 'none';
    // Scroll do conteúdo volta pro topo ao trocar de aba — evita
    // ficar no meio de uma lista anterior.
    el('caderno-corpo')?.scrollTo({ top: 0, behavior: 'instant' });
    carregarAbaCaderno(aba);
  };

  async function carregarAbaCaderno(aba) {
    if (aba === 'escrever') await Promise.all([carregarPromptDoDia(), carregarEscritas()]);
    else if (aba === 'vision') await carregarVision();
    else if (aba === 'capsulas') await carregarCapsulas();
    else if (aba === 'metas') await carregarMetas();
    else if (aba === 'afirmacoes') await carregarAfirmacoes();
  }

  function ligarBotoesCaderno() {
    if (ligarBotoesCaderno._feito) return;
    ligarBotoesCaderno._feito = true;

    // Salvar escrita
    el('caderno-btn-salvar')?.addEventListener('click', salvarEscrita);
    // Contador de caracteres em tempo real
    el('caderno-escrita-input')?.addEventListener('input', atualizarContadorEscrita);
    // Ver minhas escritas → abre overlay full-screen
    el('escrever-ver-historico')?.addEventListener('click', () => {
      const ov = el('escrever-historico-overlay');
      if (ov) {
        ov.setAttribute('aria-hidden', 'false');
        ov.classList.add('aberto');
        // Garante que a lista está populada
        carregarEscritas();
      }
    });
    el('escrever-historico-voltar')?.addEventListener('click', () => {
      const ov = el('escrever-historico-overlay');
      if (ov) {
        ov.classList.remove('aberto');
        setTimeout(() => ov.setAttribute('aria-hidden', 'true'), 320);
      }
    });
    // Botão foco vira bottom-sheet
    el('caderno-btn-foco')?.addEventListener('click', () => {
      const player = el('caderno-foco-player');
      if (!player) return;
      const aberto = player.classList.contains('aberto');
      if (aberto) {
        player.classList.remove('aberto');
        setTimeout(() => player.setAttribute('aria-hidden', 'true'), 320);
        pararAudioFoco();
      } else {
        player.setAttribute('aria-hidden', 'false');
        player.classList.add('aberto');
        carregarAudios();
      }
    });
    el('caderno-foco-fechar')?.addEventListener('click', () => {
      const player = el('caderno-foco-player');
      if (player) {
        player.classList.remove('aberto');
        setTimeout(() => player.setAttribute('aria-hidden', 'true'), 320);
      }
      pararAudioFoco();
    });
    el('caderno-foco-select')?.addEventListener('change', (e) => {
      const id = Number(e.target.value);
      if (!id) return;
      const audio = estado.audios.catalogo.find(a => a.id === id);
      if (audio) {
        embedAudio(audio.url);
        fetchAutenticado('/api/app/caderno/audios/ultimo', {
          method: 'PUT', body: JSON.stringify({ id })
        }).catch(() => {});
      }
    });
    el('caderno-foco-btn-aplicar')?.addEventListener('click', () => {
      const url = el('caderno-foco-url').value.trim();
      if (!url) return;
      embedAudio(url);
      fetchAutenticado('/api/app/caderno/audios/url-propria', {
        method: 'PUT', body: JSON.stringify({ url })
      }).catch(() => {});
    });

    // Vision
    el('vision-btn-novo')?.addEventListener('click', () => el('vision-file-input').click());
    el('vision-file-input')?.addEventListener('change', uploadImagemVision);
    // Fechar lightbox e bottom-sheet
    el('vision-lightbox-fechar')?.addEventListener('click', fecharLightbox);
    el('vision-lightbox')?.addEventListener('click', (ev) => {
      if (ev.target === el('vision-lightbox')) fecharLightbox();
    });
    document.querySelectorAll('#vision-sheet [data-fechar-sheet]').forEach(b => {
      b.addEventListener('click', fecharVisionSheet);
    });

    // Cápsulas
    el('capsulas-btn-nova')?.addEventListener('click', () => {
      resetarCapsulaPills();
      abrirModal('modal-capsula-nova');
    });
    el('capsula-btn-salvar')?.addEventListener('click', salvarCapsula);
    document.querySelectorAll('.capsula-pill').forEach(p => {
      p.addEventListener('click', (ev) => escolherDataCapsula(p.dataset.meses, ev.currentTarget));
    });
    el('capsula-banner-btn')?.addEventListener('click', () => {
      const id = el('capsula-banner').dataset.capsulaId;
      if (id) abrirCapsulaMadura(Number(id));
    });

    // Metas
    el('metas-btn-nova')?.addEventListener('click', () => abrirModal('modal-meta-nova'));
    el('meta-btn-salvar')?.addEventListener('click', salvarMeta);

    // Fechar modais
    document.querySelectorAll('[data-close]').forEach(b => {
      b.addEventListener('click', (e) => {
        const m = e.target.closest('.modal');
        if (m) fecharModal(m);
      });
    });
  }

  // ── ABA: ESCREVER ────────────────────────────────────────

  async function carregarPromptDoDia() {
    const txt = el('caderno-prompt-texto');
    try {
      const r = await fetchAutenticado('/api/app/caderno/prompt-do-dia');
      const d = await r.json();
      if (d?.ok && d.prompt?.texto) {
        estado.promptDoDia = d.prompt;
        if (txt) txt.textContent = d.prompt.texto;
      } else if (txt) {
        txt.textContent = 'Que sentimento você quer materializar hoje?';
      }
    } catch (_) {
      if (txt) txt.textContent = 'Que sentimento você quer materializar hoje?';
    }
  }

  async function carregarEscritas() {
    const lista = el('caderno-historico-lista');
    if (!lista) return;
    try {
      const r = await fetchAutenticado('/api/app/caderno/escritas?limit=20');
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.escritas?.length) {
        lista.innerHTML = `<div class="caderno-empty">
          <p style="font-family:var(--font-display,serif);font-size:1rem;color:var(--texto);margin:0 0 .3rem">Sua primeira escrita está esperando você 💛</p>
          <p style="font-size:.85rem;color:var(--texto-suave);margin:0">Comece pelo que sente agora. O resto vai vir.</p>
        </div>`;
        return;
      }
      lista.innerHTML = d.escritas.map(e => `
        <article class="caderno-escrita-card" data-id="${e.id}">
          <header class="caderno-escrita-card-head">
            <time class="caderno-escrita-card-data">${fmtData(e.criado_em)}</time>
            <button type="button" class="caderno-escrita-card-apagar" data-id="${e.id}" aria-label="Apagar">🗑</button>
          </header>
          <p class="caderno-escrita-card-texto">${escHtml(e.conteudo)}</p>
        </article>
      `).join('');
      lista.querySelectorAll('.caderno-escrita-card-apagar').forEach(b => {
        b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const id = ev.currentTarget.dataset.id;
          if (!confirm('Apagar essa escrita?')) return;
          await fetchAutenticado(`/api/app/caderno/escritas/${id}`, { method: 'DELETE' });
          carregarEscritas();
        });
      });
    } catch {
      lista.innerHTML = '<div class="caderno-empty">Não consegui carregar.</div>';
    }
  }

  async function salvarEscrita() {
    const input = el('caderno-escrita-input');
    const conteudo = (input?.value || '').trim();
    if (conteudo.length < 3) {
      toast('Escreva pelo menos 3 caracteres', 'aviso');
      return;
    }
    try {
      const r = await fetchAutenticado('/api/app/caderno/escritas', {
        method: 'POST',
        body: JSON.stringify({
          conteudo,
          prompt_id: estado.promptDoDia?.id || null,
        }),
      });
      const d = await r.json();
      if (!d?.ok) throw 0;
      // Micro-celebração: partículas douradas explodindo do botão Salvar
      celebrarEscritaSalva();
      input.value = '';
      atualizarContadorEscrita();
      toast('Escrita salva ✨', 'ok');
      // Mostra missões completadas se houver
      (d.missoes_completadas || []).forEach(m => {
        if (m?.titulo) toast(`Missão concluída: ${m.titulo} (+${m.sementes} 🌱)`, 'ok');
      });
      carregarEscritas();
    } catch {
      toast('Não consegui salvar agora.', 'erro');
    }
  }

  // Micro-celebração ao salvar — 12 partículas douradas explodindo do
  // botão Salvar pra cima/lados. Animação CSS, removida após 1.4s.
  function celebrarEscritaSalva() {
    const host = el('escrever-salvar-particulas');
    if (!host) return;
    let html = '';
    for (let i = 0; i < 12; i++) {
      const angle = -180 + (i * 30) + (Math.random() * 20 - 10);
      const dist = 60 + Math.random() * 40;
      const size = 3 + Math.random() * 4;
      const delay = Math.random() * 0.08;
      const dx = Math.cos(angle * Math.PI / 180) * dist;
      const dy = Math.sin(angle * Math.PI / 180) * dist;
      html += `<span class="celeb-part" style="--dx:${dx}px;--dy:${dy}px;--sz:${size}px;--dly:${delay}s"></span>`;
    }
    host.innerHTML = html;
    setTimeout(() => { host.innerHTML = ''; }, 1500);
  }

  function atualizarContadorEscrita() {
    const input = el('caderno-escrita-input');
    const cont = el('caderno-contador');
    if (!input || !cont) return;
    const n = (input.value || '').length;
    cont.textContent = n;
    // Esconde quando vazio
    cont.style.opacity = n > 0 ? '0.6' : '0';
  }

  function aplicarBannerCapsula(capsulaMaduraPendente) {
    const banner = el('capsula-banner');
    if (!banner) return;
    if (capsulaMaduraPendente) {
      banner.style.display = '';
      banner.dataset.capsulaId = capsulaMaduraPendente.id;
      el('capsula-banner-sub').textContent = capsulaMaduraPendente.titulo || 'Toque pra abrir';
    } else {
      banner.style.display = 'none';
    }
  }

  // ── ABA: VISION BOARD ────────────────────────────────────

  window.trocarStatusVision = function (status, btnEl) {
    estado.visionStatus = status;
    document.querySelectorAll('.vision-toggle-btn').forEach(b => b.classList.remove('ativo'));
    if (btnEl) btnEl.classList.add('ativo');
    carregarVision();
  };

  async function carregarVision() {
    const grid = el('vision-grid');
    if (!grid) return;
    grid.innerHTML = montarSkeletonGrid(6);
    try {
      const r = await fetchAutenticado(`/api/app/caderno/vision?status=${estado.visionStatus}`);
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.itens?.length) {
        grid.innerHTML = estado.visionStatus === 'conquistado'
          ? `<div class="caderno-empty">
              <p style="font-family:var(--font-display,serif);font-size:1rem;color:var(--texto);margin:0 0 .3rem">Sua galeria de conquistas vai brilhar aqui 🏆</p>
              <p style="font-size:.85rem;color:var(--texto-suave);margin:0">Marque uma meta do quadro como "Materializei!" quando ela acontecer</p>
            </div>`
          : `<div class="caderno-empty">
              <p style="font-family:var(--font-display,serif);font-size:1rem;color:var(--texto);margin:0 0 .3rem">Seu Vision Board começa aqui ✨</p>
              <p style="font-size:.85rem;color:var(--texto-suave);margin:0">Toque em + e adicione a primeira imagem do que você quer materializar</p>
            </div>`;
        return;
      }
      grid.innerHTML = d.itens.map(it => `
        <div class="vision-card ${it.principal ? 'vision-card-principal' : ''}" data-id="${it.id}" data-url="${escHtml(it.imagem_url)}" data-titulo="${escHtml(it.titulo || '')}" data-principal="${it.principal ? '1' : '0'}">
          <img src="${escHtml(it.imagem_url)}" alt="${escHtml(it.titulo || 'Imagem do vision board')}" loading="lazy" />
          ${it.principal ? '<span class="vision-card-selo" aria-label="Imagem principal">⭐</span>' : ''}
        </div>
      `).join('');
      ligarLongPressVision();
    } catch {
      grid.innerHTML = '<div class="caderno-empty">Não consegui carregar.</div>';
    }
  }

  // Detecção de LONG-PRESS (toque longo) nos cards do Vision.
  // < 500ms = toque rápido → abre lightbox.
  // >= 500ms = long-press → abre bottom-sheet de ações.
  // Cancela se o dedo arrastar (>10px) — pra não confundir com scroll.
  function ligarLongPressVision() {
    document.querySelectorAll('#vision-grid .vision-card').forEach(card => {
      let timer = null;
      let startX = 0, startY = 0;
      let cancelado = false;
      let longTriggered = false;

      const start = (ev) => {
        cancelado = false;
        longTriggered = false;
        const point = ev.touches?.[0] || ev;
        startX = point.clientX;
        startY = point.clientY;
        timer = setTimeout(() => {
          if (!cancelado) {
            longTriggered = true;
            // Feedback tátil em iOS/Android (se suportado)
            try { navigator.vibrate?.(40); } catch {}
            abrirVisionSheet(card);
          }
        }, 500);
      };
      const move = (ev) => {
        const point = ev.touches?.[0] || ev;
        const dx = Math.abs(point.clientX - startX);
        const dy = Math.abs(point.clientY - startY);
        if (dx > 10 || dy > 10) {
          cancelado = true;
          clearTimeout(timer);
        }
      };
      const end = (ev) => {
        clearTimeout(timer);
        if (!cancelado && !longTriggered) {
          // Toque rápido = lightbox
          abrirLightbox(card.dataset.url, card.dataset.titulo);
        }
      };

      card.addEventListener('touchstart', start, { passive: true });
      card.addEventListener('touchmove', move, { passive: true });
      card.addEventListener('touchend', end);
      card.addEventListener('touchcancel', () => { cancelado = true; clearTimeout(timer); });
      // Mouse fallback (desktop)
      card.addEventListener('mousedown', start);
      card.addEventListener('mousemove', move);
      card.addEventListener('mouseup', end);
      card.addEventListener('mouseleave', () => { cancelado = true; clearTimeout(timer); });
    });
  }

  function abrirLightbox(url, titulo) {
    const lb = el('vision-lightbox');
    const img = el('vision-lightbox-img');
    if (!lb || !img) return;
    img.src = url;
    img.alt = titulo || '';
    lb.setAttribute('aria-hidden', 'false');
    lb.classList.add('aberto');
  }
  function fecharLightbox() {
    const lb = el('vision-lightbox');
    if (!lb) return;
    lb.classList.remove('aberto');
    setTimeout(() => {
      lb.setAttribute('aria-hidden', 'true');
      const img = el('vision-lightbox-img');
      if (img) img.src = '';
    }, 320);
  }

  function abrirVisionSheet(card) {
    const sheet = el('vision-sheet');
    if (!sheet) return;
    const id = card.dataset.id;
    const url = card.dataset.url;
    const titulo = card.dataset.titulo;
    const principal = card.dataset.principal === '1';

    // Popula preview
    const previewImg = el('vision-sheet-preview-img');
    if (previewImg) { previewImg.src = url; previewImg.alt = titulo || ''; }
    el('vision-sheet-titulo').textContent = titulo || 'Imagem do Vision Board';

    // Ações
    const btnPrincipal = el('vision-sheet-principal');
    const btnConquistado = el('vision-sheet-conquistado');
    const btnApagar = el('vision-sheet-apagar');

    // No modo "Conquistas" (galeria), esconde "Tornar principal" e "Materializei"
    const conquistas = estado.visionStatus === 'conquistado';
    btnPrincipal.style.display = (conquistas || principal) ? 'none' : '';
    btnConquistado.style.display = conquistas ? 'none' : '';

    btnPrincipal.onclick = async () => {
      fecharVisionSheet();
      await fetchAutenticado(`/api/app/caderno/vision/${id}/principal`, { method: 'POST' });
      toast('Marcada como principal ⭐', 'ok');
      carregarVision();
    };
    btnConquistado.onclick = async () => {
      fecharVisionSheet();
      await fetchAutenticado(`/api/app/caderno/vision/${id}/conquistado`, { method: 'POST' });
      toast('Materializada! Que glória 🏆', 'ok');
      carregarVision();
    };
    btnApagar.onclick = async () => {
      if (!confirm('Apagar essa imagem do seu vision?')) return;
      fecharVisionSheet();
      await fetchAutenticado(`/api/app/caderno/vision/${id}`, { method: 'DELETE' });
      carregarVision();
    };

    sheet.setAttribute('aria-hidden', 'false');
    sheet.classList.add('aberto');
  }
  function fecharVisionSheet() {
    const sheet = el('vision-sheet');
    if (!sheet) return;
    sheet.classList.remove('aberto');
    setTimeout(() => sheet.setAttribute('aria-hidden', 'true'), 320);
  }

  // Skeletons douradas pra grids/listas durante carregamento
  function montarSkeletonGrid(n = 6) {
    let h = '<div class="vision-skeleton-grid">';
    for (let i = 0; i < n; i++) h += '<div class="vision-skeleton-card"></div>';
    h += '</div>';
    return h;
  }
  function montarSkeletonLinhas(n = 3) {
    let h = '<div class="skeleton-linhas">';
    for (let i = 0; i < n; i++) h += '<div class="skeleton-linha"></div>';
    h += '</div>';
    return h;
  }

  async function uploadImagemVision(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('imagem', file);
    try {
      // Upload via rota existente — vai pra vidamagica/imagens
      const r = await fetch('/api/upload/imagem', {
        method: 'POST',
        headers: { Authorization: `Bearer ${VmSession.getAccess()}` },
        body: fd,
      });
      const d = await r.json();
      if (!d?.url) throw new Error('upload falhou');
      // Sobe sem título/área agora — edição vem com o modal próprio depois.
      // Não usar prompt() nativo do iOS (feio, e o usuário pode bloquear
      // todos os diálogos do domínio acidentalmente).
      const r2 = await fetchAutenticado('/api/app/caderno/vision', {
        method: 'POST',
        body: JSON.stringify({ imagem_url: d.url, titulo: '', area: '' }),
      });
      const d2 = await r2.json();
      if (!d2?.ok) throw new Error(d2?.erro || 'erro ao salvar');
      toast('Adicionado ao Vision Board ✨', 'ok');
      ev.target.value = '';
      carregarVision();
    } catch (err) {
      console.error('[vision] upload erro:', err);
      toast('Não consegui subir a imagem.', 'erro');
    }
  }

  // ── ABA: CÁPSULAS ────────────────────────────────────────

  async function carregarCapsulas() {
    const lista = el('capsulas-lista');
    if (!lista) return;
    lista.innerHTML = '<div class="caderno-empty">Carregando…</div>';
    try {
      const r = await fetchAutenticado('/api/app/caderno/capsulas');
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.capsulas?.length) {
        lista.innerHTML = ''; // hero já é convite suficiente
        return;
      }
      lista.innerHTML = `<h4 class="capsulas-lista-titulo">Suas cápsulas</h4>` + d.capsulas.map(c => {
        const trancada = c.trancada;
        const aberta = !!c.aberta_em;
        const madura = !trancada && !aberta;
        const dias = trancada ? diasAtePropriaDataISO(c.abrir_em) : 0;
        const estadoClass = trancada ? 'capsula-trancada' : aberta ? 'capsula-aberta' : 'capsula-madura';
        const selo = trancada ? '🔒' : aberta ? '💌' : '✨';
        const subtexto = trancada
          ? `Abre em ${fmtData(c.abrir_em)} · faltam ${dias} dia${dias === 1 ? '' : 's'}`
          : aberta
            ? `Aberta em ${fmtData(c.aberta_em)}`
            : 'Pronta pra abrir agora! ✨';
        return `
          <article class="capsula-card ${estadoClass}" data-id="${c.id}" ${madura ? 'data-acao-click="abrir"' : ''}>
            <div class="capsula-card-selo-novo">${selo}</div>
            <div class="capsula-card-corpo">
              <h4 class="capsula-card-titulo">${escHtml(c.titulo || 'Cápsula sem título')}</h4>
              <p class="capsula-card-meta">${subtexto}</p>
            </div>
            ${madura
              ? `<button type="button" class="capsula-card-btn-abrir" data-acao="abrir" data-id="${c.id}">Abrir</button>`
              : trancada
                ? `<button type="button" class="capsula-card-btn-apagar" data-acao="apagar" data-id="${c.id}" aria-label="Apagar">
                     <svg viewBox="0 0 24 24" stroke-width="1.7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                       <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                     </svg>
                   </button>`
                : ''}
          </article>
        `;
      }).join('');
      lista.querySelectorAll('button[data-acao]').forEach(b => {
        b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const acao = ev.currentTarget.dataset.acao;
          const id = Number(ev.currentTarget.dataset.id);
          if (acao === 'abrir') abrirCapsulaMadura(id);
          if (acao === 'apagar') {
            if (!confirm('Apagar essa cápsula?')) return;
            await fetchAutenticado(`/api/app/caderno/capsulas/${id}`, { method: 'DELETE' });
            carregarCapsulas();
          }
        });
      });
    } catch {
      lista.innerHTML = '<div class="caderno-empty">Não consegui carregar.</div>';
    }
  }

  async function salvarCapsula() {
    const titulo = el('capsula-titulo-input').value.trim();
    const conteudo = el('capsula-conteudo-input').value.trim();
    // Data vem do estado das pills (ou do input quando "Outra data")
    const dataStr = estado.capsulaDataEscolhida;
    if (!conteudo || conteudo.length < 10) {
      toast('Escreva pelo menos 10 caracteres', 'aviso');
      return;
    }
    if (!dataStr) {
      toast('Escolha quando abrir a cápsula', 'aviso');
      return;
    }
    const abrir_em = new Date(`${dataStr}T12:00:00`).toISOString();
    try {
      const r = await fetchAutenticado('/api/app/caderno/capsulas', {
        method: 'POST',
        body: JSON.stringify({ titulo, conteudo, abrir_em }),
      });
      const d = await r.json();
      if (!d?.ok) {
        toast(d?.erro || 'Não consegui salvar', 'erro');
        return;
      }
      toast('Cápsula lacrada ✨', 'ok');
      el('capsula-titulo-input').value = '';
      el('capsula-conteudo-input').value = '';
      el('capsula-data-input').value = '';
      estado.capsulaDataEscolhida = null;
      resetarCapsulaPills();
      fecharModal('modal-capsula-nova');
      carregarCapsulas();
    } catch {
      toast('Não consegui salvar.', 'erro');
    }
  }

  // Pills de data rápida pra cápsula (Em 1 mês / 3 / 6 / 1 ano / Outra).
  // Calcula data ISO e guarda em estado.capsulaDataEscolhida.
  function escolherDataCapsula(mesesOuCustom, btn) {
    const pills = document.querySelectorAll('.capsula-pill');
    pills.forEach(p => p.classList.remove('ativo'));
    if (btn) btn.classList.add('ativo');

    const input = el('capsula-data-input');
    const hint = el('capsula-data-hint');

    if (mesesOuCustom === 'custom') {
      input.style.display = '';
      input.value = '';
      input.focus();
      estado.capsulaDataEscolhida = null;
      if (hint) hint.textContent = '';
      input.onchange = () => {
        const v = input.value;
        if (v) {
          estado.capsulaDataEscolhida = v;
          atualizarHintCapsula(v, hint);
        }
      };
      return;
    }
    input.style.display = 'none';
    const meses = Number(mesesOuCustom);
    const d = new Date();
    d.setMonth(d.getMonth() + meses);
    const iso = d.toISOString().slice(0, 10);
    estado.capsulaDataEscolhida = iso;
    atualizarHintCapsula(iso, hint);
  }
  function atualizarHintCapsula(iso, hint) {
    if (!hint || !iso) return;
    const d = new Date(`${iso}T12:00:00`);
    const dias = Math.ceil((d.getTime() - Date.now()) / 86400000);
    const formatada = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    hint.textContent = `Abre em ${formatada} · ${dias} dia${dias === 1 ? '' : 's'} a partir de hoje`;
  }
  function resetarCapsulaPills() {
    document.querySelectorAll('.capsula-pill').forEach(p => p.classList.remove('ativo'));
    const input = el('capsula-data-input');
    if (input) input.style.display = 'none';
    const hint = el('capsula-data-hint');
    if (hint) hint.textContent = '';
  }

  async function abrirCapsulaMadura(id) {
    try {
      const r = await fetchAutenticado(`/api/app/caderno/capsulas/${id}/abrir`, { method: 'POST' });
      const d = await r.json();
      if (!d?.ok) {
        toast(d?.erro || 'Não consegui abrir', 'erro');
        return;
      }
      el('capsula-abrir-titulo').textContent = d.capsula.titulo || 'Sua cápsula chegou';
      el('capsula-abrir-data').textContent = `Escrita em ${fmtData(d.capsula.criado_em || d.capsula.abrir_em)}`;
      el('capsula-abrir-conteudo').innerHTML = escHtml(d.capsula.conteudo).replace(/\n/g, '<br>');
      abrirModal('modal-capsula-abrir');
      // Esconde o banner depois
      el('capsula-banner').style.display = 'none';
    } catch {
      toast('Não consegui abrir.', 'erro');
    }
  }

  // ── ABA: METAS ───────────────────────────────────────────

  async function carregarMetas() {
    const ativasEl = el('metas-trilha-ativas');
    if (!ativasEl) return;
    try {
      const r = await fetchAutenticado('/api/app/caderno/metas');
      const d = await r.json();
      if (!d?.ok) throw 0;

      const ordem = ['plantando', 'em_movimento', 'quase_la', 'materializado'];
      const ativas = (d.metas || []).filter(m => m.status !== 'materializado');
      const conquistadas = (d.metas || []).filter(m => m.status === 'materializado');

      if (ativas.length === 0) {
        ativasEl.innerHTML = `
          <div class="caderno-empty">
            <p style="font-family:var(--font-display,serif);font-size:1rem;color:var(--texto);margin:0 0 .3rem">Sua primeira meta está esperando você 🌱</p>
            <p style="font-size:.85rem;color:var(--texto-suave);margin:0">Toque em "Plantar nova meta" pra começar</p>
          </div>
        `;
      } else {
        ativasEl.innerHTML = ativas.map(m => montarMetaCard(m, ordem)).join('');
      }

      if (conquistadas.length > 0) {
        el('metas-materializadas-secao').style.display = '';
        el('metas-materializadas-count').textContent = conquistadas.length;
        el('metas-trilha-materializadas').innerHTML = conquistadas.map(m => montarMetaCard(m, ordem)).join('');
      } else {
        el('metas-materializadas-secao').style.display = 'none';
      }

      // Liga os botões de ação (avançar status / apagar)
      document.querySelectorAll('.meta-card button[data-acao]').forEach(b => {
        b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const acao = ev.currentTarget.dataset.acao;
          const id = ev.currentTarget.dataset.id;
          if (acao === 'avancar') {
            const novo = ev.currentTarget.dataset.proximo;
            await fetchAutenticado(`/api/app/caderno/metas/${id}/status`, {
              method: 'PUT', body: JSON.stringify({ status: novo }),
            });
            if (novo === 'materializado') toast('🏆 Materializada! Que glória!', 'ok');
            carregarMetas();
          } else if (acao === 'apagar') {
            if (!confirm('Apagar essa meta?')) return;
            await fetchAutenticado(`/api/app/caderno/metas/${id}`, { method: 'DELETE' });
            carregarMetas();
          }
        });
      });
    } catch {
      ativasEl.innerHTML = '<div class="caderno-empty">Não consegui carregar agora.</div>';
    }
  }

  function montarMetaCard(m, ordem) {
    const labels = {
      plantando:     { icone: '🌱', nome: 'Plantando',     proximo: 'em_movimento',  proximoLabel: 'Em movimento' },
      em_movimento:  { icone: '🌿', nome: 'Em movimento',  proximo: 'quase_la',      proximoLabel: 'Quase lá' },
      quase_la:      { icone: '🌟', nome: 'Quase lá',      proximo: 'materializado', proximoLabel: 'Materializei!' },
      materializado: { icone: '🏆', nome: 'Materializada', proximo: null,            proximoLabel: null },
    };
    const idx = ordem.indexOf(m.status);
    const pct = ((idx + 1) / ordem.length) * 100;
    const info = labels[m.status] || labels.plantando;

    // Marcos da régua (4 etapas)
    const marcos = ordem.map((s, i) => {
      const atingido = i <= idx;
      const atual = s === m.status;
      const icone = labels[s].icone;
      return `<span class="meta-marco ${atingido ? 'atingido' : ''} ${atual ? 'atual' : ''}" data-idx="${i}">
        <span class="meta-marco-icone">${icone}</span>
        <span class="meta-marco-label">${labels[s].nome}</span>
      </span>`;
    }).join('');

    const btnAvancar = info.proximo
      ? `<button type="button" class="meta-btn-avancar" data-acao="avancar" data-id="${m.id}" data-proximo="${info.proximo}">
           <span>${info.proximoLabel}</span>
           <svg viewBox="0 0 24 24" stroke-width="2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
             <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
           </svg>
         </button>`
      : '';

    return `
      <article class="meta-card status-${m.status}" data-id="${m.id}">
        <header class="meta-card-head">
          <div class="meta-card-info">
            <strong class="meta-card-titulo">${escHtml(m.titulo)}</strong>
            ${m.descricao ? `<p class="meta-card-desc">${escHtml(m.descricao)}</p>` : ''}
          </div>
          <button type="button" class="meta-card-apagar" data-acao="apagar" data-id="${m.id}" aria-label="Apagar meta">
            <svg viewBox="0 0 24 24" stroke-width="1.8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </header>
        <div class="meta-termometro">
          <div class="meta-termometro-trilha"></div>
          <div class="meta-termometro-preenchimento" style="width: ${pct}%"></div>
          <div class="meta-termometro-marcos">${marcos}</div>
        </div>
        ${btnAvancar}
      </article>
    `;
  }

  async function salvarMeta() {
    const titulo = el('meta-titulo-input').value.trim();
    const descricao = el('meta-descricao-input').value.trim();
    if (!titulo) {
      toast('Dá um título pra essa meta', 'aviso');
      return;
    }
    try {
      const r = await fetchAutenticado('/api/app/caderno/metas', {
        method: 'POST', body: JSON.stringify({ titulo, descricao }),
      });
      const d = await r.json();
      if (!d?.ok) {
        toast('Não consegui salvar', 'erro');
        return;
      }
      el('meta-titulo-input').value = '';
      el('meta-descricao-input').value = '';
      fecharModal('modal-meta-nova');
      toast('Meta plantada 🌱', 'ok');
      carregarMetas();
    } catch {
      toast('Não consegui salvar.', 'erro');
    }
  }

  // ── ABA: AFIRMAÇÕES ──────────────────────────────────────

  window.filtrarAfirmacoes = function (filtro, btnEl) {
    estado.afirmacoesFiltro = filtro;
    document.querySelectorAll('.afirmacoes-filtro').forEach(b => b.classList.remove('ativo'));
    if (btnEl) btnEl.classList.add('ativo');
    carregarAfirmacoes();
  };

  async function carregarAfirmacoes() {
    const grid = el('afirmacoes-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="caderno-empty">Carregando…</div>';
    try {
      const param = estado.afirmacoesFiltro === 'favoritas' ? '?favoritas=true' : '';
      const r = await fetchAutenticado(`/api/app/caderno/afirmacoes${param}`);
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.afirmacoes?.length) {
        grid.innerHTML = estado.afirmacoesFiltro === 'favoritas'
          ? `<div class="caderno-empty">
              <p style="font-family:var(--font-display,serif);font-size:1rem;color:var(--texto);margin:0 0 .3rem">Suas afirmações favoritas vão morar aqui ⭐</p>
              <p style="font-size:.85rem;color:var(--texto-suave);margin:0">Toque na estrelinha de uma afirmação pra guardá-la.</p>
            </div>`
          : '<div class="caderno-empty">Sem afirmações cadastradas ainda.</div>';
        return;
      }
      grid.innerHTML = d.afirmacoes.map(a => {
        const cat = (a.categoria || '').toLowerCase();
        const catKnown = ['prosperidade', 'autoestima', 'relacionamentos', 'saude'].includes(cat) ? cat : 'default';
        return `
        <article class="afirmacao-card" data-id="${a.id}">
          <p class="afirmacao-texto">${escHtml(a.texto)}</p>
          <div class="afirmacao-rodape">
            ${a.categoria ? `<span class="afirmacao-categoria" data-cat="${catKnown}">${escHtml(a.categoria)}</span>` : '<span></span>'}
            <button type="button" class="afirmacao-favoritar ${a.favoritada ? 'favoritada' : ''}"
              data-id="${a.id}" aria-label="Favoritar">${a.favoritada ? '⭐' : '☆'}</button>
          </div>
        </article>
      `;
      }).join('');
      grid.querySelectorAll('.afirmacao-favoritar').forEach(b => {
        b.addEventListener('click', async (ev) => {
          const id = ev.currentTarget.dataset.id;
          const era = ev.currentTarget.classList.contains('favoritada');
          if (era) {
            await fetchAutenticado(`/api/app/caderno/afirmacoes/${id}/favoritar`, { method: 'DELETE' });
          } else {
            await fetchAutenticado(`/api/app/caderno/afirmacoes/${id}/favoritar`, { method: 'POST' });
          }
          carregarAfirmacoes();
        });
      });
    } catch {
      grid.innerHTML = '<div class="caderno-empty">Não consegui carregar.</div>';
    }
  }

  // ── ÁUDIO DE FOCO ────────────────────────────────────────

  async function carregarAudios() {
    try {
      const r = await fetchAutenticado('/api/app/caderno/audios');
      const d = await r.json();
      if (!d?.ok) return;
      estado.audios = d;
      const select = el('caderno-foco-select');
      if (select) {
        select.innerHTML = '<option value="">Escolha um áudio…</option>' +
          d.catalogo.map(a => `<option value="${a.id}" ${a.id === d.ultimo_audio_id ? 'selected' : ''}>${escHtml(a.titulo)}</option>`).join('');
      }
      if (d.url_propria) {
        el('caderno-foco-url').value = d.url_propria;
      }
    } catch {}
  }

  window.trocarFonteAudio = function (fonte, btnEl) {
    document.querySelectorAll('.caderno-foco-tab').forEach(b => b.classList.remove('ativa'));
    if (btnEl) btnEl.classList.add('ativa');
    el('caderno-foco-catalogo').style.display = fonte === 'catalogo' ? '' : 'none';
    el('caderno-foco-propria').style.display = fonte === 'propria' ? '' : 'none';
  };

  function embedAudio(url) {
    const box = el('caderno-foco-embed');
    if (!box) return;
    if (/youtube\.com\/embed/.test(url) || /youtube\.com\/watch/.test(url) || /youtu\.be\//.test(url)) {
      // Normaliza pra embed
      let embedUrl = url;
      const m1 = url.match(/youtube\.com\/watch\?v=([\w-]+)/);
      const m2 = url.match(/youtu\.be\/([\w-]+)/);
      if (m1) embedUrl = `https://www.youtube.com/embed/${m1[1]}?autoplay=1`;
      else if (m2) embedUrl = `https://www.youtube.com/embed/${m2[1]}?autoplay=1`;
      box.innerHTML = `<iframe src="${escHtml(embedUrl)}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    } else {
      box.innerHTML = `<audio controls autoplay src="${escHtml(url)}" style="width:100%"></audio>`;
    }
  }

  function pararAudioFoco() {
    const box = el('caderno-foco-embed');
    if (box) box.innerHTML = '';
  }

  // ════════════════════════════════════════════════════════
  // CONQUISTAS — render
  // ════════════════════════════════════════════════════════
  window.renderConquistas = async function () {
    // Pinta o que dá direto do contexto
    const ctx = window._ctxAtual || {};
    const g = ctx.gamificacao || {};

    // Mensal — trilha de 30 bolinhas
    const trilha = el('conq-mensal-trilha');
    if (trilha) {
      const atual = g.ciclo_30_logins || 0;
      trilha.innerHTML = Array.from({ length: 30 }).map((_, i) => {
        const dia = i + 1;
        const ativo = dia <= atual;
        const marco = (dia === 7 || dia === 15 || dia === 30);
        return `<span class="conq-bolinha ${ativo ? 'conq-bolinha-ativa' : ''} ${marco ? 'conq-bolinha-marco' : ''}" title="Dia ${dia}${marco ? ' ✨' : ''}"></span>`;
      }).join('');
      el('conq-mensal-contagem').textContent = `${atual} / 30`;
      el('conq-mensal-rodape').textContent = `Recorde: ${g.recorde_30 || 0} dias`;
    }
    el('conq-rapida-numero').textContent = g.rapida_atual || 0;
    el('conq-rapida-recorde').textContent = g.recorde_rapida || 0;
    el('conq-trimestral-numero').textContent = g.ciclo_90_logins || 0;
    el('conq-trimestral-recorde').textContent = g.recorde_90 || 0;

    // Carrega listas via /api/app/gamificacao/* (Commit 3 cria essas rotas)
    await Promise.all([
      carregarMissoes(),
      carregarPremios(),
      carregarRanking(),
    ]);
  };

  async function carregarMissoes() {
    const lista = el('conq-missoes-lista');
    if (!lista) return;
    lista.innerHTML = montarSkeletonLinhas(3);
    try {
      const r = await fetchAutenticado('/api/app/gamificacao/missoes');
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.missoes?.length) {
        lista.innerHTML = `<div class="caderno-empty">
          <p style="font-family:var(--font-display,serif);font-size:.98rem;color:var(--texto);margin:0 0 .3rem">Sua jornada está só começando ✨</p>
          <p style="font-size:.82rem;color:var(--texto-suave);margin:0">Faça o Teste do Subconsciente pra desbloquear suas missões.</p>
        </div>`;
        return;
      }
      lista.innerHTML = d.missoes.map(m => {
        const pct = Math.min(100, Math.round((m.progresso / m.alvo) * 100));
        return `
          <article class="missao-card ${m.completada_em ? 'missao-completa' : ''}">
            <header class="missao-card-head">
              <strong>${escHtml(m.titulo)}</strong>
              <span class="missao-recompensa">+${m.sementes} 🌱</span>
            </header>
            ${m.descricao ? `<p class="missao-desc">${escHtml(m.descricao)}</p>` : ''}
            <div class="missao-progresso">
              <div class="missao-progresso-barra" style="width:${pct}%"></div>
            </div>
            <p class="missao-progresso-texto">${m.progresso} / ${m.alvo} ${m.completada_em ? '✓ Concluída' : ''}</p>
          </article>
        `;
      }).join('');
    } catch {
      lista.innerHTML = '<div class="caderno-empty">Não consegui carregar missões.</div>';
    }
  }

  async function carregarPremios() {
    const lista = el('conq-premios-lista');
    if (!lista) return;
    lista.innerHTML = montarSkeletonLinhas(3);
    try {
      const r = await fetchAutenticado('/api/app/gamificacao/premios');
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.premios?.length) {
        lista.innerHTML = `<div class="caderno-empty">
          <p style="font-family:var(--font-display,serif);font-size:.98rem;color:var(--texto);margin:0 0 .3rem">Seu primeiro prêmio vem amanhã 💛</p>
          <p style="font-size:.82rem;color:var(--texto-suave);margin:0">Aparecer aqui todo dia já é o começo.</p>
        </div>`;
        return;
      }
      lista.innerHTML = d.premios.map(p => `
        <article class="premio-card">
          <span class="premio-icone">✦</span>
          <div class="premio-corpo">
            <strong>${escHtml(p.rotulo || p.tipo)}</strong>
            <span class="premio-meta">${fmtData(p.recebido_em)} · +${p.sementes_creditadas} 🌱</span>
          </div>
        </article>
      `).join('');
    } catch {
      lista.innerHTML = '<div class="caderno-empty">Não consegui carregar prêmios.</div>';
    }
  }

  async function carregarRanking() {
    const lista = el('conq-ranking-lista');
    if (!lista) return;
    lista.innerHTML = montarSkeletonLinhas(5);
    try {
      const r = await fetchAutenticado('/api/app/gamificacao/ranking');
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.ranking?.length) {
        lista.innerHTML = `<div class="caderno-empty">
          <p style="font-family:var(--font-display,serif);font-size:.98rem;color:var(--texto);margin:0 0 .3rem">O ranking abre amanhã 👑</p>
          <p style="font-size:.82rem;color:var(--texto-suave);margin:0">Volta a partir de amanhã pra ver quem está liderando.</p>
        </div>`;
        return;
      }
      lista.innerHTML = d.ranking.map(r => `
        <article class="ranking-linha ${r.eu ? 'ranking-linha-eu' : ''}">
          <span class="ranking-posicao">${r.posicao}</span>
          <span class="ranking-nome">${escHtml(r.nome || 'Você')}</span>
          <span class="ranking-pontos">${r.pontos} dias</span>
        </article>
      `).join('');
    } catch {
      lista.innerHTML = '<div class="caderno-empty">Ranking ainda não disponível.</div>';
    }
  }

})();
