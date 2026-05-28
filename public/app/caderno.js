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
    document.querySelectorAll('.caderno-aba').forEach(a => {
      a.classList.toggle('ativa', a.dataset.aba === estado.abaAtiva);
    });
    document.querySelectorAll('.caderno-painel').forEach(p => {
      p.classList.toggle('ativo', p.id === `caderno-painel-${estado.abaAtiva}`);
    });
    // Carrega conteúdo da aba ativa
    await carregarAbaCaderno(estado.abaAtiva);
    // Indicador de cápsula madura (banner no topo da aba Escrever)
    aplicarBannerCapsula(window._ctxAtual?.caderno?.capsula_madura_pendente);
    // Botões iniciais
    ligarBotoesCaderno();
  };

  window.trocarAbaCaderno = function (aba, btnEl) {
    estado.abaAtiva = aba;
    document.querySelectorAll('.caderno-aba').forEach(a => a.classList.remove('ativa'));
    if (btnEl) btnEl.classList.add('ativa');
    document.querySelectorAll('.caderno-painel').forEach(p => p.classList.remove('ativo'));
    el(`caderno-painel-${aba}`)?.classList.add('ativo');
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
    // Botão foco
    el('caderno-btn-foco')?.addEventListener('click', () => {
      const player = el('caderno-foco-player');
      if (player.style.display === 'none') {
        player.style.display = '';
        carregarAudios();
      } else {
        player.style.display = 'none';
      }
    });
    el('caderno-foco-fechar')?.addEventListener('click', () => {
      el('caderno-foco-player').style.display = 'none';
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

    // Cápsulas
    el('capsulas-btn-nova')?.addEventListener('click', () => abrirModal('modal-capsula-nova'));
    el('capsula-btn-salvar')?.addEventListener('click', salvarCapsula);
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
        lista.innerHTML = '<div class="caderno-empty">Suas escritas vão aparecer aqui ✨</div>';
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
      input.value = '';
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
    grid.innerHTML = '<div class="caderno-empty">Carregando…</div>';
    try {
      const r = await fetchAutenticado(`/api/app/caderno/vision?status=${estado.visionStatus}`);
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.itens?.length) {
        grid.innerHTML = estado.visionStatus === 'conquistado'
          ? '<div class="caderno-empty">Suas conquistas vão aparecer aqui 🏆</div>'
          : '<div class="caderno-empty">Adicione sua primeira imagem ✨</div>';
        return;
      }
      grid.innerHTML = d.itens.map(it => `
        <div class="vision-card ${it.principal ? 'vision-card-principal' : ''}" data-id="${it.id}">
          <img src="${escHtml(it.imagem_url)}" alt="${escHtml(it.titulo || '')}" loading="lazy" />
          ${it.titulo ? `<div class="vision-card-titulo">${escHtml(it.titulo)}</div>` : ''}
          ${it.principal ? '<span class="vision-card-selo">⭐ Principal</span>' : ''}
          <div class="vision-card-acoes">
            ${estado.visionStatus === 'ativo' ? `
              ${!it.principal ? `<button type="button" data-acao="principal" data-id="${it.id}">⭐ Tornar principal</button>` : ''}
              <button type="button" data-acao="conquistado" data-id="${it.id}">🏆 Conquistei!</button>
            ` : ''}
            <button type="button" data-acao="apagar" data-id="${it.id}">🗑</button>
          </div>
        </div>
      `).join('');
      grid.querySelectorAll('button[data-acao]').forEach(b => {
        b.addEventListener('click', async (ev) => {
          const acao = ev.currentTarget.dataset.acao;
          const id = ev.currentTarget.dataset.id;
          if (acao === 'principal') {
            await fetchAutenticado(`/api/app/caderno/vision/${id}/principal`, { method: 'POST' });
          } else if (acao === 'conquistado') {
            await fetchAutenticado(`/api/app/caderno/vision/${id}/conquistado`, { method: 'POST' });
            toast('Conquista marcada! 🏆', 'ok');
          } else if (acao === 'apagar') {
            if (!confirm('Apagar essa imagem?')) return;
            await fetchAutenticado(`/api/app/caderno/vision/${id}`, { method: 'DELETE' });
          }
          carregarVision();
        });
      });
    } catch {
      grid.innerHTML = '<div class="caderno-empty">Não consegui carregar.</div>';
    }
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
        lista.innerHTML = '<div class="caderno-empty">Suas cápsulas vão aparecer aqui ⏳</div>';
        return;
      }
      lista.innerHTML = d.capsulas.map(c => {
        const trancada = c.trancada;
        const dias = trancada ? diasAtePropriaDataISO(c.abrir_em) : 0;
        return `
          <article class="capsula-card ${trancada ? 'capsula-trancada' : c.aberta_em ? 'capsula-aberta' : 'capsula-madura'}" data-id="${c.id}">
            <div class="capsula-card-selo">${trancada ? '🔒' : c.aberta_em ? '💌' : '✨'}</div>
            <div class="capsula-card-corpo">
              <h4 class="capsula-card-titulo">${escHtml(c.titulo || 'Cápsula sem título')}</h4>
              <p class="capsula-card-meta">
                ${trancada
                  ? `Abre em ${fmtData(c.abrir_em)} · faltam ${dias} dia${dias === 1 ? '' : 's'}`
                  : c.aberta_em
                    ? `Aberta em ${fmtData(c.aberta_em)}`
                    : 'Pronta pra abrir agora!'}
              </p>
            </div>
            <div class="capsula-card-acoes">
              ${!trancada ? `<button type="button" data-acao="abrir" data-id="${c.id}">Abrir</button>` : ''}
              ${trancada ? `<button type="button" data-acao="apagar" data-id="${c.id}">🗑</button>` : ''}
            </div>
          </article>
        `;
      }).join('');
      lista.querySelectorAll('button[data-acao]').forEach(b => {
        b.addEventListener('click', async (ev) => {
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
    const dataStr = el('capsula-data-input').value;
    if (!conteudo || conteudo.length < 10) {
      toast('Escreva pelo menos 10 caracteres', 'aviso');
      return;
    }
    if (!dataStr) {
      toast('Escolha uma data pra abrir', 'aviso');
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
      fecharModal('modal-capsula-nova');
      carregarCapsulas();
    } catch {
      toast('Não consegui salvar.', 'erro');
    }
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
    try {
      const r = await fetchAutenticado('/api/app/caderno/metas');
      const d = await r.json();
      if (!d?.ok) throw 0;
      ['plantando', 'em_movimento', 'quase_la', 'materializado'].forEach(status => {
        const col = el(`metas-col-${status}`);
        if (!col) return;
        const itens = (d.metas || []).filter(m => m.status === status);
        if (!itens.length) {
          col.innerHTML = '<div class="metas-col-vazia">—</div>';
          return;
        }
        col.innerHTML = itens.map(m => `
          <div class="meta-card" data-id="${m.id}" draggable="true">
            <strong>${escHtml(m.titulo)}</strong>
            ${m.descricao ? `<p>${escHtml(m.descricao)}</p>` : ''}
            <div class="meta-card-acoes">
              ${montarBotaoStatus(m, status)}
              <button type="button" data-acao="apagar" data-id="${m.id}" aria-label="Apagar">🗑</button>
            </div>
          </div>
        `).join('');
      });
      // Ligar botões
      document.querySelectorAll('.meta-card button[data-acao]').forEach(b => {
        b.addEventListener('click', async (ev) => {
          const acao = ev.currentTarget.dataset.acao;
          const id = ev.currentTarget.dataset.id;
          if (acao === 'avancar') {
            const novo = ev.currentTarget.dataset.proximo;
            await fetchAutenticado(`/api/app/caderno/metas/${id}/status`, {
              method: 'PUT', body: JSON.stringify({ status: novo }),
            });
            if (novo === 'materializado') toast('🏆 Manifestada! Que glória!', 'ok');
            carregarMetas();
          } else if (acao === 'apagar') {
            if (!confirm('Apagar essa meta?')) return;
            await fetchAutenticado(`/api/app/caderno/metas/${id}`, { method: 'DELETE' });
            carregarMetas();
          }
        });
      });
    } catch {
      // silencioso
    }
  }

  function montarBotaoStatus(m, status) {
    const ordem = ['plantando', 'em_movimento', 'quase_la', 'materializado'];
    const i = ordem.indexOf(status);
    if (i < 0 || i === ordem.length - 1) return '';
    const proximo = ordem[i + 1];
    const labels = { em_movimento: 'Em movimento →', quase_la: 'Quase lá →', materializado: 'Manifestei! 🏆' };
    return `<button type="button" data-acao="avancar" data-id="${m.id}" data-proximo="${proximo}">${labels[proximo]}</button>`;
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
          ? '<div class="caderno-empty">Você ainda não favoritou nenhuma afirmação ⭐</div>'
          : '<div class="caderno-empty">Sem afirmações cadastradas ainda.</div>';
        return;
      }
      grid.innerHTML = d.afirmacoes.map(a => `
        <article class="afirmacao-card" data-id="${a.id}">
          <p class="afirmacao-texto">${escHtml(a.texto)}</p>
          <div class="afirmacao-rodape">
            ${a.categoria ? `<span class="afirmacao-categoria">${escHtml(a.categoria)}</span>` : '<span></span>'}
            <button type="button" class="afirmacao-favoritar ${a.favoritada ? 'favoritada' : ''}"
              data-id="${a.id}" aria-label="Favoritar">${a.favoritada ? '⭐' : '☆'}</button>
          </div>
        </article>
      `).join('');
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
    try {
      const r = await fetchAutenticado('/api/app/gamificacao/missoes');
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.missoes?.length) {
        lista.innerHTML = '<div class="caderno-empty">Nenhuma missão ativa por aqui.</div>';
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
    try {
      const r = await fetchAutenticado('/api/app/gamificacao/premios');
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.premios?.length) {
        lista.innerHTML = '<div class="caderno-empty">Continue logando pra ver seus prêmios aqui ✨</div>';
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
    try {
      const r = await fetchAutenticado('/api/app/gamificacao/ranking');
      const d = await r.json();
      if (!d?.ok) throw 0;
      if (!d.ranking?.length) {
        lista.innerHTML = '<div class="caderno-empty">Ranking começa amanhã 👑</div>';
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
