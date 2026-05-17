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
  let relatoAbertoId = null;  // id do relato atualmente aberto no modal

  // ── REAÇÕES (Sub-fase 2.2) ──
  const REACOES = [
    { tipo: 'quero',          emoji: '✨', texto: 'Quero isso na minha vida' },
    { tipo: 'ja_vivo',        emoji: '💛', texto: 'Já vivo isso' },
    { tipo: 'nao_e_pra_mim',  emoji: '🌿', texto: 'Isso não é para mim' },
    { tipo: 'parabens',       emoji: '🙏', texto: 'Parabéns, você merece' },
  ];
  const ANIM_BAU_KEY = 'vm_bau_animacao_vista';

  function tokenAluna(){
    try { return (window.VmSession && window.VmSession.getAccess()) || null; }
    catch { return null; }
  }

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
        position: relative;
      }
      /* ── BRILHO DOURADO: relato de assinante do Clube ── */
      .vmr-modal-card.vmr-clube {
        border-color: rgba(232,201,122,0.85);
        box-shadow:
          0 0 0 1px rgba(232,201,122,0.35),
          0 0 32px rgba(200,146,42,0.35),
          0 20px 60px rgba(0,0,0,0.55);
        background:
          radial-gradient(ellipse at top, rgba(200,146,42,0.10), transparent 60%),
          #1A1205;
      }
      .vmr-clube-badge {
        display: none;
        position: absolute;
        top: -12px; left: 50%;
        transform: translateX(-50%);
        font-size: .58rem; font-weight: 800;
        letter-spacing: .14em; text-transform: uppercase;
        color: #1A1205;
        background: linear-gradient(135deg, #E8C97A, #C8922A);
        padding: 5px 14px;
        border-radius: 999px;
        box-shadow: 0 4px 14px rgba(200,146,42,0.45);
        white-space: nowrap;
      }
      .vmr-modal-card.vmr-clube .vmr-clube-badge { display: inline-block; }
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

      /* ── BLOCO "RESPOSTA DA SUELLEN" — estilo mensagem ── */
      .vmr-resposta {
        display: flex; align-items: flex-start; gap: .75rem;
        margin-bottom: 1.1rem;
      }
      .vmr-resposta-avatar {
        width: 52px; height: 52px;
        border-radius: 50%;
        background: #2A1808 center/cover no-repeat;
        border: 2px solid rgba(232,201,122,0.55);
        box-shadow: 0 4px 14px rgba(200,146,42,0.25);
        flex-shrink: 0;
        position: relative;
        overflow: hidden;
      }
      .vmr-resposta-avatar img {
        width: 100%; height: 100%; object-fit: cover; display: block;
      }
      .vmr-resposta-avatar-fallback {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        color: #E8C97A; font-weight: 800; font-size: 1.2rem;
        font-family: 'Montserrat', sans-serif;
      }
      .vmr-resposta-bolha {
        flex: 1; min-width: 0;
        background: rgba(200,146,42,0.07);
        border: 1px solid rgba(200,146,42,0.22);
        border-radius: 4px 14px 14px 14px;
        padding: .85rem 1rem;
        position: relative;
      }
      .vmr-resposta-bolha::before {
        content: '';
        position: absolute;
        left: -7px; top: 10px;
        width: 0; height: 0;
        border-top: 7px solid transparent;
        border-bottom: 7px solid transparent;
        border-right: 8px solid rgba(200,146,42,0.22);
      }
      .vmr-resposta-autor {
        font-family: 'Montserrat', sans-serif;
        font-size: .76rem; font-weight: 700;
        color: #F4D998;
        letter-spacing: .02em;
        margin-bottom: .35rem;
      }
      .vmr-resposta-frase {
        font-size: .82rem; line-height: 1.55;
        color: rgba(245,240,232,0.85);
        margin: 0 0 .7rem;
      }
      .vmr-resposta-frase strong {
        color: #F4D998; font-weight: 700;
      }
      .vmr-prod-row {
        display: flex; align-items: center; gap: .7rem;
        padding: .55rem .65rem;
        background: rgba(0,0,0,0.22);
        border: 1px solid rgba(200,146,42,0.15);
        border-radius: 10px;
        margin-bottom: .65rem;
      }
      .vmr-prod-img {
        width: 44px; height: 44px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid rgba(200,146,42,0.25);
        background: rgba(255,255,255,0.04);
        flex-shrink: 0;
      }
      .vmr-prod-info { flex: 1; min-width: 0; }
      .vmr-prod-nome {
        font-family: 'Montserrat', sans-serif;
        font-size: .82rem; font-weight: 700;
        color: #E8C97A;
        line-height: 1.2;
        margin-bottom: 2px;
      }
      .vmr-prod-link {
        font-size: .72rem;
        color: rgba(232,201,122,0.85);
        text-decoration: none;
        border-bottom: 1px dashed rgba(232,201,122,0.35);
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
      /* Sem produto vinculado: oculta o bloco de resposta inteiro */
      .vmr-resposta.vmr-sem-produto { display: none; }

      /* ── BARRA DE REAÇÕES (Sub-fase 2.2) ── */
      .vmr-reacoes {
        display: flex; flex-direction: column;
        gap: 0.55rem;
        margin-top: 0.9rem;
        padding-top: 0.9rem;
        border-top: 1px solid rgba(200,146,42,0.18);
      }
      .vmr-reacoes-label {
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(245,240,232,0.6);
      }
      .vmr-reacoes-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.45rem;
      }
      .vmr-reacao-btn {
        display: flex; align-items: center; gap: 0.55rem;
        padding: 0.55rem 0.7rem;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(200,146,42,0.2);
        border-radius: 10px;
        color: rgba(245,240,232,0.85);
        font-family: 'Open Sans', sans-serif;
        font-size: 0.74rem;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        transition: all 0.18s;
        line-height: 1.3;
        position: relative;
      }
      .vmr-reacao-btn:hover {
        background: rgba(200,146,42,0.08);
        border-color: rgba(200,146,42,0.4);
      }
      .vmr-reacao-btn.vmr-reacao-on {
        background: rgba(200,146,42,0.16);
        border-color: rgba(232,201,122,0.55);
        color: #F4D998;
        box-shadow: 0 0 12px rgba(200,146,42,0.2);
      }
      .vmr-reacao-emoji { font-size: 1.05rem; line-height: 1; flex-shrink: 0; }
      .vmr-reacao-texto { flex: 1; min-width: 0; }
      .vmr-reacao-count {
        font-size: 0.62rem;
        color: rgba(245,240,232,0.5);
        font-weight: 700;
        flex-shrink: 0;
      }
      .vmr-reacao-btn.vmr-reacao-on .vmr-reacao-count { color: #F4D998; }
      .vmr-reacoes-login {
        text-align: center;
        font-size: 0.78rem;
        color: rgba(245,240,232,0.7);
        padding: 0.85rem;
        background: rgba(255,255,255,0.03);
        border: 1px dashed rgba(200,146,42,0.3);
        border-radius: 10px;
      }
      .vmr-reacoes-login a {
        color: #F4D998;
        font-weight: 700;
        text-decoration: none;
        border-bottom: 1px dashed rgba(244,217,152,0.5);
      }
      @media (max-width: 480px) {
        .vmr-reacoes-grid { grid-template-columns: 1fr; }
      }

      /* ── Animação 1ª vez "guardando no Baú" ── */
      .vmr-bau-anim {
        position: fixed; inset: 0;
        display: none;
        align-items: center; justify-content: center;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(6px);
        z-index: 100000;
        pointer-events: none;
      }
      .vmr-bau-anim.vmr-aberta { display: flex; animation: vmrFade .3s; }
      .vmr-bau-anim-conteudo {
        text-align: center; color: #F4D998;
        animation: vmrBauPop .8s cubic-bezier(.34,1.56,.64,1);
      }
      .vmr-bau-anim-icone {
        font-size: 4rem; margin-bottom: 0.7rem;
        filter: drop-shadow(0 4px 18px rgba(200,146,42,0.6));
      }
      .vmr-bau-anim-titulo {
        font-family: 'Montserrat', sans-serif;
        font-size: 1.15rem; font-weight: 800;
        margin-bottom: 0.4rem;
        letter-spacing: 0.02em;
      }
      .vmr-bau-anim-sub {
        font-size: 0.82rem; color: rgba(245,240,232,0.78);
        max-width: 280px; line-height: 1.45;
      }
      @keyframes vmrBauPop {
        0%   { transform: scale(0.5); opacity: 0; }
        50%  { transform: scale(1.08); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }

      .vmr-ver-mais {
        display: block; width: 100%;
        background: transparent;
        color: #E8C97A;
        border: 1px solid rgba(200,146,42,0.4);
        border-radius: 10px;
        padding: .7rem 1rem;
        margin-top: .7rem;
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
        .vmr-resposta-avatar { width: 44px; height: 44px; }
        .vmr-resposta-bolha { padding: .7rem .8rem; }
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
        <div class="vmr-modal-card" id="vmr-modal-card">
          <span class="vmr-clube-badge">💛 Clube Vida Mágica</span>
          <div class="vmr-modal-topo">
            <div class="vmr-modal-info">
              <span class="vmr-tema" id="vmr-tema">—</span>
              <div class="vmr-autor" id="vmr-autor">—</div>
              <div class="vmr-meta" id="vmr-meta"></div>
            </div>
            <button class="vmr-x" type="button" id="vmr-x" aria-label="Fechar">✕</button>
          </div>
          <p class="vmr-texto" id="vmr-texto">—</p>

          <!-- BLOCO RESPOSTA SUELLEN — estilo mensagem -->
          <div class="vmr-resposta" id="vmr-resposta">
            <div class="vmr-resposta-avatar" id="vmr-resposta-avatar">
              <img src="/assets/avatar-suellen.jpg" alt="Suellen Seragi" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
              <div class="vmr-resposta-avatar-fallback" style="display:none">S</div>
            </div>
            <div class="vmr-resposta-bolha">
              <div class="vmr-resposta-autor">Suellen Seragi</div>
              <p class="vmr-resposta-frase">Essa aluna deu esse relato depois de ter praticado o meu material:</p>
              <div class="vmr-prod-row">
                <img class="vmr-prod-img" id="vmr-prod-img" alt="" loading="lazy">
                <div class="vmr-prod-info">
                  <div class="vmr-prod-nome" id="vmr-prod-nome">—</div>
                  <a class="vmr-prod-link" id="vmr-prod-link" href="#">saber mais →</a>
                </div>
              </div>
              <a class="vmr-cta-btn" id="vmr-cta-btn" href="#" target="_blank" rel="noopener">Quero esse material também</a>
            </div>
          </div>

          <!-- BARRA DE REAÇÕES (Sub-fase 2.2) -->
          <div class="vmr-reacoes" id="vmr-reacoes" style="display:none">
            <div class="vmr-reacoes-label">Como esse relato fala com você?</div>
            <div class="vmr-reacoes-grid" id="vmr-reacoes-grid"></div>
          </div>

          <a class="vmr-ver-mais" id="vmr-ver-mais" href="/relatos">Ver mais relatos</a>
        </div>
      </div>

      <!-- Animação "guardando no Baú" (1ª vez que aluna reage) -->
      <div class="vmr-bau-anim" id="vmr-bau-anim">
        <div class="vmr-bau-anim-conteudo">
          <div class="vmr-bau-anim-icone">🧰✨</div>
          <div class="vmr-bau-anim-titulo">Guardando no seu Baú de Relatos</div>
          <div class="vmr-bau-anim-sub">Toda reação sua fica salva aqui. Encontre depois no menu do seu perfil 🌱</div>
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

    // Tema visual usa o slug do relato se vier (modal pode abrir de várias origens, não só da LP atual)
    const slugTema = relato.tema_slug || temaAtual || null;

    document.getElementById('vmr-tema').textContent = relato.tema_nome || (slugTema || '');
    document.getElementById('vmr-autor').textContent = relato.nome || '—';

    const meta = metaDoRelato(relato);
    const mMeta = document.getElementById('vmr-meta');
    mMeta.textContent = meta;
    mMeta.style.display = meta ? 'block' : 'none';

    document.getElementById('vmr-texto').textContent = relato.texto || '';

    // ── Brilho dourado: assinante do Clube ──
    const card = document.getElementById('vmr-modal-card');
    if (relato.autora_era_assinante_clube) card.classList.add('vmr-clube');
    else card.classList.remove('vmr-clube');

    // ── Bloco de resposta da Suellen (produto vinculado ao tema) ──
    const resposta = document.getElementById('vmr-resposta');
    const produtoSlug = relato.produto_slug || null;
    const produto = produtoSlug && PRECOS ? PRECOS[produtoSlug] : null;

    if (!produto){
      resposta.classList.add('vmr-sem-produto');
    } else {
      resposta.classList.remove('vmr-sem-produto');
      const img = document.getElementById('vmr-prod-img');
      img.src = produto.imagem_url || '';
      img.alt = produto.nome || '';
      img.style.display = produto.imagem_url ? 'block' : 'none';

      document.getElementById('vmr-prod-nome').textContent = produto.nome || '—';

      const link = document.getElementById('vmr-prod-link');
      const lp = SLUG_LP[slugTema];
      if (lp){ link.href = lp; link.style.display = 'inline'; }
      else { link.style.display = 'none'; }

      const btn = document.getElementById('vmr-cta-btn');
      const checkout = produto.link_checkout_padrao;
      if (checkout){ btn.href = checkout; btn.classList.remove('vmr-disabled'); }
      else { btn.removeAttribute('href'); btn.classList.add('vmr-disabled'); }
    }

    // Botão "Ver mais relatos" sempre leva pra /relatos#tema
    const verMais = document.getElementById('vmr-ver-mais');
    verMais.href = slugTema ? `/relatos#${slugTema}` : '/relatos';

    // ── Barra de reações (Sub-fase 2.2) ──
    relatoAbertoId = relato.id || null;
    montarReacoes(relato);

    // ── Registra visualização (Sub-fase 2.5 — anti-repetição) ──
    // Só se aluna logada E relato tem id. Fire-and-forget, sem bloquear UI.
    if (relatoAbertoId) {
      const token = tokenAluna();
      if (token) {
        fetch(`/api/app/relato/${relatoAbertoId}/visto`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token }
        }).catch(() => {});
      }
    }

    document.getElementById('vmr-modal').classList.add('vmr-aberto');
    document.body.style.overflow = 'hidden';
  }

  // ────────────────────── REAÇÕES ──────────────────────
  function montarReacoes(relato){
    const box = document.getElementById('vmr-reacoes');
    const grid = document.getElementById('vmr-reacoes-grid');
    if (!box || !grid) return;

    // Sem id do relato (caso edge) → esconde
    if (!relato || !relato.id){ box.style.display = 'none'; return; }

    const token = tokenAluna();
    if (!token){
      // Não logada: mostra convite pra entrar
      box.style.display = 'block';
      grid.innerHTML = `
        <div class="vmr-reacoes-login" style="grid-column: 1 / -1">
          <a href="/auth">Entre na sua conta</a> pra abençoar essa pessoa e guardar este relato no seu Baú.
        </div>
      `;
      return;
    }

    box.style.display = 'block';
    // Renderiza os 4 botões (zerados; busca o estado depois)
    grid.innerHTML = REACOES.map(r => `
      <button type="button" class="vmr-reacao-btn" data-reacao="${r.tipo}" onclick="VmRelatos.toggleReacao('${r.tipo}')">
        <span class="vmr-reacao-emoji">${r.emoji}</span>
        <span class="vmr-reacao-texto">${r.texto}</span>
        <span class="vmr-reacao-count" data-count="${r.tipo}"></span>
      </button>
    `).join('');

    // Busca estado atual (minhas_reacoes + contagens públicas)
    carregarEstadoReacoes(relato.id);
  }

  async function carregarEstadoReacoes(relatoId){
    const token = tokenAluna(); if (!token) return;
    try {
      const r = await fetch(`/api/app/relato/${relatoId}/reacoes`, {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
      });
      if (!r.ok) return;
      const data = await r.json();
      aplicarEstadoReacoes(data.minhas_reacoes || [], data.contagens || {});
    } catch {}
  }

  function aplicarEstadoReacoes(minhas, contagens){
    REACOES.forEach(r => {
      const btn = document.querySelector(`.vmr-reacao-btn[data-reacao="${r.tipo}"]`);
      const cnt = document.querySelector(`.vmr-reacao-count[data-count="${r.tipo}"]`);
      if (btn){
        if (minhas.includes(r.tipo)) btn.classList.add('vmr-reacao-on');
        else btn.classList.remove('vmr-reacao-on');
      }
      if (cnt){
        const n = contagens[r.tipo] || 0;
        cnt.textContent = n > 0 ? n : '';
      }
    });
  }

  async function toggleReacao(tipo){
    const token = tokenAluna();
    if (!token || !relatoAbertoId) return;
    const btn = document.querySelector(`.vmr-reacao-btn[data-reacao="${tipo}"]`);
    const jaAtiva = btn?.classList.contains('vmr-reacao-on');

    // Otimismo visual: já marca/desmarca antes de bater no servidor
    try {
      let res;
      if (jaAtiva){
        res = await fetch(`/api/app/relato/${relatoAbertoId}/reagir?tipo=${tipo}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        });
      } else {
        res = await fetch(`/api/app/relato/${relatoAbertoId}/reagir`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipo })
        });
      }
      if (!res.ok) return;
      const data = await res.json();
      aplicarEstadoReacoes(data.minhas_reacoes || [], data.contagens || {});

      // Animação "guardando no Baú" — só 1ª vez na vida da aluna
      if (!jaAtiva && !localStorage.getItem(ANIM_BAU_KEY)){
        mostrarAnimBau();
        localStorage.setItem(ANIM_BAU_KEY, '1');
      }
    } catch {}
  }

  function mostrarAnimBau(){
    const el = document.getElementById('vmr-bau-anim');
    if (!el) return;
    el.classList.add('vmr-aberta');
    setTimeout(() => el.classList.remove('vmr-aberta'), 2400);
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
    toggleReacao,
    __inicializado: true,
  };
})();
