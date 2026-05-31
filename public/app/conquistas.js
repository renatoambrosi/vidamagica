/* === VIDA MÁGICA — public/app/conquistas.js ===
   Lógica da view CONQUISTAS (Gamificação: ofensivas mensal/trimestral/rápida,
   missões da jornada, prêmios recebidos, ranking mensal).

   EXTRAÍDO de caderno.js (2026-05-31). A Gamificação é TRANSVERSAL — vai ser
   consultada por várias partes do app — então virou módulo AUTÔNOMO, que NÃO
   depende do Caderno (este será removido). O backend já é separado
   (core/gamificacao.js + routes/gamificacao.js + tabelas gam_*).

   Carregado como script NÃO-módulo, depois de app.js. Usa as globais que o
   app.js expõe no fim do arquivo:
   - fetchAutenticado(url, opts)  pra chamadas autenticadas
   - window._ctxAtual             pro contexto unificado carregado da Home

   Expõe:
   - window.renderConquistas()           — pinta a #view-conquistas
   - window.renderAtalhosConquistas(ctx) — badge/sub do card Conquistas na Home
   === */
(function () {
  'use strict';

  // ── Helpers (próprios — módulo autônomo) ────────────────
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
  function montarSkeletonLinhas(n = 3) {
    let h = '<div class="skeleton-linhas">';
    for (let i = 0; i < n; i++) h += '<div class="skeleton-linha"></div>';
    h += '</div>';
    return h;
  }

  // ════════════════════════════════════════════════════════
  // VIEW CONQUISTAS — render principal
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

    // Carrega listas via /api/app/gamificacao/*
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

  // ════════════════════════════════════════════════════════
  // CARD DE ATALHO NA HOME — badge de prêmios novos + sub
  // (a parte do Caderno do antigo renderAtalhosCaderno some com o Caderno)
  // ════════════════════════════════════════════════════════
  window.renderAtalhosConquistas = function (ctx) {
    if (!ctx) return;
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

})();
