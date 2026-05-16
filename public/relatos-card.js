/* ═══════════════════════════════════════════════════════════════
   VIDA MÁGICA — relatos-card.js
   Utilitário compartilhado pelas 7 LPs (index + 6 LPs de produto).

   Resolve 3 coisas no carrossel de relatos do corpo da página:
     1) BUG do swipe: o `.dep-track` antigo usava animation-infinite
        e travava qualquer drag com o dedo. Aqui pausamos a animação
        ao toque, permitimos swipe horizontal manual, e retomamos.
     2) CLICK no card abre um MODAL de leitura com texto completo,
        imagem do produto vinculado ao tema, link "saber mais" pra LP
        e CTA "Quero esse material também" → checkout.
     3) Botão "Ver mais relatos" no modal → leva pra /relatos#TEMA
        (a barra correspondente abre automática).

   NÃO MEXE no ticker do topo (Renato pediu pra não tocar).

   API pública:
     VmRelatos.iniciar({
       tema:        'orm',          // slug do tema (obrigatório)
       depoimentos: [...],          // array vindo de /api/depoimentos
       container:   '#dep-track',   // seletor do container do carrossel
       lpPath:      '/ouro-...',    // opcional; pra "saber mais" (default = origin atual)
     });

   Detalhes de UX:
     - Cards duplicados (`[...arr, ...arr]` que as LPs usam pra animar
       em loop) recebem `data-relato-idx="N"` com módulo do tamanho
       real. Click em qualquer cópia abre o relato correto.
   ═══════════════════════════════════════════════════════════════ */

(function(){
  'use strict';
  if (window.VmRelatos && window.VmRelatos.__inicializado) return;

  // Mapeamento slug do tema → LP do produto (pra botão "saber mais")
  // Mantido em sincronia com server.js + relatos.html
  const SLUG_LP = {
    ts:   '/teste',
    orm:  '/ouro-da-reprogramacao-mental',
    lda:  '/lei-da-atracao-biblica',
    gprm: '/guia-pratico-reprogramacao-mental',
    tm:   '/a-tal-maneira',
    mf:   '/magica-do-fluir',
    // vm, cdm, cdv, cdd, cds, sessao, geral: sem LP dedicada (link some)
  };

  let PRECOS = null;          // cache de /api/precos
  let MODAL_INJETADO = false;
  let temaAtual = null;
  let depoimentosAtuais = [];

  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  function metaDoRelato(d){
    const partes = [];
    if (d.profissao) partes.push(d.profissao);
    if (d.idade)    partes.push(d.idade + ' anos');
    return partes.join(' • ');
  }

  // ───────── PREÇOS (uma vez por sessão) ─────────
  async function carregarPrecos(){
    if (PRECOS) return PRECOS;
    try{
      const r = await fetch('/api/precos', {headers:{'Accept':'application/json'}, mode:'cors'});
      if (!r.ok) return (PRECOS = {});
      const data = await r.json();
      PRECOS = {};
      if (Array.isArray(data)){
        data.forEach(p => { if (p.key) PRECOS[p.key] = p; });
      } else if (data && typeof data === 'object'){
        Object.entries(data).forEach(([k,v]) => { PRECOS[k] = v; });
      }
    }catch{ PRECOS = {}; }
    return PRECOS;
  }

  // ───────── MODAL (injetado 1x no body) ─────────
  function injetarModal(){
    if (MODAL_INJETADO) return;
    MODAL_INJETADO = true;

    const css = `
      .vmr-modal-bg {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.78);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 99999;
        display: none;
        align-items: flex-start; justify-content: center;
        padding: 1.5rem 1rem;
        overflow-y: auto;
        animation: vmrFade .25s;
      }
      .vmr-modal-bg.vmr-aberto { display: flex; }
      @keyframes vmrFade { from { opacity: 0; } to { opacity: 1; } }
      .vmr-modal-card {
        background: #1A1205;
        color: #F5F0E8;
        border: 1px solid rgba(200,146,42,0.45);
        border-radius: 16px;
        max-width: 560px; width: 100%;
        padding: 1.4rem 1.4rem 1.6rem;
        margin-top: 2rem; margin-bottom: 2rem;
        box-shadow: 0 20px 60px rgba(0,0,0,0.55);
        font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        animation: vmrSlide .3s ease;
      }
      @keyframes vmrSlide { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .vmr-modal-topo {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 1rem; margin-bottom: 1rem;
        padding-bottom: .85rem;
        border-bottom: 1px solid rgba(200,146,42,0.2);
      }
      .vmr-modal-info { flex: 1; min-width: 0; }
      .vmr-tema {
        display: inline-block;
        font-size: .6rem; font-weight: 700;
        color: #F4D998;
        background: rgba(200,146,42,0.14);
        border: 1px solid rgba(200,146,42,0.32);
        padding: 3px 9px; border-radius: 999px;
        letter-spacing: .08em; text-transform: uppercase;
        margin-bottom: .5rem;
      }
      .vmr-autor {
        font-family: 'Montserrat', -apple-system, sans-serif;
        font-size: 1.02rem; font-weight: 600;
        color: #E8C97A;
        line-height: 1.25;
      }
      .vmr-meta {
        font-size: .75rem;
        color: rgba(245,240,232,0.55);
        margin-top: .15rem;
      }
      .vmr-x {
        background: none;
        border: 1px solid rgba(200,146,42,0.4);
        color: #E8C97A;
        width: 36px; height: 36px;
        border-radius: 999px;
        font-size: 1.05rem; cursor: pointer; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        transition: all .18s;
        flex-shrink: 0;
      }
      .vmr-x:hover { background: rgba(200,146,42,0.14); border-color: #E8C97A; }
      .vmr-texto {
        font-size: .95rem; line-height: 1.65;
        color: rgba(245,240,232,0.92);
        white-space: pre-line;
        margin: 0 0 1.3rem;
      }
      .vmr-cta-box {
        background: rgba(200,146,42,0.05);
        border: 1px solid rgba(200,146,42,0.2);
        border-radius: 12px;
        padding: 1rem 1rem 1.1rem;
        margin-bottom: .7rem;
      }
      .vmr-cta-frase {
        font-size: .78rem;
        color: rgba(245,240,232,0.72);
        margin: 0 0 .85rem;
        line-height: 1.45;
      }
      .vmr-prod-row {
        display: flex; align-items: center; gap: .9rem;
        margin-bottom: 1rem;
      }
      .vmr-prod-img {
        width: 56px; height: 56px;
        object-fit: cover;
        border-radius: 8px;
        border: 1px solid rgba(200,146,42,0.25);
        background: rgba(255,255,255,0.04);
        flex-shrink: 0;
      }
      .vmr-prod-link {
        font-size: .78rem;
        color: #E8C97A;
        text-decoration: none;
        border-bottom: 1px dashed rgba(232,201,122,0.4);
        transition: color .2s;
      }
      .vmr-prod-link:hover { color: #F4D998; }
      .vmr-cta-btn {
        display: block; width: 100%;
        background: linear-gradient(135deg, #7A5818, #C8922A);
        color: #1A1205;
        border: none;
        border-radius: 10px;
        padding: .85rem 1rem;
        font-family: 'Open Sans', -apple-system, sans-serif;
        font-size: .86rem; font-weight: 700;
        letter-spacing: .04em;
        cursor: pointer;
        text-decoration: none;
        text-align: center;
        transition: all .2s;
      }
      .vmr-cta-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
      .vmr-cta-btn.vmr-disabled {
        background: rgba(200,146,42,0.15);
        color: rgba(245,240,232,0.4);
        cursor: not-allowed; pointer-events: none;
      }
      .vmr-ver-mais {
        display: block; width: 100%;
        background: transparent;
        color: #E8C97A;
        border: 1px solid rgba(200,146,42,0.4);
        border-radius: 10px;
        padding: .7rem 1rem;
        font-family: 'Open Sans', -apple-system, sans-serif;
        font-size: .82rem; font-weight: 600;
        letter-spacing: .04em;
        cursor: pointer;
        text-decoration: none;
        text-align: center;
        transition: all .2s;
      }
      .vmr-ver-mais:hover { background: rgba(200,146,42,0.08); color: #F4D998; }
      @media (max-width: 600px) {
        .vmr-modal-bg { padding: .5rem; }
        .vmr-modal-card { padding: 1.1rem 1.1rem 1.3rem; margin-top: .5rem; margin-bottom: .5rem; }
        .vmr-autor { font-size: .98rem; }
        .vmr-texto { font-size: .9rem; }
      }
      /* Swipe-friendly: substitui animation infinite por scroll horizontal */
      .vmr-no-anim { animation: none !important; transform: none !important; }
    `;
    const style = document.createElement('style');
    style.setAttribute('data-vmr','1');
    style.textContent = css;
    document.head.appendChild(style);

    const html = `
      <div class="vmr-modal-bg" id="vmr-modal">
        <div class="vmr-modal-card">
          <div class="vmr-modal-topo">
            <div class="vmr-modal-info">
              <span class="vmr-tema" id="vmr-tema">—</span>
              <div class="vmr-autor" id="vmr-autor">—</div>
              <div class="vmr-meta" id="vmr-meta"></div>
            </div>
            <button class="vmr-x" type="button" id="vmr-x" aria-label="Fechar">✕</button>
          </div>
          <p class="vmr-texto" id="vmr-texto">—</p>
          <div class="vmr-cta-box" id="vmr-cta-box">
            <p class="vmr-cta-frase">Essa aluna deu esse relato depois de ter praticado o meu material:</p>
            <div class="vmr-prod-row">
              <img class="vmr-prod-img" id="vmr-prod-img" alt="" loading="lazy">
              <a class="vmr-prod-link" id="vmr-prod-link" href="#">saber mais →</a>
            </div>
            <a class="vmr-cta-btn" id="vmr-cta-btn" href="#" target="_blank" rel="noopener">Quero esse material também</a>
          </div>
          <a class="vmr-ver-mais" id="vmr-ver-mais" href="/relatos">Ver mais relatos</a>
        </div>
      </div>
    `;
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);

    // Handlers
    document.getElementById('vmr-x').addEventListener('click', fecharModal);
    document.getElementById('vmr-modal').addEventListener('click', (e) => {
      if (e.target.id === 'vmr-modal') fecharModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('vmr-modal').classList.contains('vmr-aberto')) fecharModal();
    });
  }

  function abrirModal(relato){
    if (!relato) return;
    injetarModal();

    document.getElementById('vmr-tema').textContent = relato.tema_nome || (temaAtual || '');
    document.getElementById('vmr-autor').textContent = relato.nome || '—';

    const meta = metaDoRelato(relato);
    const mMeta = document.getElementById('vmr-meta');
    mMeta.textContent = meta;
    mMeta.style.display = meta ? 'block' : 'none';

    document.getElementById('vmr-texto').textContent = relato.texto || '';

    // CTA do produto vinculado ao tema (não ao relato individual)
    const ctaBox = document.getElementById('vmr-cta-box');
    const produtoSlug = relato.produto_slug || null;
    const produto = produtoSlug && PRECOS ? PRECOS[produtoSlug] : null;

    if (!produto){
      ctaBox.style.display = 'none';
    } else {
      ctaBox.style.display = 'block';
      const img = document.getElementById('vmr-prod-img');
      img.src = produto.imagem_url || '';
      img.alt = produto.nome || '';
      img.style.display = produto.imagem_url ? 'block' : 'none';

      const link = document.getElementById('vmr-prod-link');
      const lp = SLUG_LP[temaAtual];
      if (lp){ link.href = lp; link.style.display = 'inline'; }
      else { link.style.display = 'none'; }

      const btn = document.getElementById('vmr-cta-btn');
      const checkout = produto.link_checkout_padrao;
      if (checkout){ btn.href = checkout; btn.classList.remove('vmr-disabled'); }
      else { btn.removeAttribute('href'); btn.classList.add('vmr-disabled'); }
    }

    // Botão "Ver mais relatos" sempre leva pra /relatos#tema
    const verMais = document.getElementById('vmr-ver-mais');
    verMais.href = temaAtual ? `/relatos#${temaAtual}` : '/relatos';

    document.getElementById('vmr-modal').classList.add('vmr-aberto');
    document.body.style.overflow = 'hidden';
  }

  function fecharModal(){
    const m = document.getElementById('vmr-modal');
    if (m) m.classList.remove('vmr-aberto');
    document.body.style.overflow = '';
  }

  // ───────── INTERATIVIDADE NO CARROSSEL ─────────
  // Resolve o bug: animação CSS infinita travava drag.
  // Estratégia: paramos a animação na primeira interação (touch/mouse-down),
  // habilitamos overflow-x scroll, e tratamos swipe via scrollLeft.
  function tornarSwipeavel(container){
    if (!container || container.dataset.vmrSwipeOk === '1') return;
    container.dataset.vmrSwipeOk = '1';

    // Estado do container: ainda animando OU já swipeável.
    let estaAnimando = true;

    const parent = container.parentElement;  // .dep-carousel
    if (parent){
      parent.style.overflowX = 'hidden';
    }

    function pararAnimacao(){
      if (!estaAnimando) return;
      estaAnimando = false;
      // Captura posição atual da animação antes de desligar
      const m = (window.getComputedStyle(container).transform || '').match(/matrix.*\((.+)\)/);
      let offsetX = 0;
      if (m){
        const vals = m[1].split(',').map(parseFloat);
        offsetX = vals[4] || 0;  // tx
      }
      container.style.animation = 'none';
      container.style.transform = 'none';
      // Habilita scroll horizontal nativo no container PAI
      if (parent){
        parent.style.overflowX = 'auto';
        parent.style.scrollbarWidth = 'none';     // Firefox
        parent.style.webkitOverflowScrolling = 'touch';
        parent.scrollLeft = Math.abs(offsetX);
      }
      container.classList.add('vmr-no-anim');
    }

    // Pausa quando o usuário interage
    ['pointerdown','touchstart','wheel'].forEach(evt => {
      (parent || container).addEventListener(evt, pararAnimacao, {passive: true});
    });

    // Detecta click sem drag → abre modal
    // (delegado no container; data-relato-idx vem da renderização)
    let downX = 0, downY = 0, draggedFar = false;
    (parent || container).addEventListener('pointerdown', (e) => {
      downX = e.clientX; downY = e.clientY; draggedFar = false;
    });
    (parent || container).addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientX - downX) > 6 || Math.abs(e.clientY - downY) > 6) draggedFar = true;
    });
    (parent || container).addEventListener('click', (e) => {
      if (draggedFar) { e.preventDefault(); e.stopPropagation(); return; }
      const card = e.target.closest('[data-relato-idx]');
      if (!card) return;
      const idx = parseInt(card.dataset.relatoIdx, 10);
      if (!Number.isFinite(idx)) return;
      const real = depoimentosAtuais[idx % (depoimentosAtuais.length || 1)];
      abrirModal(real);
    });

    // Esconde scrollbar visualmente (mas mantém scrollável)
    const styleHide = document.createElement('style');
    styleHide.textContent = '.dep-carousel::-webkit-scrollbar{display:none}';
    document.head.appendChild(styleHide);
  }

  // ───────── Marca os cards já renderizados pelas LPs ─────────
  // As LPs renderizam `[...depoimentos, ...depoimentos]` (duplicado).
  // Aqui passamos por cada card e atribuímos índice módulo N.
  // O index.html usa `.depoimento-card`; as LPs usam `.dep-card`.
  // Aceita seletor explícito via opts.cardSelector — default cobre ambos.
  function marcarCards(container, totalReal, cardSelector){
    const sel = cardSelector || '.dep-card, .depoimento-card';
    const cards = container.querySelectorAll(sel);
    cards.forEach((card, i) => {
      card.dataset.relatoIdx = String(i % totalReal);
    });
  }

  // ───────── API PÚBLICA ─────────
  async function iniciar(opts){
    opts = opts || {};
    temaAtual = opts.tema || null;
    depoimentosAtuais = Array.isArray(opts.depoimentos) ? opts.depoimentos : [];

    if (!depoimentosAtuais.length) return;

    const container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!container) return;

    await carregarPrecos();
    injetarModal();

    // Espera o próximo frame caso a LP ainda esteja renderizando cards
    requestAnimationFrame(() => {
      marcarCards(container, depoimentosAtuais.length, opts.cardSelector);
      tornarSwipeavel(container);
    });
  }

  window.VmRelatos = {
    iniciar,
    abrirModal,
    fecharModal,
    __inicializado: true,
  };
})();
